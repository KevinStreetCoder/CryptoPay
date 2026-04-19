"""Tests for the referrals app.

Covers:
- Code generation uniqueness + alphabet exclusion
- attribute_signup happy path + fraud gates
- check_qualification state transitions + attribution window
- Reward grant idempotency
- apply_credit_to_fee FIFO consumption + idempotency
- Ledger aggregations
- API endpoints
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import User


_CFG = {
    "ENABLED": True,
    "REFERRER_BONUS_KES": "50.00",
    "REFEREE_BONUS_KES": "50.00",
    "QUALIFYING_MIN_KES": "500.00",
    "QUALIFYING_MIN_KES_TIER0": "1000.00",
    "ATTRIBUTION_WINDOW_DAYS": 30,
    "CLAWBACK_HOLD_DAYS": 7,
    "CREDIT_EXPIRY_DAYS": 90,
    "REFERRER_MONTHLY_CAP": 10,
    "REFERRER_LIFETIME_CAP": 50,
    "MIN_REFERRER_AGE_HOURS": 24,
}


def _make_user(phone="+254712345678", full_name="Jane Doe", date_joined_offset_days=30, kyc_tier=1):
    user = User.objects.create_user(phone=phone, pin="123456", full_name=full_name)
    user.kyc_tier = kyc_tier
    user.save(update_fields=["kyc_tier"])
    if date_joined_offset_days:
        # User model uses `created_at` (auto_now_add). Rewrite it via QuerySet.update
        # to bypass auto_now_add.
        User.objects.filter(pk=user.pk).update(
            created_at=timezone.now() - timedelta(days=date_joined_offset_days)
        )
        user.refresh_from_db()
    return user


@override_settings(REFERRAL_PROGRAM=_CFG)
class ReferralCodeTest(TestCase):
    def test_code_generated_uses_name_prefix(self):
        from .models import ReferralCode
        user = _make_user(full_name="Kevin Miller")
        rc = ReferralCode.get_or_create_for_user(user)
        self.assertEqual(len(rc.code), 6)
        self.assertTrue(rc.code.startswith("KEV"))

    def test_code_alphabet_excludes_ambiguous(self):
        from .models import ReferralCode
        user = _make_user()
        rc = ReferralCode.get_or_create_for_user(user)
        for ch in "0OI1L":
            self.assertNotIn(ch, rc.code)

    def test_idempotent_get_or_create(self):
        from .models import ReferralCode
        user = _make_user()
        rc1 = ReferralCode.get_or_create_for_user(user)
        rc2 = ReferralCode.get_or_create_for_user(user)
        self.assertEqual(rc1.code, rc2.code)


@override_settings(REFERRAL_PROGRAM=_CFG)
class AttributeSignupTest(TestCase):
    def setUp(self):
        from .models import ReferralCode
        self.referrer = _make_user(phone="+254711111111", full_name="Alice")
        self.rc = ReferralCode.get_or_create_for_user(self.referrer)

    def test_happy_path_creates_referral(self):
        from .models import Referral
        from .services import attribute_signup
        referee = _make_user(phone="+254722222222", full_name="Bob")
        referral = attribute_signup(
            user=referee,
            code=self.rc.code,
            request_meta={"ip": "10.0.0.1", "device_id": "dev-A"},
        )
        self.assertIsNotNone(referral)
        self.assertEqual(referral.referrer_id, self.referrer.id)
        self.assertEqual(referral.referee_id, referee.id)
        self.assertEqual(referral.status, Referral.Status.SIGNED_UP)

    def test_invalid_code_returns_none(self):
        from .services import attribute_signup
        referee = _make_user(phone="+254722222222")
        result = attribute_signup(user=referee, code="NOPE99", request_meta={})
        self.assertIsNone(result)

    def test_self_referral_blocked(self):
        from .services import attribute_signup
        result = attribute_signup(
            user=self.referrer,
            code=self.rc.code,
            request_meta={"ip": "10.0.0.1"},
        )
        self.assertIsNone(result)

    def test_too_new_referrer_blocked(self):
        from .models import ReferralCode
        from .services import attribute_signup
        new_referrer = _make_user(
            phone="+254733333333", full_name="New", date_joined_offset_days=0
        )
        rc = ReferralCode.get_or_create_for_user(new_referrer)
        referee = _make_user(phone="+254744444444")
        result = attribute_signup(
            user=referee, code=rc.code, request_meta={"ip": "10.0.0.1"}
        )
        self.assertIsNone(result)

    def test_device_reuse_blocked(self):
        from .services import attribute_signup

        r1 = _make_user(phone="+254722222222")
        r2 = _make_user(phone="+254733333333")
        ref1 = attribute_signup(
            user=r1, code=self.rc.code, request_meta={"device_id": "DEV-X"}
        )
        self.assertIsNotNone(ref1)
        ref2 = attribute_signup(
            user=r2, code=self.rc.code, request_meta={"device_id": "DEV-X"}
        )
        self.assertIsNone(ref2)


@override_settings(REFERRAL_PROGRAM=_CFG)
class QualificationTest(TestCase):
    def setUp(self):
        from .models import ReferralCode
        self.referrer = _make_user(phone="+254711111111", full_name="Alice")
        self.referee = _make_user(phone="+254722222222", full_name="Bob", kyc_tier=1)
        self.rc = ReferralCode.get_or_create_for_user(self.referrer)

    def _make_tx(self, *, tx_type, dest_amount="600.00", completed=True):
        from apps.payments.models import Transaction
        return Transaction.objects.create(
            idempotency_key=f"test-{timezone.now().timestamp()}",
            user=self.referee,
            type=tx_type,
            source_currency="USDT",
            source_amount=Decimal("10.00"),
            dest_currency="KES",
            dest_amount=Decimal(dest_amount),
            exchange_rate=Decimal("150.00"),
            fee_amount=Decimal("30.00"),
            status=(Transaction.Status.COMPLETED if completed else Transaction.Status.PENDING),
        )

    def test_paybill_payment_qualifies(self):
        from apps.payments.models import Transaction
        from .models import Referral
        from .services import attribute_signup

        attribute_signup(user=self.referee, code=self.rc.code, request_meta={})
        # Patch BEFORE creating the tx — the post_save signal fires
        # check_qualification, which calls grant_referral_rewards.delay.
        with patch("apps.referrals.tasks.grant_referral_rewards.delay") as m:
            self._make_tx(tx_type=Transaction.Type.PAYBILL_PAYMENT)
            m.assert_called_once()

        referral = Referral.objects.get(referee=self.referee)
        self.assertEqual(referral.status, Referral.Status.QUALIFIED)
        self.assertIsNotNone(referral.qualified_at)

    def test_below_minimum_does_not_qualify(self):
        from apps.payments.models import Transaction
        from .models import Referral
        from .services import attribute_signup

        attribute_signup(user=self.referee, code=self.rc.code, request_meta={})
        with patch("apps.referrals.tasks.grant_referral_rewards.delay") as m:
            self._make_tx(
                tx_type=Transaction.Type.PAYBILL_PAYMENT, dest_amount="100.00"
            )
            m.assert_not_called()

        referral = Referral.objects.get(referee=self.referee)
        self.assertEqual(referral.status, Referral.Status.SIGNED_UP)

    def test_non_qualifying_tx_type_ignored(self):
        from apps.payments.models import Transaction
        from .models import Referral
        from .services import attribute_signup

        attribute_signup(user=self.referee, code=self.rc.code, request_meta={})
        with patch("apps.referrals.tasks.grant_referral_rewards.delay") as m:
            self._make_tx(tx_type=Transaction.Type.BUY)
            m.assert_not_called()

        referral = Referral.objects.get(referee=self.referee)
        self.assertEqual(referral.status, Referral.Status.SIGNED_UP)

    def test_attribution_window_expired_marks_rejected(self):
        from apps.payments.models import Transaction
        from .models import Referral
        from .services import attribute_signup

        attribute_signup(user=self.referee, code=self.rc.code, request_meta={})
        referral = Referral.objects.get(referee=self.referee)
        referral.attribution_window_ends_at = timezone.now() - timedelta(days=1)
        referral.save(update_fields=["attribution_window_ends_at"])

        with patch("apps.referrals.tasks.grant_referral_rewards.delay"):
            self._make_tx(tx_type=Transaction.Type.PAYBILL_PAYMENT)
        referral.refresh_from_db()
        self.assertEqual(referral.status, Referral.Status.REJECTED_FRAUD)


@override_settings(REFERRAL_PROGRAM=_CFG, CELERY_TASK_ALWAYS_EAGER=True)
class RewardGrantTest(TestCase):
    def setUp(self):
        from .models import ReferralCode
        self.referrer = _make_user(phone="+254711111111", full_name="Alice")
        self.referee = _make_user(phone="+254722222222", full_name="Bob", kyc_tier=1)
        self.rc = ReferralCode.get_or_create_for_user(self.referrer)

    def _qualifying_tx(self, key):
        from apps.payments.models import Transaction
        return Transaction.objects.create(
            idempotency_key=key,
            user=self.referee,
            type=Transaction.Type.PAYBILL_PAYMENT,
            source_currency="USDT",
            source_amount=Decimal("10.00"),
            dest_currency="KES",
            dest_amount=Decimal("600.00"),
            exchange_rate=Decimal("150.00"),
            fee_amount=Decimal("30.00"),
            status=Transaction.Status.COMPLETED,
        )

    def test_grant_creates_held_referrer_and_available_referee_rows(self):
        from .models import RewardLedger
        from .services import attribute_signup

        attribute_signup(user=self.referee, code=self.rc.code, request_meta={})
        # Mock release so HELD stays HELD. Signal fires grant on tx save.
        with patch("apps.referrals.tasks.release_held_rewards.apply_async"):
            self._qualifying_tx("grant-test-1")

        ref_row = RewardLedger.objects.get(
            user=self.referrer, kind=RewardLedger.Kind.REFERRER_BONUS
        )
        self.assertEqual(ref_row.status, RewardLedger.Status.HELD)
        self.assertEqual(ref_row.amount_kes, Decimal("50.00"))

        referee_row = RewardLedger.objects.get(
            user=self.referee, kind=RewardLedger.Kind.REFEREE_BONUS
        )
        self.assertEqual(referee_row.status, RewardLedger.Status.AVAILABLE)
        self.assertEqual(referee_row.amount_kes, Decimal("50.00"))

    def test_grant_no_double_rows(self):
        from .models import Referral, RewardLedger
        from .services import attribute_signup
        from . import tasks

        attribute_signup(user=self.referee, code=self.rc.code, request_meta={})
        with patch("apps.referrals.tasks.release_held_rewards.apply_async"):
            self._qualifying_tx("grant-idem-1")
        referral = Referral.objects.get(referee=self.referee)
        # Second grant call — early-exits because status is now REWARDED.
        tasks.grant_referral_rewards(str(referral.id))

        rows = RewardLedger.objects.filter(
            kind__in=[
                RewardLedger.Kind.REFERRER_BONUS,
                RewardLedger.Kind.REFEREE_BONUS,
            ]
        )
        self.assertEqual(rows.count(), 2)


@override_settings(REFERRAL_PROGRAM=_CFG)
class CreditConsumptionTest(TestCase):
    def setUp(self):
        self.user = _make_user(phone="+254712345678")

    def _grant_available_credit(self, amount_kes: str, key: str):
        from .models import RewardLedger
        return RewardLedger.objects.create(
            user=self.user,
            amount_kes=Decimal(amount_kes),
            kind=RewardLedger.Kind.REFEREE_BONUS,
            status=RewardLedger.Status.AVAILABLE,
            idempotency_key=key,
        )

    def _make_tx(self, fee="30.00", key="fee-tx-1"):
        from apps.payments.models import Transaction
        return Transaction.objects.create(
            idempotency_key=key,
            user=self.user,
            type=Transaction.Type.PAYBILL_PAYMENT,
            source_currency="USDT",
            source_amount=Decimal("1.00"),
            dest_currency="KES",
            dest_amount=Decimal("500.00"),
            exchange_rate=Decimal("150.00"),
            fee_amount=Decimal(fee),
        )

    def test_full_fee_consumed_when_credit_covers(self):
        from .models import RewardLedger
        from .services import apply_credit_to_fee

        self._grant_available_credit("50.00", "grant-1")
        tx = self._make_tx(fee="30.00")
        reduced_fee, applied = apply_credit_to_fee(tx, Decimal("30.00"))
        self.assertEqual(reduced_fee, Decimal("0.00"))
        self.assertEqual(applied, Decimal("30.00"))
        # Remaining = 20
        self.assertEqual(
            RewardLedger.available_credit_for(self.user), Decimal("20.00")
        )

    def test_partial_credit_reduces_fee(self):
        from .services import apply_credit_to_fee

        self._grant_available_credit("10.00", "grant-partial")
        tx = self._make_tx(fee="30.00")
        reduced_fee, applied = apply_credit_to_fee(tx, Decimal("30.00"))
        self.assertEqual(reduced_fee, Decimal("20.00"))
        self.assertEqual(applied, Decimal("10.00"))

    def test_no_credit_no_op(self):
        from .services import apply_credit_to_fee

        tx = self._make_tx(fee="30.00")
        reduced_fee, applied = apply_credit_to_fee(tx, Decimal("30.00"))
        self.assertEqual(reduced_fee, Decimal("30.00"))
        self.assertEqual(applied, Decimal("0.00"))

    def test_consumption_is_idempotent(self):
        from .services import apply_credit_to_fee
        from .models import RewardLedger

        self._grant_available_credit("50.00", "grant-idem")
        tx = self._make_tx(fee="30.00")
        apply_credit_to_fee(tx, Decimal("30.00"))
        apply_credit_to_fee(tx, Decimal("30.00"))
        consumed_rows = RewardLedger.objects.filter(
            consumed_by_transaction=tx, kind=RewardLedger.Kind.CONSUMED
        )
        self.assertEqual(consumed_rows.count(), 1)


@override_settings(REFERRAL_PROGRAM=_CFG)
class LedgerAggregationTest(TestCase):
    def setUp(self):
        self.user = _make_user()

    def test_available_excludes_held_and_consumed(self):
        from .models import RewardLedger

        RewardLedger.objects.create(
            user=self.user,
            amount_kes=Decimal("50.00"),
            kind=RewardLedger.Kind.REFEREE_BONUS,
            status=RewardLedger.Status.AVAILABLE,
            idempotency_key="k1",
        )
        RewardLedger.objects.create(
            user=self.user,
            amount_kes=Decimal("50.00"),
            kind=RewardLedger.Kind.REFERRER_BONUS,
            status=RewardLedger.Status.HELD,
            idempotency_key="k2",
        )
        RewardLedger.objects.create(
            user=self.user,
            amount_kes=Decimal("-30.00"),
            kind=RewardLedger.Kind.CONSUMED,
            status=RewardLedger.Status.CONSUMED,
            idempotency_key="k3",
        )
        self.assertEqual(
            RewardLedger.available_credit_for(self.user), Decimal("50.00")
        )
        self.assertEqual(
            RewardLedger.pending_credit_for(self.user), Decimal("50.00")
        )


class MyReferralAPITest(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient
        self.user = _make_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(REFERRAL_PROGRAM=_CFG)
    def test_me_endpoint_returns_code_and_totals(self):
        resp = self.client.get("/api/v1/referrals/me/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("code", resp.data)
        self.assertIn("share_url", resp.data)
        self.assertIn("totals", resp.data)
        self.assertEqual(resp.data["totals"]["invited_sent"], 0)
        self.assertEqual(resp.data["totals"]["signed_up"], 0)

    @override_settings(REFERRAL_PROGRAM={"ENABLED": False})
    def test_me_returns_503_when_disabled(self):
        resp = self.client.get("/api/v1/referrals/me/")
        self.assertEqual(resp.status_code, 503)

    @override_settings(REFERRAL_PROGRAM=_CFG)
    def test_validate_code_returns_valid_for_real_code(self):
        from .models import ReferralCode
        rc = ReferralCode.get_or_create_for_user(self.user)
        from rest_framework.test import APIClient
        anon = APIClient()
        resp = anon.post("/api/v1/referrals/validate/", {"code": rc.code})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["valid"])

    def test_validate_code_returns_404_for_bad_code(self):
        from rest_framework.test import APIClient
        anon = APIClient()
        resp = anon.post("/api/v1/referrals/validate/", {"code": "NOTREAL"})
        self.assertEqual(resp.status_code, 404)
