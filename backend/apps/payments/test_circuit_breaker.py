"""Real-behavior tests for the float circuit breaker.

These tests exist because today's audit found:

  1. Module-level threshold constants were FROZEN at import time, so
     a change to FLOAT_EMERGENCY_KES env didn't propagate. Even after
     the threshold was lowered from 200,000 to 500, the user-facing
     "(emergency threshold: KES 200,000)" message kept appearing
     because both the import-time constant AND the cached `reason`
     string were stale.

  2. The fail-safe default for missing cache state was CLOSED (open
     the rail with no ground truth). Audit P1-7 flipped it to
     HALF_OPEN.

  3. force_pause had a cache-write race window where a concurrent
     update_from_float could overwrite the manual pause.

Each test verifies PRODUCTION behavior · we override settings with
`override_settings`, call the live `update_from_float` / `get_state`,
and assert the observable string the user would see. NO test mocks
the threshold values · we change them via override_settings exactly
the way an env-var rotation would.
"""
from __future__ import annotations

from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from apps.payments import circuit_breaker as cb
from apps.payments.circuit_breaker import (
    BREAKER_LAST_FLOAT_KEY,
    BREAKER_MANUAL_KEY,
    BREAKER_PAUSED_AT_KEY,
    BREAKER_REASON_KEY,
    BREAKER_STATE_KEY,
    PaymentCircuitBreaker as Breaker,
    PaymentsPaused,
)


def _clear_breaker_cache():
    for k in (
        BREAKER_STATE_KEY, BREAKER_REASON_KEY, BREAKER_PAUSED_AT_KEY,
        BREAKER_LAST_FLOAT_KEY, BREAKER_MANUAL_KEY,
    ):
        cache.delete(k)


class ThresholdLivePropagationTests(TestCase):
    """The bug we shipped today: lowering FLOAT_EMERGENCY_KES from
    200,000 to 500 didn't update the user-facing reason string until
    a container restart. These tests verify that helpers ALWAYS read
    settings live."""

    def setUp(self):
        _clear_breaker_cache()

    def test_threshold_helpers_read_live_settings(self):
        """`_emergency_kes()` and friends must hit settings on every
        call · NEVER cached at import time."""
        with override_settings(FLOAT_EMERGENCY_KES=42):
            self.assertEqual(cb._emergency_kes(), Decimal("42"))
        with override_settings(FLOAT_EMERGENCY_KES=999):
            self.assertEqual(cb._emergency_kes(), Decimal("999"))
        # And after the override exits, fall back to settings default.
        # (The default is 200,000 from `_threshold` fallback.)

    def test_threshold_change_propagates_to_reason_string(self):
        """The exact bug from today · lower the threshold, the next
        update_from_float call rebuilds `reason` with the NEW value.
        Without the live-read fix, this test would still see the
        OLD threshold baked into the reason string."""
        # Start with threshold = 200,000, float = 50 → OPEN
        with override_settings(FLOAT_EMERGENCY_KES=200_000, FLOAT_CRITICAL_KES=500_000):
            Breaker.update_from_float(Decimal("50"))
            self.assertEqual(Breaker.get_state(), Breaker.OPEN)
            self.assertIn("KES 200,000", Breaker.get_reason())

        # Operator lowers threshold to 100. Same float, still below.
        # State stays OPEN, but reason MUST now reference 100, not
        # 200,000. THIS is what was failing today.
        with override_settings(FLOAT_EMERGENCY_KES=100, FLOAT_CRITICAL_KES=100):
            Breaker.update_from_float(Decimal("50"))
            self.assertEqual(Breaker.get_state(), Breaker.OPEN)
            self.assertIn("KES 100", Breaker.get_reason())
            self.assertNotIn("200,000", Breaker.get_reason())

    def test_threshold_lowered_below_float_resumes_payments(self):
        """Float = 1000. Threshold dropped from 2000 to 500 (live).
        The rail should auto-resume to CLOSED on the next call."""
        # Initial: float 1000 < emergency 2000 → OPEN
        with override_settings(
            FLOAT_EMERGENCY_KES=2000, FLOAT_CRITICAL_KES=2000,
            FLOAT_RESUME_KES=2000,
        ):
            Breaker.update_from_float(Decimal("1000"))
            self.assertEqual(Breaker.get_state(), Breaker.OPEN)

        # Operator lowers thresholds. Same float (1000) is now ABOVE
        # the new resume (500), so state should flip to CLOSED.
        with override_settings(
            FLOAT_EMERGENCY_KES=500, FLOAT_CRITICAL_KES=500,
            FLOAT_RESUME_KES=500,
        ):
            new_state = Breaker.update_from_float(Decimal("1000"))
            self.assertEqual(new_state, Breaker.CLOSED)
            self.assertEqual(Breaker.get_reason(), "")


class FailSafeDefaultTests(TestCase):
    """Audit P1-7 · when both cache keys are missing, default to a
    SAFE state. The previous default was CLOSED (fully open the rail
    with no ground truth)."""

    def setUp(self):
        _clear_breaker_cache()

    def test_get_state_with_missing_keys_returns_half_open(self):
        # No state key, no last-float key.
        self.assertEqual(Breaker.get_state(), Breaker.HALF_OPEN)

    def test_get_state_with_only_state_key_returns_state(self):
        cache.set(BREAKER_STATE_KEY, Breaker.OPEN, 60)
        self.assertEqual(Breaker.get_state(), Breaker.OPEN)

    def test_get_state_with_only_last_float_low(self):
        """No state key, but we know float was low · default to
        OPEN. Audit P1-7 baseline · fail safer than CLOSED."""
        cache.set(BREAKER_LAST_FLOAT_KEY, "10", 60)
        with override_settings(FLOAT_EMERGENCY_KES=500):
            self.assertEqual(Breaker.get_state(), Breaker.OPEN)


class ForcePauseRaceTests(TestCase):
    """Audit P1-1 · the OLD order of cache writes in force_pause
    allowed a concurrent update_from_float to overwrite the manual
    pause. Verify that MANUAL_KEY is set BEFORE the state write so a
    racing update_from_float observes the manual flag."""

    def setUp(self):
        _clear_breaker_cache()

    def test_force_pause_sets_manual_key_first(self):
        """Patch `_set_state` to be a no-op, then run force_pause and
        verify MANUAL_KEY is already set BEFORE _set_state was called."""
        original_set_state = Breaker._set_state
        manual_key_seen = []

        def spy_set_state(new_state, reason):
            # When _set_state runs, MANUAL_KEY should already be set.
            manual_key_seen.append(cache.get(BREAKER_MANUAL_KEY))
            return original_set_state(new_state, reason)

        with mock.patch.object(Breaker, "_set_state", side_effect=spy_set_state):
            Breaker.force_pause("test")

        self.assertEqual(len(manual_key_seen), 1)
        # MANUAL_KEY was True before _set_state ran
        self.assertTrue(manual_key_seen[0])


class WithdrawalPlatformLimitsTests(TestCase):
    """Audit P0-2 · withdrawal txs were recording crypto-quantity
    into the KES sliding window (e.g. `100` for 100 USDT counted
    as KES 100, when the actual KES-equivalent is ~13,000). The fix
    DROPS WITHDRAWAL from `record_outgoing` so the platform-limits
    accuracy is preserved · withdrawals are a separate crypto rail
    with their own per-currency limits."""

    def test_withdrawal_excluded_from_record_outgoing(self):
        """The saga code at apps/payments/saga.py guards on
        Transaction.Type · WITHDRAWAL must NOT be in the tuple.

        We verify by reading the source so the test fails if a
        future change re-adds WITHDRAWAL inadvertently."""
        import inspect
        from apps.payments import saga as saga_module
        src = inspect.getsource(saga_module)
        # The block that calls record_outgoing must include the
        # three KES-egress types but NOT WITHDRAWAL.
        # Find the conditional · brittle but explicit.
        idx = src.find("from .platform_limits import record_outgoing")
        self.assertGreater(idx, 0, "record_outgoing import disappeared")
        # Look back ~500 chars to find the surrounding `if` block.
        block = src[max(0, idx - 800):idx]
        self.assertIn("PAYBILL_PAYMENT", block)
        self.assertIn("TILL_PAYMENT", block)
        self.assertIn("SEND_MPESA", block)
        # The whole point: WITHDRAWAL must NOT be in this guard list.
        # If a future refactor re-adds it, this test catches the
        # regression. Note: we look for the *uppercase* enum
        # reference, not the word in comments.
        # Strip out comments to avoid false positives from the
        # explanatory comment block we wrote.
        code_only = "\n".join(
            ln for ln in block.splitlines()
            if not ln.strip().startswith("#")
        )
        self.assertNotIn("Transaction.Type.WITHDRAWAL", code_only)
