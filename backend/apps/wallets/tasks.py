"""
Rebalancing & Custody Celery tasks — periodic monitoring and order processing.

Tasks:
  check_and_trigger_rebalance   — Runs every 5 min, creates order if float low
  process_rebalance_order       — Submits a pending order to the exchange
  check_stale_orders            — Alerts on orders stuck too long
  check_custody_thresholds      — Runs every 15 min, rebalances hot/warm/cold tiers
  generate_custody_report       — Runs daily, logs full custody report
  reconcile_wallet_balances     — Runs every hour, reconciles on-chain vs DB
"""

import logging

from celery import shared_task
from django.core.cache import cache

logger = logging.getLogger(__name__)

# Redis lock for periodic task (prevent overlapping runs)
PERIODIC_LOCK_KEY = "rebalance:periodic_check:lock"
PERIODIC_LOCK_TTL = 240  # 4 minutes (task runs every 5 min)

# Custody task locks
CUSTODY_CHECK_LOCK_KEY = "custody:threshold_check:lock"
CUSTODY_CHECK_LOCK_TTL = 840  # 14 minutes (task runs every 15 min)
RECONCILE_LOCK_KEY = "custody:reconcile:lock"
RECONCILE_LOCK_TTL = 3500  # ~58 minutes (task runs every hour)


@shared_task(
    name="apps.wallets.tasks.check_and_trigger_rebalance",
    bind=True,
    max_retries=0,
    acks_late=True,
    reject_on_worker_lost=True,
)
def check_and_trigger_rebalance(self):
    """
    Periodic task: check float balance and trigger rebalance if needed.

    Runs every 5 minutes via Celery Beat. Creates a RebalanceOrder and
    immediately submits it (which notifies admin in manual mode).

    Idempotency: Redis lock prevents concurrent runs. Active order check
    in create_rebalance_order prevents duplicate orders.
    """
    # Acquire lock to prevent overlapping runs
    if not cache.add(PERIODIC_LOCK_KEY, "1", timeout=PERIODIC_LOCK_TTL):
        logger.debug("Rebalance periodic check already running, skipping")
        return "skipped:lock_held"

    try:
        from .rebalance import (
            create_rebalance_order,
            get_current_float_kes,
            has_active_rebalance,
            submit_rebalance_order,
            TRIGGER_FLOAT_KES,
        )
        from .models import RebalanceOrder

        # Quick checks before doing any work
        if has_active_rebalance():
            logger.info("Active rebalance order exists, skipping periodic check")
            return "skipped:active_order"

        current_float = get_current_float_kes()
        if current_float is None:
            logger.warning("Float balance unknown, skipping rebalance check")
            return "skipped:float_unknown"

        if current_float >= TRIGGER_FLOAT_KES:
            logger.debug(f"Float KES {current_float:,.0f} is healthy, no rebalance needed")
            return f"healthy:float_{current_float}"

        # Float is low — create and submit rebalance order
        logger.info(
            f"Float KES {current_float:,.0f} below trigger {TRIGGER_FLOAT_KES:,.0f}, "
            f"creating rebalance order"
        )

        order = create_rebalance_order(
            trigger=RebalanceOrder.TriggerType.SCHEDULED,
            reason=f"Periodic check: float at KES {current_float:,.0f}",
        )

        if not order:
            return "skipped:preconditions_not_met"

        # Immediately submit (notifies admin in manual mode)
        submit_rebalance_order(str(order.id))

        return f"triggered:order_{str(order.id)[:8]}"

    except Exception as e:
        logger.error(f"Rebalance periodic check failed: {e}", exc_info=True)
        return f"error:{e}"
    finally:
        cache.delete(PERIODIC_LOCK_KEY)


@shared_task(
    name="apps.wallets.tasks.process_rebalance_order",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=600,
    acks_late=True,
    reject_on_worker_lost=True,
)
def process_rebalance_order(self, order_id: str):
    """
    Submit a specific pending rebalance order.

    Called when an order is created via API (admin triggers manually)
    or when the circuit breaker auto-creates one.
    """
    try:
        from .rebalance import submit_rebalance_order
        order = submit_rebalance_order(order_id)
        return f"submitted:{str(order.id)[:8]}"
    except ValueError as e:
        # Invalid state transition — don't retry
        logger.warning(f"Cannot process rebalance order {order_id}: {e}")
        return f"invalid_state:{e}"
    except Exception as e:
        logger.error(f"Failed to process rebalance order {order_id}: {e}", exc_info=True)
        raise self.retry(exc=e)


@shared_task(
    name="apps.wallets.tasks.check_stale_orders",
    bind=True,
    max_retries=0,
    acks_late=True,
)
def check_stale_orders(self):
    """
    Check for rebalance orders that have been active for too long.

    Alerts admin if an order has been pending/submitted for >4 hours
    (manual mode should be actioned within a few hours).
    Auto-fails orders older than 24 hours.
    """
    from django.utils import timezone
    from datetime import timedelta
    from .models import RebalanceOrder

    now = timezone.now()
    stale_threshold = now - timedelta(hours=4)
    expire_threshold = now - timedelta(hours=24)

    # Auto-fail very old orders
    expired = RebalanceOrder.objects.filter(
        status__in=[
            RebalanceOrder.Status.PENDING,
            RebalanceOrder.Status.SUBMITTED,
        ],
        created_at__lt=expire_threshold,
    )

    for order in expired:
        try:
            from .rebalance import fail_rebalance_order
            fail_rebalance_order(
                str(order.id),
                error_message="Auto-expired: order active for >24 hours without settlement",
            )
            logger.warning(f"Rebalance order {str(order.id)[:8]} auto-expired after 24h")
        except Exception as e:
            logger.error(f"Failed to expire order {order.id}: {e}")

    # Alert on stale but not expired orders
    stale = RebalanceOrder.objects.filter(
        status__in=[
            RebalanceOrder.Status.PENDING,
            RebalanceOrder.Status.SUBMITTED,
        ],
        created_at__lt=stale_threshold,
        created_at__gte=expire_threshold,
    )

    if stale.exists():
        try:
            from apps.core.push import send_admin_alert

            orders_info = ", ".join(
                f"{str(o.id)[:8]} ({o.age_minutes:.0f}m)" for o in stale
            )
            send_admin_alert(
                title="Stale Rebalance Orders",
                body=f"Orders pending >4h: {orders_info}. Please confirm or cancel.",
                data={"type": "stale_rebalance"},
            )
        except Exception as e:
            logger.error(f"Failed to send stale order alert: {e}")

    return f"expired:{expired.count()},stale:{stale.count()}"


@shared_task(
    name="apps.wallets.tasks.trigger_rebalance_from_breaker",
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    retry_backoff=True,
    retry_backoff_max=300,
    acks_late=True,
)
def trigger_rebalance_from_breaker(self, float_balance_kes: str, breaker_state: str):
    """
    Called by the circuit breaker when it transitions to HALF_OPEN or OPEN.
    Creates a rebalance order with higher urgency.
    """
    from decimal import Decimal
    from .rebalance import create_rebalance_order, has_active_rebalance, submit_rebalance_order
    from .models import RebalanceOrder

    if has_active_rebalance():
        logger.info("Active rebalance exists, skipping breaker-triggered rebalance")
        return "skipped:active_order"

    try:
        float_kes = Decimal(float_balance_kes)
        order = create_rebalance_order(
            trigger=RebalanceOrder.TriggerType.AUTO,
            reason=(
                f"Circuit breaker triggered ({breaker_state}): "
                f"float at KES {float_kes:,.0f}"
            ),
            force=True,  # Override cooldown for breaker-triggered
        )

        if order:
            submit_rebalance_order(str(order.id))
            return f"triggered:order_{str(order.id)[:8]}"

        return "skipped:preconditions"

    except Exception as e:
        logger.error(f"Breaker-triggered rebalance failed: {e}", exc_info=True)
        raise self.retry(exc=e)


# ── Custody tier tasks ────────────────────────────────────────────────────────

@shared_task(
    name="apps.wallets.tasks.check_custody_thresholds",
    bind=True,
    max_retries=0,
    acks_late=True,
    reject_on_worker_lost=True,
)
def check_custody_thresholds(self):
    """
    Periodic task: check hot/warm/cold wallet thresholds and trigger
    automatic rebalancing between tiers when breached.

    Runs every 15 minutes via Celery Beat.

    For hot↔warm transfers, executes automatically (same infrastructure).
    For warm→cold transfers, creates a pending transfer for admin action.
    For cold→warm transfers, notifies admin (cold wallet is offline).
    """
    if not cache.add(CUSTODY_CHECK_LOCK_KEY, "1", timeout=CUSTODY_CHECK_LOCK_TTL):
        logger.debug("Custody threshold check already running, skipping")
        return "skipped:lock_held"

    try:
        from .custody import CustodyService

        service = CustodyService()
        actions_taken = []

        for currency in service.CRYPTO_CURRENCIES:
            try:
                rebalance = service.check_rebalance_needed(currency)
                if not rebalance:
                    continue

                direction = rebalance["direction"]
                amount = rebalance["amount"]
                reason = rebalance["reason"]

                logger.info(
                    f"Custody rebalance needed: {currency} {direction} "
                    f"amount={amount} | {reason}"
                )

                if direction == "hot_to_warm":
                    service.initiate_hot_to_warm_transfer(
                        currency=currency,
                        amount=amount,
                        initiated_by="system",
                        reason=reason,
                    )
                    actions_taken.append(f"{currency}:hot→warm:{amount}")

                elif direction == "warm_to_hot":
                    service.initiate_warm_to_hot_transfer(
                        currency=currency,
                        amount=amount,
                        initiated_by="system",
                        reason=reason,
                    )
                    actions_taken.append(f"{currency}:warm→hot:{amount}")

                elif direction == "warm_to_cold":
                    service.initiate_warm_to_cold_transfer(
                        currency=currency,
                        amount=amount,
                        initiated_by="system",
                        reason=reason,
                    )
                    actions_taken.append(f"{currency}:warm→cold:{amount}:pending")

                elif direction == "cold_to_warm":
                    # Cold→warm requires manual intervention.
                    # Just log and notify admin.
                    logger.warning(
                        f"Cold→warm transfer needed for {currency}: {amount}. "
                        f"Admin must initiate from cold storage."
                    )
                    try:
                        from apps.core.push import send_admin_alert
                        send_admin_alert(
                            title=f"Cold Storage Release Needed: {currency}",
                            body=(
                                f"Warm wallet {currency} below threshold. "
                                f"Please release {amount} {currency} from cold storage."
                            ),
                            data={"type": "cold_release_needed", "currency": currency},
                        )
                    except Exception:
                        pass
                    actions_taken.append(f"{currency}:cold→warm:notified")

            except ValueError as e:
                logger.warning(f"Custody rebalance skipped for {currency}: {e}")
                actions_taken.append(f"{currency}:skipped:{e}")
            except Exception as e:
                logger.error(
                    f"Custody rebalance failed for {currency}: {e}",
                    exc_info=True,
                )
                actions_taken.append(f"{currency}:error:{e}")

        if actions_taken:
            logger.info(f"Custody threshold check completed: {actions_taken}")
            return f"actions:{','.join(actions_taken)}"

        return "healthy:no_rebalance_needed"

    except Exception as e:
        logger.error(f"Custody threshold check failed: {e}", exc_info=True)
        return f"error:{e}"
    finally:
        cache.delete(CUSTODY_CHECK_LOCK_KEY)


@shared_task(
    name="apps.wallets.tasks.generate_custody_report",
    bind=True,
    max_retries=0,
    acks_late=True,
)
def generate_custody_report(self):
    """
    Daily task: generate and log a full custody report.

    Outputs the report to the structured log for compliance and monitoring.
    Can be consumed by log aggregators (ELK, Datadog, etc.) for dashboards.
    """
    try:
        from .custody import CustodyService

        service = CustodyService()
        report = service.get_custody_report()

        # Log the full report at INFO level for compliance trail
        logger.info(
            f"Daily custody report generated: "
            f"currencies={list(report['currencies'].keys())} "
            f"active_transfers={len(report['active_transfers'])} "
            f"alerts={len(report['alerts'])}"
        )

        # Log individual alerts at WARNING level
        for alert in report.get("alerts", []):
            logger.warning(
                f"Custody alert [{alert['severity']}]: {alert['currency']} — "
                f"{alert['message']}"
            )

        # Write to audit log
        try:
            from apps.accounts.models import AuditLog

            AuditLog.objects.create(
                action="CUSTODY_DAILY_REPORT",
                entity_type="custody_report",
                entity_id="daily",
                details={
                    "currencies": list(report["currencies"].keys()),
                    "alert_count": len(report["alerts"]),
                    "active_transfer_count": len(report["active_transfers"]),
                    "generated_at": report["generated_at"],
                },
            )
        except Exception as e:
            logger.error(f"Failed to write custody report to audit log: {e}")

        return f"report_generated:alerts={len(report['alerts'])}"

    except Exception as e:
        logger.error(f"Custody report generation failed: {e}", exc_info=True)
        return f"error:{e}"


@shared_task(
    name="apps.wallets.tasks.reconcile_wallet_balances",
    bind=True,
    max_retries=0,
    acks_late=True,
    reject_on_worker_lost=True,
)
def reconcile_wallet_balances(self):
    """
    Hourly task: reconcile on-chain balances with DB records.

    Queries each active system wallet's on-chain balance and compares
    with the DB balance. Logs discrepancies for investigation.

    In production, this will use chain-specific RPC calls. Currently
    updates the last_reconciled timestamp for tracking.
    """
    if not cache.add(RECONCILE_LOCK_KEY, "1", timeout=RECONCILE_LOCK_TTL):
        logger.debug("Wallet reconciliation already running, skipping")
        return "skipped:lock_held"

    try:
        from .custody import CustodyService

        service = CustodyService()
        all_results = {}

        for currency in service.CRYPTO_CURRENCIES:
            try:
                results = service.reconcile_balances(currency)
                all_results[currency] = results
            except Exception as e:
                logger.error(f"Reconciliation failed for {currency}: {e}", exc_info=True)
                all_results[currency] = {"error": str(e)}

        # Summary log
        reconciled_count = sum(
            1 for r in all_results.values()
            for tier_result in r.values()
            if isinstance(tier_result, dict) and tier_result.get("status") == "ok"
        )
        logger.info(
            f"Wallet reconciliation completed: "
            f"{reconciled_count} wallets reconciled across "
            f"{len(all_results)} currencies"
        )

        return f"reconciled:{reconciled_count}_wallets"

    except Exception as e:
        logger.error(f"Wallet reconciliation failed: {e}", exc_info=True)
        return f"error:{e}"
    finally:
        cache.delete(RECONCILE_LOCK_KEY)
