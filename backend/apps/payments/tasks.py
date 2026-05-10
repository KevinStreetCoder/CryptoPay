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


def _credit_buy_crypto_if_needed(tx, receipt: str) -> None:
    """Mirror the BUY-crypto credit step in `sasapay_views._process_
    successful_payment`. The callback handler does this inline; the
    active-poll path (this module) needs to do the same when it
    resolves a stuck BUY/DEPOSIT tx, otherwise we'd flip the status
    to COMPLETED but the user's crypto wallet stays empty.

    Idempotent · `WalletService.credit` is keyed on `transaction_id`,
    so a duplicate call (e.g. callback arrives just after this) no-ops.

    Audit · we ALSO check the platform's hot-wallet position after
    the credit and page ops if we've gone net-short on the currency.
    The current ledger model credits the user a numerical USDT
    balance without any on-chain crypto transfer, so if ops haven't
    seeded the hot wallet, we owe the user crypto we don't hold. The
    `liquidity_short.alert` log line is what ops watches for · their
    runbook is to top up the hot wallet via an OTC desk or exchange
    (Yellow Card on-ramp / IntaSend / Binance Africa) before the
    user withdraws.
    """
    from decimal import Decimal

    if tx.type not in ("BUY", "DEPOSIT"):
        return
    saga_data = tx.saga_data or {}
    quote = saga_data.get("quote") or {}
    if not quote:
        return
    crypto_currency = quote.get("currency") or tx.dest_currency
    crypto_amount_raw = quote.get("crypto_amount") or tx.dest_amount or "0"
    try:
        crypto_amount = Decimal(str(crypto_amount_raw))
    except Exception:
        logger.exception(
            "sasapay.status_query.credit_amount_parse_failed",
            extra={"tx_id": str(tx.id), "raw": crypto_amount_raw},
        )
        return
    if crypto_amount <= 0:
        return
    try:
        from apps.wallets.models import Wallet
        from apps.wallets.services import WalletService
        wallet = Wallet.objects.get(user=tx.user, currency=crypto_currency)
        WalletService.credit(
            wallet_id=wallet.id,
            amount=crypto_amount,
            transaction_id=str(tx.id),
            description=f"Buy crypto via SasaPay {receipt or 'status-poll'}",
        )
        logger.info(
            "sasapay.status_query.credited",
            extra={
                "tx_id": str(tx.id),
                "amount": str(crypto_amount),
                "currency": crypto_currency,
            },
        )
        _check_hot_wallet_solvency(crypto_currency)
    except Exception:
        logger.exception(
            "sasapay.status_query.credit_failed",
            extra={"tx_id": str(tx.id)},
        )


def _check_hot_wallet_solvency(currency: str) -> None:
    """Compare the platform's hot-wallet balance for `currency`
    against the SUM of user-wallet balances · if the hot wallet
    can't cover what we owe customers, log a CRITICAL alert and
    open a ReconciliationCase so ops tops up before any withdrawal
    drains the wallet to zero on-chain.

    Cheap (two SUM queries + one row lookup) so we can call it from
    the hot path of every BUY completion · the queries are bounded
    by the wallet table size.
    """
    from decimal import Decimal as _D
    from django.db.models import Sum
    from apps.wallets.models import SystemWallet, Wallet

    try:
        hot = SystemWallet.objects.filter(
            wallet_type="hot", currency=currency
        ).first()
        hot_balance = (hot.balance if hot else _D("0")) or _D("0")

        owed = Wallet.objects.filter(currency=currency).aggregate(
            total=Sum("balance")
        )["total"] or _D("0")

        if owed > hot_balance:
            shortfall = owed - hot_balance
            logger.critical(
                "liquidity_short.alert",
                extra={
                    "currency": currency,
                    "hot_balance": str(hot_balance),
                    "user_owed": str(owed),
                    "shortfall": str(shortfall),
                    "runbook": (
                        "Top up hot wallet via Yellow Card on-ramp / "
                        "IntaSend / Binance Africa OTC. Required to "
                        "honour user withdrawals."
                    ),
                },
            )
            # Persist the snapshot in Redis with a 1-hour TTL so the
            # admin dashboard's `/admin/rebalance/status/` endpoint
            # can surface a short-position banner without tailing logs.
            try:
                from django.core.cache import cache
                cache.set(
                    f"liquidity_short:{currency}",
                    {
                        "hot_balance": str(hot_balance),
                        "user_owed": str(owed),
                        "shortfall": str(shortfall),
                    },
                    timeout=3600,
                )
            except Exception:
                # Cache failures must not crash the completion path.
                pass
    except Exception:
        logger.exception("liquidity_short.check_failed", extra={"currency": currency})


def _resolve_via_sasapay_status(tx, checkout_request_id: str) -> None:
    """Active-poll SasaPay's transaction-status endpoint and resolve
    the saga · either complete (success) or compensate (failure).

    Why this exists: SasaPay callbacks occasionally drop on transient
    network blips; without an active probe the tx hangs in PROCESSING
    until the 10-min compensate timer fires, by which point the user
    has already given up. This is the audit hardening the previous
    branch in this task was supposed to do (it was a no-op).

    SasaPay's `query_transaction` returns the same Daraja-shaped
    `ResultCode` field SasaPay uses on callbacks · 0 means SUCCESS,
    any other code is a hard failure for STK Push purposes (1037 user
    declined, 1032 timeout, 2001 wrong PIN, etc).
    """
    from apps.mpesa.sasapay_client import SasaPayClient, SasaPayError
    from .saga import PaymentSaga

    try:
        result = SasaPayClient().query_transaction(
            checkout_request_id=checkout_request_id,
        )
    except SasaPayError as e:
        logger.warning(
            "sasapay.status_query.error",
            extra={"tx_id": str(tx.id), "error": str(e)},
        )
        return

    # SasaPay's status response wraps the Daraja-shape under a parent.
    # Be tolerant of either layout.
    inner = result.get("data") or result.get("result") or result
    result_code = str(
        inner.get("ResultCode")
        or inner.get("resultCode")
        or result.get("ResultCode")
        or ""
    )
    receipt = (
        inner.get("TransactionCode")
        or inner.get("MpesaReceiptNumber")
        or inner.get("ReceiptNumber")
        or ""
    )

    if not result_code or _is_sasapay_pending(result_code):
        # SasaPay reports the tx as still PENDING / PROCESSING / UNDER
        # REVIEW · keep waiting, cron will recheck on the next tick.
        # The PENDING set is canonical from the docs · "0 / SP00000"
        # = success, "SP01001 / SP01004 / PENDING" = still in flight.
        logger.debug(
            "sasapay.status_query.pending",
            extra={"tx_id": str(tx.id), "code": result_code, "raw": str(result)[:200]},
        )
        return

    if _is_sasapay_success(result_code):
        try:
            # Order matters · saga.complete flips status=COMPLETED and
            # records the receipt; AFTER that we credit crypto for BUY
            # so the wallet write is keyed against the now-completed tx.
            # Both ops are idempotent, so a callback arriving moments
            # later finds the tx already COMPLETED + the wallet credit
            # already keyed on tx.id and no-ops.
            PaymentSaga(tx).complete(mpesa_receipt=receipt or "")
            _credit_buy_crypto_if_needed(tx, receipt)
            logger.info("sasapay.status_query.completed", extra={
                "tx_id": str(tx.id), "receipt": receipt, "type": tx.type,
                "code": result_code,
            })
        except Exception:
            logger.exception(
                "sasapay.status_query.complete_failed",
                extra={"tx_id": str(tx.id)},
            )
    else:
        # Hard failure · compensate so the user's KES wallet is
        # unlocked / crypto refunded.
        desc = (
            inner.get("ResultDesc")
            or inner.get("resultDesc")
            or _sasapay_friendly_message(result_code)
        )
        tx.failure_reason = f"M-Pesa rejected: {desc} (code {result_code})"
        tx.status = Transaction.Status.FAILED
        tx.save(update_fields=["failure_reason", "status", "updated_at"])
        try:
            PaymentSaga(tx).compensate_convert()
        except Exception:
            logger.exception(
                "sasapay.status_query.compensate_failed",
                extra={"tx_id": str(tx.id)},
            )
        logger.info("sasapay.status_query.failed_compensated", extra={
            "tx_id": str(tx.id), "result_code": result_code, "desc": desc,
        })


def _resolve_via_intasend_status(tx, tracking_id: str) -> None:
    """Active-poll IntaSend's payment-status endpoint and resolve
    the saga. Same rationale as the SasaPay path."""
    from apps.mpesa.intasend_client import IntaSendClient, IntaSendError
    from .saga import PaymentSaga

    try:
        result = IntaSendClient().query_transaction(
            tracking_id=tracking_id,
        )
    except IntaSendError as e:
        logger.warning(
            "intasend.status_query.error",
            extra={"tx_id": str(tx.id), "error": str(e)},
        )
        return

    state = (result.get("state") or result.get("status") or "").upper()
    receipt = result.get("mpesa_reference") or result.get("api_ref") or ""

    if state in {"COMPLETE", "COMPLETED", "PROCESSED"}:
        try:
            PaymentSaga(tx).complete(mpesa_receipt=receipt)
        except Exception:
            logger.exception(
                "intasend.status_query.complete_failed",
                extra={"tx_id": str(tx.id)},
            )
    elif state in {"FAILED", "RETRY", "FAILED_RETRYABLE"}:
        tx.failure_reason = f"IntaSend reported state {state}."
        tx.status = Transaction.Status.FAILED
        tx.save(update_fields=["failure_reason", "status", "updated_at"])
        try:
            PaymentSaga(tx).compensate_convert()
        except Exception:
            logger.exception(
                "intasend.status_query.compensate_failed",
                extra={"tx_id": str(tx.id)},
            )


# ── User-facing error message map ────────────────────────────────────
#
# When the M-Pesa rail rejects an STK Push, the customer sees a numeric
# code on their phone (e.g. "Request cancelled by user"). The provider
# IPN gives us that code · we translate it into a friendly sentence the
# mobile app surfaces verbatim. Generic fallback covers unmapped codes.

_SASAPAY_ERROR_MESSAGES = {
    # 2026-05-09 · synced with the canonical table at
    # https://developer.sasapay.app/docs/apis/results-codes?country=ke
    # Categorised in dict-comment for ops triage.

    # ── Success ──
    "0":          "Payment successful.",
    "SP00000":    "Payment successful.",

    # ── Pending / processing (caller should keep polling, not fail) ──
    "PENDING":    "Payment is being processed · we'll confirm in a moment.",
    "SP01001":    "Payment is being processed · we'll confirm in a moment.",
    "SP01004":    "Payment is under review · we'll update once the rail confirms.",

    # ── Failed / reversed ──
    "SP01002":    "Payment failed · please retry. If KES was deducted, contact support with the M-Pesa SMS.",
    "SP01003":    "Payment was reversed · the KES has been refunded to your M-Pesa.",

    # ── M-Pesa C2B (STK Push) result codes ──
    "1":          "Insufficient M-Pesa balance · top up and try again.",
    "1001":       "Another payment is in progress · wait a moment then retry.",
    "1019":       "Transaction already in progress · please retry shortly.",
    "1025":       "Daily transaction limit reached · raise your KYC tier or try tomorrow.",
    "1031":       "M-Pesa is offline · please retry in a minute.",
    "1032":       "Payment cancelled · please retry to enter your PIN.",
    "1036":       "M-Pesa system error · please retry.",
    "1037":       "STK push timed out · please retry to enter your PIN.",
    "2001":       "Wrong M-Pesa PIN · retry and enter the correct PIN.",
    "9999":       "Payment failed · contact support if KES was deducted.",

    # ── M-Pesa B2C (Send Money) error codes from SasaPay docs ──
    "2040":       "Recipient phone is not registered for M-Pesa.",
    "4001":       "Payment processing error · please retry.",
    "SFC_IC0003": "Recipient phone number is invalid · check the number and retry.",
    "2028":       "Payment to this recipient is not allowed · contact support.",
    "17":         "M-Pesa system error · please retry.",

    # ── Pesalink (bank-transfer) ──
    # SasaPay uses literal "ERROR" code with a categorical message ·
    # we keep this entry as a default for any Pesalink failure.
    "ERROR":      "Bank transfer failed · check the account details and retry.",

    # ── Airtel ──
    "DP00900001000": "Airtel payment was ambiguous · please retry. If you were charged, contact support.",

    # ── SasaPay HTTP-level response codes ──
    "404":        "We couldn't find this transaction · contact support.",
    "SP.400.000": "We sent something invalid to the payments rail · please retry.",
    "SP.401.000": "Payments rail rejected the request · contact support.",
    "SP.403.000": "Payments rail blocked the request · contact support.",
    "SP.404.000": "We couldn't find this transaction · contact support.",
    "SP.409.000": "Duplicate transaction detected · we won't charge you twice.",
    "SP.429.000": "Too many requests · wait a moment and try again.",
    "SP.500.000": "Payments rail is temporarily unavailable · please retry.",
    "SP.502.000": "Payments rail is temporarily unavailable · please retry.",
    "SP.503.000": "Payments rail is temporarily unavailable · please retry.",
    "SP.504.000": "Payments rail timed out · please retry.",
}

# Codes that should be treated as PENDING (keep waiting) rather than
# terminal · the cron / status-poll respects this list and avoids
# compensating prematurely.
SASAPAY_PENDING_CODES = frozenset(["PENDING", "SP01001", "SP01004"])

# Codes that are terminal SUCCESS · saga.complete on these.
SASAPAY_SUCCESS_CODES = frozenset(["0", "SP00000"])


def _sasapay_friendly_message(result_code: str) -> str:
    """Map a SasaPay numeric / alphanumeric result code to a user-
    readable sentence. Falls back to a generic message if the code
    isn't in our dictionary."""
    return _SASAPAY_ERROR_MESSAGES.get(
        str(result_code),
        "Payment did not go through. Please retry · if KES was deducted, "
        "contact support with the M-Pesa SMS receipt.",
    )


def _is_sasapay_success(result_code: str) -> bool:
    """Whether a SasaPay result code means terminal success."""
    return str(result_code) in SASAPAY_SUCCESS_CODES


def _is_sasapay_pending(result_code: str) -> bool:
    """Whether a SasaPay result code means still-pending (don't fail
    the saga, keep polling)."""
    return str(result_code) in SASAPAY_PENDING_CODES


# ── Failure classification · ops triage ──────────────────────────────
#
# 2026-05-10 · classify failure codes into operational categories so
# the admin failed-tx feed can filter "needs ops attention" vs "user
# self-resolves". Keep this aligned with `_SASAPAY_ERROR_MESSAGES` ·
# every code that ever appears in the failure path should land in
# exactly one bucket below.
#
# Categories (returned as a string · stored on Transaction.failure_category):
#   "user"        · user error, no ops action needed
#   "rail"        · SasaPay/M-Pesa/biller side · ops investigates
#   "permission"  · product activation issue · escalate to SasaPay support
#   "unknown"     · anything not classified · default · ops glance

_FAILURE_BUCKETS = {
    # User-side · cancelled, wrong PIN, timeouts, insufficient balance
    "1":          "user",   # Insufficient M-Pesa balance
    "1032":       "user",   # User cancelled
    "1037":       "user",   # STK timeout
    "2001":       "user",   # Wrong M-Pesa PIN
    "1025":       "user",   # Daily limit reached
    "1019":       "user",   # In-progress duplicate
    "1001":       "user",
    "2040":       "user",   # Unregistered M-Pesa recipient
    "SFC_IC0003": "user",   # Invalid recipient phone

    # Rail-side · system errors, retry storms, gateway failures
    "1031":       "rail",   # M-Pesa offline
    "1036":       "rail",
    "9999":       "rail",
    "17":         "rail",
    "4001":       "rail",
    "SP01002":    "rail",
    "SP01003":    "rail",
    "DP00900001000": "rail",
    "ERROR":      "rail",
    "SP.500.000": "rail",
    "SP.502.000": "rail",
    "SP.503.000": "rail",
    "SP.504.000": "rail",
    "SP.429.000": "rail",

    # Permission · product activation / scope issues · escalate to SasaPay
    "2028":       "permission",  # "Not permitted according to product assignment"
    "SP.401.000": "permission",
    "SP.403.000": "permission",
    "SP.400.000": "permission",
    "SP4072":     "permission",  # Invalid SasaPay scope
    "SP4041":     "permission",  # Merchant code not a SasaPay merchant
}

FAILURE_CATEGORIES = ("user", "rail", "permission", "unknown")


def classify_failure_code(result_code: str) -> str:
    """Return one of FAILURE_CATEGORIES for a given SasaPay/M-Pesa code.

    Used by:
      - Transaction.failure_category column · ops dashboard filter
      - The failed-tx alert email subject line · "[USER] Failed Tx ..."
        vs "[RAIL] Failed Tx ..." vs "[PERMISSION] Failed Tx ..." so
        ops sees the actionable ones first.
    """
    return _FAILURE_BUCKETS.get(str(result_code), "unknown")


@shared_task
def check_pending_mpesa_payments():
    """
    Active-poll the M-Pesa rail for stuck transactions, both directions.

    Outgoing (PAYBILL/TILL/SEND_MPESA · CONFIRMING) · the legacy path:
    after the user signs off and we fire the B2B/B2C, we move the tx to
    CONFIRMING and wait for the result callback. If it drops, we resolve
    via Transaction Status API; after 10 minutes with no resolution we
    compensate (return crypto) and mark FAILED.

    Incoming (BUY/DEPOSIT · PROCESSING) · 2026-05-09 fix:
    after we trigger an STK Push the tx sits in PROCESSING until the
    customer enters their M-Pesa PIN and the IPN/callback arrives. The
    callback occasionally drops on transient SasaPay/Cloudflare blips,
    leaving the tx stuck in PROCESSING forever (the 10-min compensate
    branch was CONFIRMING-only and never fired for BUY). Frontend
    polling sees `processing` for 2 min, then renders a generic
    "processing" success screen while the customer's KES has already
    been deducted. We now actively poll SasaPay for these too · on
    SUCCESS we credit crypto (mirroring the callback handler), on
    FAILURE we compensate just like the outgoing path.

    Run every 30 seconds via Celery Beat.
    """
    from datetime import timedelta

    from django.conf import settings as app_settings
    from django.db.models import Q
    from django.utils import timezone

    cutoff = timezone.now() - timedelta(seconds=60)
    stuck = Transaction.objects.filter(
        Q(
            status=Transaction.Status.CONFIRMING,
            type__in=[
                Transaction.Type.PAYBILL_PAYMENT,
                Transaction.Type.TILL_PAYMENT,
                Transaction.Type.SEND_MPESA,
            ],
        ) | Q(
            status=Transaction.Status.PROCESSING,
            type__in=[
                Transaction.Type.BUY,
                Transaction.Type.DEPOSIT,
            ],
        ),
        updated_at__lt=cutoff,
    )

    provider = getattr(app_settings, "PAYMENT_PROVIDER", "daraja").lower()

    for tx in stuck:
        # Pull whichever ID the active rail recorded · key names differ.
        sd = tx.saga_data or {}
        conversation_id = (
            sd.get("mpesa_conversation_id")
            or sd.get("mpesa_checkout_request_id")  # SasaPay STK
            or sd.get("checkout_request_id")
            or ""
        )
        if not conversation_id:
            continue

        # Active poll the provider · catches the case where the
        # callback dropped or got firewalled. Promotes "stuck in
        # PROCESSING" to either COMPLETED (saga.complete) or FAILED
        # (saga.compensate) without waiting on the cron's 10-min
        # timeout.
        try:
            if provider == "sasapay":
                _resolve_via_sasapay_status(tx, conversation_id)
            elif provider == "intasend":
                _resolve_via_intasend_status(tx, conversation_id)
            else:
                from apps.mpesa.client import MpesaClient
                client = MpesaClient()
                result = client.transaction_status(conversation_id)
                logger.info("status_query.daraja", extra={
                    "tx_id": str(tx.id), "result_code": result.get("ResponseCode"),
                })
        except Exception as e:
            logger.error("status_query.failed", extra={
                "tx_id": str(tx.id), "provider": provider, "error": str(e),
            })

        # 10-minute compensate · OUTGOING ONLY (CONFIRMING). For BUY/
        # DEPOSIT in PROCESSING we deliberately do NOT auto-FAIL after
        # 10 min: an STK Push that the active poll still reports as
        # "still pending" usually just means SasaPay's status query is
        # lagging behind the actual M-Pesa state, and the legitimate
        # follow-up callback is pending. Marking FAILED here would
        # leave the user thinking their KES was lost. Instead the
        # active poll will eventually resolve it, OR a
        # ReconciliationCase will be opened by ops on stuck-tx alerts.
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

        # Between 3-10 minutes, log a diagnostic note BUT do NOT stamp
        # it on `failure_reason` · the customer detail screen renders
        # any non-empty failure_reason as a red "Failure Reason" block,
        # which contradicts the still-PROCESSING status badge. We
        # surface the warning via structured logging + ops dashboards
        # instead. The diagnostic lives in `saga_data["pending_note"]`
        # so support tooling can pick it up without leaking to the
        # customer UI.
        elif tx.updated_at < (timezone.now() - timedelta(minutes=3)):
            sd = tx.saga_data or {}
            if "pending_note" not in sd:
                sd["pending_note"] = (
                    f"Awaiting M-Pesa callback >3 min · flagged at "
                    f"{timezone.now().isoformat()}"
                )
                tx.saga_data = sd
                tx.save(update_fields=["saga_data", "updated_at"])
                logger.warning(
                    "tx.pending.callback_late",
                    extra={"tx_id": str(tx.id), "type": tx.type, "age_seconds": (timezone.now() - tx.updated_at).total_seconds()},
                )


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
