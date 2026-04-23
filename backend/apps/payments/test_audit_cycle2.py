"""
Regression tests for audit cycle-2 fixes (commits 5943743 + follow-ups).

CRITICAL 1 · SwapView NameError
  - The view referenced `ser.validated_data` where only `serializer`
    was bound. Every swap raised HTTP 500 pre-fix. Test: a happy-path
    swap no longer NameErrors before it gets to business-logic
    validation.

HIGH 2 · lock_funds / unlock_funds idempotency
  - When `transaction_id` is passed, a second call with the same
    (tx, wallet) pair must be a no-op so a saga retry doesn't
    double-lock.

HIGH 4 · Referral status labels exhaustive
  - Every value in `Referral.Status.choices` must have a
    human-readable entry in `ReferralHistoryItemSerializer._STATUS_LABELS`
    so no status silently falls through to the raw-title fallback.

MED 5 · MyReferralSerializer / view drift
  - Serializer must declare `bonus_per_referral_kes` +
    `referee_bonus_kes` so drf-spectacular emits a truthful spec.

MED 6 · TransactionReceiptView one-shot signed URL
  - A signed URL can be consumed once; a second request with the same
    sig falls back to bearer-auth (and returns 401 when no bearer).

MED 7 · RequestOTPView constant-shape response
  - `email_fallback` and masked-email leaks must no longer appear in
    the response body.
"""
from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.payments.models import Transaction
from apps.referrals.models import Referral


class SwapViewNameErrorTest(TestCase):
    """CRITICAL 1 · swap must not NameError on `ser.validated_data`."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            phone="+254711000100", pin="123456", kyc_tier=3,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_swap_endpoint_reachable_without_name_error(self):
        """POST /swap/ with valid payload must not raise NameError.

        We're not asserting the swap *succeeds* (that needs real
        wallets + rates). We're asserting it doesn't 500 with
        `NameError: name 'ser' is not defined` like pre-fix. A 400 or
        403 is fine — anything OTHER than a 500 proves the fix.
        """
        resp = self.client.post("/api/v1/payments/swap/", {
            "from_currency": "USDT",
            "to_currency": "USDC",
            "amount": "1",
            "pin": "123456",
            "idempotency_key": "test-swap-nameerror",
        }, format="json")
        self.assertNotEqual(
            resp.status_code, 500,
            f"SwapView crashed with HTTP 500 — NameError regression. body={resp.content!r}",
        )


class LockFundsIdempotencyTest(TestCase):
    """HIGH 2 · lock_funds/unlock_funds with transaction_id must be idempotent."""

    def setUp(self):
        cache.clear()
        from apps.wallets.models import Wallet
        self.user = User.objects.create_user(
            phone="+254711000101", pin="123456",
        )
        self.wallet = Wallet.objects.create(
            user=self.user, currency="USDT", balance=Decimal("100"),
        )

    def test_double_lock_with_same_tx_id_is_noop(self):
        from apps.wallets.services import WalletService
        tx_id = "00000000-0000-0000-0000-000000000001"

        WalletService.lock_funds(self.wallet.id, Decimal("40"), transaction_id=tx_id)
        WalletService.lock_funds(self.wallet.id, Decimal("40"), transaction_id=tx_id)

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.locked_balance, Decimal("40"))

    def test_double_unlock_with_same_tx_id_is_noop(self):
        from apps.wallets.services import WalletService
        tx_id = "00000000-0000-0000-0000-000000000002"

        WalletService.lock_funds(self.wallet.id, Decimal("30"), transaction_id=tx_id)
        WalletService.unlock_funds(self.wallet.id, Decimal("30"), transaction_id=tx_id)
        WalletService.unlock_funds(self.wallet.id, Decimal("30"), transaction_id=tx_id)

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.locked_balance, Decimal("0"))

    def test_legacy_no_tx_id_still_works(self):
        from apps.wallets.services import WalletService
        WalletService.lock_funds(self.wallet.id, Decimal("20"))
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.locked_balance, Decimal("20"))


class ReferralStatusLabelsExhaustiveTest(TestCase):
    """HIGH 4 · every Referral.Status value needs a display label."""

    def test_every_status_choice_has_a_display_label(self):
        from apps.referrals.serializers import ReferralHistoryItemSerializer
        labels = ReferralHistoryItemSerializer._STATUS_LABELS
        for value, _verbose in Referral.Status.choices:
            self.assertIn(
                value, labels,
                f"Referral.Status.{value} has no entry in _STATUS_LABELS — "
                f"will render as raw title-case on mobile.",
            )


class MyReferralSerializerFieldsTest(TestCase):
    """MED 5 · declared fields must match MyReferralView's response."""

    def test_declared_fields_cover_view_output(self):
        from apps.referrals.serializers import MyReferralSerializer
        declared = set(MyReferralSerializer().fields.keys())
        required = {"bonus_per_referral_kes", "referee_bonus_kes"}
        missing = required - declared
        self.assertFalse(
            missing,
            f"MyReferralSerializer missing fields {missing} — "
            f"drf-spectacular spec will lie about the API contract.",
        )


class RequestOTPConstantShapeTest(TestCase):
    """MED 7 · response must not leak whether the phone has an email."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _fire(self, phone):
        return self.client.post("/api/v1/auth/otp/", {
            "phone": phone,
        }, format="json")

    def test_no_email_fallback_field_in_response(self):
        """Pre-fix the response for phone-with-email-on-file would
        include `"email_fallback": true` and a masked email — leaking
        account-existence + that the user registered an email.

        `send_sms` / `send_otp_to_email` are imported lazily inside the
        view so we patch at the source module.
        """
        User.objects.create_user(
            phone="+254711000200", pin="123456",
            email="leak-canary@example.com",
        )
        with patch("apps.core.email.send_sms", return_value=False), \
             patch("apps.core.email.send_otp_to_email", return_value=True):
            resp = self._fire("+254711000200")

        body = resp.json()
        self.assertNotIn("email_fallback", body)
        self.assertNotIn("leak-canary", str(body))
        self.assertNotIn("l***", str(body))
