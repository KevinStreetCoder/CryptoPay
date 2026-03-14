"""
M-Pesa Celery tasks: float balance monitoring and STK Push status polling.
"""

import logging
from decimal import Decimal

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)

# Float balance thresholds (KES) — used by check_float_balance
# Circuit breaker thresholds are in apps.payments.circuit_breaker
FLOAT_LOW_THRESHOLD = 300_000
FLOAT_CRITICAL_THRESHOLD = 100_000


@shared_task(name="apps.mpesa.tasks.check_float_balance")
def check_float_balance():
    """
    Check M-Pesa float balance via Daraja Account Balance API.
    Results arrive async via callback — see process_balance_callback().
    Also updates the circuit breaker with the latest float level.
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


@shared_task(name="apps.mpesa.tasks.process_balance_result")
def process_balance_result(balance_kes: str):
    """
    Process a float balance result (from M-Pesa callback or manual check).
    Updates the payment circuit breaker state based on current float.
    Sends pre-alerts at 70% and 50% of emergency threshold.
    Also syncs the balance to SystemWallet FLOAT/KES for tracking.

    Args:
        balance_kes: String representation of the KES balance.
    """
    from apps.payments.circuit_breaker import PaymentCircuitBreaker
    from django.core.cache import cache

    try:
        balance = Decimal(balance_kes)
    except Exception:
        logger.error(f"Invalid balance value: {balance_kes}")
        return

    # Sync to SystemWallet for historical tracking
    _sync_float_to_system_wallet(balance)

    new_state = PaymentCircuitBreaker.update_from_float(balance)

    # Standard circuit breaker alerts
    if new_state == PaymentCircuitBreaker.OPEN:
        _send_float_alert(
            level="EMERGENCY",
            balance=balance,
            message=f"ALL PAYMENTS PAUSED — KES float at {balance:,.0f}",
        )
    elif new_state == PaymentCircuitBreaker.HALF_OPEN:
        _send_float_alert(
            level="CRITICAL",
            balance=balance,
            message=f"Large payments paused — KES float at {balance:,.0f}",
        )

    # Pre-alerts at percentage thresholds (before circuit breaker trips)
    # Only alert when float is above critical but declining toward it
    if new_state == PaymentCircuitBreaker.CLOSED:
        emergency_kes = Decimal(str(getattr(settings, "FLOAT_EMERGENCY_KES", 200_000)))
        healthy_kes = Decimal(str(getattr(settings, "FLOAT_HEALTHY_KES", 1_500_000)))

        # 50% of healthy = early warning
        prealert_50_threshold = healthy_kes * Decimal("0.50")
        # 70% decline from healthy toward emergency
        prealert_70_threshold = emergency_kes + (healthy_kes - emergency_kes) * Decimal("0.30")

        # Use Redis to avoid spamming alerts (1 alert per threshold per 30 min)
        # Check 50% first (higher threshold / less urgent), then 70% (lower / more urgent)
        if balance <= prealert_70_threshold:
            # More severe: 70% decline toward emergency
            alert_key = "float:prealert:70pct"
            if not cache.get(alert_key):
                cache.set(alert_key, "1", timeout=1800)
                _send_float_alert(
                    level="WARNING",
                    balance=balance,
                    message=(
                        f"Float declining: KES {balance:,.0f} "
                        f"(70% toward emergency threshold). "
                        f"Consider rebalancing soon."
                    ),
                )
        elif balance <= prealert_50_threshold:
            # Less severe: 50% of healthy level
            alert_key = "float:prealert:50pct"
            if not cache.get(alert_key):
                cache.set(alert_key, "1", timeout=1800)
                _send_float_alert(
                    level="INFO",
                    balance=balance,
                    message=(
                        f"Float at 50% of healthy level: KES {balance:,.0f} "
                        f"(target: KES {healthy_kes:,.0f}). "
                        f"Monitor closely."
                    ),
                )

    # Compute days-of-coverage and log
    _log_float_coverage(balance)

    logger.info(
        f"Float balance processed: KES {balance:,.0f} — "
        f"circuit breaker state: {new_state}"
    )
    return new_state


def _sync_float_to_system_wallet(balance: Decimal):
    """Keep SystemWallet FLOAT/KES in sync with actual M-Pesa balance."""
    try:
        from apps.wallets.models import SystemWallet
        float_wallet, _ = SystemWallet.objects.get_or_create(
            wallet_type="float",
            currency="KES",
        )
        float_wallet.balance = balance
        float_wallet.save(update_fields=["balance", "updated_at"])
    except Exception as e:
        logger.error(f"Failed to sync float to SystemWallet: {e}")


def _log_float_coverage(balance: Decimal):
    """Log days-of-operations coverage for monitoring."""
    try:
        from datetime import timedelta
        from django.db.models import Sum
        from django.utils import timezone
        from apps.payments.models import Transaction

        daily_outflow = Transaction.objects.filter(
            status="completed",
            type__in=["PAYBILL_PAYMENT", "TILL_PAYMENT", "SEND_MPESA"],
            completed_at__gte=timezone.now() - timedelta(hours=24),
        ).aggregate(total=Sum("dest_amount"))["total"] or Decimal("0")

        if daily_outflow > 0:
            days = float(balance / daily_outflow)
            logger.info(
                f"Float coverage: {days:.1f} days at current outflow "
                f"(KES {daily_outflow:,.0f}/day)"
            )
            if days < 2:
                logger.warning(f"Float coverage below 2 days: {days:.1f} days")
    except Exception as e:
        logger.error(f"Failed to compute float coverage: {e}")


def _send_float_alert(level: str, balance: Decimal, message: str):
    """Send alert to operations team about low float."""
    # Push notification to admin devices
    try:
        from apps.core.push import send_admin_alert

        send_admin_alert(
            title=f"[{level}] Float Alert",
            body=message,
        )
    except Exception as e:
        logger.error(f"Failed to send float push alert: {e}")

    # Email alert
    try:
        from django.core.mail import mail_admins

        mail_admins(
            subject=f"[CryptoPay {level}] Float Balance Alert",
            message=(
                f"Float Level: {level}\n"
                f"Balance: KES {balance:,.0f}\n"
                f"Message: {message}\n\n"
                f"Action required: Top up M-Pesa float immediately.\n"
                f"Admin panel: {settings.MPESA_CALLBACK_BASE_URL}/admin/"
            ),
            fail_silently=True,
        )
    except Exception as e:
        logger.error(f"Failed to send float email alert: {e}")

    logger.warning(f"Float alert [{level}]: {message}")


@shared_task(name="apps.mpesa.tasks.process_c2b_deposit")
def process_c2b_deposit(trans_id: str, amount_str: str, phone: str, bill_ref: str, raw_payload: dict):
    """
    Process a confirmed C2B deposit:
    1. Find user by phone/account reference
    2. Get current market rate
    3. Create Transaction record
    4. Credit crypto to user's wallet
    5. Send notifications
    """
    import uuid as _uuid

    from django.db import transaction as db_transaction
    from django.utils import timezone

    from apps.payments.models import Transaction
    from apps.wallets.models import Wallet
    from apps.wallets.services import WalletService

    amount = Decimal(amount_str)

    # Parse account reference to find user and target currency
    from .views import _parse_c2b_account_ref

    user, currency = _parse_c2b_account_ref(bill_ref, phone)
    if not user:
        logger.error(
            f"C2B deposit {trans_id}: could not find user for "
            f"ref='{bill_ref}' phone='{phone}'. MANUAL INTERVENTION REQUIRED."
        )
        return

    # Get current live rate (no pre-locked quote for C2B)
    try:
        from apps.rates.services import RateService

        rate_info = RateService.get_crypto_kes_rate(currency)
        final_rate = Decimal(rate_info["final_rate"])
    except Exception as e:
        logger.critical(
            f"C2B deposit {trans_id}: rate fetch failed: {e}. "
            f"KES {amount} from {phone} NOT credited. MANUAL INTERVENTION REQUIRED."
        )
        return

    # Calculate deposit: apply spread in reverse (user gets MORE crypto per KES for deposits)
    # For deposits, spread works in our favor on the buy side
    fee_pct = Decimal(str(getattr(settings, "DEPOSIT_FEE_PERCENTAGE", "1.5")))
    fee_kes = (amount * fee_pct / Decimal("100")).quantize(Decimal("0.01"))
    net_kes = amount - fee_kes
    crypto_amount = (net_kes / final_rate).quantize(Decimal("0.00000001"))

    try:
        with db_transaction.atomic():
            tx = Transaction.objects.create(
                idempotency_key=f"c2b:{trans_id}",
                user=user,
                type=Transaction.Type.KES_DEPOSIT_C2B,
                status=Transaction.Status.COMPLETED,
                source_currency="KES",
                source_amount=amount,
                dest_currency=currency,
                dest_amount=crypto_amount,
                exchange_rate=final_rate,
                fee_amount=fee_kes,
                fee_currency="KES",
                mpesa_receipt=trans_id,
                mpesa_phone=phone,
                completed_at=timezone.now(),
            )

            wallet, _ = Wallet.objects.get_or_create(
                user=user, currency=currency,
            )
            credit_tx_id = _uuid.uuid5(
                _uuid.NAMESPACE_URL, f"c2b_credit:{trans_id}"
            )
            WalletService.credit(
                wallet.id,
                crypto_amount,
                credit_tx_id,
                f"C2B deposit: {amount} KES -> {crypto_amount} {currency}",
            )

        logger.info(
            f"C2B deposit {trans_id}: credited {crypto_amount} {currency} to "
            f"user {user.id} (KES {amount} from {phone})"
        )
    except Exception as e:
        logger.critical(
            f"C2B deposit {trans_id}: FAILED to credit {currency} to user {user.id}: {e}. "
            f"MANUAL INTERVENTION REQUIRED.",
            exc_info=True,
        )
        return

    # Link callback record to transaction
    from .models import MpesaCallback

    MpesaCallback.objects.filter(mpesa_receipt=trans_id).update(transaction=tx)

    # Send notifications (non-critical)
    try:
        from apps.core.email import send_transaction_notifications

        send_transaction_notifications(user, tx)
    except Exception as e:
        logger.error(f"Notification dispatch failed for C2B deposit {tx.id}: {e}")


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
            # Success — wrap status + credit in atomic block so they
            # either both succeed or neither does (no orphaned COMPLETED
            # transaction without crypto credit).
            from django.db import transaction as db_transaction

            try:
                with db_transaction.atomic():
                    tx.status = Transaction.Status.COMPLETED
                    tx.completed_at = timezone.now()
                    tx.save(update_fields=["status", "completed_at", "updated_at"])

                    # BUY flow: credit crypto to user's wallet
                    if tx.type == Transaction.Type.BUY and tx.dest_currency and tx.dest_amount:
                        import uuid as _uuid

                        from apps.wallets.models import Wallet
                        from apps.wallets.services import WalletService

                        wallet = Wallet.objects.get(
                            user=tx.user, currency=tx.dest_currency,
                        )
                        # Deterministic tx_id — same as callback handler, so
                        # if callback also fires later, the credit is idempotent.
                        credit_tx_id = _uuid.uuid5(
                            _uuid.NAMESPACE_URL,
                            f"buy_credit:{tx.id}",
                        )
                        WalletService.credit(
                            wallet.id,
                            tx.dest_amount,
                            credit_tx_id,
                            f"Buy {tx.dest_currency}: STK poll confirmed",
                        )
                        logger.info(
                            f"Credited {tx.dest_amount} {tx.dest_currency} to "
                            f"user {tx.user_id} for BUY tx {tx.id} (via poll)"
                        )

                logger.info(f"STK Push confirmed via poll for tx {transaction_id}")
            except Exception as e:
                logger.critical(
                    f"FAILED to complete BUY tx {transaction_id} (poll): {e}. "
                    f"MANUAL INTERVENTION REQUIRED."
                )
                return

            # Send notifications outside the atomic block (non-critical)
            try:
                from apps.core.email import send_transaction_notifications
                send_transaction_notifications(tx.user, tx)
            except Exception as e:
                logger.error(f"Notification dispatch failed for tx {tx.id}: {e}")
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
