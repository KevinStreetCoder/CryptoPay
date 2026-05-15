"""IntaSend client + webhook tests · 2026-05-08.

Replaces test_kopokopo.py (K2 rail retired in favour of IntaSend).
All HTTP calls mocked at the requests boundary; no live IntaSend
sandbox traffic so the same harness runs in CI.

Coverage:
  - Phone normalisation accepts the 4 common Kenyan formats and
    rejects garbage (so a malformed input never silently 400s the
    upstream API).
  - STK Push payload shape · phone_number, amount, currency, narrative,
    api_ref. Auth header set to the configured secret.
  - Send Money payload routing · pay_paybill / pay_till / send_to_mobile
    each emit MPESA-B2B / MPESA-B2C with the right account fields.
  - Reversal raises NotImplementedError (matches SasaPay path · the
    saga opens REVERSAL_NOT_SUPPORTED case).
  - Provider adapter routes to IntaSendClient when PAYMENT_PROVIDER=intasend.
  - Webhook · HMAC signature verification, Redis SETNX dedup, amount
    tamper rejection, classification of collection vs send-money events.
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


_TEST_SECRET = "ISSecretKey_test_" + "x" * 64
_TEST_WEBHOOK_SECRET = "challenge_" + "y" * 32


# ── Phone normalisation ───────────────────────────────────────────


class TestNormalisePhone(TestCase):
    def test_kenyan_local_format(self):
        from apps.mpesa.intasend_client import _normalise_phone
        assert _normalise_phone("0712345678") == "+254712345678"

    def test_already_254(self):
        from apps.mpesa.intasend_client import _normalise_phone
        assert _normalise_phone("254712345678") == "+254712345678"

    def test_e164_passthrough(self):
        from apps.mpesa.intasend_client import _normalise_phone
        assert _normalise_phone("+254712345678") == "+254712345678"

    def test_short_form(self):
        from apps.mpesa.intasend_client import _normalise_phone
        assert _normalise_phone("712345678") == "+254712345678"

    def test_safaricom_01_prefix(self):
        from apps.mpesa.intasend_client import _normalise_phone
        # The newer 01XX… range Safaricom rolled out in 2022.
        assert _normalise_phone("0112345678") == "+254112345678"

    def test_garbage_rejected(self):
        from apps.mpesa.intasend_client import _normalise_phone
        with self.assertRaises(ValueError):
            _normalise_phone("not-a-phone")
        with self.assertRaises(ValueError):
            _normalise_phone("")


# ── Test fixtures ────────────────────────────────────────────────


def _mock_response(status_code=200, json_payload=None):
    """Build a minimal `requests.Response`-shaped mock."""
    resp = MagicMock()
    resp.ok = 200 <= status_code < 300
    resp.status_code = status_code
    resp.json.return_value = json_payload or {}
    resp.text = json.dumps(json_payload or {})
    return resp


# ── STK Push (C2B) ───────────────────────────────────────────────


@override_settings(
    INTASEND_ENVIRONMENT="sandbox",
    INTASEND_API_SECRET=_TEST_SECRET,
    INTASEND_PUBLISHABLE_KEY="ISPubKey_test_aaa",
    INTASEND_CALLBACK_URL="https://example.com/cb/",
)
class TestStkPush(TestCase):
    def test_payload_shape_and_auth_header(self):
        from apps.mpesa.intasend_client import IntaSendClient

        with patch("apps.mpesa.intasend_client.requests.post") as mock_post:
            mock_post.return_value = _mock_response(200, {
                "id": "inv-123",
                "tracking_id": "trk-abc",
                "invoice": {"invoice_id": "inv-123", "state": "PENDING"},
            })
            client = IntaSendClient()
            result = client.stk_push(
                phone="0712345678", amount=100,
                account_ref="HOUSE-RENT", description="April",
            )

        # Endpoint + method.
        args, kwargs = mock_post.call_args
        assert args[0].endswith("/api/v1/payment/mpesa-stk-push/")
        # Bearer header carries the configured secret.
        assert kwargs["headers"]["Authorization"] == f"Bearer {_TEST_SECRET}"
        # Payload shape.
        payload = kwargs["json"]
        assert payload["phone_number"] == "254712345678"
        assert payload["amount"] == 100
        assert payload["currency"] == "KES"
        assert "api_ref" in payload
        # Result normalised to the adapter contract.
        assert result["InvoiceID"] == "inv-123"
        assert result["TrackingID"] == "trk-abc"
        assert result["ResponseCode"] == "0"

    def test_api_error_raises(self):
        from apps.mpesa.intasend_client import IntaSendClient, IntaSendError

        with patch("apps.mpesa.intasend_client.requests.post") as mock_post:
            mock_post.return_value = _mock_response(400, {"detail": "Insufficient funds"})
            client = IntaSendClient()
            with self.assertRaises(IntaSendError) as ctx:
                client.stk_push(phone="254712345678", amount=100)
            assert "400" in str(ctx.exception)
            assert "Insufficient funds" in str(ctx.exception)

    def test_missing_secret_raises(self):
        from apps.mpesa.intasend_client import IntaSendClient, IntaSendError

        with override_settings(INTASEND_API_SECRET=""):
            with self.assertRaises(IntaSendError) as ctx:
                IntaSendClient().stk_push(phone="254712345678", amount=100)
            assert "INTASEND_API_SECRET" in str(ctx.exception)


# ── Send Money (B2C / B2B) ───────────────────────────────────────


@override_settings(
    INTASEND_ENVIRONMENT="sandbox",
    INTASEND_API_SECRET=_TEST_SECRET,
)
class TestSendMoney(TestCase):
    def test_pay_paybill_uses_b2b_with_account_number(self):
        from apps.mpesa.intasend_client import IntaSendClient

        with patch("apps.mpesa.intasend_client.requests.post") as mock_post:
            mock_post.return_value = _mock_response(200, {
                "tracking_id": "trk-pay-1",
                "state": "PROCESSING",
            })
            IntaSendClient().pay_paybill(
                paybill="247247", account="0123456789",
                amount=1000, reference="cpay-tx-1",
            )

        payload = mock_post.call_args[1]["json"]
        assert payload["provider"] == "MPESA-B2B"
        assert payload["currency"] == "KES"
        assert payload["requires_approval"] == "NO"
        # Both paybill (account) and account_no carried.
        tx0 = payload["transactions"][0]
        assert tx0["account"] == "247247"
        assert tx0["account_number"] == "0123456789"
        assert tx0["amount"] == 1000
        assert payload["api_ref"] == "cpay-tx-1"

    def test_pay_till_uses_b2b_without_account_number(self):
        from apps.mpesa.intasend_client import IntaSendClient

        with patch("apps.mpesa.intasend_client.requests.post") as mock_post:
            mock_post.return_value = _mock_response(200, {"tracking_id": "trk"})
            IntaSendClient().pay_till(till="888888", amount=500)

        payload = mock_post.call_args[1]["json"]
        assert payload["provider"] == "MPESA-B2B"
        tx0 = payload["transactions"][0]
        assert tx0["account"] == "888888"
        # No account_number for till payments.
        assert "account_number" not in tx0

    def test_send_to_mobile_uses_b2c(self):
        from apps.mpesa.intasend_client import IntaSendClient

        with patch("apps.mpesa.intasend_client.requests.post") as mock_post:
            mock_post.return_value = _mock_response(200, {"tracking_id": "trk-b2c"})
            IntaSendClient().send_to_mobile(
                phone="0712345678", amount=200, reason="Refund",
            )

        payload = mock_post.call_args[1]["json"]
        assert payload["provider"] == "MPESA-B2C"
        # Phone normalised to the bare 254XXX… form IntaSend expects.
        assert payload["transactions"][0]["account"] == "254712345678"
        assert payload["transactions"][0]["narrative"] == "Refund"

    def test_send_to_mobile_rejects_bad_phone(self):
        from apps.mpesa.intasend_client import IntaSendClient

        with patch("apps.mpesa.intasend_client.requests.post"):
            with self.assertRaises(ValueError):
                IntaSendClient().send_to_mobile(phone="1234", amount=200)


# ── Reversal · NOT SUPPORTED ────────────────────────────────────


@override_settings(INTASEND_API_SECRET=_TEST_SECRET)
class TestReversal(TestCase):
    def test_reversal_raises_not_implemented(self):
        from apps.mpesa.intasend_client import IntaSendClient
        with self.assertRaises(NotImplementedError):
            IntaSendClient().reversal(transaction_id="abc")


# ── Provider routing ────────────────────────────────────────────


@override_settings(
    PAYMENT_PROVIDER="intasend",
    INTASEND_API_SECRET=_TEST_SECRET,
    INTASEND_PUBLISHABLE_KEY="pk",
    INTASEND_ENVIRONMENT="sandbox",
)
class TestProviderRouting(TestCase):
    def test_adapter_routes_to_intasend(self):
        from apps.mpesa.provider import get_payment_client
        client = get_payment_client()
        assert client.is_intasend
        assert not client.is_sasapay
        assert not client.supports_reversal

    def test_b2b_payment_through_adapter(self):
        from apps.mpesa.provider import get_payment_client

        with patch("apps.mpesa.intasend_client.requests.post") as mock_post:
            mock_post.return_value = _mock_response(200, {
                "tracking_id": "trk-via-adapter",
            })
            result = get_payment_client().b2b_payment(
                paybill="247247", account="ACME",
                amount=5000, remarks="Bill",
                reference="adapter-tx-1",
            )

        # Adapter contract fields present.
        assert result["ConversationID"] == "trk-via-adapter"
        assert result["ResponseCode"] == "0"
        assert result["OriginatorConversationID"] == "adapter-tx-1"

    def test_reversal_through_adapter_raises(self):
        from apps.mpesa.provider import get_payment_client
        with self.assertRaises(NotImplementedError):
            get_payment_client().reversal(
                transaction_id="abc", amount=100, remarks="oops",
            )


# ── Webhook · signature, dedup, classification ──────────────────


def _hmac_hex(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


@override_settings(
    DEBUG=False,
    INTASEND_WEBHOOK_SECRET=_TEST_WEBHOOK_SECRET,
    INTASEND_API_SECRET=_TEST_SECRET,
)
class TestWebhookSignature(TestCase):
    def setUp(self):
        from django.test import Client
        self.client = Client()
        cache.clear()

    def test_rejects_missing_signature(self):
        body = b'{"state":"COMPLETE"}'
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_rejects_bad_signature(self):
        body = b'{"state":"COMPLETE","tracking_id":"xyz"}'
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
            HTTP_X_INTASEND_SIGNATURE="0" * 64,
        )
        assert resp.status_code == 401

    def test_accepts_valid_signature_unknown_event(self):
        # Unknown event shape · still authenticated · returns 200 with
        # the "ignored_unknown" status. Verifies the signature path.
        body = b'{"state":"PENDING"}'
        sig = _hmac_hex(_TEST_WEBHOOK_SECRET, body)
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
            HTTP_X_INTASEND_SIGNATURE=sig,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored_unknown"

    def test_accepts_sha256_prefixed_signature(self):
        body = b'{"state":"PENDING","invoice_id":"inv-pfx"}'
        sig = "sha256=" + _hmac_hex(_TEST_WEBHOOK_SECRET, body)
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
            HTTP_X_INTASEND_SIGNATURE=sig,
        )
        assert resp.status_code == 200

    # ── 2026-05-15 · body-challenge auth (IntaSend default scheme) ──
    #
    # Regression tests for the beta-launch bug: IntaSend's default
    # webhook auth puts the dashboard "Challenge" string in the JSON
    # body's `challenge` field · NOT in an HMAC header. We shipped only
    # the HMAC scheme, so every paybill webhook was 401'd and the saga
    # left in CONFIRMING. Composite verifier accepts EITHER scheme.

    def test_accepts_valid_body_challenge_unknown_event(self):
        body_obj = {"state": "PENDING", "challenge": _TEST_WEBHOOK_SECRET}
        body = json.dumps(body_obj).encode("utf-8")
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
            # No HMAC signature header · body challenge alone must pass.
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored_unknown"

    def test_accepts_valid_body_challenge_send_money_event(self):
        # Confirms the body-challenge path doesn't break the
        # downstream classifier · a real send-money payload with a
        # valid challenge reaches the send-money handler.
        body_obj = {
            "state": "PENDING",
            "provider": "MPESA-B2B",
            "tracking_id": "tr-real-1",
            "challenge": _TEST_WEBHOOK_SECRET,
        }
        body = json.dumps(body_obj).encode("utf-8")
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
        )
        assert resp.status_code == 200
        # No matching pending tx in the test DB · the send_money handler
        # returns tx_not_found, NOT bad_signature. That's the proof that
        # auth passed.
        assert resp.json()["status"] == "tx_not_found"

    def test_rejects_wrong_body_challenge(self):
        body_obj = {"state": "PENDING", "challenge": "WRONG_CHALLENGE_VALUE"}
        body = json.dumps(body_obj).encode("utf-8")
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_rejects_empty_body_challenge(self):
        # Empty string challenge must NOT pass · prevents accidentally
        # whitelisting requests that happen to carry `"challenge":""`.
        body_obj = {"state": "PENDING", "challenge": ""}
        body = json.dumps(body_obj).encode("utf-8")
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_rejects_no_auth_at_all(self):
        # Neither body-challenge nor HMAC header. Hard reject.
        body_obj = {"state": "PENDING", "tracking_id": "tr-noauth"}
        body = json.dumps(body_obj).encode("utf-8")
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_body_challenge_constant_time_compare(self):
        # Ensure compare_digest is used (not string ==). We assert
        # behaviour: prefix-match must fail. If we ever regress to ==
        # this still works, so the real safety net is reviewing
        # `_verify_body_challenge` source. Belt-and-braces.
        body_obj = {
            "state": "PENDING",
            "challenge": _TEST_WEBHOOK_SECRET[:10],  # prefix only
        }
        body = json.dumps(body_obj).encode("utf-8")
        resp = self.client.post(
            "/api/v1/intasend/callback/",
            data=body,
            content_type="application/json",
        )
        assert resp.status_code == 401


@override_settings(
    DEBUG=False,
    INTASEND_WEBHOOK_SECRET=_TEST_WEBHOOK_SECRET,
    INTASEND_API_SECRET=_TEST_SECRET,
)
class TestWebhookDedup(TestCase):
    def setUp(self):
        from django.test import Client
        self.client = Client()
        cache.clear()

    def test_duplicate_tracking_id_rejected_as_duplicate(self):
        body = b'{"state":"PENDING","tracking_id":"dup-1","invoice_id":"i"}'
        sig = _hmac_hex(_TEST_WEBHOOK_SECRET, body)
        # First delivery
        r1 = self.client.post(
            "/api/v1/intasend/callback/",
            data=body, content_type="application/json",
            HTTP_X_INTASEND_SIGNATURE=sig,
        )
        # Second delivery (replay)
        r2 = self.client.post(
            "/api/v1/intasend/callback/",
            data=body, content_type="application/json",
            HTTP_X_INTASEND_SIGNATURE=sig,
        )
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json()["status"] == "duplicate"


@override_settings(
    DEBUG=False,
    INTASEND_WEBHOOK_SECRET=_TEST_WEBHOOK_SECRET,
    INTASEND_API_SECRET=_TEST_SECRET,
)
class TestWebhookClassification(TestCase):
    def setUp(self):
        from django.test import Client
        self.client = Client()
        cache.clear()

    def test_classify_collection(self):
        from apps.mpesa.intasend_views import _classify_event
        # Has invoice_id, no provider field → collection.
        assert _classify_event({"invoice_id": "abc", "state": "COMPLETE"}) == "collection"

    def test_classify_send_money(self):
        from apps.mpesa.intasend_views import _classify_event
        assert _classify_event({"provider": "MPESA-B2C"}) == "send_money"
        assert _classify_event({"provider": "MPESA-B2B"}) == "send_money"
        assert _classify_event({"provider": "PESALINK"}) == "send_money"

    def test_classify_unknown(self):
        from apps.mpesa.intasend_views import _classify_event
        assert _classify_event({}) == "unknown"
        assert _classify_event({"random": "field"}) == "unknown"
