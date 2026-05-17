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
            # 2026-05-17 · N2 fix · if `_book_revenue_split` had already
            # credited FEE / PROVIDER_COST / EXCISE SystemWallets (e.g.
            # the callback completed THEN a later anomaly fired
            # compensate_convert), reverse those bookings here so the
            # SystemWallet balances don't drift. Idempotent via the new
            # `WalletService.unbook_fee*` helpers · safe to call even if
            # no booking ever happened.
            self._unbook_revenue_split()
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
        """Step 3: Call M-Pesa API — B2B for paybill/till, B2C for send-to-phone.

        2026-05-09 · ALL auto-complete paths removed (DEV-mode + sandbox
        guard). Removed at user request because they masked real SasaPay
        failures (SP01002 etc.) by stamping a fake `DEV{id}` /
        `SANDBOX-{conv}` receipt and firing notifications BEFORE the
        real callback arrived. Reality: when our SasaPay merchant
        account doesn't have a product activated, the call fails
        synchronously OR the callback returns a non-zero ResultCode ·
        EITHER way the saga must reflect that state, not pretend success.

        Local-dev workflow without a SasaPay account: set
        `PAYMENT_PROVIDER=stub` (a future provider that mocks the
        adapter) rather than relying on a code-path inside the real
        provider's saga.
        """
        from apps.mpesa.provider import get_payment_client

        client = get_payment_client()

        # 2026-05-09 callback-match fix · pass `reference=tx.id` on
        # EVERY rail. The SasaPay adapter previously generated a random
        # UUID for B2B paybill/till when no reference was supplied · the
        # eventual result callback then carried that random UUID and our
        # `_process_successful_payment` couldn't match it back to the
        # transaction (Strategy 1 looks up by idempotency_key=ref).
        # That swallowed the `RecipientName` field SasaPay returns,
        # leaving the receipt blank.
        if self.tx.mpesa_paybill:
            # 2026-05-09 utility-routing fix · per docs.sasapay.app,
            # KPLC / DSTV / GOTV / Zuku / Nairobi Water etc. MUST go
            # through the dedicated `/utilities/` endpoint, NOT
            # `/payments/b2b/`. The B2B endpoint requires a separate
            # "B2B Paybill" product activation that the user reported
            # was failing with SP01002 ("not permitted according to
            # product assignment"). The Utilities endpoint also returns
            # the biller's prepaid token in a dedicated `Pin` field
            # (plus `Units` for KPLC kWh) on the callback. Route here
            # whenever we know the serviceCode for the paybill.
            utility_service_code = None
            is_kplc_prepaid = self.tx.mpesa_paybill == "888880"
            # 2026-05-15 · this branch only fires when paybill is routed
            # through SasaPay. When PAYMENT_PROVIDER_PAYBILL=intasend,
            # IntaSend handles paybill via its own B2B endpoint without
            # the per-paybill product-assignment gate, so the SasaPay
            # Utilities-API special-case is irrelevant and we let the
            # generic `client.b2b_payment(...)` path below dispatch to
            # IntaSend.
            paybill_via_sasapay = (
                client.routing_for("paybill") == "sasapay"
                if hasattr(client, "routing_for") else
                getattr(client, "is_sasapay", False)
            )
            if paybill_via_sasapay:
                try:
                    utility_service_code = (
                        client._client_for("paybill")._utility_service_code_for_paybill(
                            self.tx.mpesa_paybill
                        )
                        if hasattr(client, "_client_for") else
                        client._client._utility_service_code_for_paybill(
                            self.tx.mpesa_paybill
                        )
                    )
                except Exception:
                    utility_service_code = None

            # 2026-05-10 · KPLC PREPAID dedicated WaaS endpoint.
            # Found via the official SasaPay Java SDK
            # (github.com/SasaPay/sasapay-java-sdk · ApiUrls.purchase_kplc).
            # Path is `/waas/utilities/kplc-token/`, distinct from the
            # generic `/utilities/` (which has no KPLC serviceCode).
            # Returns Pin + Units in the callback. Falls back to plain
            # B2B if the merchant doesn't have WaaS provisioning.
            #
            # 2026-05-10 update · SasaPay support confirmed via email
            # that WaaS provisioning requires the merchant to be a
            # registered limited company. CPAY TECHNOLOGIES is currently
            # name-reservation only (full cert pending), so every WaaS
            # call returns 401/403 and the saga adds an extra HTTP
            # round-trip before falling back to B2B. Skip WaaS entirely
            # while SASAPAY_WAAS_ENABLED is False (default). Flip the
            # env var ON when the limited-company cert lands AND SasaPay
            # confirms WaaS is provisioned on our merchant account.
            from django.conf import settings as _dj_settings
            waas_enabled = getattr(_dj_settings, "SASAPAY_WAAS_ENABLED", False)
            if is_kplc_prepaid and waas_enabled and paybill_via_sasapay:
                user_phone = (self.tx.user.phone or "").lstrip("+")
                if user_phone.startswith("0"):
                    user_phone = "254" + user_phone[1:]
                logger.info(
                    "saga.routing_to_kplc_token_endpoint · tx=%s meter=%s",
                    self.tx.id, self.tx.mpesa_account,
                )
                try:
                    sasapay_client = (
                        client._client_for("paybill")
                        if hasattr(client, "_client_for") else client._client
                    )
                    kplc_raw = sasapay_client.pay_kplc_token(
                        meter_number=self.tx.mpesa_account,
                        amount=int(self.tx.dest_amount),
                        mobile_number=user_phone,
                    )
                except Exception as e:
                    # WaaS endpoint not provisioned (401/403/404) ·
                    # gracefully fall back to plain B2B so the payment
                    # still goes through (no Pin field on callback,
                    # but the M-Pesa receipt still reaches the user).
                    logger.warning(
                        "saga.kplc_waas_unavailable · falling back to B2B "
                        "tx=%s err=%s", self.tx.id, str(e)[:200],
                    )
                    kplc_raw = None

                if kplc_raw is not None:
                    waas_ok = bool(kplc_raw.get("status", True))
                    result = {
                        "ConversationID": kplc_raw.get("CheckoutRequestID")
                                          or kplc_raw.get("checkoutRequestId")
                                          or "",
                        "OriginatorConversationID": kplc_raw.get("transactionReference") or str(self.tx.id),
                        "ResponseCode": "0" if waas_ok else "1",
                        "status": waas_ok,
                        "ResponseDescription": kplc_raw.get("message")
                                               or kplc_raw.get("detail")
                                               or "",
                        "_raw": kplc_raw,
                    }
                else:
                    result = client.b2b_payment(
                        paybill=self.tx.mpesa_paybill,
                        account=self.tx.mpesa_account,
                        amount=int(self.tx.dest_amount),
                        remarks=f"CryptoPay-{self.tx.id}",
                        reference=str(self.tx.id),
                    )
            elif utility_service_code:
                # Normalise the user's phone to 254XXXXXXXXX so the
                # biller SMS reaches them (not Cpay's sender phone).
                user_phone = self.tx.user.phone or ""
                user_phone_e164 = user_phone.lstrip("+")
                if user_phone_e164.startswith("0"):
                    user_phone_e164 = "254" + user_phone_e164[1:]
                logger.info(
                    "saga.routing_to_utilities · tx=%s paybill=%s service=%s",
                    self.tx.id, self.tx.mpesa_paybill, utility_service_code,
                )
                sasapay_client = (
                    client._client_for("paybill")
                    if hasattr(client, "_client_for") else client._client
                )
                util_raw = sasapay_client.pay_utility(
                    paybill=self.tx.mpesa_paybill,
                    account_number=self.tx.mpesa_account,
                    amount=int(self.tx.dest_amount),
                    contact_phone=user_phone_e164,
                    service_code=utility_service_code,
                    reference=str(self.tx.id),
                )
                # Utilities response shape (per docs.sasapay.app):
                #   { "status": true, "message": "..." }   on success
                #   { "status": false, "message": "..." }  on rejection
                # No ConversationID / B2BRequestID like B2B has · we
                # use the merchant transaction reference (= tx.id) as
                # the originator key. The `status` boolean is mapped
                # to the standard ResponseCode shape so the synchronous
                # error check below treats it uniformly with B2B/B2C.
                util_status_ok = bool(util_raw.get("status", True))
                result = {
                    "ConversationID": util_raw.get("CheckoutRequestID")
                                      or util_raw.get("checkoutRequestId")
                                      or "",
                    "OriginatorConversationID": util_raw.get("transactionReference") or str(self.tx.id),
                    "ResponseCode": "0" if util_status_ok else "1",
                    "status": util_status_ok,
                    "ResponseDescription": util_raw.get("message")
                                           or util_raw.get("detail")
                                           or util_raw.get("ResponseDescription")
                                           or "",
                    "_raw": util_raw,  # for debug/audit
                }
            else:
                result = client.b2b_payment(
                    paybill=self.tx.mpesa_paybill,
                    account=self.tx.mpesa_account,
                    amount=int(self.tx.dest_amount),
                    remarks=f"CryptoPay-{self.tx.id}",
                    reference=str(self.tx.id),
                )
        elif self.tx.mpesa_till:
            result = client.buy_goods(
                till=self.tx.mpesa_till,
                amount=int(self.tx.dest_amount),
                remarks=f"CryptoPay-{self.tx.id}",
                reference=str(self.tx.id),
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

        # 2026-05-09 · check the SasaPay synchronous response for an
        # immediate failure. SasaPay returns ResponseCode "0" + a
        # B2BRequestID/ConversationID when the request was queued for
        # the biller. Any non-zero ResponseCode means the request was
        # rejected at the SasaPay gateway BEFORE hitting the biller ·
        # the user got SP01002 ("not permitted according to product
        # assignment") this way and we previously shrugged it off as
        # "CONFIRMING" while the saga waited for a callback that would
        # never confirm success.
        sync_code = str(
            result.get("ResponseCode")
            or result.get("responseCode")
            or "0"
        ).strip()
        sync_status = result.get("status")
        # `status: false` is the camelCase failure shape used by some
        # SasaPay endpoints (Utilities, fund-movement) · treat it as a
        # synchronous failure regardless of the ResponseCode field.
        if sync_code != "0" or sync_status is False:
            sync_desc = (
                result.get("ResponseDescription")
                or result.get("detail")
                or result.get("message")
                or f"SasaPay rejected with code {sync_code}"
            )
            logger.error(
                "saga.sync_response_failed · tx=%s code=%s desc=%s",
                self.tx.id, sync_code, sync_desc,
            )
            # Mark FAILED + raise so the outer compensation runs (refund
            # the locked crypto). DO NOT auto-complete · DO NOT pretend
            # the payment succeeded.
            self.tx.status = Transaction.Status.FAILED
            self.tx.failure_reason = (
                f"SasaPay {sync_code}: {sync_desc}"[:500]
            )
            self.tx.save(update_fields=[
                "status", "failure_reason", "updated_at",
            ])
            raise SagaError(
                f"SasaPay sync rejection · code={sync_code} desc={sync_desc}"
            )

        self.tx.saga_data["mpesa_conversation_id"] = result.get("ConversationID", "")
        self.tx.saga_data["mpesa_originator_id"] = result.get("OriginatorConversationID", "")
        # 2026-05-16 · IntaSend send-money carries TWO IDs:
        #   `tracking_id` is per-transaction (what the webhook delivers)
        #   `file_id`     is the batch ID (what the status query needs)
        # We persist both so the callback handler can match the row via
        # `intasend_tracking_id` and the status-query cron has the file_id
        # to call /send-money/status/. The adapter returns these on the
        # result dict only when the IntaSendClient set them (i.e. send-
        # money operations); SasaPay/Daraja results don't set them so
        # the keys land as empty strings and the callback paths fall
        # back to api_ref matching · same as today.
        if result.get("intasend_tracking_id"):
            self.tx.saga_data["intasend_tracking_id"] = result.get(
                "intasend_tracking_id", "",
            )
        if result.get("intasend_file_id"):
            self.tx.saga_data["intasend_file_id"] = result.get(
                "intasend_file_id", "",
            )
        self.tx.status = Transaction.Status.CONFIRMING
        self.tx.save(update_fields=["saga_data", "status", "updated_at"])

        # NOTE · all sandbox / DEV auto-complete paths removed 2026-05-09.
        # Production payments wait for the real SasaPay callback to flip
        # status to COMPLETED (or FAILED via _process_failed_payment).
        # Cleanup cron handles the rare case where a callback never
        # arrives (transitions stuck-CONFIRMING txs to FAILED after
        # 3 min via verify_transaction status query).

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
        # 2026-05-09 · clear any in-flight diagnostic note on
        # `failure_reason` (e.g. "Pending: awaiting M-Pesa callback
        # (>3 min)" stamped by the cleanup cron at the 3-min mark).
        # The field is meant for terminal FAILED state · leaving the
        # stale text on a COMPLETED tx made the customer's
        # transaction-detail screen render a red "Failure Reason"
        # block alongside the green "Completed" badge, which read as
        # contradictory.
        if self.tx.failure_reason:
            self.tx.failure_reason = ""
            self.tx.save(update_fields=[
                "mpesa_receipt", "status", "completed_at",
                "failure_reason", "updated_at",
            ])
        else:
            self.tx.save(update_fields=[
                "mpesa_receipt", "status", "completed_at", "updated_at",
            ])
        logger.info(f"Payment completed: tx {self.tx.id}, receipt {mpesa_receipt}")

        # Record this outflow against the platform-limits sliding windows
        # so the next caller sees an accurate "outgoing in last hour/day"
        # reading.
        #
        # 2026-05-09 audit fix · WITHDRAWAL was in this list. Withdrawal
        # transactions have `dest_currency = USDT/BTC/ETH/...`, NOT KES,
        # and the fallback branch recorded `source_amount` (a CRYPTO
        # quantity, e.g. `100` for 100 USDT) into a Redis ZSET that the
        # rest of the system treats as KES. After a few withdrawals the
        # per-hour / per-day caps in `platform_limits.enforce_outgoing()`
        # saw massively understated outgoing KES (100 KES for a
        # ~13,000-KES-equivalent withdrawal) and stopped blocking real
        # KES drains. Withdrawals are a SEPARATE crypto-egress rail and
        # already have their own limits (per-currency / address-whitelist
        # / blockchain-fee bounds). Removing them from this list fixes
        # the platform-limits accuracy. If we want to enforce a unified
        # "outgoing value in KES equivalent" limit later, compute
        # `kes_estimate = source_amount * latest_rate` BEFORE recording.
        if self.tx.type in (
            Transaction.Type.PAYBILL_PAYMENT,
            Transaction.Type.TILL_PAYMENT,
            Transaction.Type.SEND_MPESA,
        ):
            try:
                from .platform_limits import record_outgoing
                from decimal import Decimal as _D
                amount_kes = _D(self.tx.dest_amount or 0) if self.tx.dest_currency == "KES" \
                    else _D(self.tx.source_amount or 0)
                record_outgoing(amount_kes, str(self.tx.id))
            except Exception:
                logger.exception(
                    "platform_limits.record_outgoing_failed_in_saga",
                    extra={"transaction_id": str(self.tx.id)},
                )

        # 2026-05-17 · book revenue into the SystemWallet ledger.
        #
        # Before this block, paybill/till/B2C settlement only stamped
        # `fee_amount` on the Transaction record · `SystemWallet(FEE)`
        # was never credited. The /admin/revenue/ dashboard exposed
        # the gap (earned 71.35 KES, booked 0 KES across all completed
        # txs) which is exactly the C87DC5F2 audit finding.
        #
        # Split:
        #   - `fee_amount = spread_revenue + flat_fee` → split into:
        #     * provider_cost (IntaSend `charges` per webhook tx)
        #     * net fee (the remainder · OUR true take)
        #   - `excise_duty_amount` → booked to EXCISE wallet (owed KRA)
        #
        # All three calls are idempotent via FeeLedgerEntry's
        # UniqueConstraint(transaction_id, system_wallet, entry_type)
        # so the saga can be retried (callback + cron status query
        # both calling complete()) without double-booking.
        #
        # Best-effort · a booking failure logs but does NOT roll back
        # the COMPLETED status. The fee is already on the tx record;
        # the admin reconciliation panel will surface the gap so ops
        # can backfill via `python manage.py backfill_unbooked_fees`.
        self._book_revenue_split()

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

    def _book_revenue_split(self) -> None:
        """Credit FEE / PROVIDER_COST / EXCISE SystemWallets per the
        completed transaction's fee_amount + excise_duty_amount.

        Split logic:
          - `provider_cost` = `saga_data.intasend_charges` (if present;
            IntaSend's per-tx KES charge captured from the send-money
            webhook by `_enrich_tx_from_send_money_payload`). For
            paths without a captured charge (SasaPay, legacy txs),
            provider_cost = 0 (under-report; better than over-claiming
            revenue we didn't earn).
          - `net_fee` = max(0, `tx.fee_amount` - `provider_cost`)
            so a tx where the provider charge exceeded our fee
            (BUY net-loss case · audit finding #5) books zero net
            revenue rather than going negative.
          - `excise` = `tx.excise_duty_amount` → KRA bucket
            (NEVER our revenue; tracked separately so the next KRA
            remittance has a single source of truth).

        Best-effort · any booking failure is logged but doesn't
        re-raise. The /admin/revenue/ dashboard's earned-vs-booked
        panel surfaces the gap so ops can backfill manually.
        """
        from decimal import Decimal as _D
        try:
            fee_amount = _D(self.tx.fee_amount or 0)
            excise = _D(self.tx.excise_duty_amount or 0)
            # 2026-05-17 · N7 fix · empty fee_currency must NOT silently
            # default to KES · for crypto-side fees (SWAP, withdrawal)
            # that would mis-route the booking to the KES wallet which
            # has no balance to credit and silently over-states KES
            # revenue. Default to `source_currency` (the wallet we
            # debited the fee from) which is the canonical answer for
            # ALL tx types except SEND_MPESA where source might be
            # crypto and the fee was in KES.
            fee_currency = (
                self.tx.fee_currency
                or self.tx.source_currency
                or "KES"
            ).upper()
            sd = self.tx.saga_data or {}

            # IntaSend captures the per-tx charge on the webhook · we
            # stashed it under `intasend_charges` via
            # `_enrich_tx_from_send_money_payload`. SasaPay doesn't
            # currently surface this; treat as 0 and over-credit net
            # fee · ops will see the discrepancy on the dashboard's
            # provider_cost column and we can wire SasaPay later.
            provider_cost = _D(str(sd.get("intasend_charges") or 0))

            net_fee = fee_amount - provider_cost
            if net_fee < 0:
                # Provider charged us more than we charged the user.
                # Book 0 net fee + the FULL provider_cost on the
                # provider_cost bucket · the resulting NEGATIVE delta
                # vs fee_amount is the loss-per-tx visible in admin.
                net_fee = _D("0")

            # Lazy import inside function · WalletService is a heavy
            # module and lazy-loading keeps saga.complete idempotent
            # on import-time failures.
            from apps.wallets.services import (
                WalletService,
                FeeWalletMissingError,
            )

            if net_fee > 0:
                try:
                    WalletService.book_fee(
                        currency=fee_currency,
                        amount=net_fee,
                        transaction_id=self.tx.id,
                        description=(
                            f"{self.tx.type} net fee · {net_fee} "
                            f"{fee_currency} (gross {fee_amount} − "
                            f"provider {provider_cost})"
                        ),
                    )
                except FeeWalletMissingError as e:
                    logger.error(
                        "saga.complete.book_fee_missing_wallet",
                        extra={"tx_id": str(self.tx.id), "err": str(e)},
                    )

            if provider_cost > 0:
                try:
                    WalletService.book_provider_cost(
                        currency=fee_currency,
                        amount=provider_cost,
                        transaction_id=self.tx.id,
                        description=(
                            f"{self.tx.type} provider cost · {provider_cost} "
                            f"{fee_currency} · {sd.get('intasend_provider') or 'IntaSend'}"
                        ),
                    )
                except FeeWalletMissingError as e:
                    logger.error(
                        "saga.complete.book_provider_cost_missing_wallet",
                        extra={"tx_id": str(self.tx.id), "err": str(e)},
                    )

            if excise > 0:
                try:
                    WalletService.book_excise(
                        currency=fee_currency,
                        amount=excise,
                        transaction_id=self.tx.id,
                        description=(
                            f"{self.tx.type} excise duty · {excise} "
                            f"{fee_currency} · owed to KRA"
                        ),
                    )
                except FeeWalletMissingError as e:
                    logger.error(
                        "saga.complete.book_excise_missing_wallet",
                        extra={"tx_id": str(self.tx.id), "err": str(e)},
                    )
        except Exception:
            # Total failure of the revenue-split block must NOT crash
            # the saga · the tx is already COMPLETED. Ops will see the
            # gap on the dashboard and can backfill.
            logger.exception(
                "saga.complete.book_revenue_split_failed",
                extra={"tx_id": str(self.tx.id)},
            )

    def _unbook_revenue_split(self) -> None:
        """Reverse FEE / PROVIDER_COST / EXCISE bookings that the
        callback's `_book_revenue_split` may have already credited.

        2026-05-17 · N2 fix · called from `compensate_convert` so a
        late-arriving compensation (e.g. double-settlement reversal)
        doesn't leave the SystemWallet balances inflated above the
        true net revenue. Idempotent via the
        `WalletService.unbook_*` helpers · each looks up the prior
        CREDIT FeeLedgerEntry and creates a balancing DEBIT only when
        the credit exists + no prior DEBIT is found. Safe to call
        eagerly · no-ops when nothing was booked.

        Best-effort wrap · a failure here logs but does NOT re-raise.
        The compensate path's user-facing crypto credit has already
        succeeded; surfacing an exception would block the saga and
        leave the user with a "compensating..." spinner.
        """
        try:
            fee_currency = (self.tx.fee_currency or "KES").upper()
            tx_id = self.tx.id
            from apps.wallets.services import WalletService  # noqa: PLC0415

            desc_suffix = (
                f"· compensate_convert for tx {tx_id} ({self.tx.type})"
            )
            WalletService.unbook_fee(
                currency=fee_currency,
                transaction_id=tx_id,
                description=f"Reverse FEE booking {desc_suffix}",
            )
            WalletService.unbook_provider_cost(
                currency=fee_currency,
                transaction_id=tx_id,
                description=f"Reverse PROVIDER_COST {desc_suffix}",
            )
            WalletService.unbook_excise(
                currency=fee_currency,
                transaction_id=tx_id,
                description=f"Reverse EXCISE {desc_suffix}",
            )
        except Exception:
            logger.exception(
                "saga.compensate.unbook_revenue_split_failed",
                extra={"tx_id": str(self.tx.id)},
            )
