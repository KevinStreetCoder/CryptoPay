"""
Kopo Kopo K2-Connect API client.

Alternative payment rail to Safaricom Daraja and SasaPay · Kopo Kopo
is a Daraja-approved aggregator that holds its own merchant relationship
with Safaricom. We rent their merchant code instead of getting our own,
which lets Cpay route to M-Pesa rails without the CBK Letter of No
Objection that direct Daraja onboarding requires.

Two services are exposed:

  - "Receive Money" · STK Push (C2B) for users buying crypto from us.
    Endpoint:  POST /api/v2/incoming_payments

  - "Pay" · sending money to arbitrary M-Pesa recipients (paybill, till,
    mobile wallet) on behalf of Cpay. Two-step flow:
        1. POST /api/v2/pay_recipients   · register the recipient,
           returns a `destination_reference` URL we treat as an opaque ID
        2. POST /api/v2/payments         · send money to that recipient
    Both steps use OAuth2 client_credentials. Webhooks announce results.

Why we prefer Kopo Kopo over SasaPay for B2B
  - First-class reversal API (`POST /api/v2/reversals`) · SasaPay's
    reversal is partial and forces our saga to open a
    REVERSAL_NOT_SUPPORTED ReconciliationCase every B2B failure.
  - Outbound B2C is `KES 50` flat regardless of amount · cheaper than
    Safaricom's tiered fees at any value over `KES 1,000`.
  - SDKs in five languages, Postman collection, OpenAPI spec.

Why we keep SasaPay alongside
  - SasaPay is a CBK-licensed PSP (one regulator-tier closer to the
    LNO destination), Kopo Kopo is an aggregator-tier merchant.
  - Already integrated · zero engineering debt to ship.
  - In production we route by transaction type · paybills + tills via
    Kopo Kopo (better economics + reversal), C2B + B2C via either.

Switch between providers via PAYMENT_PROVIDER env var (handled by
`apps/mpesa/provider.py`). Set `kopokopo` to use this client.

Reference docs:
  - Live API reference · https://api-docs.kopokopo.com/
  - Developer guides · https://developers.kopokopo.com/
  - Python SDK README   · https://github.com/kopokopo/k2-connect-python
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

import requests
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)


class KopoKopoError(Exception):
    """K2-Connect API error · raised on non-2xx HTTP or schema mismatch."""
    pass


class KopoKopoClient:
    """Single-purpose K2-Connect client mirroring `MpesaClient` / `SasaPayClient`.

    All methods return a normalised dict the provider adapter can translate
    into the Daraja-compatible response shape downstream code expects.
    Network errors raise `KopoKopoError`; HTTP errors raise the same.
    """

    SANDBOX_BASE = "https://sandbox.kopokopo.com"
    PRODUCTION_BASE = "https://api.kopokopo.com"

    # Cache key for the OAuth bearer · single-tenant so one entry is fine.
    _TOKEN_CACHE_KEY = "kopokopo_access_token"

    def __init__(self):
        self.environment = getattr(settings, "KOPOKOPO_ENVIRONMENT", "sandbox")
        self.base_url = (
            self.PRODUCTION_BASE if self.environment == "production" else self.SANDBOX_BASE
        )
        self.client_id = settings.KOPOKOPO_CLIENT_ID
        self.client_secret = settings.KOPOKOPO_CLIENT_SECRET
        # K2-Connect uses a single till_number that maps to your merchant
        # account (set up during KYB). All STK Push requests target it.
        self.till_number = settings.KOPOKOPO_TILL_NUMBER
        # Default callback URL · K2 lets you override per-request, but
        # configuring once keeps every call consistent.
        self.callback_url = getattr(
            settings, "KOPOKOPO_CALLBACK_URL", "https://cpay.co.ke/api/v1/kopokopo/callback/",
        )

    # ── Authentication ───────────────────────────────────────────────────

    def _get_access_token(self) -> str:
        """OAuth2 client_credentials grant · cached in Redis until ~5 min before expiry.

        K2-Connect tokens default to 1 hour (`expires_in: 3600`). We cache
        for `expires_in - 300` so a request near the boundary still has a
        valid token in hand. Same pattern as the SasaPay and Daraja
        clients · see `sasapay_client.py:_get_access_token` for the
        reference implementation.
        """
        cached = cache.get(self._TOKEN_CACHE_KEY)
        if cached:
            return cached

        url = f"{self.base_url}/oauth/token"
        payload = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }
        try:
            resp = requests.post(url, data=payload, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except requests.exceptions.RequestException as e:
            raise KopoKopoError(f"K2 OAuth request failed: {e}") from e
        except ValueError as e:
            raise KopoKopoError(f"K2 OAuth returned non-JSON: {e}") from e

        token = data.get("access_token")
        if not token:
            raise KopoKopoError(f"K2 OAuth response missing access_token: {data}")

        expires_in = int(data.get("expires_in", 3600))
        cache.set(self._TOKEN_CACHE_KEY, token, timeout=max(expires_in - 300, 60))
        return token

    def _headers(self, access_token: str | None = None) -> dict:
        token = access_token or self._get_access_token()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _request(self, method: str, path: str, json_body: dict | None = None,
                 timeout: int = 30) -> requests.Response:
        """Shared HTTP helper · auto-retries auth once on 401, surfaces 4xx/5xx
        as KopoKopoError with the upstream payload preserved in the message
        so the calling saga has something useful to log."""
        url = f"{self.base_url}{path}"
        try:
            resp = requests.request(
                method, url, headers=self._headers(),
                json=json_body, timeout=timeout,
            )
            if resp.status_code == 401:
                # Token may have rotated mid-flight · clear cache and retry once.
                cache.delete(self._TOKEN_CACHE_KEY)
                resp = requests.request(
                    method, url, headers=self._headers(),
                    json=json_body, timeout=timeout,
                )
            if not resp.ok:
                # Best-effort body capture for debugging · don't crash on parse errors
                body_snippet = resp.text[:500] if resp.text else "<empty>"
                raise KopoKopoError(
                    f"K2 {method} {path} returned {resp.status_code}: {body_snippet}"
                )
            return resp
        except requests.exceptions.RequestException as e:
            raise KopoKopoError(f"K2 {method} {path} network error: {e}") from e

    # ── C2B · STK Push (user pays Cpay) ─────────────────────────────────

    def stk_push(self, phone: str, amount: float, account_ref: str = "",
                 description: str = "", first_name: str = "", last_name: str = "",
                 email: str = "") -> dict:
        """Initiate an STK Push collection from a customer's M-Pesa wallet.

        K2-Connect's `incoming_payments` endpoint is the equivalent of
        Daraja's STK Push · user phone gets a popup, taps Confirm, money
        arrives at our Kopo Kopo float, callback fires with the result.

        Returns a normalised dict so `provider.py` can translate into
        Daraja's `CheckoutRequestID` / `MerchantRequestID` / `ResponseCode`
        shape that downstream code (saga, mobile client) expects.
        """
        path = "/api/v2/incoming_payments"
        payload = {
            "payment_channel": "M-PESA STK Push",
            "till_number": self.till_number,
            "subscriber": {
                "first_name": first_name or "Cpay",
                "last_name": last_name or "Customer",
                "phone_number": _normalise_phone(phone),
                "email": email or "",
            },
            "amount": {
                "currency": "KES",
                "value": str(int(round(float(amount)))),
            },
            "metadata": {
                "account_ref": account_ref or "",
                "description": description or "Cpay buy crypto",
            },
            "_links": {
                # K2 fires this URL on success / failure / timeout. Same
                # payload schema for both, distinguished by `status`.
                "callback_url": self.callback_url,
            },
        }
        resp = self._request("POST", path, json_body=payload)
        # K2 returns 201 Created with the new resource URL in the
        # `Location` header · that's our analogue to Daraja's
        # CheckoutRequestID.
        location = resp.headers.get("Location", "")
        return {
            "checkout_request_id": location,
            "k2_resource_url": location,
            "status_code": resp.status_code,
        }

    def query_stk_status(self, location_url: str) -> dict:
        """Poll the K2 resource URL returned by `stk_push` for the latest state.

        Use this if the callback never arrives (network blip on K2's side).
        Returns the raw JSON · saga interprets `status: Success / Pending /
        Failed`.
        """
        try:
            resp = requests.get(
                location_url, headers=self._headers(), timeout=15,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as e:
            raise KopoKopoError(f"K2 STK status query failed: {e}") from e

    # ── Pay · two-step flow (recipient + send) ───────────────────────────

    def add_paybill_recipient(
        self, paybill_number: str, paybill_name: str, account_number: str,
    ) -> str:
        """Register a paybill destination · returns its `destination_reference`.

        K2's Pay flow needs every recipient registered first (paybill,
        till, mobile wallet, bank). The registration is cheap · single
        POST · and the returned URL is the opaque handle we use when
        sending money. We can cache it per-paybill so repeat KPLC
        payments don't re-register every time.
        """
        path = "/api/v2/pay_recipients"
        payload = {
            "type": "pay_recipient",
            "pay_recipient": {
                "type": "paybill",
                "pay_recipient_paybill": {
                    "paybill_number": paybill_number,
                    "paybill_name": paybill_name,
                    "account_number": account_number,
                },
            },
        }
        resp = self._request("POST", path, json_body=payload)
        return resp.headers.get("Location", "")

    def add_till_recipient(self, till_number: str, till_name: str = "") -> str:
        """Register a till (Buy Goods) destination."""
        path = "/api/v2/pay_recipients"
        payload = {
            "type": "pay_recipient",
            "pay_recipient": {
                "type": "till",
                "pay_recipient_till": {
                    "till_number": till_number,
                    "till_name": till_name or "Cpay till payment",
                },
            },
        }
        resp = self._request("POST", path, json_body=payload)
        return resp.headers.get("Location", "")

    def add_mobile_wallet_recipient(
        self, phone: str, first_name: str = "Cpay", last_name: str = "Recipient",
        email: str = "",
    ) -> str:
        """Register a mobile-wallet destination (sending money to an M-Pesa number)."""
        path = "/api/v2/pay_recipients"
        payload = {
            "type": "pay_recipient",
            "pay_recipient": {
                "type": "mobile_wallet",
                "pay_recipient_mobile_wallet": {
                    "first_name": first_name,
                    "last_name": last_name,
                    "phone_number": _normalise_phone(phone),
                    "network": "Safaricom",
                    "email": email,
                },
            },
        }
        resp = self._request("POST", path, json_body=payload)
        return resp.headers.get("Location", "")

    def send_pay(
        self, destination_reference: str, destination_type: str,
        amount: float, currency: str = "KES",
        metadata: dict | None = None, callback_url: str | None = None,
    ) -> dict:
        """Send money to a registered recipient.

        `destination_type` is one of: `paybill`, `till`, `mobile_wallet`,
        `bank_account`. The enum mirrors the recipient_type used at
        registration time (see `add_paybill_recipient` / `add_till_recipient`
        / `add_mobile_wallet_recipient`).

        Returns a normalised dict keyed similarly to Daraja's B2B response
        so the saga handler can route into the existing flow without
        special-casing.
        """
        path = "/api/v2/payments"
        payload = {
            "destination_reference": destination_reference,
            "destination_type": destination_type,
            "amount": {
                "currency": currency,
                "value": str(int(round(float(amount)))),
            },
            "description": (metadata or {}).get("description", "Cpay payout"),
            "category": "PayBill",  # K2 free-text category for our reports
            "tags": ["cpay"],
            "metadata": metadata or {},
            "_links": {
                "callback_url": callback_url or self.callback_url,
            },
        }
        resp = self._request("POST", path, json_body=payload)
        location = resp.headers.get("Location", "")
        return {
            "k2_resource_url": location,
            "destination_reference": destination_reference,
            "destination_type": destination_type,
            "status_code": resp.status_code,
        }

    # ── B2B Paybill convenience ──────────────────────────────────────────

    def pay_paybill(
        self, paybill: str, account: str, amount: float,
        paybill_name: str = "", reference: str | None = None,
    ) -> dict:
        """One-shot Paybill payment · register-then-send.

        `reference` lets the caller pin the recipient cache key (e.g. tx id).
        For Cpay's typical workload where the same KPLC paybill gets paid
        thousands of times we cache the recipient location across calls,
        keyed by `paybill_number` + `account` · `_recipient_cache_get`.
        """
        cache_key = f"k2_recipient:paybill:{paybill}:{account}"
        location = cache.get(cache_key)
        if not location:
            location = self.add_paybill_recipient(
                paybill_number=paybill,
                paybill_name=paybill_name or f"Paybill-{paybill}",
                account_number=account,
            )
            # 1-day cache · paybills are stable. If KPLC changes their
            # paybill we just re-register on cache miss, no harm.
            cache.set(cache_key, location, timeout=24 * 60 * 60)

        return self.send_pay(
            destination_reference=location,
            destination_type="paybill",
            amount=amount,
            metadata={"reference": reference or ""},
        )

    # ── B2B Till (Buy Goods) convenience ─────────────────────────────────

    def pay_till(
        self, till: str, amount: float, till_name: str = "",
        reference: str | None = None,
    ) -> dict:
        """One-shot Till payment · register-then-send. Same caching as paybill."""
        cache_key = f"k2_recipient:till:{till}"
        location = cache.get(cache_key)
        if not location:
            location = self.add_till_recipient(
                till_number=till, till_name=till_name or f"Till-{till}",
            )
            cache.set(cache_key, location, timeout=24 * 60 * 60)

        return self.send_pay(
            destination_reference=location,
            destination_type="till",
            amount=amount,
            metadata={"reference": reference or ""},
        )

    # ── B2C · Send to Mobile ────────────────────────────────────────────

    def send_to_mobile(
        self, phone: str, amount: float, reason: str = "Payment",
        first_name: str = "Cpay", last_name: str = "Recipient",
        reference: str | None = None,
    ) -> dict:
        """Send M-Pesa to an arbitrary phone number on behalf of Cpay.

        Cheapest outbound on K2 · `KES 50` flat regardless of amount.
        At `KES 80,000` rent payments that's a ~`KES 100` saving over
        Safaricom's tiered fees per transaction.
        """
        normalised = _normalise_phone(phone)
        cache_key = f"k2_recipient:mobile:{normalised}"
        location = cache.get(cache_key)
        if not location:
            location = self.add_mobile_wallet_recipient(
                phone=normalised, first_name=first_name, last_name=last_name,
            )
            cache.set(cache_key, location, timeout=24 * 60 * 60)

        return self.send_pay(
            destination_reference=location,
            destination_type="mobile_wallet",
            amount=amount,
            metadata={"reference": reference or "", "reason": reason},
        )

    # ── Reversal ─────────────────────────────────────────────────────────

    def reversal(self, transaction_id: str, amount: int = 0, remarks: str = "") -> dict:
        """Reverse an incoming payment · K2's first-class reversal endpoint.

        `transaction_id` is the K2 resource URL or the `Location` we got
        back from `stk_push`. Unlike SasaPay we DO get a clean reversal
        path here · the saga's compensate_mpesa can succeed without
        opening a REVERSAL_NOT_SUPPORTED ReconciliationCase.
        """
        path = "/api/v2/reversals"
        payload = {
            "destination": transaction_id,
            "_links": {
                "callback_url": self.callback_url,
            },
        }
        if remarks:
            payload["metadata"] = {"remarks": remarks}

        resp = self._request("POST", path, json_body=payload)
        return {
            "k2_resource_url": resp.headers.get("Location", ""),
            "status_code": resp.status_code,
        }


# ── Module-level helpers ────────────────────────────────────────────────


def _normalise_phone(phone: str) -> str:
    """Normalise to the +254XXXXXXXXX format K2 expects.

    Accepts:
      0712 345 678  →  +254712345678
      254712345678  →  +254712345678
      +254712345678 →  +254712345678  (passthrough)

    Raises ValueError on any input that doesn't look like a Kenyan
    mobile number once we've stripped non-digits, so we never let
    a bad number into the K2 request and silently 400.
    """
    if not phone:
        raise ValueError("phone is empty")
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("0") and len(digits) == 10:
        digits = "254" + digits[1:]
    elif digits.startswith("254") and len(digits) == 12:
        pass  # already in 254 form
    elif digits.startswith("7") and len(digits) == 9:
        digits = "254" + digits
    else:
        raise ValueError(f"phone {phone!r} doesn't look like a Kenyan mobile number")
    return f"+{digits}"
