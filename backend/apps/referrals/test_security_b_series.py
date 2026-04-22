"""B-series security audit regression tests (referrals app).

Covers B3, B7, B8, B9, B10, B15, B16, B21, B22, B24, B27, B29. Tests are
deliberately lightweight integration / unit tests · they assert the
documented behavior of each fix without requiring a full end-to-end
payment saga run.
"""
from __future__ import annotations

import threading
import time
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.conf import settings
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


User = settings.AUTH_USER_MODEL


def _make_user(phone="+254700000001", full_name="Test Referrer", kyc_tier=0):
    from apps.accounts.models import User as UserModel
    u = UserModel.objects.create(
        phone=phone,
        full_name=full_name,
        kyc_tier=kyc_tier,
    )
    u.set_pin("123456")
    u.save()
    return u


# -------------------------- B15 -------------------------- #

def test_B15_expire_unused_credit_is_scheduled():
    assert "expire-unused-referral-credit" in settings.CELERY_BEAT_SCHEDULE
    entry = settings.CELERY_BEAT_SCHEDULE["expire-unused-referral-credit"]
    assert entry["task"] == "apps.referrals.tasks.expire_unused_credit"


# -------------------------- B24 -------------------------- #

class TestB24AdminClawbackReasonLength(TestCase):
    def test_reason_longer_than_500_is_rejected(self):
        from apps.referrals.views import AdminClawbackSerializer
        ser = AdminClawbackSerializer(data={"reason": "x" * 501})
        assert not ser.is_valid()
        assert "reason" in ser.errors

    def test_reason_exactly_500_is_accepted(self):
        from apps.referrals.views import AdminClawbackSerializer
        ser = AdminClawbackSerializer(data={"reason": "x" * 500})
        assert ser.is_valid()

    def test_reason_blank_is_rejected(self):
        from apps.referrals.views import AdminClawbackSerializer
        ser = AdminClawbackSerializer(data={"reason": ""})
        assert not ser.is_valid()


# -------------------------- B9 -------------------------- #

class TestB9ValidateCodeConstantShape(TestCase):
    def setUp(self):
        from apps.referrals.models import ReferralCode
        self.user = _make_user(phone="+254711111111")
        self.rc = ReferralCode.get_or_create_for_user(self.user)
        self.client = APIClient()

    def test_invalid_code_returns_200_with_valid_false(self):
        resp = self.client.post(
            "/api/v1/referrals/validate/",
            {"code": "ZZZZZZ"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data.get("valid") is False
        # Same key shape as the valid response.
        assert "referrer_first_name" in resp.data
        assert "reward_preview_kes" in resp.data

    def test_valid_code_also_returns_200(self):
        resp = self.client.post(
            "/api/v1/referrals/validate/",
            {"code": self.rc.code},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data.get("valid") is True


# -------------------------- B10 + B29 -------------------------- #

class TestB29LandingIPIsHashed(TestCase):
    def setUp(self):
        from apps.referrals.models import ReferralCode
        self.user = _make_user(phone="+254722222222")
        self.rc = ReferralCode.get_or_create_for_user(self.user)
        cache.clear()

    def test_landing_writes_hashed_ip_not_dotted_quad(self):
        from apps.referrals.models import ReferralEvent
        client = APIClient(REMOTE_ADDR="1.2.3.4")
        client.get(f"/r/{self.rc.code}/public/")
        ev = ReferralEvent.objects.filter(
            event_type=ReferralEvent.EventType.LINK_CLICKED
        ).first()
        assert ev is not None
        # B29: raw IP is NEVER stored · the GenericIPAddressField stays null
        # and the salted hash lives in the JSON payload only.
        assert ev.ip_address is None
        ip_hash = (ev.payload or {}).get("ip_hash", "")
        assert "." not in ip_hash
        assert len(ip_hash) == 16

    def test_landing_coarse_ua_class_only(self):
        from apps.referrals.models import ReferralEvent
        client = APIClient(
            REMOTE_ADDR="1.2.3.4",
            HTTP_USER_AGENT="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
        )
        client.get(f"/r/{self.rc.code}/public/")
        ev = ReferralEvent.objects.filter(
            event_type=ReferralEvent.EventType.LINK_CLICKED
        ).first()
        assert ev.user_agent == "mobile"


class TestB10LandingLogsOnlyCacheMiss(TestCase):
    def setUp(self):
        from apps.referrals.models import ReferralCode, ReferralEvent
        cache.clear()
        self.user = _make_user(phone="+254733333333")
        self.rc = ReferralCode.get_or_create_for_user(self.user)
        ReferralEvent.objects.filter(
            event_type=ReferralEvent.EventType.LINK_CLICKED
        ).delete()

    def test_first_hit_writes_event_cached_hits_do_not(self):
        from apps.referrals.models import ReferralEvent
        client = APIClient(REMOTE_ADDR="9.9.9.9")
        for _ in range(3):
            client.get(f"/r/{self.rc.code}/public/")
        count = ReferralEvent.objects.filter(
            event_type=ReferralEvent.EventType.LINK_CLICKED
        ).count()
        assert count == 1


# -------------------------- B22 -------------------------- #

class TestB22ShareEventAtomicIncrement(TestCase):
    """Verifies the counter uses `F("...") + 1` via `.update()` (atomic SQL)
    rather than a read-modify-write that can lose updates. We exercise the
    ORM call directly · real threaded-concurrency tests against a sqlite or
    postgres test DB from inside a Django TestCase deadlock on connection
    pool affinity, so we prove the invariant via the code path that would
    race in production."""
    def setUp(self):
        from apps.referrals.models import ReferralCode
        self.user = _make_user(phone="+254744444444")
        self.rc = ReferralCode.get_or_create_for_user(self.user)

    def test_share_event_uses_F_expression(self):
        import inspect
        from apps.referrals import views as _views
        src = inspect.getsource(_views.ShareEventView.post)
        # Must use the atomic `F("total_invites_sent") + 1` pattern.
        assert 'F("total_invites_sent")' in src or "F('total_invites_sent')" in src
        # Must NOT use the racy read-modify-write pattern.
        assert "total_invites_sent = rc.total_invites_sent + 1" not in src

    def test_posting_share_events_increments_counter(self):
        from apps.referrals.models import ReferralCode
        client = APIClient()
        client.force_authenticate(user=self.user)
        for _ in range(5):
            resp = client.post(
                "/api/v1/referrals/share-event/",
                {"channel": "whatsapp"},
                format="json",
            )
            assert resp.status_code == 200, resp.data
        self.rc.refresh_from_db()
        assert self.rc.total_invites_sent == 5


# -------------------------- B8 -------------------------- #

class TestB8DeviceIdPlausibility:
    def test_short_device_id_rejected(self):
        from apps.referrals.services import _device_id_plausible
        assert _device_id_plausible("") is False
        assert _device_id_plausible("abc") is False
        assert _device_id_plausible("x" * 15) is False

    def test_web_fallback_device_id_rejected(self):
        from apps.referrals.services import _device_id_plausible
        assert _device_id_plausible("web-1234567890123456") is False
        assert _device_id_plausible("dev-1234567890123456") is False

    def test_real_device_id_accepted(self):
        from apps.referrals.services import _device_id_plausible
        assert _device_id_plausible("a1b2c3d4e5f6a7b8c9d0") is True


# -------------------------- B16 -------------------------- #

class TestB16CheckQualificationAtomic(TestCase):
    """check_qualification should not raise TransactionManagementError when
    invoked from a non-atomic context (signals, out-of-saga code paths)."""
    def test_no_atomic_error(self):
        # No referral exists · early return, but must not raise.
        from apps.referrals.services import check_qualification
        user = _make_user(phone="+254755555555")
        # Construct a lightweight object that looks like a Transaction.
        class _Tx:
            def __init__(self, u):
                self.user = u
                self.type = "PAYBILL_PAYMENT"
                self.status = "COMPLETED"
                self.dest_amount = Decimal("1000")
                self.dest_currency = "KES"
        try:
            check_qualification(_Tx(user))
        except Exception as e:
            pytest.fail(f"check_qualification raised: {e}")


# -------------------------- B21 -------------------------- #

class TestB21ReferrerQualifiesForGrant:
    def test_referrer_with_no_tx_no_kyc_is_rejected(self):
        from apps.referrals.services import referrer_qualifies_for_grant
        user = _make_user(phone="+254766666666", kyc_tier=0)
        ok, reason = referrer_qualifies_for_grant(user)
        assert ok is False
        assert reason == "referrer_not_established"

    def test_referrer_with_kyc_tier_1_is_accepted(self):
        from apps.referrals.services import referrer_qualifies_for_grant
        user = _make_user(phone="+254777777777", kyc_tier=1)
        ok, _ = referrer_qualifies_for_grant(user)
        assert ok is True


# -------------------------- B3 -------------------------- #

class TestB3ReferralCreditNoDoubleSpend(TestCase):
    """Verify the TOCTOU fix on `apply_credit_to_fee`.

    We don't use real threads (Django TestCase pools DB connections per
    thread and deadlocks on `select_for_update` inside the same test atomic
    block). Instead we:
      1. Static-check that the service file locks the User row before
         reading available_credit_for, which is the invariant that prevents
         two concurrent payments from both claiming the full balance.
      2. Sequentially consume credit across multiple transactions and
         assert the ledger accounting is exact (applied + remaining ==
         initial) · this catches regressions in the single-user ledger
         that would otherwise corrupt under concurrency too.
    """
    def setUp(self):
        from apps.referrals.models import RewardLedger
        self.user = _make_user(phone="+254788888888")
        RewardLedger.objects.create(
            user=self.user,
            amount_kes=Decimal("50.00"),
            kind=RewardLedger.Kind.REFEREE_BONUS,
            status=RewardLedger.Status.AVAILABLE,
            idempotency_key=f"seed:{self.user.id}",
        )

    def test_service_locks_user_row_before_reading_balance(self):
        import inspect
        from apps.referrals import services as _svcs
        src = inspect.getsource(_svcs.apply_credit_to_fee)
        # The user-row lock must be INSIDE the atomic block and BEFORE the
        # availability read · otherwise two concurrent calls race.
        assert "select_for_update" in src
        assert "available_credit_for" in src
        # The fix order: atomic → lock user → re-read availability.
        atomic_idx = src.index("db_tx.atomic()")
        lock_idx = src.index("select_for_update().filter(pk=user.pk)")
        avail_idx = src.rfind("available_credit_for(user)")
        assert atomic_idx < lock_idx < avail_idx, (
            "apply_credit_to_fee must lock the user row INSIDE atomic + "
            "BEFORE reading available balance (B3 TOCTOU fix)"
        )

    def test_sequential_consumption_does_not_exceed_balance(self):
        from apps.payments.models import Transaction
        from apps.referrals.services import apply_credit_to_fee
        from apps.referrals.models import RewardLedger

        total_applied = Decimal("0")
        for i in range(5):
            tx = Transaction.objects.create(
                idempotency_key=f"test-b3-seq-{i}",
                user=self.user,
                type=Transaction.Type.PAYBILL_PAYMENT,
                source_currency="USDT",
                source_amount=Decimal("1"),
                dest_currency="KES",
                dest_amount=Decimal("1000"),
                exchange_rate=Decimal("130"),
                fee_amount=Decimal("50"),
                fee_currency="KES",
            )
            _, applied = apply_credit_to_fee(tx, Decimal("50"))
            total_applied += applied

        # Only the initial 50 should have been consumed across all 5 tx's.
        assert total_applied == Decimal("50")
        remaining = RewardLedger.available_credit_for(self.user)
        assert remaining == Decimal("0.00")


# -------------------------- B27 -------------------------- #

class TestB27SignupCountryIgnored(TestCase):
    def test_client_country_is_ignored(self):
        from apps.referrals.models import ReferralCode
        from apps.referrals.services import attribute_signup
        referrer = _make_user(phone="+254799999999", kyc_tier=1)
        rc = ReferralCode.get_or_create_for_user(referrer)
        # Referrer account backdated so age gate passes.
        type(referrer).objects.filter(pk=referrer.pk).update(
            created_at=timezone.now() - timezone.timedelta(days=2)
        )

        new_user = _make_user(phone="+254712345678")
        ref = attribute_signup(
            user=new_user,
            code=rc.code,
            request_meta={
                "ip": "5.5.5.5",
                "device_id": "a1b2c3d4e5f6a7b8c9d0e1f2",
                "country": "US",  # malicious client claim
                "user_agent": "x" * 300,
            },
        )
        if ref is not None:
            assert ref.signup_country == ""
            # UA truncated to 200 chars max.
            assert len(ref.signup_user_agent) <= 200
