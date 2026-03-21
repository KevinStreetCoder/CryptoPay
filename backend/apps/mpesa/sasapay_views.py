"""
SasaPay callback handlers.

Receives payment results from SasaPay for B2B, B2C, and C2B transactions.
Processes results the same way as Daraja callbacks — updates transaction
status, credits wallets, and sends notifications.
"""

import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from apps.accounts.models import AuditLog

logger = logging.getLogger(__name__)


@csrf_exempt
@require_POST
def sasapay_callback(request):
    """
    Handle SasaPay result callbacks for B2B, B2C, and C2B transactions.
    Must return HTTP 200 or SasaPay will retry.
    """
    try:
        data = json.loads(request.body)
        logger.info(f"SasaPay callback: {json.dumps(data, indent=2)[:500]}")

        result_code = str(data.get("ResultCode", data.get("resultCode", "")))
        checkout_id = data.get("CheckoutRequestID", data.get("checkoutRequestId", ""))
        trans_code = data.get("TransactionCode", data.get("SasaPayTransactionCode", ""))
        trans_ref = data.get("MerchantTransactionReference", "")
        amount = data.get("TransAmount", data.get("TransactionAmount", "0"))
        recipient_name = data.get("RecipientName", "")

        if result_code == "0":
            logger.info(
                f"SasaPay SUCCESS: code={trans_code}, amount={amount}, "
                f"ref={trans_ref}, recipient={recipient_name}"
            )
            _process_successful_payment(data, trans_ref, trans_code, amount)
        else:
            result_desc = data.get("ResultDesc", data.get("resultDesc", "Unknown"))
            logger.warning(
                f"SasaPay FAILED: code={result_code}, desc={result_desc}, "
                f"ref={trans_ref}, checkout={checkout_id}"
            )
            _process_failed_payment(data, trans_ref, result_desc)

    except Exception as e:
        logger.exception(f"SasaPay callback error: {e}")

    # Always return 200 to prevent retries
    return JsonResponse({"status": "ok"})


@csrf_exempt
@require_POST
def sasapay_ipn(request):
    """
    Handle SasaPay IPN (Instant Payment Notification).
    Richer data than result callback — includes customer name, balance, etc.
    """
    try:
        data = json.loads(request.body)
        logger.info(f"SasaPay IPN: {json.dumps(data, indent=2)[:500]}")

        # IPN fields: MerchantCode, TransID, ThirdPartyTransID, FullName,
        # TransactionType (C2B/B2C/B2B), MSISDN, TransAmount, TransTime,
        # BillRefNumber, OrgAccountBalance

        trans_type = data.get("TransactionType", "")
        trans_id = data.get("TransID", "")
        amount = data.get("TransAmount", "0")
        phone = data.get("MSISDN", "")
        customer = data.get("FullName", "")

        if trans_type == "C2B":
            # Customer paid to our merchant account
            logger.info(
                f"SasaPay C2B deposit: {amount} KES from {customer} ({phone}), "
                f"TransID={trans_id}"
            )
            _process_c2b_deposit(data)

    except Exception as e:
        logger.exception(f"SasaPay IPN error: {e}")

    return JsonResponse({"status": "ok"})


def _process_successful_payment(data: dict, ref: str, trans_code: str, amount: str):
    """Process a successful B2B or B2C payment."""
    from apps.payments.models import Transaction

    if not ref:
        return

    # Find transaction by idempotency key or reference
    tx = Transaction.objects.filter(idempotency_key=ref).first()
    if not tx:
        logger.warning(f"SasaPay callback: no matching transaction for ref={ref}")
        return

    if tx.status == Transaction.Status.COMPLETED:
        logger.info(f"SasaPay callback: tx {tx.id} already completed, ignoring duplicate")
        return

    from django.utils import timezone

    tx.mpesa_receipt = trans_code
    tx.status = Transaction.Status.COMPLETED
    tx.completed_at = timezone.now()
    tx.save(update_fields=["mpesa_receipt", "status", "completed_at", "updated_at"])

    # Send notifications
    try:
        from apps.core.email import send_transaction_notifications
        send_transaction_notifications(tx.user, tx)
    except Exception as e:
        logger.warning(f"SasaPay notification failed for tx {tx.id}: {e}")

    # Audit log
    AuditLog.objects.create(
        user=tx.user,
        action="sasapay_payment_completed",
        details=f"SasaPay {trans_code}: KES {amount} paid, ref={ref}",
    )

    logger.info(f"SasaPay payment completed: tx={tx.id}, receipt={trans_code}")


def _process_failed_payment(data: dict, ref: str, reason: str):
    """Process a failed B2B or B2C payment — compensate."""
    from apps.payments.models import Transaction

    if not ref:
        return

    tx = Transaction.objects.filter(idempotency_key=ref).first()
    if not tx or tx.status in (Transaction.Status.COMPLETED, Transaction.Status.FAILED):
        return

    from django.utils import timezone

    tx.status = Transaction.Status.FAILED
    tx.failure_reason = f"SasaPay: {reason}"
    tx.save(update_fields=["status", "failure_reason", "updated_at"])

    # Compensate — refund locked funds
    try:
        from apps.wallets.services import WalletService
        WalletService.unlock_and_refund(tx)
    except Exception as e:
        logger.error(f"SasaPay refund failed for tx {tx.id}: {e}")

    logger.warning(f"SasaPay payment failed: tx={tx.id}, reason={reason}")


def _process_c2b_deposit(data: dict):
    """Process a C2B (STK Push) deposit — credit user's KES wallet."""
    from apps.payments.models import Transaction
    from apps.accounts.models import User

    phone = data.get("MSISDN", "")
    amount = data.get("TransAmount", "0")
    trans_id = data.get("TransID", "")
    bill_ref = data.get("BillRefNumber", "")

    if not phone or not amount:
        return

    # Find user by phone
    normalized = phone if phone.startswith("+") else f"+{phone}"
    user = User.objects.filter(phone=normalized).first()
    if not user:
        # Try without + prefix
        user = User.objects.filter(phone=phone).first()
    if not user:
        logger.warning(f"SasaPay C2B: no user for phone {phone}")
        return

    # Check for duplicate
    if Transaction.objects.filter(mpesa_receipt=trans_id).exists():
        logger.info(f"SasaPay C2B: duplicate TransID {trans_id}")
        return

    from decimal import Decimal
    from django.utils import timezone
    from apps.wallets.services import WalletService

    kes_amount = Decimal(str(amount))

    # Credit KES wallet
    try:
        WalletService.credit(user, "KES", kes_amount, f"SasaPay deposit {trans_id}")

        # Create transaction record
        Transaction.objects.create(
            user=user,
            type=Transaction.Type.DEPOSIT,
            status=Transaction.Status.COMPLETED,
            source_currency="KES",
            source_amount=kes_amount,
            dest_currency="KES",
            dest_amount=kes_amount,
            mpesa_receipt=trans_id,
            mpesa_phone=phone,
            completed_at=timezone.now(),
        )

        logger.info(f"SasaPay C2B deposit credited: KES {kes_amount} to {user.phone}")

        # Send notifications
        from apps.core.email import send_transaction_notifications
        tx = Transaction.objects.filter(mpesa_receipt=trans_id).first()
        if tx:
            send_transaction_notifications(user, tx)

    except Exception as e:
        logger.error(f"SasaPay C2B credit failed: {e}")
