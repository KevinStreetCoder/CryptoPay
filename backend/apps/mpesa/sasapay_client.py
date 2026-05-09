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


# 2026-05-09 · Channel codes per the SasaPay docs at
# https://developer.sasapay.app/docs/apis/b2c?country=ke
# Used by B2C (Send Money) to select the destination rail · the same
# codes appear in NetworkCode for C2B (STK Push) for the mobile-money
# rails (M-PESA, Airtel, T-Kash) but the bank codes are B2C-only.
SASAPAY_CHANNELS = {
    # Mobile money / wallet
    "0":     "SasaPay",
    "63902": "M-PESA",
    "63903": "Airtel Money",
    "63907": "T-Kash",
    # Banks (B2C-only · Paybill/Till payments via B2B use a separate
    # ReceiverMerchantCode lookup, not these channel codes)
    "01":    "KCB",
    "02":    "Standard Chartered",
    "03":    "Absa",
    "07":    "NCBA",
    "10":    "Prime Bank",
    "11":    "Co-operative Bank",
    "12":    "National Bank",
    "14":    "M-Oriental",
    "16":    "Citibank",
    "18":    "Middle East Bank",
    "19":    "Bank of Africa",
    "23":    "Consolidated Bank",
    "25":    "Credit Bank",
    "31":    "Stanbic",
    "35":    "ABC Bank",
    "36":    "Choice MFB",
    "43":    "Ecobank",
    "50":    "Paramount",
    "51":    "Kingdom Bank",
    "53":    "Guaranty",
    "54":    "Victoria",
    "55":    "Guardian",
    "57":    "I&M",
    "61":    "HFC",
    "63":    "DTB",
    "65":    "Mayfair",
    "66":    "Sidian",
    "68":    "Equity",
    "70":    "Family Bank",
    "72":    "Gulf African",
    "74":    "First Community",
    "75":    "DIB",
    "76":    "UBA",
    "78":    "KWFT",
    "89":    "Stima Sacco",
    "97":    "Telkom",
}


def channel_name(code: str) -> str:
    """Resolve a SasaPay channel code to its human-readable name."""
    return SASAPAY_CHANNELS.get(str(code), f"Channel {code}")


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
        last_status = None
        last_body = None

        for attempt in range(retries):
            try:
                resp = requests.request(
                    method, url, headers=self._headers(),
                    json=json_data, timeout=30,
                )
                if resp.status_code == 429:
                    last_status = 429
                    last_body = resp.text[:200]
                    wait = min(2 ** attempt * 5, 60)
                    logger.warning(f"SasaPay rate limited, waiting {wait}s")
                    time.sleep(wait)
                    continue
                if resp.status_code == 401:
                    # 2026-05-09 · capture the 401 body so the surfaced
                    # error explains WHICH endpoint SasaPay refused, not
                    # just "after 3 retries: None". A 401 on B2C with a
                    # working OAuth token means the merchant isn't
                    # enabled for B2C in production; ops can act on that
                    # message without tailing logs.
                    last_status = 401
                    last_body = resp.text[:200]
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

        # If we exhausted retries on 401, surface a clear merchant-config
        # diagnostic instead of "None"; otherwise fall through to the
        # ConnectionError-style message.
        if last_status == 401:
            raise SasaPayError(
                f"SasaPay refused {path} with HTTP 401 ({last_body or 'Authorization Failure'}). "
                "If OAuth works but this endpoint 401s, the merchant likely isn't enabled for "
                "this product yet (e.g. B2C/SendMoney) · contact SasaPay support to enable it."
            )
        if last_status == 429:
            raise SasaPayError(
                f"SasaPay rate-limited {path} after {retries} attempts. Backoff and retry."
            )
        raise SasaPayError(f"SasaPay request failed after {retries} retries: {last_error}")

    # ── Utility paybills · routed through /utilities/ not /payments/b2b/ ──
    #
    # 2026-05-09 · per docs.sasapay.app, KPLC / DSTV / GOTV / Nairobi
    # Water etc. use a SEPARATE Utilities API endpoint that returns the
    # prepaid token in a dedicated `Pin` field on the callback. The
    # generic /payments/b2b/ endpoint requires the merchant to have a
    # "B2B Paybill" product enabled (sandbox accounts and most prod
    # merchants don't have this · it returns ResultCode SP01002 with
    # "request not permitted according to product assignment").
    #
    # For utility paybills we MUST route to /utilities/ instead.
    # Mapping below covers the common Kenyan utilities. Anything not
    # in this map falls through to the regular B2B path.
    #
    # The serviceCode values come from the SasaPay docs · operators
    # who roll out new utilities can extend this map without code
    # changes via the `SASAPAY_UTILITY_SERVICE_CODES` Django setting.
    UTILITY_PAYBILL_SERVICE_CODES = {
        "888880": "SP-KPLC",            # KPLC Prepaid
        "888888": "SP-KPLC-POSTPAID",   # KPLC Postpaid
        "444900": "SP-DSTV",            # DSTV
        "423655": "SP-GOTV",            # GOTV (Multichoice)
        "320320": "SP-ZUKU",            # Zuku Internet/TV
        "888888-water": "SP-NRB-WATER", # Nairobi Water (sentinel)
    }

    def _utility_service_code_for_paybill(self, paybill: str) -> str | None:
        """Return the SasaPay utility serviceCode for a paybill, or None."""
        # Operator override · settings can extend / override the map
        # without a deploy when SasaPay onboards new utilities.
        override = getattr(settings, "SASAPAY_UTILITY_SERVICE_CODES", {}) or {}
        if paybill in override:
            return override[paybill]
        return self.UTILITY_PAYBILL_SERVICE_CODES.get(str(paybill))

    def pay_utility(
        self,
        paybill: str,
        account_number: str,
        amount: float,
        contact_phone: str,
        service_code: str,
        reference: str | None = None,
        callback_url: str | None = None,
    ) -> dict:
        """Pay a utility bill (KPLC, DSTV, GOTV, Zuku, Nairobi Water).

        Routes through `/utilities/` which is the ONLY SasaPay endpoint
        that returns the biller's prepaid token in the callback `Pin`
        field. The generic /payments/b2b/ endpoint will not work for
        these paybills (returns SP01002 unless the merchant has
        explicitly been granted the B2B Paybill product, which most
        accounts don't have).

        Args:
            paybill: Biller paybill number (e.g. "888880" for KPLC).
            account_number: Customer account at the biller (meter,
                            smartcard, water account number).
            amount: KES amount to pay (integer; the API expects whole
                    KES, not decimals).
            contact_phone: Phone to receive the biller's notification
                           SMS (with the prepaid token for KPLC etc.).
                           Normalise to 254XXXXXXXXX before passing.
            service_code: SasaPay serviceCode like "SP-KPLC",
                          "SP-DSTV", etc. Use
                          `_utility_service_code_for_paybill()` to
                          resolve from a paybill number.
            reference: Unique merchant tx ref · auto-uuid if not given.
            callback_url: Override default callback URL.
        """
        return self._request("POST", "/utilities/", {
            "transactionReference": reference or str(uuid.uuid4()),
            "merchantCode": self.merchant_code,
            "serviceCode": service_code,
            "contactNumber": contact_phone,
            "accountNumber": account_number,
            "currencyCode": "KES",
            "amount": int(round(float(amount))),
            "callbackUrl": callback_url or self.callback_url,
        })

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
                       reference: str = None, callback_url: str = None,
                       channel: str = "63902",
                       auto_topup_utility: bool = True) -> dict:
        """
        Send money to a mobile-money / bank account via SasaPay B2C.
        Funds deducted from the Utility Account (must be topped up first ·
        we attempt that automatically when `auto_topup_utility` is True).

        Args:
            phone: Recipient phone OR bank account number (format
                   `254XXXXXXXXX` for mobile money). For banks, pass
                   the account number string and set `channel` to the
                   bank code from SASAPAY_CHANNELS.
            amount: KES amount to send. Minimum is KES 10 (server-
                    enforced, undocumented).
            channel: One of SASAPAY_CHANNELS keys. Default `"63902"`
                     (M-PESA). Use `"63903"` for Airtel, `"63907"` for
                     T-Kash, `"68"` for Equity bank, etc.
            auto_topup_utility: When True (default) and Utility balance
                                is below `amount`, we move the gap from
                                Working → Utility before the B2C call.
        """
        if auto_topup_utility:
            # Best-effort · don't fail B2C if the topup probe errors,
            # the actual B2C call's response will surface the real
            # insufficient-balance error.
            try:
                self.ensure_utility_balance(amount)
            except Exception:
                logger.exception("send_to_mobile.utility_topup_failed (continuing)")

        return self._request("POST", "/payments/b2c/", {
            "MerchantCode": self.merchant_code,
            "Amount": str(amount),
            "Currency": "KES",
            "MerchantTransactionReference": reference or str(uuid.uuid4()),
            "ReceiverNumber": phone,
            "Channel": channel,
            "Reason": reason,
            "CallBackURL": callback_url or self.callback_url,
        })

    # ── C2B — Collect Payment (STK Push) ──────────────────────────────────

    def stk_push(self, phone: str, amount: float, account_ref: str,
                 description: str = "Payment",
                 callback_url: str = None,
                 network: str = "63902") -> dict:
        """
        Initiate STK Push to collect payment from customer.

        Args:
            phone: Customer phone (format: 254XXXXXXXXX)
            amount: KES amount to collect
            account_ref: Account reference · returned to us as
                         `BillRefNumber` on the IPN callback so we
                         can reconcile to the originating Transaction.
            network: SasaPay network code · `"63902"` M-PESA (default),
                     `"63903"` Airtel Money, `"63907"` T-Kash, `"0"`
                     SasaPay wallet (uses OTP flow not STK).
        """
        return self._request("POST", "/payments/request-payment/", {
            "MerchantCode": self.merchant_code,
            "NetworkCode": network,
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
        """Move funds from Working Account to Utility Account.

        REQUIRED before any B2C call · per the SasaPay docs at
        https://developer.sasapay.app/docs/apis/internal-fund-movement
        and https://developer.sasapay.app/docs/apis/b2c, B2C debits
        the Utility Account specifically (not Working). C2B + B2B
        receipts land in Working. So the merchant MUST move funds
        Working → Utility before the saga's B2C step or the call
        will fail with "insufficient utility balance".

        Direction is fixed (always Working → Utility); the endpoint
        has no source/destination params · just amount + merchant.
        Synchronous, returns `{status, message}`.
        """
        return self._request("POST", "/transactions/fund-movement/", {
            "merchantCode": self.merchant_code,
            "amount": str(amount),
        })

    def ensure_utility_balance(self, required_amount) -> bool:
        """Best-effort top-up · check Utility balance, move funds from
        Working if Utility < required + SMS_COST + buffer.

        2026-05-09 audit fix · the previous calc used `required * 1.05`
        which on a 10 KES send produced `required = 10.5`. Utility had
        exactly 10.5 so the topup was SKIPPED · then SasaPay rejected
        the B2C with "Insufficient balance to send KES 10.00.
        Transaction cost KES 0.0. SMS cost KES 1." because they need
        amount + SMS cost (~1 KES) + tx cost. The 5% buffer (0.5 KES)
        couldn't cover the 1 KES SMS fee.

        Now the formula is `amount + SMS_COST_KES + max(MIN_BUFFER, 10%)`
        so:
          - 10 KES send → topup ensures Utility ≥ 10 + 3 + 1 = 14
          - 100 KES send → ≥ 100 + 3 + 10 = 113
          - 1000 KES send → ≥ 1000 + 3 + 100 = 1103
        SMS_COST_KES is the SasaPay-published per-message fee (1 KES
        as of 2026-05-09); raise if SasaPay raises theirs.

        Returns True if Utility now has enough (either already had it
        or top-up succeeded), False on any error. Used as a pre-flight
        before every B2C call so the saga doesn't fail with insufficient-
        balance after we've already locked the user's crypto.
        """
        from decimal import Decimal as _D

        # SasaPay published costs · keep these as data, not magic numbers
        # in the formula. Raise via env if SasaPay's pricing changes.
        SMS_COST_KES = _D(str(getattr(settings, "SASAPAY_SMS_COST_KES", "1")))
        TX_COST_KES = _D(str(getattr(settings, "SASAPAY_TX_COST_KES", "0")))
        MIN_BUFFER_KES = _D(str(getattr(settings, "SASAPAY_MIN_BUFFER_KES", "3")))
        BUFFER_PCT = _D(str(getattr(settings, "SASAPAY_BUFFER_PCT", "0.10")))

        try:
            balance_resp = self.check_balance()
        except SasaPayError as e:
            logger.warning("ensure_utility_balance.check_balance_failed: %s", e)
            return False

        data = balance_resp.get("data") or {}
        utility = _D("0")
        working = _D("0")
        for entry in data.get("Accounts") or []:
            label = (entry.get("account_label") or "").lower()
            if "utility" in label:
                utility = _D(str(entry.get("account_balance") or 0))
            elif "working" in label:
                working = _D(str(entry.get("account_balance") or 0))

        amount = _D(str(required_amount))
        # required = amount + SMS + TX + max(MIN_BUFFER, amount * 10%)
        pct_buffer = (amount * BUFFER_PCT).quantize(_D("0.01"))
        buffer = max(MIN_BUFFER_KES, pct_buffer)
        required = amount + SMS_COST_KES + TX_COST_KES + buffer

        logger.info(
            "ensure_utility_balance.check · amount=%s required=%s utility=%s working=%s "
            "(SMS=%s TX=%s buffer=%s)",
            amount, required, utility, working, SMS_COST_KES, TX_COST_KES, buffer,
        )

        if utility >= required:
            return True

        # Top up · move (required - utility) from Working.
        gap = (required - utility).quantize(_D("0.01"))
        if working < gap:
            logger.error(
                "ensure_utility_balance.insufficient_working · need=%s working=%s",
                gap, working,
            )
            return False

        try:
            self.move_funds_to_utility(float(gap))
            logger.info("ensure_utility_balance.topped_up · moved KES %s", gap)
            return True
        except SasaPayError as e:
            logger.warning("ensure_utility_balance.move_funds_failed: %s", e)
            return False

    def checkout_payment(
        self,
        amount: float,
        reference: str,
        description: str = "Payment",
        payer_email: str = "",
        callback_url: str = None,
        success_url: str = "",
        failure_url: str = "",
        enable_card: bool = True,
        enable_mpesa: bool = True,
        enable_airtel: bool = True,
        enable_sasapay_wallet: bool = True,
    ) -> dict:
        """Hosted Checkout Payment · returns a CheckoutUrl that the
        customer is redirected to. The hosted page handles M-PESA STK,
        Airtel Money, T-KASH, SasaPay wallet, and card input
        (depending on which `enable_*` flags are True).

        Use this for cases where:
          - User wants to pay with a method we don't STK-trigger
            directly (e.g. card, Airtel)
          - We want SasaPay to handle the customer-facing UI rather
            than building it ourselves
          - We need a shareable payment link (the CheckoutUrl)

        Per the SasaPay docs at
        https://developer.sasapay.app/docs/apis/checkout-payments
        the response is sync · CheckoutUrl is returned immediately,
        the user is redirected, and the final result lands at our
        CallbackUrl (separate from the C2B IPN).
        """
        return self._request("POST", "/payments/card-payments/", {
            "MerchantCode": self.merchant_code,
            "Amount": str(amount),
            "Reference": reference,
            "Description": description,
            "Currency": "KES",
            "PayerEmail": payer_email,
            "CallbackUrl": callback_url or self.callback_url,
            "SuccessUrl": success_url,
            "FailureUrl": failure_url,
            "RedirectEnabled": bool(success_url or failure_url),
            "SasaPayWalletEnabled": enable_sasapay_wallet,
            "MpesaEnabled": enable_mpesa,
            "AirtelEnabled": enable_airtel,
            "CardEnabled": enable_card,
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

    def lookup_phone_holder_name(self, phone: str, channel: str = "63902") -> str:
        """Resolve an M-Pesa phone (or Airtel/T-Kash) to its registered
        holder name via account-validation. Used pre-flight on the SEND
        MONEY rail so the receipt + status screen can render
        "Paid to Kevin Kareithi" instead of "Paid to M-Pesa transfer".

        Cached in Redis (1 h on hits, 5 min on misses · phone holders
        change far more often than paybill ownership). Empty string on
        any error so callers fall through to the masked-phone fallback.
        """
        from django.core.cache import cache

        if not phone:
            return ""
        key = f"sasapay_phone_name:{channel}:{phone}"
        cached = cache.get(key)
        if cached is not None:
            return cached or ""

        try:
            result = self._request("POST", "/accounts/account-validation/", {
                "merchant_code": self.merchant_code,
                "channel_code": str(channel),
                "account_number": str(phone),
            })
        except Exception as e:
            logger.warning(
                "sasapay.lookup_phone_holder_name.failed",
                extra={"phone": phone, "error": str(e)[:200]},
            )
            cache.set(key, "", timeout=300)
            return ""

        details = result.get("account_details") or {}
        name = (details.get("account_name") or "").strip()
        cache.set(key, name, timeout=3600)
        return name

    def lookup_merchant_name(self, paybill_or_till: str, channel_code: str = "0") -> str:
        """Resolve a Paybill/Till number to its registered merchant name.

        2026-05-09 · the same `account-validation` endpoint that we use
        for phone validation also returns the registered business name
        when given a Paybill (channel_code=0) or Buy-Goods Till (
        channel_code=2). Keying our receipts to this means we can
        print "Paid to KPLC PREPAID" instead of just "Paybill 888880".

        Cached in Redis with a 24 h TTL · Kenyan paybills change owners
        rarely (months between such transitions) so the cache mostly
        eliminates the network hop on the hot quote path.

        Returns the human-readable merchant name, or an empty string
        if the lookup fails for any reason · callers fall through to
        the original "Paybill <number>" rendering.
        """
        from django.core.cache import cache

        if not paybill_or_till:
            return ""
        key = f"sasapay_merchant_name:{channel_code}:{paybill_or_till}"
        cached = cache.get(key)
        if cached is not None:
            # We deliberately cache empty-string misses too · if SasaPay
            # said "no such merchant" we don't want to retry every quote.
            return cached or ""

        try:
            result = self._request("POST", "/accounts/account-validation/", {
                "merchant_code": self.merchant_code,
                "channel_code": str(channel_code),
                "account_number": str(paybill_or_till),
            })
        except Exception as e:
            logger.warning(
                "sasapay.lookup_merchant_name.failed",
                extra={"paybill": paybill_or_till, "error": str(e)[:200]},
            )
            cache.set(key, "", timeout=600)  # 10 min on errors · retry sooner
            return ""

        details = result.get("account_details") or {}
        name = (details.get("account_name") or "").strip()
        # 24 h on success · paybill→name is effectively static for our
        # purposes. Caches the empty value too to suppress retries.
        cache.set(key, name, timeout=86400)
        return name
