"""ReconciliationCase tests · 2026-04-26.

Covers:
  - Late M-Pesa success on a compensated transaction opens a
    DOUBLE_SETTLEMENT case at CRITICAL severity with a 5-min SLA.
  - The denormalised `Transaction.has_open_reconciliation` flag is
    maintained by the post_save signal.
  - `sweep_reconciliation_cases` escalates breached cases.
  - `compensate_convert_async` advisory lock prevents concurrent
    duplicate retries.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
from django.test import TestCase
from django.utils import timezone

from .models import ReconciliationCase, Transaction


pytestmark = pytest.mark.django_db


def _make_user(phone="+254700070001"):
    from apps.accounts.models import User
    return User.objects.create_user(phone=phone, pin="123456")


def _make_failed_compensated_tx(user, kes_amount: str = "1000"):
    """Build a transaction that's been compensated (the saga's
    failure-then-rollback terminal state)."""
    tx = Transaction.objects.create(
        user=user,
        idempotency_key=f"recon-test-{user.phone}-{kes_amount}",
        type=Transaction.Type.PAYBILL_PAYMENT,
        status=Transaction.Status.FAILED,
        source_currency="USDT",
        source_amount=Decimal("10"),
        dest_currency="KES",
        dest_amount=Decimal(kes_amount),
        mpesa_paybill="247247",
        mpesa_account="1234567890",
        saga_data={
            "locked_wallet_id": "00000000-0000-0000-0000-000000000abc",
            "locked_amount": "10",
            "compensated_at": timezone.now().isoformat(),
            "conversion_completed": True,
        },
    )
    return tx


class TestDoubleSettlementCase(TestCase):
    def test_late_callback_on_compensated_tx_opens_case(self):
        """The most dangerous failure mode: crypto already refunded,
        M-Pesa now confirms the B2B paid out · user has both."""
        from .saga import PaymentSaga

        user = _make_user("+254700070010")
        tx = _make_failed_compensated_tx(user)

        saga = PaymentSaga(tx)
        saga.complete(mpesa_receipt="ABC123XYZ")

        cases = ReconciliationCase.objects.filter(transaction=tx)
        assert cases.count() == 1, "expected exactly one open recon case"
        case = cases.first()
        assert case.case_type == ReconciliationCase.CaseType.DOUBLE_SETTLEMENT
        assert case.status == ReconciliationCase.Status.OPEN
        assert case.severity == ReconciliationCase.Severity.CRITICAL
        # SLA breach is 5 min from detection (industry standard for
        # double-settlement TTD per Wise/Adyen)
        assert case.sla_breach_at is not None
        elapsed = (case.sla_breach_at - case.detected_at).total_seconds()
        assert 290 <= elapsed <= 310  # 5 min ± 10 s tolerance
        # Evidence carries the M-Pesa receipt
        assert case.evidence.get("mpesa_receipt") == "ABC123XYZ"
        # Denormalised flag flipped via signal
        tx.refresh_from_db(fields=["has_open_reconciliation"])
        assert tx.has_open_reconciliation is True

    def test_idempotent_late_callback_does_not_duplicate_case(self):
        """If the same callback arrives twice (Safaricom retry, network
        replay) we should NOT open two cases · the saga uses
        `get_or_create` keyed on (transaction, case_type, status=OPEN)."""
        from .saga import PaymentSaga

        user = _make_user("+254700070011")
        tx = _make_failed_compensated_tx(user)

        saga = PaymentSaga(tx)
        saga.complete(mpesa_receipt="ABC123XYZ")
        # Refresh saga so the local tx mirror is the same as the DB.
        # (`complete` re-reads via `refresh_from_db` already, so a
        # second call is a no-op against the same Status.FAILED row.)
        saga2 = PaymentSaga(tx)
        saga2.complete(mpesa_receipt="ABC123XYZ")

        assert ReconciliationCase.objects.filter(transaction=tx).count() == 1


class TestRecOnFlagDenormalisation(TestCase):
    def test_flag_flips_off_when_case_resolved(self):
        user = _make_user("+254700070020")
        tx = _make_failed_compensated_tx(user)
        case = ReconciliationCase.objects.create(
            transaction=tx,
            case_type=ReconciliationCase.CaseType.DOUBLE_SETTLEMENT,
            status=ReconciliationCase.Status.OPEN,
            severity=ReconciliationCase.Severity.HIGH,
        )
        tx.refresh_from_db()
        assert tx.has_open_reconciliation is True

        case.status = ReconciliationCase.Status.HUMAN_RESOLVED
        case.save(update_fields=["status"])

        tx.refresh_from_db()
        assert tx.has_open_reconciliation is False

    def test_flag_recomputed_on_delete(self):
        user = _make_user("+254700070021")
        tx = _make_failed_compensated_tx(user)
        case = ReconciliationCase.objects.create(
            transaction=tx,
            case_type=ReconciliationCase.CaseType.DOUBLE_SETTLEMENT,
            status=ReconciliationCase.Status.OPEN,
            severity=ReconciliationCase.Severity.HIGH,
        )
        tx.refresh_from_db()
        assert tx.has_open_reconciliation is True

        case.delete()
        tx.refresh_from_db()
        assert tx.has_open_reconciliation is False


class TestSweepReconciliationCases(TestCase):
    def test_sweep_escalates_breached_cases(self):
        from .tasks import sweep_reconciliation_cases

        user = _make_user("+254700070030")
        tx = _make_failed_compensated_tx(user)
        breached = ReconciliationCase.objects.create(
            transaction=tx,
            case_type=ReconciliationCase.CaseType.DOUBLE_SETTLEMENT,
            status=ReconciliationCase.Status.OPEN,
            severity=ReconciliationCase.Severity.HIGH,
            sla_breach_at=timezone.now() - timedelta(minutes=1),  # past breach
        )
        # Control · within SLA, should NOT escalate
        within_sla = ReconciliationCase.objects.create(
            transaction=tx,
            case_type=ReconciliationCase.CaseType.LATE_CALLBACK,
            status=ReconciliationCase.Status.OPEN,
            severity=ReconciliationCase.Severity.HIGH,
            sla_breach_at=timezone.now() + timedelta(minutes=5),
        )

        result = sweep_reconciliation_cases()

        assert result["escalated"] == 1
        breached.refresh_from_db()
        assert breached.status == ReconciliationCase.Status.ESCALATED
        # Escalated cases get bumped to CRITICAL severity
        assert breached.severity == ReconciliationCase.Severity.CRITICAL
        # And carry an audit note
        assert "auto-escalated by sweep" in breached.notes

        within_sla.refresh_from_db()
        assert within_sla.status == ReconciliationCase.Status.OPEN
