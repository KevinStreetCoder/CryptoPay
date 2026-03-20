"""Celery tasks for payment processing."""

import logging

from celery import shared_task

from .models import Transaction

logger = logging.getLogger(__name__)


@shared_task
def check_pending_mpesa_payments():
    """
    Check for M-Pesa payments stuck in 'confirming' status.
    If no callback received within 60s, query Transaction Status API.
    After 10 minutes, auto-compensate to return user funds.
    Run every 30 seconds via Celery Beat.
    """
    from datetime import timedelta

    from django.utils import timezone

    from apps.mpesa.client import MpesaClient

    cutoff = timezone.now() - timedelta(seconds=60)
    stuck = Transaction.objects.filter(
        status=Transaction.Status.CONFIRMING,
        updated_at__lt=cutoff,
        type__in=[
            Transaction.Type.PAYBILL_PAYMENT,
            Transaction.Type.TILL_PAYMENT,
            Transaction.Type.SEND_MPESA,
        ],
    )

    client = MpesaClient()

    for tx in stuck:
        conversation_id = tx.saga_data.get("mpesa_conversation_id", "")
        if not conversation_id:
            continue

        # Try querying M-Pesa transaction status
        try:
            result = client.transaction_status(conversation_id)
            logger.info(f"Status query for tx {tx.id}: {result}")
        except Exception as e:
            logger.error(f"Status query failed for tx {tx.id}: {e}")

        # After 10 minutes with no resolution, compensate and mark FAILED
        ten_min_cutoff = timezone.now() - timedelta(minutes=10)
        if tx.updated_at < ten_min_cutoff and tx.status == Transaction.Status.CONFIRMING:
            logger.warning(
                f"Transaction {tx.id} stuck in CONFIRMING for >10 min — "
                f"compensating user and marking FAILED"
            )
            tx.failure_reason = (
                "Timeout: no M-Pesa callback received within 10 minutes. "
                "Crypto returned to wallet. If M-Pesa payment went through, "
                "contact support for manual reconciliation."
            )
            tx.status = Transaction.Status.FAILED
            tx.save(update_fields=["failure_reason", "status", "updated_at"])

            # Compensate: credit crypto back to user
            try:
                from .saga import PaymentSaga
                saga = PaymentSaga(tx)
                saga.compensate_convert()
                logger.info(f"Compensated stuck tx {tx.id} — crypto returned to user")
            except Exception as comp_err:
                logger.critical(
                    f"Compensation failed for stuck tx {tx.id}: {comp_err}. "
                    f"MANUAL INTERVENTION REQUIRED."
                )

            # Alert admins about the failed transaction
            try:
                from apps.core.tasks import send_failed_transaction_alert_task
                send_failed_transaction_alert_task.delay(transaction_id=str(tx.id))
            except Exception:
                pass

        # Between 3-10 minutes, just flag for review
        elif tx.updated_at < (timezone.now() - timedelta(minutes=3)):
            if not tx.failure_reason:
                tx.failure_reason = "Pending: awaiting M-Pesa callback (>3 min)."
                tx.save(update_fields=["failure_reason", "updated_at"])
                logger.warning(f"Transaction {tx.id} flagged — no M-Pesa callback after 3 min")


@shared_task
def cleanup_stuck_transactions():
    """
    Find transactions stuck in PROCESSING for >2 hours and auto-fail them.
    Unlocks any locked funds. Runs every hour via Celery Beat.

    Covers: withdrawals, swaps, and any other transaction type that
    gets stuck in PROCESSING without completing or failing.
    """
    from datetime import timedelta

    from django.db import transaction as db_transaction
    from django.utils import timezone

    cutoff = timezone.now() - timedelta(hours=2)
    stuck = Transaction.objects.filter(
        status=Transaction.Status.PROCESSING,
        updated_at__lt=cutoff,
    )

    for tx in stuck:
        try:
            with db_transaction.atomic():
                # Lock the transaction row
                tx_locked = Transaction.objects.select_for_update().get(id=tx.id)
                if tx_locked.status != Transaction.Status.PROCESSING:
                    continue  # Already resolved

                # Try to unlock any locked funds
                saga_data = tx_locked.saga_data or {}
                locked_wallet_id = saga_data.get("locked_wallet_id")
                locked_amount = saga_data.get("locked_amount")

                if locked_wallet_id and locked_amount:
                    try:
                        from apps.wallets.services import WalletService
                        from decimal import Decimal
                        WalletService.unlock_funds(locked_wallet_id, Decimal(locked_amount))
                        logger.info(f"Unlocked {locked_amount} for stuck tx {tx.id}")
                    except Exception as unlock_err:
                        logger.critical(
                            f"Failed to unlock funds for tx {tx.id}: {unlock_err}. "
                            f"MANUAL INTERVENTION REQUIRED."
                        )

                tx_locked.status = Transaction.Status.FAILED
                tx_locked.failure_reason = (
                    f"Auto-failed: stuck in PROCESSING for >2 hours. "
                    f"Any locked funds have been returned to your wallet."
                )
                tx_locked.save(update_fields=["status", "failure_reason", "updated_at"])

            logger.warning(f"Auto-failed stuck transaction {tx.id} (type={tx.type})")

            # Send admin alert
            try:
                from apps.core.email import send_admin_alert
                send_admin_alert(
                    f"Stuck transaction auto-failed: {tx.id}",
                    f"Transaction {tx.id} ({tx.type}) was stuck in PROCESSING "
                    f"for >2 hours and has been auto-failed. User: {tx.user.phone}. "
                    f"Amount: {tx.source_amount} {tx.source_currency}.",
                )
            except Exception:
                pass

        except Exception as e:
            logger.error(f"Failed to cleanup stuck tx {tx.id}: {e}")
