"""
Safaricom Daraja API client.

Handles OAuth, STK Push, B2C, B2B, Transaction Status, and Reversal.
All endpoints are async (callback-driven) — we initiate and receive results via webhook.

Callback security: Uses per-transaction HMAC tokens in callback URLs.
See apps.mpesa.middleware for token generation and verification.
"""

import base64
import logging
from datetime import datetime
from pathlib import Path

import requests
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.x509 import load_pem_x509_certificate
from django.conf import settings

from .middleware import build_callback_url

logger = logging.getLogger(__name__)


class MpesaError(Exception):
    pass


class MpesaClient:
    SANDBOX_BASE = "https://sandbox.safaricom.co.ke"
    PRODUCTION_BASE = "https://api.safaricom.co.ke"

    def __init__(self):
        self.environment = settings.MPESA_ENVIRONMENT
        self.base_url = (
            self.PRODUCTION_BASE if self.environment == "production" else self.SANDBOX_BASE
        )
        self.consumer_key = settings.MPESA_CONSUMER_KEY
        self.consumer_secret = settings.MPESA_CONSUMER_SECRET
        self.shortcode = settings.MPESA_SHORTCODE
        self.passkey = settings.MPESA_PASSKEY
        self.callback_base = settings.MPESA_CALLBACK_BASE_URL
        self._access_token = None
        self._token_expiry = None

    @property
    def access_token(self) -> str:
        """Get OAuth access token, caching for reuse."""
        if self._access_token and self._token_expiry and datetime.now() < self._token_expiry:
            return self._access_token

        url = f"{self.base_url}/oauth/v1/generate?grant_type=client_credentials"
        credentials = base64.b64encode(
            f"{self.consumer_key}:{self.consumer_secret}".encode()
        ).decode()

        response = requests.get(
            url,
            headers={"Authorization": f"Basic {credentials}"},
            timeout=30,
        )
        response.raise_for_status()

        data = response.json()
        self._access_token = data["access_token"]
        # Token valid for ~3600s, refresh at 3000s to be safe
        from datetime import timedelta
        self._token_expiry = datetime.now() + timedelta(seconds=3000)
        return self._access_token

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def _generate_password(self) -> tuple[str, str]:
        """Generate the STK Push password: base64(shortcode + passkey + timestamp).
        Uses Africa/Nairobi timezone explicitly to match Safaricom's EAT expectation."""
        from zoneinfo import ZoneInfo
        timestamp = datetime.now(tz=ZoneInfo("Africa/Nairobi")).strftime("%Y%m%d%H%M%S")
        raw = f"{self.shortcode}{self.passkey}{timestamp}"
        password = base64.b64encode(raw.encode()).decode()
        return password, timestamp

    def stk_push(self, phone: str, amount: int, account_ref: str, description: str = "", transaction_id: str = "") -> dict:
        """
        Initiate an STK Push (Lipa Na M-Pesa Online).
        Used for: User buying crypto with M-Pesa.
        """
        phone = self._normalize_phone(phone)
        password, timestamp = self._generate_password()

        # Build secure callback URL with per-transaction HMAC token
        callback_url = build_callback_url("stk", transaction_id or account_ref)

        payload = {
            "BusinessShortCode": self.shortcode,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": amount,
            "PartyA": phone,
            "PartyB": self.shortcode,
            "PhoneNumber": phone,
            "CallBackURL": callback_url,
            "AccountReference": account_ref,
            "TransactionDesc": description or "CryptoPay deposit",
        }

        response = requests.post(
            f"{self.base_url}/mpesa/stkpush/v1/processrequest",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        data = response.json()

        if data.get("ResponseCode") != "0":
            raise MpesaError(f"STK Push failed: {data.get('ResponseDescription', data)}")

        logger.info(f"STK Push initiated: {data.get('CheckoutRequestID')}")
        return data

    def register_c2b_urls(self) -> dict:
        """
        Register C2B validation and confirmation URLs with Safaricom.
        One-time setup per environment. URLs must be HTTPS.

        IMPORTANT: Do not include "mpesa" or "safaricom" in callback URL paths
        — Safaricom filters and blocks them.
        """
        payload = {
            "ShortCode": self.shortcode,
            "ResponseType": getattr(
                settings, "MPESA_C2B_RESPONSE_TYPE", "Completed"
            ),
            "ConfirmationURL": f"{self.callback_base}/api/v1/mpesa/callback/c2b/confirm/",
            "ValidationURL": f"{self.callback_base}/api/v1/mpesa/callback/c2b/validate/",
        }

        response = requests.post(
            f"{self.base_url}/mpesa/c2b/v1/registerurl",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        data = response.json()

        if data.get("ResponseCode") != "0" and data.get("ResponseDescription", "").lower() != "success":
            raise MpesaError(f"C2B URL registration failed: {data}")

        logger.info(f"C2B URLs registered: {data}")
        return data

    def stk_query(self, checkout_request_id: str) -> dict:
        """Query the status of an STK Push transaction."""
        password, timestamp = self._generate_password()

        payload = {
            "BusinessShortCode": self.shortcode,
            "Password": password,
            "Timestamp": timestamp,
            "CheckoutRequestID": checkout_request_id,
        }

        response = requests.post(
            f"{self.base_url}/mpesa/stkpushquery/v1/query",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        return response.json()

    @staticmethod
    def _normalize_phone(phone: str) -> str:
        """Normalize phone to 254XXXXXXXXX format (no +, no spaces)."""
        phone = phone.strip().replace(" ", "").replace("-", "")
        if phone.startswith("+"):
            phone = phone[1:]
        if phone.startswith("0"):
            phone = "254" + phone[1:]
        return phone

    def b2c_payment(self, phone: str, amount: int, remarks: str = "", transaction_id: str = "") -> dict:
        """
        B2C payment (send money to user's M-Pesa).
        Used for: User selling crypto, receiving KES.
        """
        phone = self._normalize_phone(phone)
        tx_ref = transaction_id or f"b2c-{phone}"
        payload = {
            "InitiatorName": settings.MPESA_INITIATOR_NAME,
            "SecurityCredential": self._get_security_credential(),
            "CommandID": "BusinessPayment",
            "Amount": amount,
            "PartyA": settings.MPESA_B2C_SHORTCODE or self.shortcode,
            "PartyB": phone,
            "Remarks": remarks or "CryptoPay payout",
            "QueueTimeOutURL": f"{self.callback_base}/api/v1/mpesa/callback/b2c/timeout/",
            "ResultURL": build_callback_url("b2c", tx_ref),
            "Occasion": "",
        }

        response = requests.post(
            f"{self.base_url}/mpesa/b2c/v1/paymentrequest",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        data = response.json()

        if data.get("ResponseCode") != "0":
            msg = data.get("ResponseDescription") or data.get("errorMessage") or str(data)
            raise MpesaError(f"B2C failed: {msg}")

        return data

    def b2b_payment(self, paybill: str, account: str, amount: int, remarks: str = "", transaction_id: str = "") -> dict:
        """
        B2B payment (pay a Paybill from our shortcode).
        Used for: The core crypto-to-Paybill flow.
        """
        tx_ref = transaction_id or f"b2b-{paybill}-{account}"
        payload = {
            "Initiator": settings.MPESA_INITIATOR_NAME,
            "SecurityCredential": self._get_security_credential(),
            "CommandID": "BusinessPayBill",
            "SenderIdentifierType": "4",
            "RecieverIdentifierType": "4",
            "Amount": amount,
            "PartyA": self.shortcode,
            "PartyB": paybill,
            "AccountReference": account,
            "Remarks": remarks or "CryptoPay bill payment",
            "QueueTimeOutURL": f"{self.callback_base}/api/v1/mpesa/callback/b2b/timeout/",
            "ResultURL": build_callback_url("b2b", tx_ref),
        }

        response = requests.post(
            f"{self.base_url}/mpesa/b2b/v1/paymentrequest",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        data = response.json()

        if data.get("ResponseCode") != "0":
            raise MpesaError(f"B2B failed: {data.get('ResponseDescription', data)}")

        return data

    def buy_goods(self, till: str, amount: int, remarks: str = "", transaction_id: str = "") -> dict:
        """B2B BuyGoods — pay a Till number."""
        tx_ref = transaction_id or f"till-{till}"
        payload = {
            "Initiator": settings.MPESA_INITIATOR_NAME,
            "SecurityCredential": self._get_security_credential(),
            "CommandID": "BusinessBuyGoods",
            "SenderIdentifierType": "4",
            "RecieverIdentifierType": "2",
            "Amount": amount,
            "PartyA": self.shortcode,
            "PartyB": till,
            "Remarks": remarks or "CryptoPay till payment",
            "QueueTimeOutURL": f"{self.callback_base}/api/v1/mpesa/callback/b2b/timeout/",
            "ResultURL": build_callback_url("b2b", tx_ref),
        }

        response = requests.post(
            f"{self.base_url}/mpesa/b2b/v1/paymentrequest",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        data = response.json()

        if data.get("ResponseCode") != "0":
            raise MpesaError(f"BuyGoods failed: {data.get('ResponseDescription', data)}")

        return data

    def transaction_status(self, transaction_id: str) -> dict:
        """Query the status of any M-Pesa transaction (fallback when callback times out)."""
        payload = {
            "Initiator": settings.MPESA_INITIATOR_NAME,
            "SecurityCredential": self._get_security_credential(),
            "CommandID": "TransactionStatusQuery",
            "TransactionID": transaction_id,
            "PartyA": self.shortcode,
            "IdentifierType": "4",
            "ResultURL": f"{self.callback_base}/api/v1/mpesa/callback/status/",
            "QueueTimeOutURL": f"{self.callback_base}/api/v1/mpesa/callback/status/timeout/",
            "Remarks": "Status query",
            "Occasion": "",
        }

        response = requests.post(
            f"{self.base_url}/mpesa/transactionstatus/v1/query",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        return response.json()

    def reversal(self, transaction_id: str, amount: int, remarks: str = "") -> dict:
        """Request reversal of a completed M-Pesa transaction."""
        payload = {
            "Initiator": settings.MPESA_INITIATOR_NAME,
            "SecurityCredential": self._get_security_credential(),
            "CommandID": "TransactionReversal",
            "TransactionID": transaction_id,
            "Amount": amount,
            "ReceiverParty": self.shortcode,
            "RecieverIdentifierType": "4",
            "ResultURL": f"{self.callback_base}/api/v1/mpesa/callback/reversal/",
            "QueueTimeOutURL": f"{self.callback_base}/api/v1/mpesa/callback/reversal/timeout/",
            "Remarks": remarks or "CryptoPay reversal",
            "Occasion": "",
        }

        response = requests.post(
            f"{self.base_url}/mpesa/reversal/v1/request",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        return response.json()

    def account_balance(self) -> dict:
        """Check the M-Pesa float balance."""
        payload = {
            "Initiator": settings.MPESA_INITIATOR_NAME,
            "SecurityCredential": self._get_security_credential(),
            "CommandID": "AccountBalance",
            "PartyA": self.shortcode,
            "IdentifierType": "4",
            "Remarks": "Balance check",
            "QueueTimeOutURL": f"{self.callback_base}/api/v1/mpesa/callback/balance/timeout/",
            "ResultURL": f"{self.callback_base}/api/v1/mpesa/callback/balance/",
        }

        response = requests.post(
            f"{self.base_url}/mpesa/accountbalance/v1/query",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        return response.json()

    def _get_security_credential(self) -> str:
        """
        Encrypt the initiator password with Safaricom's RSA public certificate.

        Steps:
        1. Load the PEM certificate from disk (sandbox or production).
        2. Extract the RSA public key.
        3. Encrypt the initiator password using PKCS1v15 padding.
        4. Base64-encode the ciphertext.
        """
        cert_path = Path(getattr(settings, "MPESA_CERT_PATH", ""))

        # Auto-resolve: if explicit path not set, try environment-specific cert
        if not cert_path.is_file():
            auto_path = Path(f"certs/{'sandbox' if self.environment == 'sandbox' else 'production'}.cer")
            if auto_path.is_file():
                cert_path = auto_path

        if not cert_path.is_file():
            raise MpesaError(
                f"M-Pesa certificate not found at {cert_path}. "
                f"B2C/B2B operations require a valid Safaricom certificate. "
                f"Download from Daraja portal and place in certs/ directory."
            )

        cert_pem = cert_path.read_bytes()
        certificate = load_pem_x509_certificate(cert_pem)
        public_key = certificate.public_key()

        encrypted = public_key.encrypt(
            settings.MPESA_INITIATOR_PASSWORD.encode("utf-8"),
            asym_padding.PKCS1v15(),
        )

        return base64.b64encode(encrypted).decode("utf-8")
