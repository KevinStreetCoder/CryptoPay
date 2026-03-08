"""
M-Pesa Celery tasks: float balance monitoring and STK Push status polling.
"""

import logging

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)

# Float balance thresholds (KES)
FLOAT_LOW_THRESHOLD = 300_000
FLOAT_CRITICAL_THRESHOLD = 100_000


@shared_task(name="apps.mpesa.tasks.check_float_balance")
def check_float_balance():
    """
    Check M-Pesa float balance via Daraja Account Balance API.
    Results arrive async via callback. This task initiates the query.
    """
    from .client import MpesaClient, MpesaError

    if not settings.MPESA_CONSUMER_KEY:
        logger.debug("M-Pesa not configured, skipping float check")
        return

    try:
        client = MpesaClient()
        result = client.account_balance()
        logger.info(f"Float balance query initiated: {result}")
        return result
    except MpesaError as e:
        logger.error(f"Float balance check failed: {e}")
    except Exception as e:
        logger.error(f"Float balance check error: {e}")


@shared_task(name="apps.mpesa.tasks.poll_stk_status")
def poll_stk_status(checkout_request_id: str, transaction_id: str, attempt: int = 1):
    """
    Poll STK Push status when callback hasn't arrived within timeout.
    Retries up to 3 times with 30s intervals.
    """
    from django.utils import timezone

    from apps.payments.models import Transaction

    from .client import MpesaClient

    max_attempts = 3

    try:
        tx = Transaction.objects.get(id=transaction_id)
    except Transaction.DoesNotExist:
        logger.error(f"Transaction {transaction_id} not found for STK poll")
        return

    # Skip if already resolved
    if tx.status in (Transaction.Status.COMPLETED, Transaction.Status.FAILED, Transaction.Status.REVERSED):
        logger.info(f"Transaction {transaction_id} already resolved ({tx.status}), skipping poll")
        return

    if not settings.MPESA_CONSUMER_KEY:
        logger.debug("M-Pesa not configured, skipping STK poll")
        return

    try:
        client = MpesaClient()
        result = client.stk_query(checkout_request_id)
        result_code = result.get("ResultCode")

        if result_code == "0" or result_code == 0:
            # Success
            tx.status = Transaction.Status.COMPLETED
            tx.completed_at = timezone.now()
            tx.save(update_fields=["status", "completed_at", "updated_at"])
            logger.info(f"STK Push confirmed via poll for tx {transaction_id}")
        elif result_code is not None and result_code != "":
            # Failed
            tx.failure_reason = result.get("ResultDesc", "STK Push failed")
            tx.status = Transaction.Status.FAILED
            tx.save(update_fields=["failure_reason", "status", "updated_at"])
            logger.warning(f"STK Push failed via poll for tx {transaction_id}: {result}")
        else:
            # Still pending — retry
            if attempt < max_attempts:
                poll_stk_status.apply_async(
                    args=[checkout_request_id, transaction_id, attempt + 1],
                    countdown=30,
                )
                logger.info(f"STK still pending, retry {attempt + 1}/{max_attempts}")
            else:
                # Max retries — flag for manual review
                tx.failure_reason = "STK Push timeout: no callback or status after 3 polls"
                tx.status = Transaction.Status.FAILED
                tx.save(update_fields=["failure_reason", "status", "updated_at"])
                logger.error(f"STK Push timeout for tx {transaction_id} after {max_attempts} polls")

    except Exception as e:
        logger.error(f"STK status poll error: {e}")
        if attempt < max_attempts:
            poll_stk_status.apply_async(
                args=[checkout_request_id, transaction_id, attempt + 1],
                countdown=30,
            )
