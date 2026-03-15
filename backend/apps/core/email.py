"""Email and SMS service module — thin wrappers that dispatch Celery tasks for async delivery."""

import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Reusable SMS helper (eSMS Africa primary, Africa's Talking fallback)
# ---------------------------------------------------------------------------


def send_sms(phone, message):
    """Send an SMS via eSMS Africa (primary) or Africa's Talking (fallback).

    This is the single entry point for all outbound SMS. Uses the same
    provider hierarchy as OTP sending in RequestOTPView.

    Args:
        phone: str, E.164 phone number (e.g. +254712345678).
        message: str, SMS body (max ~160 chars recommended).

    Returns:
        bool: True if SMS was sent successfully via any provider.
    """
    from django.conf import settings

    if not phone:
        logger.warning("send_sms called with empty phone number")
        return False

    sms_sent = False

    # Primary: eSMS Africa
    esms_key = getattr(settings, "ESMS_API_KEY", "")
    esms_account = getattr(settings, "ESMS_ACCOUNT_ID", "")
    if esms_key and esms_account:
        try:
            import requests as http_requests
            payload = {
                "phoneNumber": phone,
                "text": message,
            }
            sender_id = getattr(settings, "ESMS_SENDER_ID", "")
            if sender_id:
                payload["senderId"] = sender_id
            resp = http_requests.post(
                "https://api.esmsafrica.io/api/sms/send",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-API-Key": esms_key,
                    "X-Account-ID": esms_account,
                },
                timeout=10,
            )
            if resp.status_code == 200:
                sms_sent = True
                logger.info(f"SMS sent via eSMS to {phone[:7]}***")
            else:
                logger.error(f"eSMS failed: {resp.status_code} {resp.text}")
        except Exception as e:
            logger.error(f"eSMS send failed: {e}")

    # Fallback: Africa's Talking
    if not sms_sent and getattr(settings, "AT_API_KEY", ""):
        try:
            import africastalking
            africastalking.initialize(settings.AT_USERNAME, settings.AT_API_KEY)
            sms = africastalking.SMS
            sender = getattr(settings, "AT_SENDER_ID", "") or None
            sms.send(message, [phone], sender_id=sender)
            sms_sent = True
            logger.info(f"SMS sent via AT to {phone[:7]}***")
        except Exception as e:
            logger.error(f"AT SMS send failed: {e}")

    if not sms_sent:
        logger.info(f"[DEV] SMS to {phone}: {message}")

    return sms_sent


def send_otp_email(user, otp_code):
    """Send OTP verification email.

    Args:
        user: User model instance (must have email, full_name, phone).
        otp_code: str, the 6-digit OTP code.
    """
    if not user.email:
        logger.warning(f"Cannot send OTP email: user {user.phone} has no email.")
        return

    from apps.core.tasks import send_otp_email_task

    send_otp_email_task.delay(
        user_email=user.email,
        user_full_name=user.full_name or user.phone,
        otp_code=otp_code,
    )
    logger.info(f"Queued OTP email for {user.email}")


def send_welcome_email(user):
    """Send welcome email to a newly registered user.

    Args:
        user: User model instance (must have email, full_name, phone).
    """
    if not user.email:
        logger.warning(f"Cannot send welcome email: user {user.phone} has no email.")
        return

    from apps.core.tasks import send_welcome_email_task

    send_welcome_email_task.delay(
        user_email=user.email,
        user_full_name=user.full_name,
        user_phone=user.phone,
    )
    logger.info(f"Queued welcome email for {user.email}")


def send_transaction_receipt(user, transaction):
    """Send transaction receipt email.

    Args:
        user: User model instance.
        transaction: Transaction model instance with dest_amount, dest_currency,
                     type, status, id, and created_at attributes.
    """
    if not user.email:
        logger.warning(f"Cannot send receipt: user {user.phone} has no email.")
        return

    from apps.core.tasks import send_transaction_receipt_task

    ref = str(transaction.id)[:8].upper()
    send_transaction_receipt_task.delay(
        user_email=user.email,
        user_full_name=user.full_name or user.phone,
        amount=str(transaction.dest_amount),
        currency=transaction.dest_currency,
        tx_type=transaction.type,
        status=str(transaction.status),
        reference=ref,
        timestamp=transaction.created_at.isoformat(),
        # Enhanced fields
        source_amount=str(transaction.source_amount) if transaction.source_amount else None,
        source_currency=transaction.source_currency or None,
        exchange_rate=str(transaction.exchange_rate) if transaction.exchange_rate else None,
        fee_amount=str(transaction.fee_amount) if transaction.fee_amount else None,
        fee_currency=transaction.fee_currency or None,
        mpesa_receipt=transaction.mpesa_receipt or None,
    )
    logger.info(f"Queued transaction receipt for {user.email} — ref {ref}")


def send_kyc_status_email(user, document_type, status, rejection_reason=None):
    """Send KYC document status update email.

    Args:
        user: User model instance.
        document_type: str, e.g. 'national_id', 'passport', 'selfie'.
        status: str, e.g. 'approved', 'rejected'.
        rejection_reason: Optional str with reason for rejection.
    """
    if not user.email:
        logger.warning(f"Cannot send KYC status email: user {user.phone} has no email.")
        return

    from apps.core.tasks import send_kyc_status_email_task

    send_kyc_status_email_task.delay(
        user_email=user.email,
        user_full_name=user.full_name or user.phone,
        document_type=document_type,
        status=status,
        rejection_reason=rejection_reason,
    )
    logger.info(f"Queued KYC status email for {user.email} — {document_type}: {status}")


def send_transaction_notifications(user, transaction):
    """Send all notifications for a completed transaction: email receipt, SMS, PDF, push.

    This is the single entry point for transaction notifications.
    Call this when a transaction is completed successfully.
    """
    # Email receipt
    send_transaction_receipt(user, transaction)

    # SMS notification
    if user.phone:
        from apps.core.tasks import send_transaction_sms_task

        send_transaction_sms_task.delay(
            phone=user.phone,
            tx_type=transaction.type,
            amount=str(transaction.dest_amount),
            currency=transaction.dest_currency,
            reference=str(transaction.id)[:8].upper(),
        )
        logger.info(f"Queued transaction SMS for {user.phone}")

    # PDF receipt generation
    from apps.core.tasks import generate_pdf_receipt_task

    generate_pdf_receipt_task.delay(transaction_id=str(transaction.id))
    logger.info(f"Queued PDF receipt for transaction {transaction.id}")

    # Push notification
    from apps.core.tasks import send_push_task

    type_labels = {
        "PAYBILL_PAYMENT": "Paybill payment",
        "TILL_PAYMENT": "Till payment",
        "SEND_MPESA": "M-Pesa transfer",
        "BUY": "Crypto purchase",
    }
    label = type_labels.get(transaction.type, "Transaction")
    send_push_task.delay(
        user_id=str(user.id),
        title="Payment Successful",
        body=f"{label} of {transaction.dest_currency} {transaction.dest_amount} completed. Ref: {str(transaction.id)[:8].upper()}",
        data={"transaction_id": str(transaction.id), "type": "transaction_complete"},
    )

    # Admin alert for failed transactions + user failure email
    if str(transaction.status) == "failed":
        from apps.core.tasks import send_failed_transaction_alert_task

        send_failed_transaction_alert_task.delay(
            transaction_id=str(transaction.id),
        )

        # Send failure notification to user
        if user.email:
            from apps.core.tasks import send_email_task
            from django.template.loader import render_to_string

            ref = str(transaction.id)[:8].upper()
            tx_label = type_labels.get(transaction.type, "Transaction")
            html_content = render_to_string("email/transaction_receipt.html", {
                "full_name": user.full_name or user.phone,
                "amount": str(transaction.dest_amount),
                "currency": transaction.dest_currency,
                "tx_type": transaction.type,
                "tx_type_label": tx_label,
                "status": "failed",
                "reference": ref,
                "timestamp": transaction.created_at.isoformat(),
            })
            send_email_task.delay(
                subject=f"CPay — Transaction Failed: {tx_label} {ref}",
                html_content=html_content,
                recipient_email=user.email,
            )
            logger.info(f"Queued failure email for {user.email} — ref {ref}")


def send_security_alert(user, event_type, ip_address, device_info):
    """Send security alert email.

    Args:
        user: User model instance.
        event_type: str, one of 'new_device', 'password_change', 'pin_change',
                    'suspicious_login', 'account_locked'.
        ip_address: str, IP address of the event origin.
        device_info: str, human-readable device description.
    """
    if not user.email:
        logger.warning(f"Cannot send security alert: user {user.phone} has no email.")
        return

    from apps.core.tasks import send_security_alert_task

    send_security_alert_task.delay(
        user_email=user.email,
        user_full_name=user.full_name or user.phone,
        event_type=event_type,
        ip_address=ip_address,
        device_info=device_info,
    )
    logger.info(f"Queued security alert for {user.email} — {event_type}")


def send_admin_new_user_alert(user):
    """Send admin alert about a new user registration.

    Args:
        user: User model instance just created.
    """
    from apps.core.tasks import send_admin_new_user_alert_task

    send_admin_new_user_alert_task.delay(
        user_phone=user.phone,
        user_full_name=user.full_name or "",
        user_email=user.email or "",
        kyc_tier=getattr(user, "kyc_tier", 0),
    )
    logger.info(f"Queued admin new-user alert for {user.phone}")


def send_welcome_sms(user):
    """Send welcome SMS to a newly registered user.

    Args:
        user: User model instance (must have phone).
    """
    if not user.phone or user.phone.startswith("+000"):
        logger.warning(f"Cannot send welcome SMS: user has no real phone.")
        return

    from apps.core.tasks import send_sms_task

    send_sms_task.delay(
        phone=user.phone,
        message=(
            "Welcome to CPay! Your account is ready. "
            "Deposit KES, pay bills, and send money with crypto. "
            "Visit cpay.co.ke"
        ),
    )
    logger.info(f"Queued welcome SMS for {user.phone}")


def send_pin_change_alert(user, ip_address="", device_info=""):
    """Send security alert email + SMS when PIN is changed.

    Args:
        user: User model instance.
        ip_address: str, IP address of the request.
        device_info: str, device description.
    """
    # Email alert
    send_security_alert(user, "pin_change", ip_address, device_info)

    # SMS alert
    if user.phone:
        from apps.core.tasks import send_sms_task

        send_sms_task.delay(
            phone=user.phone,
            message=(
                "CPay Security: Your PIN was changed. "
                "If this was not you, contact support@cpay.co.ke immediately."
            ),
        )
        logger.info(f"Queued PIN change SMS alert for {user.phone}")


def send_pin_reset_alert(user, ip_address=""):
    """Send security alert email when PIN is reset via forgot-PIN flow.

    Args:
        user: User model instance.
        ip_address: str, IP address of the request.
    """
    send_security_alert(user, "pin_change", ip_address, "PIN reset via forgot-PIN flow")
    logger.info(f"Queued PIN reset security alert for {user.phone}")


def send_deposit_confirmed_notification(user, deposit):
    """Send email + push notification when a blockchain deposit is confirmed.

    Args:
        user: User model instance.
        deposit: BlockchainDeposit model instance with amount, currency, tx_hash.
    """
    # Email notification
    if user.email:
        from apps.core.tasks import send_email_task
        from django.template.loader import render_to_string

        context = {
            "full_name": user.full_name or user.phone,
            "amount": str(deposit.amount),
            "currency": deposit.currency,
            "tx_hash": deposit.tx_hash,
            "chain": getattr(deposit, "chain", ""),
        }
        html_content = render_to_string("email/transaction_receipt.html", {
            "full_name": context["full_name"],
            "amount": context["amount"],
            "currency": context["currency"],
            "tx_type": "DEPOSIT",
            "tx_type_label": "Crypto Deposit",
            "status": "completed",
            "reference": deposit.tx_hash[:8].upper() if deposit.tx_hash else "N/A",
            "timestamp": deposit.credited_at.isoformat() if hasattr(deposit, "credited_at") and deposit.credited_at else "",
            "crypto_amount": context["amount"],
            "crypto_currency": context["currency"],
        })
        send_email_task.delay(
            subject=f"CPay — Deposit Confirmed: {deposit.amount} {deposit.currency}",
            html_content=html_content,
            recipient_email=user.email,
        )
        logger.info(f"Queued deposit confirmation email for {user.email}")

    # Push notification
    from apps.core.tasks import send_push_task

    send_push_task.delay(
        user_id=str(user.id),
        title="Deposit Confirmed",
        body=f"{deposit.amount} {deposit.currency} has been credited to your wallet.",
        data={"type": "deposit_confirmed", "currency": deposit.currency},
    )


def send_admin_kyc_upload_alert(user, document_type):
    """Send admin alert when a user uploads a KYC document.

    Args:
        user: User model instance.
        document_type: str, e.g. 'national_id', 'passport'.
    """
    from django.core.mail import mail_admins
    from django.utils import timezone

    now = timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z")
    doc_label = document_type.replace("_", " ").title()
    body = (
        f"KYC Document Submitted\n"
        f"{'=' * 40}\n"
        f"User: {user.phone} ({user.full_name or 'N/A'})\n"
        f"Document: {doc_label}\n"
        f"Time: {now}\n\n"
        f"Action: Review in admin panel.\n"
    )
    try:
        mail_admins(
            subject=f"[CPay] KYC Upload: {user.phone} — {doc_label}",
            message=body,
            fail_silently=True,
        )
        logger.info(f"Admin KYC upload alert sent for {user.phone} — {doc_label}")
    except Exception as exc:
        logger.error(f"Failed to send admin KYC alert: {exc}")
