"""Celery tasks for payment processing."""

import logging

from celery import shared_task, signals

from .models import Transaction

logger = logging.getLogger(__name__)


# ── Compensation retry · async, idempotent, advisory-lock-guarded ─────
#
# Background · `PaymentSaga.compensate_convert` used to retry the
# crypto credit-back inline with `time.sleep(2 ** attempt)` while
# holding the Celery worker. A stuck wallet write therefore blocked
# the whole payment queue and starved every other in-flight saga.
#
# 2026-04-26 redesign · the saga makes ONE synchronous attempt (50 ms
# happy path, no Celery roundtrip latency for the common case). On
# failure it enqueues `compensate_convert_async` which:
#
#   - Uses Celery's `bind=True` + `autoretry_for=(Exception,)` +
#     `retry_backoff=2, retry_backoff_max=600, retry_jitter=True,
#     max_retries=8` · ~17 min total spread, randomised so two
#     simultaneous retries don't thunder a recovering wallet service.
#   - `acks_late=True` + `reject_on_worker_lost=True` so a worker
#     crash mid-task re-queues the message instead of silently
#     dropping a fund-loss compensation.
#   - Postgres advisory lock per transaction_id to serialise concurrent
#     attempts (e.g. saga retry + cleanup_stuck_transactions). Uses
#     `pg_try_advisory_xact_lock` so the lock auto-releases on commit
#     · no Redis cleanup, no orphaned locks.
#   - Idempotency · the wallet credit is keyed on `tx.id`, so a
#     repeat after a partial commit just no-ops at the wallet layer.
#   - DLQ · once `max_retries` is hit, the `task_failure` signal
#     handler creates a `Transaction.failure_reason` audit and fires
#     a structured Sentry event tagged `transaction_id=…` so the
#     ops dashboard alerts dedupe per-transaction.
#
# References:
#   - Celery best practices · https://docs.celeryq.dev/en/stable/userguide/tasks.html
#   - PG advisory locks · https://www.postgresql.org/docs/current/explicit-locking.html
#   - AWS saga compensation · https://docs.aws.amazon.com/prescriptive-guidance/
#     latest/cloud-design-patterns/saga.html

_COMPENSATE_LOCK_NAMESPACE = 0xC0FFEE  # arbitrary; pairs with hashtext(tx_id)


@shared_task(
    bind=True,
    name="apps.payments.tasks.compensate_convert_async",
    autoretry_for=(Exception,),
    retry_backoff=2,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=8,
    acks_late=True,
    reject_on_worker_lost=True,
)
def compensate_convert_async(self, transaction_id: str, wallet_id: str, amount_str: str):
    """Async compensation for the saga's Step-2 (crypto credit-back).

    Args:
        transaction_id: UUID string of the failed Transaction row.
        wallet_id: UUID string of the wallet that should be credited.
        amount_str: Decimal string of the amount to credit.

    Why pass amount as a string · Celery serialises args via JSON;
    Decimal would round-trip as str anyway, but being explicit avoids
    the `1.10000000` → `1.1` precision drift that bit us in 2025.
    """
    from decimal import Decimal
    from django.db import connection

    from apps.wallets.services import WalletService

    attempt = self.request.retries + 1
    log_extra = {
        "transaction_id": transaction_id,
        "wallet_id": wallet_id,
        "amount": amount_str,
        "attempt": attempt,
        "max_retries": self.max_retries,
        "celery_task_id": self.request.id,
    }

    # Advisory lock · prevents two parallel compensation attempts from
    # racing on the same transaction (e.g. saga path + the daily
    # `cleanup_stuck_transactions` sweep both deciding to compensate).
    # `pg_try_advisory_xact_lock` returns False if the lock is held
    # elsewhere; we re-queue ourselves rather than block the worker.
    #
    # The two-arg form `pg_try_advisory_xact_lock(int4, int4)` requires
    # both args to be int4. `hashtext` returns int4 but our namespace
    # bigint trips it. Use the single-arg `pg_try_advisory_xact_lock
    # (bigint)` form with a stable namespace-shifted key instead ·
    # combines the namespace and hash into one 64-bit integer.
    lock_key = (_COMPENSATE_LOCK_NAMESPACE << 32) | (
        # `& 0xFFFFFFFF` masks to 32 bits so int4 hashtext fits the
        # low half of a bigint without sign-extension surprises.
        0xFFFFFFFF
    )
    with connection.cursor() as cur:
        cur.execute(
            "SELECT pg_try_advisory_xact_lock((%s)::bigint << 32 | (hashtext(%s) & 2147483647))",
            [_COMPENSATE_LOCK_NAMESPACE, transaction_id],
        )
        got_lock = cur.fetchone()[0]

    if not got_lock:
        logger.info("compensate_convert_async.lock_busy", extra=log_extra)
        # Re-queue with a short delay; another worker will release.
        raise self.retry(countdown=5, exc=RuntimeError("compensate-lock-busy"))

    try:
        WalletService.credit(
            wallet_id,
            Decimal(amount_str),
            transaction_id,
            f"Reversal: conversion for tx {transaction_id} (attempt {attempt})",
        )
        logger.info("compensate_convert_async.ok", extra=log_extra)
    except Exception as e:
        log_extra.update({"error_type": type(e).__name__, "error": str(e)})
        if attempt >= self.max_retries:
            # Last attempt · the `task_failure` signal handler below
            # creates the durable audit record. Re-raise so Celery
            # marks the task FAILED and the signal fires.
            logger.critical("compensate_convert_async.exhausted", extra=log_extra)
        else:
            logger.warning("compensate_convert_async.retry", extra=log_extra)
        raise


@signals.task_failure.connect(sender=compensate_convert_async)
def _on_compensate_failure(sender, task_id, exception, args, kwargs, **_kw):
    """DLQ landing for a compensation that exhausted all retries.

    Marks the Transaction with a clear failure_reason so admin tooling
    surfaces it, and emits a Sentry event with a stable fingerprint
    (per transaction_id) so the on-call dedupe doesn't drown.

    The next iteration (P0-3) introduces a `ReconciliationCase` row
    here · until then, this signal is the durable record. A daily
    sweep already exists in `cleanup_stuck_transactions` to surface
    these in the admin queue.
    """
    transaction_id = (kwargs or {}).get("transaction_id") or (args[1] if len(args) >= 2 else None)
    amount_str = (kwargs or {}).get("amount_str") or (args[3] if len(args) >= 4 else None)

    logger.critical(
        "compensate_convert_async.dead_letter",
        extra={
            "transaction_id": transaction_id,
            "amount": amount_str,
            "celery_task_id": task_id,
            "exception_type": type(exception).__name__ if exception else None,
            "exception": str(exception) if exception else None,
        },
    )

    if transaction_id:
        try:
            tx = Transaction.objects.get(id=transaction_id)
            stamp = (
                f"Compensation failed after retries · {type(exception).__name__}: "
                f"{exception}. Manual credit required."
            )
            # Append rather than overwrite · we want every failed run
            # in the audit trail.
            tx.failure_reason = (tx.failure_reason or "") + f"\n[{task_id}] {stamp}"
            tx.save(update_fields=["failure_reason", "updated_at"])
        except Transaction.DoesNotExist:
            logger.error(
                "compensate_convert_async.dead_letter.tx_missing",
                extra={"transaction_id": transaction_id},
            )

    # Best-effort Sentry capture · the deduping happens via fingerprint.
    try:
        import sentry_sdk
        with sentry_sdk.push_scope() as scope:
            scope.fingerprint = ["compensate_convert_async", str(transaction_id)]
            scope.set_tag("transaction_id", str(transaction_id))
            scope.set_level("fatal")
            sentry_sdk.capture_exception(exception)
    except Exception:
        pass

    # Best-effort admin alert · email is the last resort.
    try:
        from apps.core.email import send_admin_alert
        send_admin_alert(
            f"CRITICAL: compensation failed permanently · tx {transaction_id}",
            f"Compensation task {task_id} failed all retries. "
            f"Transaction {transaction_id} owes {amount_str}. "
            f"Manual credit required immediately.",
        )
    except Exception:
        pass

    # And open a ReconciliationCase so the ops dashboard surfaces it.
    if transaction_id:
        try:
            from datetime import timedelta
            from django.utils import timezone
            from .models import ReconciliationCase
            ReconciliationCase.objects.create(
                transaction_id=transaction_id,
                case_type=ReconciliationCase.CaseType.COMPENSATE_FAILED,
                status=ReconciliationCase.Status.OPEN,
                severity=ReconciliationCase.Severity.CRITICAL,
                sla_breach_at=timezone.now() + timedelta(minutes=15),
                correlation_id=str(task_id),
                evidence={
                    "amount": amount_str,
                    "celery_task_id": task_id,
                    "exception_type": type(exception).__name__ if exception else None,
                    "exception": str(exception) if exception else None,
                },
            )
        except Exception:
            pass


# ── Daily reconciliation sweep ────────────────────────────────────────
#
# Industry SLO for double-settlement detection is 5 min (Wise, Adyen).
# Open cases past their `sla_breach_at` get escalated · severity bumped
# to CRITICAL, ESCALATED status, PagerDuty webhook (when wired).
#
# Uses `SELECT FOR UPDATE SKIP LOCKED` so a manually-running ops query
# doesn't deadlock the sweep. Combined with `pg_try_advisory_xact_lock`
# per case to serialise across workers · the lock is xact-scoped so
# auto-released on commit.

@shared_task(name="apps.payments.tasks.sweep_reconciliation_cases")
def sweep_reconciliation_cases():
    """Daily 02:00 EAT · escalate breached cases, alert ops."""
    from django.db import connection, transaction as db_transaction
    from django.utils import timezone

    from .models import ReconciliationCase

    now = timezone.now()
    breach_lock_namespace = 0xFEEDFACE
    escalated_count = 0

    # Iterator + atomic per row keeps the working set small and avoids
    # locking the entire OPEN queue while we work.
    breached_qs = (
        ReconciliationCase.objects
        .filter(status=ReconciliationCase.Status.OPEN)
        .filter(sla_breach_at__lte=now)
        .order_by("detected_at")
    )

    for case in breached_qs.iterator(chunk_size=100):
        try:
            with db_transaction.atomic():
                with connection.cursor() as cur:
                    cur.execute(
                        "SELECT pg_try_advisory_xact_lock((%s)::bigint << 32 | (hashtext(%s) & 2147483647))",
                        [breach_lock_namespace, str(case.id)],
                    )
                    if not cur.fetchone()[0]:
                        # Another worker is on it · skip.
                        continue

                # Re-read inside the lock to defeat TOCTOU.
                fresh = (
                    ReconciliationCase.objects
                    .select_for_update(skip_locked=True)
                    .filter(id=case.id, status=ReconciliationCase.Status.OPEN)
                    .first()
                )
                if not fresh:
                    continue

                fresh.status = ReconciliationCase.Status.ESCALATED
                fresh.severity = max(
                    fresh.severity,
                    ReconciliationCase.Severity.CRITICAL,
                )
                fresh.notes = (fresh.notes or "") + (
                    f"\n[{now.isoformat()}] auto-escalated by sweep "
                    f"(SLA breach at {fresh.sla_breach_at.isoformat()})"
                )
                fresh.save(update_fields=["status", "severity", "notes", "updated_at"])
                escalated_count += 1

                # Best-effort alert · Sentry first (deduped by case id),
                # email second.
                try:
                    import sentry_sdk
                    with sentry_sdk.push_scope() as scope:
                        scope.fingerprint = ["recon_case_escalated", str(fresh.id)]
                        scope.set_tag("case_type", fresh.case_type)
                        scope.set_tag("transaction_id", str(fresh.transaction_id))
                        scope.set_level("error")
                        sentry_sdk.capture_message(
                            f"ReconciliationCase escalated · {fresh.case_type} · {fresh.transaction_id}",
                        )
                except Exception:
                    pass

                try:
                    from apps.core.email import send_admin_alert
                    send_admin_alert(
                        f"Recon escalated: {fresh.get_case_type_display()} · tx {fresh.transaction_id}",
                        f"Case {fresh.id} ({fresh.case_type}) breached its 5-min SLA. "
                        f"Transaction: {fresh.transaction_id}. "
                        f"Severity: {fresh.severity}. "
                        f"Evidence: {fresh.evidence}",
                    )
                except Exception:
                    pass
        except Exception as e:
            logger.exception(
                "sweep_reconciliation_cases.escalate_failed",
                extra={"case_id": str(case.id), "error": str(e)},
            )

    logger.info(
        "sweep_reconciliation_cases.done",
        extra={
            "escalated": escalated_count,
            "checked_at": now.isoformat(),
        },
    )
    return {"escalated": escalated_count, "checked_at": now.isoformat()}


@shared_task
def check_pending_mpesa_payments():
    """
    Check for M-Pesa payments stuck in 'confirming' status.
    If no callback received within 60s, query Transaction Status API.
    After 10 minutes, auto-compensate to return user funds.
    Run every 30 seconds via Celery Beat.
    """
    from datetime import timedelta

    from django.conf import settings as app_settings
    from django.utils import timezone

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

    provider = getattr(app_settings, "PAYMENT_PROVIDER", "daraja")

    for tx in stuck:
        conversation_id = tx.saga_data.get("mpesa_conversation_id", "")
        if not conversation_id:
            continue

        # Try querying transaction status (Daraja only — SasaPay uses callbacks)
        if provider != "sasapay":
            try:
                from apps.mpesa.client import MpesaClient
                client = MpesaClient()
                result = client.transaction_status(conversation_id)
                logger.info(f"Status query for tx {tx.id}: {result}")
            except Exception as e:
                logger.error(f"Status query failed for tx {tx.id}: {e}")
        else:
            # SasaPay relies on callbacks — log that we're waiting
            logger.debug(f"SasaPay tx {tx.id} pending callback (no status query API)")

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
                # B23: stamp the compensation timestamp in saga_data so that
                # if a late SUCCESS callback arrives, complete() can detect
                # the double-settlement window and page ops.
                tx.refresh_from_db(fields=["saga_data"])
                saga_data = tx.saga_data or {}
                saga_data["compensated_at"] = timezone.now().isoformat()
                tx.saga_data = saga_data
                tx.save(update_fields=["saga_data", "updated_at"])
                logger.info(f"Compensated stuck tx {tx.id} · crypto returned to user")
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
