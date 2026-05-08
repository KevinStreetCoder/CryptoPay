"""Platform-limits · admin-settable safety caps · 2026-05-08.

Tests cover three layers:
  1. Service layer · enforce_outgoing / record_outgoing / get_status
     / update_limits behave correctly under the documented edge cases
     (cap hit, cap disabled, count cap, hard pause, reset on tighten).
  2. Admin DRF endpoint · GET / PATCH gating, validation, audit log.
  3. Integration with the saga · record_outgoing fires only on
     outgoing tx types (PAYBILL / TILL / SEND_MPESA / WITHDRAWAL),
     not on BUY / DEPOSIT.

The platform-limits sit ABOVE the float-driven circuit breaker in
the request path. A breach here returns HTTP 503 with
`platform_limit: true` in the body so the mobile app can route the
user to a "service paused" screen identical to the circuit breaker
path · same UX, different cause.
"""
from __future__ import annotations

import time
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.payments.models import PlatformLimit, Transaction
from apps.payments.platform_limits import (
    PlatformLimitExceeded,
    enforce_outgoing,
    get_status,
    record_outgoing,
    update_limits,
)


pytestmark = pytest.mark.django_db


def _make_user(phone="+254700020001", *, is_staff=False):
    user = User.objects.create_user(phone=phone, pin="123456")
    if is_staff:
        user.is_staff = True
        user.save(update_fields=["is_staff"])
    return user


def _reset_state():
    """Wipe the limit singleton + sliding-window counters between tests.

    Tests use the Django cache as both Redis stand-in (sliding windows)
    and the limit-singleton cache. Cleaning both keeps tests
    independent.
    """
    PlatformLimit.objects.all().delete()
    cache.clear()


class TestPerTransactionCap(TestCase):
    def setUp(self):
        _reset_state()
        update_limits(actor=None, max_per_tx_kes=50_000)

    def test_under_cap_passes(self):
        enforce_outgoing(Decimal("49999"))  # no raise

    def test_at_cap_passes(self):
        enforce_outgoing(Decimal("50000"))  # equality is fine

    def test_above_cap_raises(self):
        with self.assertRaises(PlatformLimitExceeded) as ctx:
            enforce_outgoing(Decimal("50001"))
        assert ctx.exception.cap_name == "max_per_tx"

    def test_zero_cap_disables_check(self):
        # Disable ALL caps to isolate the per-tx behaviour · setting
        # max_per_tx_kes=0 disables ONLY that cap, but the per-hour /
        # per-day / count caps still apply at their defaults. This is
        # the correct production behaviour (each cap is independent),
        # so the test must zero them all to prove the per-tx zero
        # actually disables the per-tx check.
        update_limits(
            actor=None,
            max_per_tx_kes=0,
            max_per_hour_kes=0,
            max_per_day_kes=0,
            max_tx_per_hour_count=0,
        )
        enforce_outgoing(Decimal("999_999_999"))  # no raise


class TestHourlyCap(TestCase):
    def setUp(self):
        _reset_state()
        update_limits(
            actor=None,
            max_per_tx_kes=0,           # disable per-tx so we test hour
            max_per_hour_kes=100_000,
            max_per_day_kes=0,
            max_tx_per_hour_count=0,
        )

    def test_under_window_passes(self):
        record_outgoing(Decimal("60000"), "tx-a")
        enforce_outgoing(Decimal("30000"))  # 60k + 30k = 90k < 100k

    def test_at_window_edge_passes(self):
        record_outgoing(Decimal("60000"), "tx-a")
        enforce_outgoing(Decimal("40000"))  # 60k + 40k = 100k exactly

    def test_above_window_raises(self):
        record_outgoing(Decimal("60000"), "tx-a")
        record_outgoing(Decimal("30000"), "tx-b")
        with self.assertRaises(PlatformLimitExceeded) as ctx:
            enforce_outgoing(Decimal("20000"))  # 90k + 20k = 110k
        assert ctx.exception.cap_name == "max_per_hour"


class TestDailyCap(TestCase):
    def setUp(self):
        _reset_state()
        update_limits(
            actor=None,
            max_per_tx_kes=0,
            max_per_hour_kes=0,
            max_per_day_kes=200_000,
            max_tx_per_hour_count=0,
        )

    def test_above_day_window_raises(self):
        record_outgoing(Decimal("180000"), "tx-a")
        with self.assertRaises(PlatformLimitExceeded) as ctx:
            enforce_outgoing(Decimal("30000"))
        assert ctx.exception.cap_name == "max_per_day"


class TestCountCap(TestCase):
    def setUp(self):
        _reset_state()
        update_limits(
            actor=None,
            max_per_tx_kes=0,
            max_per_hour_kes=0,
            max_per_day_kes=0,
            max_tx_per_hour_count=3,  # only 3 tx per hour allowed
        )

    def test_under_count_passes(self):
        record_outgoing(Decimal("100"), "tx-a")
        record_outgoing(Decimal("100"), "tx-b")
        enforce_outgoing(Decimal("100"))  # would be the 3rd · ok

    def test_above_count_raises(self):
        record_outgoing(Decimal("100"), "tx-a")
        record_outgoing(Decimal("100"), "tx-b")
        record_outgoing(Decimal("100"), "tx-c")
        with self.assertRaises(PlatformLimitExceeded) as ctx:
            enforce_outgoing(Decimal("100"))  # 4th
        assert ctx.exception.cap_name == "max_count_per_hour"


class TestHardPause(TestCase):
    def setUp(self):
        _reset_state()

    def test_hard_pause_blocks_everything(self):
        update_limits(
            actor=None, hard_pause=True, hard_pause_reason="incident",
        )
        with self.assertRaises(PlatformLimitExceeded) as ctx:
            enforce_outgoing(Decimal("1"))
        assert ctx.exception.cap_name == "hard_pause"

    def test_hard_pause_outranks_other_caps(self):
        # Even under-cap on every other check, hard_pause wins.
        update_limits(
            actor=None,
            max_per_tx_kes=1_000_000,
            max_per_hour_kes=10_000_000,
            max_per_day_kes=100_000_000,
            max_tx_per_hour_count=1000,
            hard_pause=True,
            hard_pause_reason="manual",
        )
        with self.assertRaises(PlatformLimitExceeded) as ctx:
            enforce_outgoing(Decimal("100"))
        assert ctx.exception.cap_name == "hard_pause"


class TestStatus(TestCase):
    def setUp(self):
        _reset_state()
        update_limits(
            actor=None,
            max_per_tx_kes=50_000,
            max_per_hour_kes=200_000,
            max_per_day_kes=1_000_000,
            max_tx_per_hour_count=100,
        )

    def test_status_shape(self):
        record_outgoing(Decimal("60000"), "tx-a")
        record_outgoing(Decimal("40000"), "tx-b")

        status = get_status()

        assert status["limits"]["max_per_tx_kes"] == "50000.00"
        assert status["usage"]["last_hour"]["count"] == 2
        assert Decimal(status["usage"]["last_hour"]["sum_kes"]) == Decimal("100000")
        # Headroom = 200000 - 100000 = 100000
        assert Decimal(status["remaining"]["hour_kes"]) == Decimal("100000")
        # Day same numbers (we haven't crossed an hour)
        assert Decimal(status["usage"]["last_day"]["sum_kes"]) == Decimal("100000")


class TestUpdateLimitsAuditLog(TestCase):
    def setUp(self):
        _reset_state()
        self.actor = _make_user("+254700020010", is_staff=True)

    def test_update_creates_audit_log(self):
        from apps.accounts.models import AuditLog

        update_limits(
            self.actor,
            max_per_tx_kes=100_000,
            hard_pause=True,
            hard_pause_reason="ops drill",
        )

        log = AuditLog.objects.filter(
            action="PLATFORM_LIMITS_UPDATED",
        ).order_by("-id").first()
        assert log is not None
        assert log.user_id == self.actor.id
        assert log.details["after"]["max_per_tx_kes"] == "100000.00"
        assert log.details["after"]["hard_pause"] == "True"

    def test_partial_update_only_writes_changed_fields(self):
        # Initial set
        update_limits(self.actor, max_per_tx_kes=50_000, max_per_day_kes=2_000_000)
        # Update only one field
        update_limits(self.actor, max_per_tx_kes=75_000)

        limit = PlatformLimit.current()
        assert limit.max_per_tx_kes == Decimal("75000.00")
        # The day cap survived
        assert limit.max_per_day_kes == Decimal("2000000.00")

    def test_update_invalidates_cache(self):
        # Prime the cache with one value · subsequent get_limit calls
        # must reflect the update, not the cached old value.
        update_limits(self.actor, max_per_tx_kes=1)
        with self.assertRaises(PlatformLimitExceeded):
            enforce_outgoing(Decimal("2"))

        update_limits(self.actor, max_per_tx_kes=10)
        enforce_outgoing(Decimal("5"))  # would have raised under old cap


class TestAdminAPI(TestCase):
    def setUp(self):
        _reset_state()
        self.staff = _make_user("+254700020020", is_staff=True)
        self.non_staff = _make_user("+254700020021", is_staff=False)
        self.url = reverse("payments:admin-platform-limits")
        self.client = APIClient()

    def test_anon_blocked(self):
        resp = self.client.get(self.url)
        assert resp.status_code in (401, 403)

    def test_non_staff_blocked(self):
        self.client.force_authenticate(self.non_staff)
        resp = self.client.get(self.url)
        assert resp.status_code == 403

    def test_staff_get_returns_status(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get(self.url)
        assert resp.status_code == 200
        body = resp.json()
        assert "limits" in body
        assert "usage" in body
        assert "remaining" in body
        assert "circuit_breaker" in body  # bonus payload

    def test_staff_patch_updates_caps(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.patch(
            self.url,
            {"max_per_tx_kes": 75_000, "hard_pause": True,
             "hard_pause_reason": "drill"},
            format="json",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["limits"]["max_per_tx_kes"] == "75000.00"
        assert body["hard_pause"] is True

        limit = PlatformLimit.current()
        assert limit.max_per_tx_kes == Decimal("75000.00")
        assert limit.hard_pause is True

    def test_patch_rejects_negative(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.patch(
            self.url, {"max_per_tx_kes": -1}, format="json",
        )
        assert resp.status_code == 400

    def test_patch_rejects_non_numeric(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.patch(
            self.url, {"max_per_hour_kes": "not-a-number"}, format="json",
        )
        assert resp.status_code == 400

    def test_patch_ignores_unknown_fields(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.patch(
            self.url,
            {"max_per_tx_kes": 100, "secret_kill_switch": True,
             "user_id": "abc"},
            format="json",
        )
        assert resp.status_code == 200
        # Unknown fields silently ignored · safe default.
        assert PlatformLimit.current().max_per_tx_kes == Decimal("100.00")


class TestSagaIntegration(TestCase):
    """The saga must call record_outgoing on outgoing-flow Tx types
    (PAYBILL_PAYMENT / TILL_PAYMENT / SEND_MPESA / WITHDRAWAL) when
    transitioning to COMPLETED, but NOT on BUY / DEPOSIT / SWAP."""

    def setUp(self):
        _reset_state()
        self.user = _make_user("+254700020030")

    def _make_tx(self, type_, amount):
        return Transaction.objects.create(
            user=self.user,
            idempotency_key=f"limits-saga-{type_}-{amount}",
            type=type_,
            status=Transaction.Status.PROCESSING,
            source_currency="USDT",
            source_amount=Decimal("10"),
            dest_currency="KES",
            dest_amount=Decimal(str(amount)),
            mpesa_paybill="247247",
        )

    def _last_hour_sum(self) -> Decimal:
        status = get_status()
        return Decimal(status["usage"]["last_hour"]["sum_kes"])

    def test_paybill_payment_recorded(self):
        from apps.payments.saga import PaymentSaga

        tx = self._make_tx(Transaction.Type.PAYBILL_PAYMENT, "5000")
        PaymentSaga(tx).complete(mpesa_receipt="RCP1")
        assert self._last_hour_sum() == Decimal("5000")

    def test_send_mpesa_recorded(self):
        from apps.payments.saga import PaymentSaga

        tx = self._make_tx(Transaction.Type.SEND_MPESA, "3000")
        PaymentSaga(tx).complete(mpesa_receipt="RCP2")
        assert self._last_hour_sum() == Decimal("3000")

    def test_buy_not_recorded(self):
        # BUY is INCOMING (we received KES from the user), not outgoing.
        # Counting it would conflate the directions and hide actual
        # outflow against the cap.
        from apps.payments.saga import PaymentSaga

        tx = self._make_tx(Transaction.Type.BUY, "5000")
        PaymentSaga(tx).complete(mpesa_receipt="RCP3")
        assert self._last_hour_sum() == Decimal("0")

    def test_deposit_not_recorded(self):
        from apps.payments.saga import PaymentSaga

        tx = self._make_tx(Transaction.Type.DEPOSIT, "5000")
        PaymentSaga(tx).complete(mpesa_receipt="RCP4")
        assert self._last_hour_sum() == Decimal("0")
