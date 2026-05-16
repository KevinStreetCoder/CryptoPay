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
        # IDENTICAL (tracking_id, state) replay · still dedups.
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

    # 2026-05-16 · regression for the stuck-paybill bug.
    #
    # IntaSend delivers MULTIPLE webhooks for the same tracking_id as
    # the payment progresses (QUEUED → PROCESSING → COMPLETED/FAILED).
    # The pre-fix dedup was keyed on tracking_id alone, so the FIRST
    # webhook (usually a near-empty QUEUED with no `state`) ate the
    # SETNX and EVERY subsequent state transition came back 200
    # "duplicate" before the handler saw it. Saga stuck CONFIRMING
    # forever. New dedup composes (tracking_id, state) so distinct
    # states get processed independently while identical replays
    # still dedup.

    def test_multi_state_same_tracking_id_each_processed(self):
        sig = lambda b: _hmac_hex(_TEST_WEBHOOK_SECRET, b)
        queued     = b'{"state":"QUEUED","tracking_id":"multi-1","provider":"MPESA-B2B"}'
        processing = b'{"state":"PROCESSING","tracking_id":"multi-1","provider":"MPESA-B2B"}'
        completed  = b'{"state":"COMPLETE","tracking_id":"multi-1","provider":"MPESA-B2B"}'

        rq = self.client.post("/api/v1/intasend/callback/", data=queued,
                              content_type="application/json",
                              HTTP_X_INTASEND_SIGNATURE=sig(queued))
        rp = self.client.post("/api/v1/intasend/callback/", data=processing,
                              content_type="application/json",
                              HTTP_X_INTASEND_SIGNATURE=sig(processing))
        rc = self.client.post("/api/v1/intasend/callback/", data=completed,
                              content_type="application/json",
                              HTTP_X_INTASEND_SIGNATURE=sig(completed))
        # All three must be processed (not deduped) · the response
        # status is `tx_not_found` because no matching pending tx
        # exists in this isolated unit test · the point is none of
        # them is `duplicate`.
        for r in (rq, rp, rc):
            assert r.status_code == 200, r.content
            assert r.json().get("status") != "duplicate", r.content

    def test_same_state_replay_still_dedups(self):
        # Idempotent retries by IntaSend (same tracking_id + same state)
        # must still dedup · otherwise we'd process the same business
        # event twice.
        sig = lambda b: _hmac_hex(_TEST_WEBHOOK_SECRET, b)
        body = b'{"state":"COMPLETE","tracking_id":"dup-state-1","provider":"MPESA-B2B"}'

        r1 = self.client.post("/api/v1/intasend/callback/", data=body,
                              content_type="application/json",
                              HTTP_X_INTASEND_SIGNATURE=sig(body))
        r2 = self.client.post("/api/v1/intasend/callback/", data=body,
                              content_type="application/json",
                              HTTP_X_INTASEND_SIGNATURE=sig(body))
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json()["status"] == "duplicate"

    def test_no_state_field_dedups_against_other_no_state(self):
        # Defensive · the empty-state QUEUED webhook should still
        # dedup against itself (so a duplicate flood doesn't hammer
        # the saga's no-state path).
        sig = lambda b: _hmac_hex(_TEST_WEBHOOK_SECRET, b)
        body = b'{"tracking_id":"no-state-1","provider":"MPESA-B2B"}'
        r1 = self.client.post("/api/v1/intasend/callback/", data=body,
                              content_type="application/json",
                              HTTP_X_INTASEND_SIGNATURE=sig(body))
        r2 = self.client.post("/api/v1/intasend/callback/", data=body,
                              content_type="application/json",
                              HTTP_X_INTASEND_SIGNATURE=sig(body))
        assert r1.json().get("status") != "duplicate"
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

    # 2026-05-16 · classifier expansion · send-money intermediate states
    # may omit `provider` but still carry `file_id` or a `transactions`
    # array. Those used to misclassify as unknown_event and never
    # transition the saga.

    def test_classify_send_money_via_file_id(self):
        from apps.mpesa.intasend_views import _classify_event
        assert _classify_event({"file_id": "FF1234"}) == "send_money"

    def test_classify_send_money_via_transactions_array(self):
        from apps.mpesa.intasend_views import _classify_event
        payload = {
            "transactions": [
                {"tracking_id": "t-1", "status": "Queued"},
            ],
        }
        assert _classify_event(payload) == "send_money"

    def test_classify_provider_still_wins_when_explicit(self):
        # Even if `transactions` is present, an explicit provider should
        # still resolve correctly.
        from apps.mpesa.intasend_views import _classify_event
        payload = {
            "provider": "MPESA-B2C",
            "transactions": [{"tracking_id": "x"}],
        }
        assert _classify_event(payload) == "send_money"


# 2026-05-16 · per-transaction inner-status resolution ───────────────


class TestResolveSendMoneyState(TestCase):
    """IntaSend's send-money batches carry status at TWO levels:
        top-level `state` · batch status (often "Complete" even when
            every inner tx failed)
        `transactions[0].status` · per-tx, the one the saga cares about.

    Earlier we only read top-level `state`. A payload with state=""
    + transactions=[{status: "Initiation failed"}] fell through to
    "noted" and the tx hung in CONFIRMING until the 10-min cron
    compensated. This regression test guards against re-introducing
    that drop."""

    def test_empty_state_picks_up_per_tx_initiation_failed(self):
        from apps.mpesa.intasend_views import _resolve_send_money_state, _is_failed
        payload = {
            "state": "",
            "transactions": [
                {"status": "Initiation failed", "status_code": "TF103"},
            ],
        }
        s = _resolve_send_money_state(payload)
        assert _is_failed(s), s

    def test_per_tx_failure_overrides_batch_complete(self):
        # The smoking-gun payload: BATCH "Complete" but the inner tx
        # actually failed. Per-tx must win.
        from apps.mpesa.intasend_views import _resolve_send_money_state, _is_failed
        payload = {
            "state": "Complete",
            "transactions": [
                {"status": "Initiation failed", "status_code": "TF103"},
            ],
        }
        s = _resolve_send_money_state(payload)
        assert _is_failed(s), s

    def test_per_tx_complete_keeps_complete(self):
        from apps.mpesa.intasend_views import _resolve_send_money_state, _is_complete
        payload = {
            "state": "Complete",
            "transactions": [
                {"status": "Completed", "status_code": "TS100"},
            ],
        }
        s = _resolve_send_money_state(payload)
        assert _is_complete(s), s

    def test_status_codes_recognised(self):
        from apps.mpesa.intasend_views import _is_failed, _is_complete
        assert _is_failed("TF103")
        assert _is_failed("TF102")
        assert _is_failed("TF101")
        assert _is_complete("BC100")
        assert _is_complete("TS100")


class TestFindPendingTxByFileId(TestCase):
    """B2B / send-money webhooks deliver a per-tx `tracking_id` that
    doesn't match what we stored at initiate-time (we stamp
    `saga_data.intasend_file_id` because the initiate response only
    has the batch-level file_id). _find_pending_tx must look up by
    file_id too, otherwise the webhook returns tx_not_found and the
    tx hangs in CONFIRMING."""

    def test_resolves_via_intasend_file_id_in_saga_data(self):
        from apps.payments.models import Transaction
        from apps.accounts.models import User
        from apps.mpesa.intasend_views import _find_pending_tx
        from uuid import uuid4

        user = User.objects.create_user(
            email=f"file-id-test-{uuid4().hex[:6]}@example.com",
            phone=f"+25470{uuid4().int % 10000000:07d}",
            password="testing12345",
        )
        tx = Transaction.objects.create(
            user=user,
            idempotency_key=str(uuid4()),
            type=Transaction.Type.PAYBILL_PAYMENT,
            status=Transaction.Status.CONFIRMING,
            source_currency="SOL",
            source_amount="0.00190758",
            dest_currency="KES",
            dest_amount="10",
            fee_amount="0",
            fee_currency="KES",
            mpesa_paybill="888880",
            saga_data={"intasend_file_id": "YGQ9ZNX"},
        )
        # Webhook payload carries a per-tx tracking_id (mismatched)
        # AND the batch file_id (matches what we stored).
        payload = {
            "tracking_id": "98834bcd-d7ab-4e23-9082-6878b380171c",
            "file_id": "YGQ9ZNX",
            "state": "",
            "transactions": [{"status": "Initiation failed"}],
        }
        found = _find_pending_tx(payload)
        assert found is not None
        assert found.id == tx.id

    def test_resolves_via_mpesa_conversation_id_legacy(self):
        # Older tx rows stamped file_id as mpesa_conversation_id (no
        # intasend_file_id key). _find_pending_tx falls back to that
        # column too, so existing rows still resolve.
        from apps.payments.models import Transaction
        from apps.accounts.models import User
        from apps.mpesa.intasend_views import _find_pending_tx
        from uuid import uuid4

        user = User.objects.create_user(
            email=f"legacy-conv-{uuid4().hex[:6]}@example.com",
            phone=f"+25470{uuid4().int % 10000000:07d}",
            password="testing12345",
        )
        tx = Transaction.objects.create(
            user=user,
            idempotency_key=str(uuid4()),
            type=Transaction.Type.PAYBILL_PAYMENT,
            status=Transaction.Status.CONFIRMING,
            source_currency="USDT",
            source_amount="0.10",
            dest_currency="KES",
            dest_amount="10",
            fee_amount="0",
            fee_currency="KES",
            mpesa_paybill="888880",
            saga_data={"mpesa_conversation_id": "LEGACY-FILE-ID"},
        )
        payload = {
            "file_id": "LEGACY-FILE-ID",
            "state": "Complete",
        }
        found = _find_pending_tx(payload)
        assert found is not None
        assert found.id == tx.id


# ── 2026-05-16 · query_transaction routes to the right endpoint ──────


@override_settings(
    INTASEND_API_SECRET=_TEST_SECRET,
    INTASEND_PUBLISHABLE_KEY="ISPubKey_test_xxx",
    INTASEND_ENVIRONMENT="test",
)
class TestQueryTransactionEndpointRouting(TestCase):
    """Regression for the beta-launch stuck-paybill bug:

    `IntaSendClient.query_transaction` previously hit
    `/api/v1/payment/status/` for everything · that endpoint is for
    COLLECTIONS (C2B) only. Send-money (B2B/B2C) needs
    `/api/v1/send-money/status/`. Mismatch caused every send-money
    status query to return "Invoice with specified id does not exist",
    so the stuck-tx cron could never resolve a paybill.
    """

    @patch("requests.post")
    def test_explicit_send_money_kind_hits_send_money_endpoint(self, post_mock):
        post_mock.return_value.status_code = 200
        post_mock.return_value.json.return_value = {"state": "COMPLETE"}
        post_mock.return_value.raise_for_status = lambda: None

        from apps.mpesa.intasend_client import IntaSendClient
        IntaSendClient().query_transaction(
            tracking_id="t-123", kind="send_money",
        )

        assert post_mock.called
        url = post_mock.call_args.args[0] if post_mock.call_args.args else post_mock.call_args.kwargs.get("url", "")
        assert "/send-money/status/" in url, (
            f"send_money kind must hit /send-money/status/, got: {url}"
        )

    @patch("requests.post")
    def test_explicit_collection_kind_hits_payment_endpoint(self, post_mock):
        post_mock.return_value.status_code = 200
        post_mock.return_value.json.return_value = {"state": "COMPLETE"}
        post_mock.return_value.raise_for_status = lambda: None

        from apps.mpesa.intasend_client import IntaSendClient
        IntaSendClient().query_transaction(
            invoice_id="inv-1", kind="collection",
        )

        url = post_mock.call_args.args[0] if post_mock.call_args.args else post_mock.call_args.kwargs.get("url", "")
        assert "/payment/status/" in url
        assert "/send-money/status/" not in url

    @patch("requests.post")
    def test_auto_kind_tries_send_money_first(self, post_mock):
        # Auto with a tracking_id should hit send-money first ·
        # send-money is where most beta traffic lives.
        post_mock.return_value.status_code = 200
        post_mock.return_value.json.return_value = {"state": "PENDING"}
        post_mock.return_value.raise_for_status = lambda: None

        from apps.mpesa.intasend_client import IntaSendClient
        IntaSendClient().query_transaction(tracking_id="t-auto")

        first_url = (
            post_mock.call_args_list[0].args[0]
            if post_mock.call_args_list[0].args
            else post_mock.call_args_list[0].kwargs.get("url", "")
        )
        assert "/send-money/status/" in first_url

    @patch("requests.post")
    def test_auto_kind_falls_back_to_collection_on_send_money_404(self, post_mock):
        # First call: send-money 404 with "does not exist"
        # Second call: collection success
        fail = MagicMock()
        fail.ok = False
        fail.status_code = 404
        fail.text = '{"detail":"Invoice with specified id does not exist"}'
        fail.json.return_value = {
            "detail": "Invoice with specified id does not exist",
        }

        ok = MagicMock()
        ok.ok = True
        ok.status_code = 200
        ok.json.return_value = {"state": "COMPLETE"}

        post_mock.side_effect = [fail, ok]

        from apps.mpesa.intasend_client import IntaSendClient
        result = IntaSendClient().query_transaction(tracking_id="t-fb")

        # Should have hit BOTH endpoints (send-money first, then collection).
        urls = [
            (call.args[0] if call.args else call.kwargs.get("url", ""))
            for call in post_mock.call_args_list
        ]
        assert any("/send-money/status/" in u for u in urls), urls
        assert any("/payment/status/" in u for u in urls), urls
        assert result.get("state") == "COMPLETE"
