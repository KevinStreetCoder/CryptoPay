"""
Regression tests for A4 (audit): a qualifying M-Pesa payment that gets
reversed after the referral reward was paid out must trigger a clawback.

The audit flagged this abuse vector:
  1. Attacker signs up via referral link → status = PENDING
  2. Sends KES 500 paybill → tx completes → qualifying → rewarded
  3. Referrer receives KES 50 credit
  4. Attacker reverses the KES 500 via M-Pesa support
  5. Prior: nothing happens → attacker + referrer collude to drain
  6. Now: signal detects REVERSED on qualifying_transaction and enqueues
     `claw_back_reward`, which already exists with idempotent semantics.
"""
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.payments.models import Transaction
from apps.referrals.models import Referral


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class ReversalClawbackTest(TestCase):
    def setUp(self):
        self.referrer = User.objects.create_user(
            phone="+254711111111", pin="123456",
        )
        self.referee = User.objects.create_user(
            phone="+254722222222", pin="123456",
        )
        self.tx = Transaction.objects.create(
            idempotency_key="test:qualifying:1",
            user=self.referee,
            type=Transaction.Type.PAYBILL_PAYMENT,
            status=Transaction.Status.COMPLETED,
            source_currency="USDT",
            source_amount=Decimal("4"),
            dest_currency="KES",
            dest_amount=Decimal("500"),
            exchange_rate=Decimal("125"),
            fee_amount=Decimal("10"),
            fee_currency="KES",
            completed_at=timezone.now(),
        )
        now = timezone.now()
        self.referral = Referral.objects.create(
            referrer=self.referrer,
            referee=self.referee,
            code_used="TEST1234",
            status=Referral.Status.REWARDED,
            qualifying_transaction=self.tx,
            attribution_window_ends_at=now + timedelta(days=60),
            qualified_at=now,
            rewarded_at=now,
        )

    def test_reversing_qualifying_tx_enqueues_clawback(self):
        """When the qualifying tx flips to REVERSED the signal must
        enqueue claw_back_reward for that referral exactly once."""
        with patch("apps.referrals.tasks.claw_back_reward.delay") as mock_delay:
            self.tx.status = Transaction.Status.REVERSED
            self.tx.save(update_fields=["status"])

            mock_delay.assert_called_once()
            args, kwargs = mock_delay.call_args
            self.assertEqual(args[0], str(self.referral.id))
            self.assertIn("qualifying_tx_reversed", kwargs.get("reason", ""))

    def test_pending_referral_not_clawed_back(self):
        """A referral that never reached QUALIFIED has no reward to
        claw back — signal must not enqueue."""
        self.referral.status = Referral.Status.PENDING
        self.referral.qualified_at = None
        self.referral.rewarded_at = None
        self.referral.save()

        with patch("apps.referrals.tasks.claw_back_reward.delay") as mock_delay:
            self.tx.status = Transaction.Status.REVERSED
            self.tx.save(update_fields=["status"])
            mock_delay.assert_not_called()

    def test_failed_status_does_not_trigger_clawback(self):
        """Only REVERSED triggers clawback — FAILED is a saga-level
        abort that the saga itself compensates for. We must not
        double-compensate here."""
        with patch("apps.referrals.tasks.claw_back_reward.delay") as mock_delay:
            self.tx.status = Transaction.Status.FAILED
            self.tx.save(update_fields=["status"])
            mock_delay.assert_not_called()

    def test_qualifying_tx_reversal_with_broker_outage_still_runs_clawback(self):
        """If Celery broker is down, signal must fall back to in-process
        execution so the clawback still runs. Prior design would have
        silently lost the clawback on broker failure.

        We patch the shared task object so both `.delay()` and the
        direct call `claw_back_reward(...)` route through a single
        mock — `.delay` is configured to raise, the direct call is
        tracked via the mock itself.
        """
        from unittest.mock import MagicMock

        task_mock = MagicMock()
        task_mock.delay = MagicMock(side_effect=RuntimeError("broker unreachable"))

        with patch("apps.referrals.tasks.claw_back_reward", task_mock):
            self.tx.status = Transaction.Status.REVERSED
            self.tx.save(update_fields=["status"])

        # .delay was attempted once (and raised), THEN the signal's
        # except-fallback called task_mock(...) directly.
        task_mock.delay.assert_called_once()
        self.assertEqual(task_mock.call_count, 1)
        args, kwargs = task_mock.call_args
        self.assertEqual(args[0], str(self.referral.id))
        self.assertIn("qualifying_tx_reversed", kwargs.get("reason", ""))
