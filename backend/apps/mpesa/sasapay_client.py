"""
SasaPay Payment API client.

Alternative to Safaricom Daraja — CBK-licensed PSP that handles M-Pesa,
Airtel Money, T-Kash, and bank payments through a single API.

No Safaricom business shortcode needed — SasaPay provides the payment
infrastructure. Supports B2B (Paybill/Till), B2C (send to mobile),
and C2B (STK Push collection).

Switch between Daraja and SasaPay via PAYMENT_PROVIDER env var.
"""

import base64
import hashlib
import hmac
import json
import logging
import time
import uuid

import requests
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)


class SasaPayError(Exception):
    """SasaPay API error."""
    pass


class SasaPayClient:
    SANDBOX_BASE = "https://sandbox.sasapay.app/api/v1"
    PRODUCTION_BASE = "https://api.sasapay.app/api/v1"

    def __init__(self):
        self.environment = getattr(settings, "SASAPAY_ENVIRONMENT", "sandbox")
        self.base_url = (
            self.PRODUCTION_BASE if self.environment == "production" else self.SANDBOX_BASE
        )
        self.client_id = settings.SASAPAY_CLIENT_ID
        self.client_secret = settings.SASAPAY_CLIENT_SECRET
        self.merchant_code = settings.SASAPAY_MERCHANT_CODE
        self.callback_url = getattr(settings, "SASAPAY_CALLBACK_URL", "")

    # ── Authentication ─────────────────────────────────────────────────────

    def _get_access_token(self) -> str:
        """Get OAuth token, cached until near expiry."""
        cached = cache.get("sasapay_access_token")
        if cached:
            return cached

        credentials = f"{self.client_id}:{self.client_secret}"
        encoded = base64.b64encode(credentials.encode()).decode()

        try:
            response = requests.get(
                f"{self.base_url}/auth/token/",
                params={"grant_type": "client_credentials"},
                headers={"Authorization": f"Basic {encoded}"},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
        except requests.exceptions.RequestException as e:
            raise SasaPayError(f"SasaPay auth failed: {e}") from e

        if not data.get("status"):
            raise SasaPayError(f"SasaPay auth error: {data.get('detail', 'Unknown')}")

        token = data["access_token"]
        expires_in = data.get("expires_in", 3600)
        cache.set("sasapay_access_token", token, timeout=max(expires_in - 300, 60))
        return token

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._get_access_token()}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, json_data: dict = None,
                 retries: int = 3) -> dict:
        """Make authenticated request with retry/backoff."""
        url = f"{self.base_url}{path}"
        last_error = None

        for attempt in range(retries):
            try:
                resp = requests.request(
                    method, url, headers=self._headers(),
                    json=json_data, timeout=30,
                )
                if resp.status_code == 429:
                    wait = min(2 ** attempt * 5, 60)
                    logger.warning(f"SasaPay rate limited, waiting {wait}s")
                    time.sleep(wait)
                    continue
                if resp.status_code == 401:
                    cache.delete("sasapay_access_token")
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.exceptions.ConnectionError as e:
                last_error = e
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
            except requests.exceptions.HTTPError as e:
                if e.response is not None and e.response.status_code >= 500:
                    last_error = e
                    if attempt < retries - 1:
                        time.sleep(2 ** attempt)
                        continue
                raise SasaPayError(
                    f"SasaPay API error: HTTP {e.response.status_code} — {e.response.text[:200]}"
                ) from e

        raise SasaPayError(f"SasaPay request failed after {retries} retries: {last_error}")

    # ── B2B — Pay Paybill / Till ───────────────────────────────────────────

    def pay_paybill(self, receiver_code: str, account_ref: str, amount: float,
                    reference: str = None, callback_url: str = None) -> dict:
        """
        Pay a Paybill number via M-Pesa.

        Args:
            receiver_code: The target Paybill number (e.g., "888880")
            account_ref: Account number at the biller
            amount: KES amount to pay
            reference: Unique transaction reference (auto-generated if None)
            callback_url: Override default callback URL
        """
        return self._request("POST", "/payments/b2b/", {
            "MerchantCode": self.merchant_code,
            "MerchantTransactionReference": reference or str(uuid.uuid4()),
            "Currency": "KES",
            "Amount": str(amount),
            "ReceiverMerchantCode": receiver_code,
            "AccountReference": account_ref,
            "ReceiverAccountType": "PAYBILL",
            "NetworkCode": "63902",  # M-Pesa
            "Reason": "Bill payment",
            "CallBackURL": callback_url or self.callback_url,
        })

    def pay_till(self, receiver_code: str, amount: float,
                 reference: str = None, callback_url: str = None) -> dict:
        """
        Pay a Till number via M-Pesa.

        Args:
            receiver_code: The target Till number (e.g., "5432100")
            amount: KES amount to pay
        """
        return self._request("POST", "/payments/b2b/", {
            "MerchantCode": self.merchant_code,
            "MerchantTransactionReference": reference or str(uuid.uuid4()),
            "Currency": "KES",
            "Amount": str(amount),
            "ReceiverMerchantCode": receiver_code,
            "AccountReference": "",
            "ReceiverAccountType": "TILL",
            "NetworkCode": "63902",
            "Reason": "Payment",
            "CallBackURL": callback_url or self.callback_url,
        })

    # ── B2C — Send Money to Mobile ────────────────────────────────────────

    def send_to_mobile(self, phone: str, amount: float, reason: str = "Payment",
                       reference: str = None, callback_url: str = None) -> dict:
        """
        Send money to an M-Pesa phone number.
        Funds deducted from Utility Account (must fund it first).

        Args:
            phone: Recipient phone (format: 254XXXXXXXXX)
            amount: KES amount to send
        """
        return self._request("POST", "/payments/b2c/", {
            "MerchantCode": self.merchant_code,
            "Amount": str(amount),
            "Currency": "KES",
            "MerchantTransactionReference": reference or str(uuid.uuid4()),
            "ReceiverNumber": phone,
            "Channel": "63902",  # M-Pesa
            "Reason": reason,
            "CallBackURL": callback_url or self.callback_url,
        })

    # ── C2B — Collect Payment (STK Push) ──────────────────────────────────

    def stk_push(self, phone: str, amount: float, account_ref: str,
                 description: str = "Payment",
                 callback_url: str = None) -> dict:
        """
        Initiate M-Pesa STK Push to collect payment from customer.

        Args:
            phone: Customer phone (format: 254XXXXXXXXX)
            amount: KES amount to collect
            account_ref: Account reference / invoice number
        """
        return self._request("POST", "/payments/request-payment/", {
            "MerchantCode": self.merchant_code,
            "NetworkCode": "63902",
            "PhoneNumber": phone,
            "Amount": str(amount),
            "Currency": "KES",
            "AccountReference": account_ref,
            "TransactionDesc": description,
            "CallBackURL": callback_url or self.callback_url,
            "TransactionFee": 0,
        })

    # ── Utility APIs ──────────────────────────────────────────────────────

    def check_balance(self) -> dict:
        """Get merchant account balances (Working, Utility, Bulk Payment)."""
        return self._request("GET", f"/payments/check-balance/?MerchantCode={self.merchant_code}")

    def move_funds_to_utility(self, amount: float) -> dict:
        """Move funds from Working Account to Utility Account (required before B2C)."""
        return self._request("POST", "/transactions/fund-movement/", {
            "merchantCode": self.merchant_code,
            "amount": amount,
        })

    def query_transaction(self, checkout_request_id: str = None,
                          reference: str = None,
                          transaction_code: str = None) -> dict:
        """Query transaction status."""
        payload = {"MerchantCode": self.merchant_code}
        if checkout_request_id:
            payload["CheckoutRequestId"] = checkout_request_id
        if reference:
            payload["MerchantTransactionReference"] = reference
        if transaction_code:
            payload["TransactionCode"] = transaction_code
        payload["CallbackUrl"] = self.callback_url
        return self._request("POST", "/transactions/status-query/", payload)

    def verify_transaction(self, transaction_code: str) -> dict:
        """Verify a completed transaction."""
        return self._request("POST", "/transactions/verify/", {
            "merchantCode": self.merchant_code,
            "transactionCode": transaction_code,
        })

    def validate_account(self, phone: str, channel: str = "63902") -> dict:
        """Validate a mobile money / bank account before transfer."""
        return self._request("POST", "/accounts/account-validation/", {
            "merchant_code": self.merchant_code,
            "channel_code": channel,
            "account_number": phone,
        })
