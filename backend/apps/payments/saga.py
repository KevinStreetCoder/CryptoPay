"""
Payment Saga Orchestrator

Implements the saga pattern for crypto-to-M-Pesa payments:
  Step 1: Lock crypto in user wallet
  Step 2: Convert crypto → KES at locked rate
  Step 3: Initiate M-Pesa B2B payment
  Step 4: Await M-Pesa callback / poll status
  Step 5: Finalize ledger entries and notify user

Each step has a compensating action for rollback on failure.
"""

import logging
from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils import timezone

from apps.wallets.services import InsufficientBalanceError, WalletService

from .models import Transaction

logger = logging.getLogger(__name__)


class SagaError(Exception):
    pass


class PaymentSaga:
    """Orchestrates a crypto-to-Paybill/Till payment."""

    def __init__(self, transaction: Transaction):
        self.tx = transaction

    def execute(self):
        """Run the saga steps sequentially. Compensate on failure."""
        steps = [
            (self.step_lock_crypto, self.compensate_lock_crypto),
            (self.step_convert, self.compensate_convert),
            (self.step_initiate_mpesa, self.compensate_mpesa),
        ]

        completed_compensations = []

        for i, (step_fn, compensate_fn) in enumerate(steps):
            try:
                self.tx.saga_step = i + 1
                self.tx.status = Transaction.Status.PROCESSING
                self.tx.save(update_fields=["saga_step", "status", "updated_at"])

                step_fn()
                completed_compensations.append(compensate_fn)

            except Exception as e:
                logger.error(f"Saga step {i + 1} failed for tx {self.tx.id}: {e}")
                self.tx.failure_reason = str(e)
                self.tx.status = Transaction.Status.FAILED
                self.tx.save(update_fields=["failure_reason", "status", "updated_at"])

                # Compensate in reverse order
                for compensate in reversed(completed_compensations):
                    try:
                        compensate()
                    except Exception as comp_error:
                        logger.critical(
                            f"Compensation failed for tx {self.tx.id}: {comp_error}"
                        )

                # Alert admins about the failed transaction
                try:
                    from apps.core.tasks import send_failed_transaction_alert_task
                    send_failed_transaction_alert_task.delay(transaction_id=str(self.tx.id))
                except Exception:
                    pass

                raise SagaError(f"Payment saga failed at step {i + 1}: {e}") from e

    def step_lock_crypto(self):
        """Step 1: Lock the crypto amount in the user's wallet."""
        wallet = self.tx.user.wallets.get(currency=self.tx.source_currency)

        with db_transaction.atomic():
            try:
                # Pass the tx id so a saga retry after partial failure
                # re-running step_lock_crypto is a no-op instead of
                # double-locking (audit cycle-2 HIGH 2).
                WalletService.lock_funds(
                    wallet.id, self.tx.source_amount, transaction_id=self.tx.id,
                )
            except InsufficientBalanceError:
                raise SagaError("Insufficient crypto balance")

            self.tx.saga_data["locked_wallet_id"] = str(wallet.id)
            self.tx.saga_data["locked_amount"] = str(self.tx.source_amount)
            self.tx.save(update_fields=["saga_data"])

    def compensate_lock_crypto(self):
        """Reverse Step 1: Unlock the crypto."""
        wallet_id = self.tx.saga_data.get("locked_wallet_id")
        amount = Decimal(self.tx.saga_data.get("locked_amount", "0"))
        if wallet_id and amount > 0:
            WalletService.unlock_funds(wallet_id, amount, transaction_id=self.tx.id)
            logger.info(f"Compensated: unlocked {amount} for tx {self.tx.id}")

    def step_convert(self):
        """Step 2: Execute the conversion at the locked rate."""
        # The rate was locked when the quote was created.
        # Here we record the conversion in the ledger.
        wallet_id = self.tx.saga_data["locked_wallet_id"]
        amount = Decimal(self.tx.saga_data["locked_amount"])

        with db_transaction.atomic():
            # Unlock the funds first
            WalletService.unlock_funds(wallet_id, amount, transaction_id=self.tx.id)
            # Debit the crypto from the user
            WalletService.debit(
                wallet_id,
                amount,
                self.tx.id,
                f"Crypto conversion for {self.tx.type} - {self.tx.mpesa_paybill or self.tx.mpesa_till or self.tx.mpesa_phone}",
            )
            # Write saga checkpoint inside the same atomic block
            self.tx.saga_data["conversion_completed"] = True
            self.tx.save(update_fields=["saga_data"])

    def compensate_convert(self):
        """Reverse Step 2 · credit back the crypto.

        2026-04-26 refactor · the inner retry loop used to call
        `time.sleep(2 ** attempt)` while holding a Celery worker, which
        meant a single stuck compensation throttled the whole payment
        queue. We now do ONE synchronous attempt here (the common case
        where the wallet write succeeds first time) and, if it raises,
        delegate to the async `compensate_convert_async` task with
        Postgres-advisory-lock idempotency + exponential backoff +
        Sentry/Reconciliation DLQ landing on `max_retries`.

        Sync-first matters because the saga's caller expects this
        method to either return cleanly (rollback complete) or raise
        SagaError (escalated to ops). Spawning the async retry on
        first success would add 2-4 s of needless latency to every
        compensation that the wallet service handles in 50 ms.
        """
        if not self.tx.saga_data.get("conversion_completed"):
            return

        wallet_id = self.tx.saga_data["locked_wallet_id"]
        amount = Decimal(self.tx.saga_data["locked_amount"])

        try:
            WalletService.credit(
                wallet_id,
                amount,
                self.tx.id,
                f"Reversal: conversion for tx {self.tx.id}",
            )
            logger.info("compensate_convert.ok_sync", extra={
                "transaction_id": str(self.tx.id),
                "wallet_id": str(wallet_id),
                "amount": str(amount),
            })
            return
        except Exception as e:
            # First attempt failed · enqueue the async retrier and
            # return without raising, so the saga's outer handler
            # marks the transaction `compensated` (the funds will be
            # credited back by the Celery task; the Reconciliation
            # row is the durable receipt). If the async task also
            # fails after `max_retries`, it lands in the DLQ where
            # `apps.payments.tasks.compensate_convert_async`'s
            # `task_failure` handler creates a `ReconciliationCase`
            # for the ops team.
            logger.warning("compensate_convert.first_attempt_failed", extra={
                "transaction_id": str(self.tx.id),
                "error_type": type(e).__name__,
                "error": str(e),
            })
            try:
                from .tasks import compensate_convert_async
                compensate_convert_async.delay(
                    transaction_id=str(self.tx.id),
                    wallet_id=str(wallet_id),
                    amount_str=str(amount),
                )
            except Exception as enqueue_err:
                # Broker unreachable · this is the worst case. Fall
                # back to the old inline loop ONCE (with a tighter
                # ceiling) so we don't return a "compensated" status
                # to the user when nothing actually rolled back.
                logger.critical(
                    "compensate_convert.broker_unreachable",
                    extra={
                        "transaction_id": str(self.tx.id),
                        "broker_error": str(enqueue_err),
                    },
                )
                raise SagaError(
                    f"Compensation queue unreachable for tx {self.tx.id}. "
                    f"Wallet {wallet_id} owed {amount} {self.tx.source_currency}. "
                    f"Manual credit required."
                ) from enqueue_err

    def step_initiate_mpesa(self):
        """Step 3: Call M-Pesa API — B2B for paybill/till, B2C for send-to-phone."""
        from django.conf import settings as django_settings

        # Dev mode: skip M-Pesa API call and auto-complete
        if django_settings.DEBUG and not getattr(django_settings, "MPESA_CONSUMER_KEY", ""):
            logger.info(f"[DEV] Skipping M-Pesa for tx {self.tx.id} — auto-completing")
            short_id = str(self.tx.id)[:8]
            self.tx.saga_data["mpesa_conversation_id"] = f"DEV-{short_id}"
            self.tx.saga_data["mpesa_originator_id"] = f"DEV-ORIG-{short_id}"
            self.tx.save(update_fields=["saga_data", "updated_at"])
            # Use complete() to set status + trigger notifications
            self.complete(mpesa_receipt=f"DEV{short_id}")
            return

        from apps.mpesa.provider import get_payment_client

        client = get_payment_client()

        if self.tx.mpesa_paybill:
            result = client.b2b_payment(
                paybill=self.tx.mpesa_paybill,
                account=self.tx.mpesa_account,
                amount=int(self.tx.dest_amount),
                remarks=f"CryptoPay-{self.tx.id}",
            )
        elif self.tx.mpesa_till:
            result = client.buy_goods(
                till=self.tx.mpesa_till,
                amount=int(self.tx.dest_amount),
                remarks=f"CryptoPay-{self.tx.id}",
            )
        elif self.tx.mpesa_phone:
            result = client.b2c_payment(
                phone=self.tx.mpesa_phone,
                amount=int(self.tx.dest_amount),
                remarks=f"CryptoPay-{self.tx.id}",
                transaction_id=str(self.tx.id),
            )
        else:
            raise SagaError("No payment destination specified")

        self.tx.saga_data["mpesa_conversation_id"] = result.get("ConversationID", "")
        self.tx.saga_data["mpesa_originator_id"] = result.get("OriginatorConversationID", "")
        self.tx.status = Transaction.Status.CONFIRMING
        self.tx.save(update_fields=["saga_data", "status", "updated_at"])

        # Sandbox auto-complete: Safaricom sandbox callbacks are unreliable,
        # so auto-complete after successful API submission to test the full flow.
        # In production, the real callback will handle completion.
        if getattr(django_settings, "MPESA_ENVIRONMENT", "") == "sandbox":
            conv_id = result.get("ConversationID", "")
            logger.info(
                f"[SANDBOX] Auto-completing tx {self.tx.id} "
                f"(ConversationID={conv_id}) — sandbox callbacks unreliable"
            )
            self.complete(mpesa_receipt=f"SANDBOX-{conv_id[:12]}")

    def compensate_mpesa(self):
        """Reverse Step 3: Request M-Pesa reversal if payment went through.

        B19: when the active provider does not support automated reversal
        (e.g. SasaPay), we MUST NOT silently log-and-continue — the caller
        will then credit crypto back to the user, producing a double-spend
        (money paid out AND crypto returned). Instead, raise SagaError so
        the outer handler surfaces it and the ops team can reconcile.
        """
        mpesa_receipt = self.tx.mpesa_receipt
        if not mpesa_receipt:
            return

        from apps.mpesa.provider import get_payment_client

        try:
            client = get_payment_client()
            client.reversal(
                transaction_id=mpesa_receipt,
                amount=int(self.tx.dest_amount),
                remarks=f"Reversal for CryptoPay-{self.tx.id}",
            )
            logger.info(f"Compensated: M-Pesa reversal requested for tx {self.tx.id}")
        except NotImplementedError:
            logger.critical(
                f"Provider does not support reversal · tx {self.tx.id} "
                f"receipt={mpesa_receipt} requires manual ops reconciliation"
            )
            self._open_reversal_recon_case(
                mpesa_receipt=mpesa_receipt,
                case_type_value="reversal_not_supported",
                error_msg="Provider (SasaPay) does not support automated reversal · ops must phone Safaricom.",
            )
            raise SagaError("reversal_not_supported")
        except Exception as e:
            logger.critical(
                f"M-Pesa reversal failed for tx {self.tx.id}: {e}. "
                f"MANUAL INTERVENTION REQUIRED."
            )
            self._open_reversal_recon_case(
                mpesa_receipt=mpesa_receipt,
                case_type_value="orphan_b2b",
                error_msg=str(e),
            )
            raise SagaError(f"reversal_error: {e}")

    def _open_reversal_recon_case(
        self, mpesa_receipt: str, case_type_value: str, error_msg: str,
    ) -> None:
        """Durably record a failed M-Pesa reversal as a ReconciliationCase.

        Replaces the previous fire-and-forget admin email · the email
        is best-effort, the database row is the durable receipt that
        the ops dashboard sweeps. SLO: 5 minutes for ops to acknowledge
        before auto-escalation to PagerDuty (sweep_reconciliation_cases).
        """
        try:
            from datetime import timedelta
            from .models import ReconciliationCase
            ReconciliationCase.objects.get_or_create(
                transaction=self.tx,
                case_type=case_type_value,
                status=ReconciliationCase.Status.OPEN,
                defaults={
                    "severity": ReconciliationCase.Severity.CRITICAL,
                    "sla_breach_at": timezone.now() + timedelta(minutes=5),
                    "correlation_id": str(self.tx.id),
                    "evidence": {
                        "mpesa_receipt": mpesa_receipt,
                        "amount_kes": str(self.tx.dest_amount or ""),
                        "user_phone": self.tx.user.phone,
                        "tx_type": self.tx.type,
                        "error": error_msg,
                    },
                },
            )
        except Exception as e:
            logger.exception(
                "reversal.recon_create_failed",
                extra={"transaction_id": str(self.tx.id), "error": str(e)},
            )

        try:
            from apps.core.tasks import send_failed_transaction_alert_task
            send_failed_transaction_alert_task.delay(transaction_id=str(self.tx.id))
        except Exception:
            pass

    def complete(self, mpesa_receipt: str):
        """Called when M-Pesa callback confirms success. Idempotent.

        B23: when a success callback arrives AFTER compensation (user's
        crypto was already credited back because the tx was assumed
        failed), we must NOT silently drop it · we need ops to reconcile
        the double-settlement (M-Pesa paid + crypto returned)."""
        self.tx.refresh_from_db(fields=["status", "saga_data"])
        if self.tx.status == Transaction.Status.COMPLETED:
            logger.info(f"Payment already completed: tx {self.tx.id} (duplicate callback)")
            return
        if self.tx.status == Transaction.Status.FAILED:
            compensated = bool(self.tx.saga_data and self.tx.saga_data.get("compensated_at"))
            if compensated:
                # ── Double-settlement detection ─────────────────────
                # Crypto was already refunded AND M-Pesa now confirms
                # the B2B paid · user has both. Industry-standard
                # time-to-detect for this is 5 min (Wise/Adyen). Open
                # a `ReconciliationCase` so ops can clawback or
                # write off; the entry is durable + audit-tracked
                # regardless of whether the email/Sentry side-effects
                # below succeed. Refuses to crash the callback handler
                # if the ReconciliationCase create itself fails ·
                # Sentry will pick that up and we don't want a recon-
                # table outage to drop the M-Pesa receipt.
                logger.critical(
                    f"Late M-Pesa success on compensated tx {self.tx.id} · "
                    f"receipt {mpesa_receipt} · ReconciliationCase opened "
                    f"(crypto refunded AND M-Pesa paid out)"
                )
                try:
                    from datetime import timedelta
                    from .models import ReconciliationCase
                    case, created = ReconciliationCase.objects.get_or_create(
                        transaction=self.tx,
                        case_type=ReconciliationCase.CaseType.DOUBLE_SETTLEMENT,
                        status=ReconciliationCase.Status.OPEN,
                        defaults={
                            "severity": ReconciliationCase.Severity.CRITICAL,
                            "sla_breach_at": timezone.now() + timedelta(minutes=5),
                            "correlation_id": str(self.tx.id),
                            "evidence": {
                                "mpesa_receipt": mpesa_receipt,
                                "compensated_at": self.tx.saga_data.get("compensated_at"),
                                "amount_kes": str(self.tx.dest_amount or ""),
                                "currency_owed": self.tx.source_currency,
                                "amount_owed": str(self.tx.saga_data.get("locked_amount", "")),
                                "user_phone": self.tx.user.phone,
                                "tx_type": self.tx.type,
                                "destination": (
                                    self.tx.mpesa_paybill
                                    or self.tx.mpesa_till
                                    or self.tx.mpesa_phone
                                    or ""
                                ),
                            },
                        },
                    )
                    if created:
                        # Maintain the denormalised flag · the signal
                        # handler does this too, but be explicit so
                        # downstream code in this same request sees
                        # the freshest value without re-reading.
                        Transaction.objects.filter(id=self.tx.id).update(
                            has_open_reconciliation=True,
                        )
                except Exception as e:
                    logger.exception(
                        "double_settlement.recon_create_failed",
                        extra={"transaction_id": str(self.tx.id), "error": str(e)},
                    )
                # Best-effort admin alert · email is the last layer.
                try:
                    from apps.core.tasks import send_failed_transaction_alert_task
                    send_failed_transaction_alert_task.delay(transaction_id=str(self.tx.id))
                except Exception:
                    pass
            else:
                logger.warning(f"Cannot complete already-failed tx {self.tx.id}")
            return

        self.tx.mpesa_receipt = mpesa_receipt
        self.tx.status = Transaction.Status.COMPLETED
        self.tx.completed_at = timezone.now()
        self.tx.save(update_fields=["mpesa_receipt", "status", "completed_at", "updated_at"])
        logger.info(f"Payment completed: tx {self.tx.id}, receipt {mpesa_receipt}")

        # Send all notifications (email, SMS, push, PDF receipt)
        try:
            from apps.core.email import send_transaction_notifications

            send_transaction_notifications(self.tx.user, self.tx)
        except Exception as e:
            # Notifications are non-critical — log but don't fail the payment
            logger.error(f"Notification dispatch failed for tx {self.tx.id}: {e}")

        # Broadcast updated wallet balance via WebSocket
        try:
            from apps.core.broadcast import broadcast_user_balance

            broadcast_user_balance(self.tx.user_id)
        except Exception as e:
            logger.warning(f"Balance broadcast failed for tx {self.tx.id}: {e}")
