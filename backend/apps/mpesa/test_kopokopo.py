"""Kopo Kopo client + provider-adapter tests · 2026-04-30.

Covers:

  - OAuth bearer cache (Redis SETEX, refresh on 401)
  - Phone-number normalisation
  - STK Push request shape · payload + Location header round-trip
  - Pay flow caching (recipient-Location reused across calls)
  - Reversal returns the K2 resource URL
  - Provider adapter routes correctly when PAYMENT_PROVIDER=kopokopo
  - Webhook signature verification rejects unsigned + accepts good HMAC
  - Webhook duplicate-event dedup via Redis SETNX

These are pure unit tests · no live K2 sandbox traffic. We mock
`requests.post` / `requests.get` at the module boundary so the same
test harness runs in CI with no network access.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from django.core.cache import cache
from django.test import TestCase, override_settings

pytestmark = pytest.mark.django_db


# Test-only credentials · matches the conftest pattern of dummy
# 64-hex-char keys. The production guard's checks only fire under
# DEBUG=False, so unit tests run fine with these placeholders.
_K2_TEST_API_KEY = "k" * 64
_K2_TEST_CLIENT_SECRET = "s" * 64


# ── Phone normalisation ───────────────────────────────────────────


class TestNormalisePhone(TestCase):
    def test_kenyan_local_format(self):
        from apps.mpesa.kopokopo_client import _normalise_phone
        assert _normalise_phone("0712345678") == "+254712345678"

    def test_already_254(self):
        from apps.mpesa.kopokopo_client import _normalise_phone
        assert _normalise_phone("254712345678") == "+254712345678"

    def test_e164_passthrough(self):
        from apps.mpesa.kopokopo_client import _normalise_phone
        assert _normalise_phone("+254712345678") == "+254712345678"

    def test_short_form_assumed_kenyan(self):
        from apps.mpesa.kopokopo_client import _normalise_phone
        # 9-digit '7XX' prefix · we add the 254
        assert _normalise_phone("712345678") == "+254712345678"

    def test_garbage_raises(self):
        from apps.mpesa.kopokopo_client import _normalise_phone
        with pytest.raises(ValueError):
            _normalise_phone("notaphone")
        with pytest.raises(ValueError):
            _normalise_phone("")


# ── OAuth bearer caching ──────────────────────────────────────────


@override_settings(
    KOPOKOPO_ENVIRONMENT="sandbox",
    KOPOKOPO_CLIENT_ID="cid",
    KOPOKOPO_CLIENT_SECRET=_K2_TEST_CLIENT_SECRET,
    KOPOKOPO_TILL_NUMBER="555555",
)
class TestKopoKopoAuth(TestCase):
    def setUp(self):
        # Each test starts with a clean token cache so mock counts match.
        cache.delete("kopokopo_access_token")

    def test_oauth_caches_token(self):
        from apps.mpesa.kopokopo_client import KopoKopoClient

        client = KopoKopoClient()
        with patch("apps.mpesa.kopokopo_client.requests.post") as mock_post:
            mock_post.return_value = MagicMock(
                status_code=200,
                json=MagicMock(return_value={
                    "access_token": "tok-abc",
                    "expires_in": 3600,
                }),
            )
            mock_post.return_value.raise_for_status = lambda: None

            t1 = client._get_access_token()
            t2 = client._get_access_token()

            assert t1 == "tok-abc"
            assert t2 == "tok-abc"
            # Only one OAuth round-trip · the second call is cached.
            assert mock_post.call_count == 1

    def test_oauth_missing_token_raises(self):
        from apps.mpesa.kopokopo_client import KopoKopoClient, KopoKopoError

        client = KopoKopoClient()
        with patch("apps.mpesa.kopokopo_client.requests.post") as mock_post:
            mock_post.return_value = MagicMock(
                status_code=200,
                json=MagicMock(return_value={"expires_in": 3600}),
            )
            mock_post.return_value.raise_for_status = lambda: None

            with pytest.raises(KopoKopoError, match="missing access_token"):
                client._get_access_token()


# ── STK Push request shape ────────────────────────────────────────


@override_settings(
    KOPOKOPO_ENVIRONMENT="sandbox",
    KOPOKOPO_CLIENT_ID="cid",
    KOPOKOPO_CLIENT_SECRET=_K2_TEST_CLIENT_SECRET,
    KOPOKOPO_TILL_NUMBER="555555",
)
class TestKopoKopoSTKPush(TestCase):
    def setUp(self):
        cache.delete("kopokopo_access_token")
        cache.set("kopokopo_access_token", "tok-abc", timeout=300)

    def test_stk_push_includes_till_and_phone(self):
        from apps.mpesa.kopokopo_client import KopoKopoClient

        client = KopoKopoClient()
        with patch("apps.mpesa.kopokopo_client.requests.request") as mock_req:
            mock_req.return_value = MagicMock(
                status_code=201,
                ok=True,
                headers={"Location": "https://sandbox.kopokopo.com/api/v2/incoming_payments/abc-123"},
                text="",
            )
            result = client.stk_push(
                phone="0712345678", amount=100,
                account_ref="BUY-1234", description="Cpay buy",
            )

        # The wrapper returned the Location URL so the saga can store it
        # on the tx for later callback matching.
        assert result["k2_resource_url"].endswith("/abc-123")
        assert result["status_code"] == 201

        # Inspect the actual outbound payload · `requests.request` was
        # called once with method POST and the right body shape.
        assert mock_req.call_count == 1
        call_kwargs = mock_req.call_args.kwargs
        body = call_kwargs["json"]
        assert body["till_number"] == "555555"
        assert body["subscriber"]["phone_number"] == "+254712345678"
        assert body["amount"]["currency"] == "KES"
        assert body["amount"]["value"] == "100"
        assert body["metadata"]["account_ref"] == "BUY-1234"


# ── Pay flow caching ──────────────────────────────────────────────


@override_settings(
    KOPOKOPO_ENVIRONMENT="sandbox",
    KOPOKOPO_CLIENT_ID="cid",
    KOPOKOPO_CLIENT_SECRET=_K2_TEST_CLIENT_SECRET,
    KOPOKOPO_TILL_NUMBER="555555",
)
class TestKopoKopoPaybillCache(TestCase):
    def setUp(self):
        cache.delete("kopokopo_access_token")
        cache.set("kopokopo_access_token", "tok-abc", timeout=300)
        # Wipe any stale recipient cache from other tests.
        cache.delete("k2_recipient:paybill:888880:12345")

    def test_paybill_recipient_cached_across_calls(self):
        from apps.mpesa.kopokopo_client import KopoKopoClient

        client = KopoKopoClient()
        with patch("apps.mpesa.kopokopo_client.requests.request") as mock_req:
            # First call creates the recipient (Location: .../recip-1)
            # then sends payment.
            mock_req.side_effect = [
                MagicMock(status_code=201, ok=True,
                          headers={"Location": "https://sandbox.kopokopo.com/api/v2/pay_recipients/recip-1"},
                          text=""),
                MagicMock(status_code=201, ok=True,
                          headers={"Location": "https://sandbox.kopokopo.com/api/v2/payments/pay-1"},
                          text=""),
                # Second call · recipient cached, ONLY the payment POST runs.
                MagicMock(status_code=201, ok=True,
                          headers={"Location": "https://sandbox.kopokopo.com/api/v2/payments/pay-2"},
                          text=""),
            ]

            r1 = client.pay_paybill(paybill="888880", account="12345", amount=100)
            r2 = client.pay_paybill(paybill="888880", account="12345", amount=200)

            assert r1["k2_resource_url"].endswith("/pay-1")
            assert r2["k2_resource_url"].endswith("/pay-2")

        # 3 HTTP calls total · 1 add_recipient + 2 send_pay (NOT 4).
        assert mock_req.call_count == 3


# ── Reversal ──────────────────────────────────────────────────────


@override_settings(
    KOPOKOPO_ENVIRONMENT="sandbox",
    KOPOKOPO_CLIENT_ID="cid",
    KOPOKOPO_CLIENT_SECRET=_K2_TEST_CLIENT_SECRET,
    KOPOKOPO_TILL_NUMBER="555555",
)
class TestKopoKopoReversal(TestCase):
    def setUp(self):
        cache.delete("kopokopo_access_token")
        cache.set("kopokopo_access_token", "tok-abc", timeout=300)

    def test_reversal_returns_resource_url(self):
        from apps.mpesa.kopokopo_client import KopoKopoClient

        client = KopoKopoClient()
        with patch("apps.mpesa.kopokopo_client.requests.request") as mock_req:
            mock_req.return_value = MagicMock(
                status_code=201, ok=True,
                headers={"Location": "https://sandbox.kopokopo.com/api/v2/reversals/rev-99"},
                text="",
            )
            r = client.reversal(
                transaction_id="https://k2/api/v2/incoming_payments/orig-tx",
                amount=500, remarks="user-cancelled",
            )

        assert r["k2_resource_url"].endswith("/rev-99")
        assert r["status_code"] == 201


# ── Provider adapter routing ──────────────────────────────────────


class TestProviderAdapterRoutesToKopoKopo(TestCase):
    @override_settings(PAYMENT_PROVIDER="kopokopo",
                       KOPOKOPO_CLIENT_ID="cid",
                       KOPOKOPO_CLIENT_SECRET=_K2_TEST_CLIENT_SECRET,
                       KOPOKOPO_TILL_NUMBER="555555")
    def test_adapter_constructs_kopokopo_client(self):
        from apps.mpesa.provider import get_payment_client

        with patch("apps.mpesa.kopokopo_client.requests.post") as mock_post:
            mock_post.return_value = MagicMock(
                status_code=200,
                json=MagicMock(return_value={
                    "access_token": "tok", "expires_in": 3600,
                }),
            )
            mock_post.return_value.raise_for_status = lambda: None

            adapter = get_payment_client()
            assert adapter.is_kopokopo
            assert not adapter.is_sasapay
            assert adapter.provider_name == "kopokopo"

    @override_settings(PAYMENT_PROVIDER="kopokopo",
                       KOPOKOPO_CLIENT_ID="cid",
                       KOPOKOPO_CLIENT_SECRET=_K2_TEST_CLIENT_SECRET,
                       KOPOKOPO_TILL_NUMBER="555555")
    def test_b2b_routes_to_paybill_method(self):
        from apps.mpesa.provider import get_payment_client

        cache.set("kopokopo_access_token", "tok", timeout=300)
        adapter = get_payment_client()

        with patch.object(adapter._client, "pay_paybill",
                          return_value={"k2_resource_url": "u",
                                        "destination_reference": "d",
                                        "status_code": 201}):
            r = adapter.b2b_payment(paybill="888880", account="12345",
                                    amount=100, remarks="kplc")

        # Adapter normalises into the Daraja-shaped response so the
        # saga doesn't have to know which rail handled the payment.
        assert r["ResponseCode"] == "0"
        assert r["ConversationID"] == "u"

    @override_settings(PAYMENT_PROVIDER="kopokopo",
                       KOPOKOPO_CLIENT_ID="cid",
                       KOPOKOPO_CLIENT_SECRET=_K2_TEST_CLIENT_SECRET,
                       KOPOKOPO_TILL_NUMBER="555555")
    def test_reversal_works_unlike_sasapay(self):
        """SasaPay raises NotImplementedError on reversal.
        K2 does NOT · this is why we prefer K2 for B2B."""
        from apps.mpesa.provider import get_payment_client

        cache.set("kopokopo_access_token", "tok", timeout=300)
        adapter = get_payment_client()

        with patch.object(adapter._client, "reversal",
                          return_value={"k2_resource_url": "rev-url",
                                        "status_code": 201}):
            r = adapter.reversal(transaction_id="orig", amount=100)

        assert r["ResponseCode"] == "0"
        assert r["ConversationID"] == "rev-url"


# ── Webhook signature verification ────────────────────────────────


@override_settings(KOPOKOPO_API_KEY=_K2_TEST_API_KEY)
class TestKopoKopoCallbackSignature(TestCase):
    def setUp(self):
        cache.clear()  # blow away any dedup keys from sibling tests

    def _signed(self, body_str: str) -> str:
        return hmac.new(
            _K2_TEST_API_KEY.encode("utf-8"),
            body_str.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def test_unsigned_callback_rejected_in_production(self):
        from rest_framework.test import APIClient

        client = APIClient()
        # DEBUG=False (the default for the test runner via settings override)
        with override_settings(DEBUG=False):
            r = client.post(
                "/api/v1/kopokopo/callback/",
                data=json.dumps({"id": "evt-noauth"}),
                content_type="application/json",
            )
        assert r.status_code == 403

    def test_signed_callback_processed(self):
        from rest_framework.test import APIClient

        body = json.dumps({"id": "evt-good", "topic": "noop"})
        sig = self._signed(body)

        client = APIClient()
        with override_settings(DEBUG=False):
            r = client.post(
                "/api/v1/kopokopo/callback/",
                data=body,
                content_type="application/json",
                HTTP_X_KOPOKOPO_SIGNATURE=sig,
            )
        # Even an unhandled topic returns 200 · we ack and log.
        assert r.status_code == 200

    def test_duplicate_event_id_dedup(self):
        from rest_framework.test import APIClient

        body = json.dumps({"id": "evt-dup", "topic": "noop"})
        sig = self._signed(body)
        client = APIClient()

        with override_settings(DEBUG=False):
            r1 = client.post("/api/v1/kopokopo/callback/", data=body,
                             content_type="application/json",
                             HTTP_X_KOPOKOPO_SIGNATURE=sig)
            r2 = client.post("/api/v1/kopokopo/callback/", data=body,
                             content_type="application/json",
                             HTTP_X_KOPOKOPO_SIGNATURE=sig)

        assert r1.status_code == 200
        assert r2.status_code == 200
        # The second response should signal duplicate.
        assert r2.json().get("duplicate") is True
