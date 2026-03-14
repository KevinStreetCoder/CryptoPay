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

        # Between 3-10 minutes, just flag for review
        elif tx.updated_at < (timezone.now() - timedelta(minutes=3)):
            if not tx.failure_reason:
                tx.failure_reason = "Pending: awaiting M-Pesa callback (>3 min)."
                tx.save(update_fields=["failure_reason", "updated_at"])
                logger.warning(f"Transaction {tx.id} flagged — no M-Pesa callback after 3 min")
