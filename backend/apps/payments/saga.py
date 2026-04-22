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
                WalletService.lock_funds(wallet.id, self.tx.source_amount)
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
            WalletService.unlock_funds(wallet_id, amount)
            logger.info(f"Compensated: unlocked {amount} for tx {self.tx.id}")

    def step_convert(self):
        """Step 2: Execute the conversion at the locked rate."""
        # The rate was locked when the quote was created.
        # Here we record the conversion in the ledger.
        wallet_id = self.tx.saga_data["locked_wallet_id"]
        amount = Decimal(self.tx.saga_data["locked_amount"])

        with db_transaction.atomic():
            # Unlock the funds first
            WalletService.unlock_funds(wallet_id, amount)
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
        """Reverse Step 2: Credit back the crypto with retry logic.

        CRITICAL: If this fails, user permanently loses funds.
        Retries 3 times with exponential backoff before alerting admins.
        """
        if not self.tx.saga_data.get("conversion_completed"):
            return

        wallet_id = self.tx.saga_data["locked_wallet_id"]
        amount = Decimal(self.tx.saga_data["locked_amount"])

        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                WalletService.credit(
                    wallet_id,
                    amount,
                    self.tx.id,
                    f"Reversal: conversion for tx {self.tx.id}",
                )
                logger.info(f"Compensated: reversed conversion for tx {self.tx.id}")
                return
            except Exception as e:
                if attempt < max_retries - 1:
                    wait = 2 ** attempt
                    logger.warning(
                        f"Compensation retry {attempt + 1}/{max_retries} for tx {self.tx.id}: {e}"
                    )
                    time.sleep(wait)
                else:
                    logger.critical(
                        f"COMPENSATION FAILED for tx {self.tx.id}. "
                        f"User {self.tx.user.phone} lost {amount} {self.tx.source_currency}. "
                        f"MANUAL CREDIT REQUIRED."
                    )
                    try:
                        from apps.core.email import send_admin_alert
                        send_admin_alert(
                            f"CRITICAL: Fund loss — compensation failed tx {self.tx.id}",
                            f"User {self.tx.user.phone} lost {amount} {self.tx.source_currency}. "
                            f"Wallet {wallet_id}. Manual credit required immediately.",
                        )
                    except Exception:
                        pass
                    raise SagaError(
                        f"Compensation failed after {max_retries} retries for tx {self.tx.id}. "
                        f"User {self.tx.user.phone} lost {amount} {self.tx.source_currency}."
                    )

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
            try:
                from apps.core.tasks import send_failed_transaction_alert_task
                send_failed_transaction_alert_task.delay(transaction_id=str(self.tx.id))
            except Exception:
                pass
            raise SagaError("reversal_not_supported")
        except Exception as e:
            logger.critical(
                f"M-Pesa reversal failed for tx {self.tx.id}: {e}. "
                f"MANUAL INTERVENTION REQUIRED."
            )
            raise SagaError(f"reversal_error: {e}")

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
                logger.critical(
                    f"Late M-Pesa success on compensated tx {self.tx.id} · "
                    f"receipt {mpesa_receipt} · manual reconciliation required "
                    f"(funds paid out but crypto already refunded)"
                )
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
