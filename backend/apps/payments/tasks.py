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
    Run every 30 seconds via Celery Beat.
    """
    from datetime import timedelta

    from django.utils import timezone

    from apps.mpesa.client import MpesaClient

    cutoff = timezone.now() - timedelta(seconds=60)
    stuck = Transaction.objects.filter(
        status=Transaction.Status.CONFIRMING,
        updated_at__lt=cutoff,
        type__in=[Transaction.Type.PAYBILL_PAYMENT, Transaction.Type.TILL_PAYMENT],
    )

    client = MpesaClient()

    for tx in stuck:
        conversation_id = tx.saga_data.get("mpesa_conversation_id", "")
        if not conversation_id:
            continue

        try:
            result = client.transaction_status(conversation_id)
            logger.info(f"Status query for tx {tx.id}: {result}")
            # The actual result comes via callback — this just triggers the query
        except Exception as e:
            logger.error(f"Status query failed for tx {tx.id}: {e}")

        # After 3 minutes with no resolution, flag for manual review
        three_min_cutoff = timezone.now() - timedelta(minutes=3)
        if tx.updated_at < three_min_cutoff and tx.status == Transaction.Status.CONFIRMING:
            tx.failure_reason = "Timeout: no M-Pesa callback received. Flagged for manual review."
            tx.save(update_fields=["failure_reason", "updated_at"])
            logger.warning(f"Transaction {tx.id} flagged for manual review — no M-Pesa callback")
