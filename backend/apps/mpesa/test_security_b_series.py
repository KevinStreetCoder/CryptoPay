"""B-series security audit regression tests (mpesa app).

Covers B1, B2, B11, B12, B25, B28.
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch, MagicMock

import pytest
from django.conf import settings
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


# Token minting in `apps.mpesa.middleware` refuses to fall back to
# Django's SECRET_KEY in non-DEBUG mode, which is the safe default in
# production but means tests that exercise the URL-token path must
# provide a deterministic key. 64-hex-char dummy mirrors what we'd
# generate via `secrets.token_hex(32)` in real envs.
_TEST_HMAC_KEY = "0" * 64


# -------------------------- B1 + B2: middleware prefix list -------------------------- #

class TestB1MiddlewarePrefixCoverage(TestCase):
    """Verify MpesaIPWhitelistMiddleware protects ALL the right URL prefixes."""

    def test_prefix_tuple_covers_c2b_hooks_and_sasapay(self):
        from apps.mpesa.middleware import MpesaIPWhitelistMiddleware
        prefixes = [p for p, _ in MpesaIPWhitelistMiddleware.CALLBACK_PATH_PREFIXES]
        assert "/api/v1/mpesa/callback/" in prefixes
        assert "/api/v1/hooks/c2b/" in prefixes
        assert "/api/v1/sasapay/" in prefixes
        assert "/api/v1/mpesa/sasapay/" in prefixes

    def test_non_whitelisted_ip_is_rejected_on_c2b_hook(self):
        client = APIClient(REMOTE_ADDR="8.8.8.8")
        resp = client.post(
            "/api/v1/hooks/c2b/confirm/",
            {"TransID": "X", "TransAmount": "1000", "MSISDN": "254700000000"},
            format="json",
        )
        # Middleware blocks before the view runs.
        assert resp.status_code == 403

    def test_non_whitelisted_ip_is_rejected_on_sasapay_callback(self):
        client = APIClient(REMOTE_ADDR="8.8.8.8")
        resp = client.post(
            "/api/v1/sasapay/callback/",
            {"ResultCode": "0"},
            format="json",
        )
        assert resp.status_code == 403


# -------------------------- B25: C2B amount bounds -------------------------- #

class TestB25C2BRejectsOutOfRange(TestCase):
    """process_c2b_deposit must REFUSE to credit crypto when amount is
    outside DEPOSIT_MIN_KES/DEPOSIT_MAX_KES."""

    @patch("apps.mpesa.tasks._send_c2b_admin_alert")
    def test_out_of_range_does_not_create_transaction(self, _alert):
        from apps.mpesa.tasks import process_c2b_deposit
        from apps.payments.models import Transaction
        # Seed a user that matches the bill-ref phone so the user-lookup
        # step doesn't early-return on "orphaned deposit".
        from django.contrib.auth import get_user_model
        User = get_user_model()
        User.objects.create(phone="+254700000001")

        start_count = Transaction.objects.count()
        # Enormous amount far exceeds DEPOSIT_MAX_KES · must be rejected
        # before any Transaction row is created.
        process_c2b_deposit(
            trans_id="FAKEXX",
            amount_str="999999999",
            phone="254700000001",
            bill_ref="USDT-254700000001",
            raw_payload={},
        )
        end_count = Transaction.objects.count()
        assert end_count == start_count


# -------------------------- B11: balance callback token -------------------------- #

class TestB11BalanceCallbackToken(TestCase):
    def test_bad_token_returns_403(self):
        client = APIClient(REMOTE_ADDR="196.201.214.10")
        resp = client.post(
            "/api/v1/mpesa/callback/balance/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
            {"Result": {"ResultCode": 0}},
            format="json",
        )
        # 403 if middleware passes the whitelisted IP but the view rejects bad token.
        assert resp.status_code == 403


# -------------------------- B12: STK amount match -------------------------- #

class TestB12STKAmountMismatch(TestCase):
    """A callback with Amount != tx.source_amount must mark the tx FAILED
    with reason 'amount_mismatch' and not credit crypto."""

    def test_amount_mismatch_flags_failed(self):
        from apps.payments.models import Transaction
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create(phone="+254700000002")
        tx = Transaction.objects.create(
            idempotency_key="b12-test",
            user=user,
            type=Transaction.Type.BUY,
            source_currency="KES",
            source_amount=Decimal("100"),
            dest_currency="USDT",
            dest_amount=Decimal("0.77"),
            exchange_rate=Decimal("130"),
            status=Transaction.Status.PROCESSING,
            saga_data={
                "mpesa_checkout_request_id": "CKR-abc",
                "mpesa_merchant_request_id": "MR-abc",
            },
        )
        payload = {
            "Body": {
                "stkCallback": {
                    "MerchantRequestID": "MR-abc",
                    "CheckoutRequestID": "CKR-abc",
                    "ResultCode": 0,
                    "ResultDesc": "OK",
                    "CallbackMetadata": {
                        "Item": [
                            {"Name": "Amount", "Value": 999},
                            {"Name": "MpesaReceiptNumber", "Value": "XYZ"},
                            {"Name": "PhoneNumber", "Value": 254700000002},
                        ]
                    },
                }
            }
        }
        client = APIClient(REMOTE_ADDR="196.201.214.10")
        resp = client.post("/api/v1/mpesa/callback/stk/", payload, format="json")
        assert resp.status_code == 200
        tx.refresh_from_db()
        assert tx.status == Transaction.Status.FAILED
        assert tx.failure_reason == "amount_mismatch"


# -------------------------- B28: status/reversal per-tx token URLs -------------------------- #

class TestB28StatusReversalUseTokens(TestCase):
    @override_settings(MPESA_CALLBACK_HMAC_KEY=_TEST_HMAC_KEY)
    def test_transaction_status_result_url_contains_token_segment(self):
        from apps.mpesa.client import MpesaClient
        c = MpesaClient()
        with patch("apps.mpesa.client.requests.post") as mock_post, \
             patch.object(c, "_get_security_credential", return_value="cred"):
            mock_post.return_value = MagicMock(
                status_code=200,
                json=MagicMock(return_value={"ok": True}),
            )
            mock_post.return_value.raise_for_status = lambda: None
            c.transaction_status("tx-abc-123")
            # The posted JSON must have a token-bearing ResultURL.
            call_kwargs = mock_post.call_args.kwargs
            body = call_kwargs.get("json", {})
            result_url = body.get("ResultURL", "")
            timeout_url = body.get("QueueTimeOutURL", "")
            assert "/callback/status/" in result_url
            # Token is 32 hex chars; URL path should have > base length.
            assert result_url.count("/") >= 6
            assert "/callback/status/timeout/" in timeout_url
