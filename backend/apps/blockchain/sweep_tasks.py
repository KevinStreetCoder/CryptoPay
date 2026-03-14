"""
Celery tasks for on-chain sweep operations.

Consolidates user deposit addresses into the platform's central hot wallet.
These tasks are designed to be idempotent and safe for concurrent execution.

Add to Celery Beat schedule in settings (config/settings/base.py):

    CELERY_BEAT_SCHEDULE = {
        ...
        # Sweep tasks
        "scan-and-create-sweep-orders": {
            "task": "apps.blockchain.sweep_tasks.scan_and_create_sweep_orders",
            "schedule": crontab(minute="*/15"),  # Every 15 minutes
        },
        "process-pending-sweeps": {
            "task": "apps.blockchain.sweep_tasks.process_pending_sweeps",
            "schedule": crontab(minute="*/5"),  # Every 5 minutes
        },
        "verify-submitted-sweeps": {
            "task": "apps.blockchain.sweep_tasks.verify_submitted_sweeps",
            "schedule": crontab(minute="*/3"),  # Every 3 minutes
        },
        "credit-confirmed-sweeps": {
            "task": "apps.blockchain.sweep_tasks.credit_confirmed_sweeps",
            "schedule": crontab(minute="*/5"),  # Every 5 minutes
        },
    }
"""

import logging

from celery import shared_task
from django.db import transaction as db_transaction

from .models import SweepOrder
from .reconciliation import run_full_reconciliation
from .sweep import (
    create_sweep_orders,
    credit_hot_wallet,
    execute_sweep,
    verify_sweep,
)

logger = logging.getLogger(__name__)

# All chains to scan for sweepable deposits
SWEEP_CHAINS = ["tron", "ethereum", "bitcoin", "solana"]

# Maximum number of pending sweeps to process per task invocation
MAX_SWEEPS_PER_RUN = 20

# Maximum retries before giving up on a failed sweep
MAX_RETRIES = 3


@shared_task(
    name="apps.blockchain.sweep_tasks.scan_and_create_sweep_orders",
    bind=True,
    max_retries=1,
    default_retry_delay=120,
    retry_backoff=True,
    retry_backoff_max=600,
    soft_time_limit=300,
    time_limit=360,
)
def scan_and_create_sweep_orders(self):
    """
    Periodic task: Scan all chains for deposit addresses with sweepable balances
    and create SweepOrder records.

    Runs every 15 minutes via Celery Beat.

    For each chain:
    1. Find addresses with CREDITED deposits that haven't been swept
    2. Query on-chain balances
    3. Estimate fees and decide whether to sweep
    4. Create SweepOrder records (PENDING or SKIPPED)
    """
    total_created = 0

    for chain in SWEEP_CHAINS:
        try:
            orders = create_sweep_orders(chain)
            total_created += len(orders)
            if orders:
                logger.info(
                    f"Created {len(orders)} sweep orders for {chain}: "
                    f"{', '.join(str(o.id)[:8] for o in orders)}"
                )
        except Exception as e:
            logger.error(f"Failed to scan {chain} for sweepable deposits: {e}", exc_info=True)
            # Continue with other chains -- don't let one chain block the rest

    if total_created > 0:
        logger.info(f"Sweep scan complete: created {total_created} orders across all chains")
    else:
        logger.debug("Sweep scan complete: no new orders created")

    return {"orders_created": total_created}


@shared_task(
    name="apps.blockchain.sweep_tasks.process_pending_sweeps",
    bind=True,
    max_retries=1,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=600,
    soft_time_limit=300,
    time_limit=360,
)
def process_pending_sweeps(self):
    """
    Process pending sweep orders by signing and broadcasting transactions.

    Runs every 5 minutes via Celery Beat.

    Picks up SweepOrder records with status=PENDING, ordered by creation time,
    and executes them one by one. Each execution:
    1. Derives the private key for the deposit address
    2. Signs and broadcasts the sweep transaction
    3. Updates the order to SUBMITTED (or FAILED on error)

    Failed orders with retry_count < MAX_RETRIES are reset to PENDING for
    the next run.
    """
    pending_orders = list(
        SweepOrder.objects.filter(
            status=SweepOrder.Status.PENDING,
        )
        .order_by("created_at")
        .values_list("id", flat=True)[:MAX_SWEEPS_PER_RUN]
    )

    if not pending_orders:
        logger.debug("No pending sweep orders to process")
        return {"processed": 0, "succeeded": 0, "failed": 0}

    succeeded = 0
    failed = 0

    for order_id in pending_orders:
        try:
            result = execute_sweep(str(order_id))
            if result:
                succeeded += 1
            else:
                failed += 1
        except Exception as e:
            logger.error(f"Unexpected error processing sweep {order_id}: {e}", exc_info=True)
            failed += 1

    # Retry failed orders that haven't exceeded max retries
    _retry_failed_sweeps()

    logger.info(
        f"Processed {len(pending_orders)} pending sweeps: "
        f"{succeeded} succeeded, {failed} failed"
    )

    return {
        "processed": len(pending_orders),
        "succeeded": succeeded,
        "failed": failed,
    }


@shared_task(
    name="apps.blockchain.sweep_tasks.verify_submitted_sweeps",
    bind=True,
    max_retries=1,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=180,
    time_limit=240,
)
def verify_submitted_sweeps(self):
    """
    Check confirmation status of submitted/confirming sweep transactions.

    Runs every 3 minutes via Celery Beat.

    Picks up SweepOrder records with status in (SUBMITTED, CONFIRMING) and
    queries the chain for confirmation count. Updates status to:
    - CONFIRMING if tx found but not enough confirmations
    - CONFIRMED if required confirmations reached
    - FAILED if tx not found after extended period (stale detection)
    """
    submitted_orders = list(
        SweepOrder.objects.filter(
            status__in=[SweepOrder.Status.SUBMITTED, SweepOrder.Status.CONFIRMING],
        )
        .order_by("submitted_at")
        .values_list("id", flat=True)[:MAX_SWEEPS_PER_RUN]
    )

    if not submitted_orders:
        logger.debug("No submitted sweeps to verify")
        return {"verified": 0, "confirmed": 0, "still_pending": 0}

    confirmed = 0
    still_pending = 0

    for order_id in submitted_orders:
        try:
            result = verify_sweep(str(order_id))
            if result:
                confirmed += 1
            else:
                still_pending += 1
        except Exception as e:
            logger.error(f"Failed to verify sweep {order_id}: {e}", exc_info=True)
            still_pending += 1

    # Detect stale sweeps (submitted > 2 hours ago, still not confirmed)
    _detect_stale_sweeps()

    logger.info(
        f"Verified {len(submitted_orders)} sweeps: "
        f"{confirmed} confirmed, {still_pending} still pending"
    )

    return {
        "verified": len(submitted_orders),
        "confirmed": confirmed,
        "still_pending": still_pending,
    }


@shared_task(
    name="apps.blockchain.sweep_tasks.credit_confirmed_sweeps",
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=120,
    time_limit=180,
)
def credit_confirmed_sweeps(self):
    """
    Update SystemWallet HOT balance for confirmed sweep transactions.

    Runs every 5 minutes via Celery Beat.

    Picks up SweepOrder records with status=CONFIRMED and atomically:
    1. Locks the SweepOrder row
    2. Credits the SystemWallet HOT balance
    3. Updates SweepOrder status to CREDITED
    """
    confirmed_orders = list(
        SweepOrder.objects.filter(
            status=SweepOrder.Status.CONFIRMED,
        )
        .order_by("confirmed_at")
        .values_list("id", flat=True)[:MAX_SWEEPS_PER_RUN]
    )

    if not confirmed_orders:
        logger.debug("No confirmed sweeps to credit")
        return {"credited": 0, "failed": 0}

    credited = 0
    failed = 0

    for order_id in confirmed_orders:
        try:
            result = credit_hot_wallet(str(order_id))
            if result:
                credited += 1
            else:
                failed += 1
        except Exception as e:
            logger.error(
                f"Failed to credit hot wallet for sweep {order_id}: {e}",
                exc_info=True,
            )
            failed += 1

    logger.info(
        f"Credited {credited} confirmed sweeps to hot wallet "
        f"({failed} failures)"
    )

    return {"credited": credited, "failed": failed}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _retry_failed_sweeps():
    """
    Reset failed sweep orders back to PENDING if they haven't exceeded max retries.

    This gives transient failures (network timeouts, RPC errors) another chance.
    Permanently failed sweeps (e.g., invalid address, anomaly detected) are left
    in FAILED state for manual investigation.
    """
    retryable = SweepOrder.objects.filter(
        status=SweepOrder.Status.FAILED,
        retry_count__lt=MAX_RETRIES,
    ).exclude(
        # Don't retry anomaly-related failures
        error_message__icontains="anomaly",
    ).exclude(
        # Don't retry "not implemented" failures
        error_message__icontains="not yet implemented",
    ).exclude(
        # Don't retry wallet-not-found failures
        error_message__icontains="wallet not found",
    )

    from django.db.models import F
    count = retryable.update(
        status=SweepOrder.Status.PENDING,
        retry_count=F("retry_count") + 1,
    )

    if count > 0:
        logger.info(f"Reset {count} failed sweep orders back to PENDING for retry")


@shared_task(
    name="apps.blockchain.sweep_tasks.reconcile_balances",
    bind=True,
    max_retries=0,
    soft_time_limit=600,
    time_limit=720,
)
def reconcile_balances(self):
    """
    Periodic reconciliation: compare on-chain balances vs DB records.

    Runs every 15 minutes via Celery Beat.

    Checks:
    1. Deposit address balances vs credited deposits minus credited sweeps
    2. Hot wallet on-chain balances vs SystemWallet HOT records
    3. Flags DEFICIT (possible unauthorized outflows) as CRITICAL
    4. Flags SURPLUS (likely unsent sweeps) as WARNING
    """
    try:
        result = run_full_reconciliation()
        if result["deficits"] > 0:
            logger.critical(
                f"Reconciliation found {result['deficits']} deficit(s)! "
                f"Details: {result['details']}"
            )
        return result
    except Exception as e:
        logger.error(f"Reconciliation task failed: {e}", exc_info=True)
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _detect_stale_sweeps():
    """
    Detect sweep orders that have been in SUBMITTED status for too long.

    If a sweep has been submitted but not confirmed after 2 hours,
    it might be stuck (dropped from mempool, insufficient gas, etc.).
    Mark as FAILED for manual investigation.
    """
    from datetime import timedelta
    from django.utils import timezone

    stale_cutoff = timezone.now() - timedelta(hours=2)

    stale_orders = SweepOrder.objects.filter(
        status__in=[SweepOrder.Status.SUBMITTED, SweepOrder.Status.CONFIRMING],
        submitted_at__lt=stale_cutoff,
    )

    for order in stale_orders:
        order.status = SweepOrder.Status.FAILED
        order.error_message = (
            f"Stale sweep: submitted at {order.submitted_at}, "
            f"not confirmed after 2 hours. Manual investigation required. "
            f"tx_hash={order.tx_hash}"
        )
        order.save(update_fields=["status", "error_message", "updated_at"])
        logger.warning(
            f"Marked stale sweep {order.id} as FAILED "
            f"(submitted {order.submitted_at}, chain={order.chain}, "
            f"tx={order.tx_hash[:16] if order.tx_hash else 'none'}...)"
        )
