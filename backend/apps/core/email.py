"""Email and SMS service module — direct sending (no Celery dependency)."""

import logging

from django.conf import settings
from django.core.mail import send_mail, mail_admins
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Reusable SMS helper (Unimatrix primary, eSMS secondary, AT tertiary)
# ---------------------------------------------------------------------------


def send_sms(phone, message):
    """Send an SMS via eSMS Africa (primary) or Africa's Talking (fallback).

    This is the single entry point for all outbound SMS.

    Args:
        phone: str, E.164 phone number (e.g. +254712345678).
        message: str, SMS body (max ~160 chars recommended).

    Returns:
        bool: True if SMS was sent successfully via any provider.
    """
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
    """Send OTP verification email directly.

    Args:
        user: User model instance (must have email, full_name, phone).
        otp_code: str, the 6-digit OTP code.
    """
    if not user.email:
        logger.warning(f"Cannot send OTP email: user {user.phone} has no email.")
        return

    try:
        html = render_to_string("email/otp.html", {
            "full_name": user.full_name or user.phone,
            "otp_code": otp_code,
        })
        send_mail(
            f"CPay — Your verification code is {otp_code}",
            "",
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            html_message=html,
            fail_silently=True,
        )
        logger.info(f"OTP email sent to {user.email}")
    except Exception as e:
        logger.error(f"Failed to send OTP email to {user.email}: {e}")


def send_welcome_email(user):
    """Send welcome email to a newly registered user.

    Args:
        user: User model instance (must have email, full_name, phone).
    """
    if not user.email:
        logger.warning(f"Cannot send welcome email: user {user.phone} has no email.")
        return

    try:
        html = render_to_string("email/welcome.html", {
            "full_name": user.full_name or "there",
            "phone": user.phone,
        })
        send_mail(
            "Welcome to CPay!",
            f"Welcome to CPay, {user.full_name}!",
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            html_message=html,
            fail_silently=True,
        )
        logger.info(f"Welcome email sent to {user.email}")
    except Exception as e:
        logger.error(f"Failed to send welcome email to {user.email}: {e}")


def send_transaction_receipt(user, transaction):
    """Send transaction receipt email directly.

    Args:
        user: User model instance.
        transaction: Transaction model instance.
    """
    if not user.email:
        logger.warning(f"Cannot send receipt: user {user.phone} has no email.")
        return

    ref = str(transaction.id)[:8].upper()

    # Determine type label
    TX_TYPE_LABELS = {
        "PAYBILL_PAYMENT": "Paybill Payment",
        "TILL_PAYMENT": "Till Payment",
        "SEND_MPESA": "M-Pesa Transfer",
        "BUY": "Crypto Purchase",
        "SELL": "Crypto Sale",
        "DEPOSIT": "Deposit",
        "WITHDRAWAL": "Withdrawal",
        "KES_DEPOSIT": "KES Deposit",
        "KES_DEPOSIT_C2B": "KES Deposit (C2B)",
    }
    tx_type_label = TX_TYPE_LABELS.get(transaction.type, transaction.type.replace("_", " ").title())

    # Determine crypto side
    crypto_amount = None
    crypto_currency = None
    if transaction.source_currency and transaction.source_currency != "KES":
        crypto_amount = str(transaction.source_amount) if transaction.source_amount else None
        crypto_currency = transaction.source_currency
    elif transaction.dest_currency and transaction.dest_currency != "KES":
        crypto_amount = str(transaction.dest_amount)
        crypto_currency = transaction.dest_currency

    context = {
        "full_name": user.full_name or user.phone,
        "amount": str(transaction.dest_amount),
        "currency": transaction.dest_currency,
        "tx_type": transaction.type,
        "tx_type_label": tx_type_label,
        "status": str(transaction.status),
        "reference": ref,
        "timestamp": transaction.created_at.isoformat(),
        "crypto_amount": crypto_amount,
        "crypto_currency": crypto_currency,
        "exchange_rate": str(transaction.exchange_rate) if transaction.exchange_rate else None,
        "fee_amount": str(transaction.fee_amount) if transaction.fee_amount else None,
        "fee_currency": transaction.fee_currency or "KES",
        "mpesa_receipt": transaction.mpesa_receipt or None,
    }

    try:
        html = render_to_string("email/transaction_receipt.html", context)
        send_mail(
            f"CPay Receipt — {tx_type_label} {ref}",
            "",
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            html_message=html,
            fail_silently=True,
        )
        logger.info(f"Transaction receipt sent to {user.email} — ref {ref}")
    except Exception as e:
        logger.error(f"Failed to send receipt to {user.email}: {e}")


def send_kyc_status_email(user, document_type, status, rejection_reason=None):
    """Send KYC document status update email directly.

    Args:
        user: User model instance.
        document_type: str, e.g. 'national_id', 'passport', 'selfie'.
        status: str, e.g. 'approved', 'rejected'.
        rejection_reason: Optional str with reason for rejection.
    """
    if not user.email:
        logger.warning(f"Cannot send KYC status email: user {user.phone} has no email.")
        return

    try:
        html = render_to_string("email/kyc_status.html", {
            "full_name": user.full_name or user.phone,
            "document_type": document_type.replace("_", " ").title(),
            "status": status,
            "rejection_reason": rejection_reason,
        })
        send_mail(
            f"CPay KYC Update — {status.title()}",
            "",
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            html_message=html,
            fail_silently=True,
        )
        logger.info(f"KYC status email sent to {user.email} — {document_type}: {status}")
    except Exception as e:
        logger.error(f"Failed to send KYC status email to {user.email}: {e}")


def send_transaction_notifications(user, transaction):
    """Send all notifications for a completed transaction: email receipt, SMS, push.

    This is the single entry point for transaction notifications.
    Call this when a transaction is completed successfully.
    """
    TX_TYPE_LABELS = {
        "PAYBILL_PAYMENT": "Paybill payment",
        "TILL_PAYMENT": "Till payment",
        "SEND_MPESA": "M-Pesa transfer",
        "BUY": "Crypto purchase",
    }

    # Email receipt (direct)
    send_transaction_receipt(user, transaction)

    # SMS notification (direct)
    if user.phone:
        ref = str(transaction.id)[:8].upper()
        label = TX_TYPE_LABELS.get(transaction.type, transaction.type.replace("_", " ").title())
        message = (
            f"CPay: {label} of {transaction.dest_currency} {transaction.dest_amount} completed successfully. "
            f"Ref: {ref}. Thank you for using CPay."
        )
        send_sms(user.phone, message)
        logger.info(f"Transaction SMS sent to {user.phone}")

    # PDF receipt generation (keep as Celery — heavy IO)
    try:
        from apps.core.tasks import generate_pdf_receipt_task
        generate_pdf_receipt_task.delay(transaction_id=str(transaction.id))
        logger.info(f"Queued PDF receipt for transaction {transaction.id}")
    except Exception as e:
        logger.error(f"Failed to queue PDF receipt: {e}")

    # Push notification (keep as Celery — external API)
    try:
        from apps.core.tasks import send_push_task
        label = TX_TYPE_LABELS.get(transaction.type, "Transaction")
        send_push_task.delay(
            user_id=str(user.id),
            title="Payment Successful",
            body=f"{label} of {transaction.dest_currency} {transaction.dest_amount} completed. Ref: {str(transaction.id)[:8].upper()}",
            data={"transaction_id": str(transaction.id), "type": "transaction_complete"},
        )
    except Exception as e:
        logger.error(f"Failed to queue push notification: {e}")

    # Admin alert for failed transactions + user failure email
    if str(transaction.status) == "failed":
        try:
            from apps.core.tasks import send_failed_transaction_alert_task
            send_failed_transaction_alert_task.delay(transaction_id=str(transaction.id))
        except Exception as e:
            logger.error(f"Failed to queue failed-tx alert: {e}")

        # Send failure notification to user (direct)
        if user.email:
            try:
                ref = str(transaction.id)[:8].upper()
                tx_label = TX_TYPE_LABELS.get(transaction.type, "Transaction")
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
                send_mail(
                    f"CPay — Transaction Failed: {tx_label} {ref}",
                    "",
                    settings.DEFAULT_FROM_EMAIL,
                    [user.email],
                    html_message=html_content,
                    fail_silently=True,
                )
                logger.info(f"Failure email sent to {user.email} — ref {ref}")
            except Exception as e:
                logger.error(f"Failed to send failure email to {user.email}: {e}")


def send_security_alert(user, event_type, ip_address, device_info):
    """Send security alert email directly.

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

    from django.utils import timezone

    event_labels = {
        "new_device": "New Device Login",
        "password_change": "Password Changed",
        "pin_change": "PIN Changed",
        "suspicious_login": "Suspicious Login Attempt",
        "account_locked": "Account Locked",
        "account_suspended": "Account Suspended",
        "account_unsuspended": "Account Reactivated",
    }

    try:
        html = render_to_string("email/security_alert.html", {
            "full_name": user.full_name or user.phone,
            "event_type": event_type,
            "event_label": event_labels.get(event_type, event_type.replace("_", " ").title()),
            "ip_address": ip_address,
            "device_info": device_info,
            "timestamp": timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z"),
        })
        send_mail(
            f"CPay Security Alert — {event_labels.get(event_type, event_type)}",
            "",
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            html_message=html,
            fail_silently=True,
        )
        logger.info(f"Security alert sent to {user.email} — {event_type}")
    except Exception as e:
        logger.error(f"Failed to send security alert to {user.email}: {e}")


def send_admin_new_user_alert(user):
    """Send admin alert about a new user registration directly.

    Args:
        user: User model instance just created.
    """
    from django.utils import timezone

    now = timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z")
    body = (
        f"New CPay User Registration\n"
        f"{'=' * 40}\n"
        f"Phone: {user.phone}\n"
        f"Name: {user.full_name or '(not set)'}\n"
        f"Email: {user.email or '(not set)'}\n"
        f"KYC Tier: {getattr(user, 'kyc_tier', 0)}\n"
        f"Registered at: {now}\n"
    )
    try:
        mail_admins(
            subject=f"[CPay] New user registered: {user.phone}",
            message=body,
            fail_silently=True,
        )
        logger.info(f"Admin new-user alert sent for {user.phone}")
    except Exception as e:
        logger.error(f"Failed to send admin new-user alert for {user.phone}: {e}")


def send_welcome_sms(user):
    """Send welcome SMS to a newly registered user directly.

    Args:
        user: User model instance (must have phone).
    """
    if not user.phone or user.phone.startswith("+000"):
        logger.warning(f"Cannot send welcome SMS: user has no real phone.")
        return

    message = (
        "Welcome to CPay! Your account is ready. "
        "Deposit KES, pay bills, and send money with crypto. "
        "Visit cpay.co.ke"
    )
    send_sms(user.phone, message)
    logger.info(f"Welcome SMS sent to {user.phone}")


def send_pin_change_alert(user, ip_address="", device_info=""):
    """Send security alert email + SMS when PIN is changed.

    Args:
        user: User model instance.
        ip_address: str, IP address of the request.
        device_info: str, device description.
    """
    # Email alert (direct)
    send_security_alert(user, "pin_change", ip_address, device_info)

    # SMS alert (direct)
    if user.phone:
        send_sms(
            user.phone,
            "CPay Security: Your PIN was changed. "
            "If this was not you, contact support@cpay.co.ke immediately.",
        )
        logger.info(f"PIN change SMS alert sent to {user.phone}")


def send_pin_reset_alert(user, ip_address=""):
    """Send security alert email when PIN is reset via forgot-PIN flow.

    Args:
        user: User model instance.
        ip_address: str, IP address of the request.
    """
    send_security_alert(user, "pin_change", ip_address, "PIN reset via forgot-PIN flow")
    logger.info(f"PIN reset security alert sent for {user.phone}")


def send_deposit_confirmed_notification(user, deposit):
    """Send email + push notification when a blockchain deposit is confirmed.

    Args:
        user: User model instance.
        deposit: BlockchainDeposit model instance with amount, currency, tx_hash.
    """
    # Email notification (direct)
    if user.email:
        try:
            context = {
                "full_name": user.full_name or user.phone,
                "amount": str(deposit.amount),
                "currency": deposit.currency,
                "tx_type": "DEPOSIT",
                "tx_type_label": "Crypto Deposit",
                "status": "completed",
                "reference": deposit.tx_hash[:8].upper() if deposit.tx_hash else "N/A",
                "timestamp": deposit.credited_at.isoformat() if hasattr(deposit, "credited_at") and deposit.credited_at else "",
                "crypto_amount": str(deposit.amount),
                "crypto_currency": deposit.currency,
            }
            html_content = render_to_string("email/transaction_receipt.html", context)
            send_mail(
                f"CPay — Deposit Confirmed: {deposit.amount} {deposit.currency}",
                "",
                settings.DEFAULT_FROM_EMAIL,
                [user.email],
                html_message=html_content,
                fail_silently=True,
            )
            logger.info(f"Deposit confirmation email sent to {user.email}")
        except Exception as e:
            logger.error(f"Failed to send deposit confirmation email to {user.email}: {e}")

    # SMS notification (direct)
    if user.phone:
        ref = deposit.tx_hash[:8].upper() if deposit.tx_hash else "N/A"
        send_sms(
            user.phone,
            f"CPay: Deposit of {deposit.amount} {deposit.currency} confirmed "
            f"and credited to your wallet. Ref: {ref}. Thank you for using CPay."
        )
        logger.info(f"Deposit SMS sent to {user.phone}")

    # Push notification (keep as Celery — external API)
    try:
        from apps.core.tasks import send_push_task
        send_push_task.delay(
            user_id=str(user.id),
            title="Deposit Confirmed",
            body=f"{deposit.amount} {deposit.currency} has been credited to your wallet.",
            data={"type": "deposit_confirmed", "currency": deposit.currency},
        )
    except Exception as e:
        logger.error(f"Failed to queue deposit push notification: {e}")


def send_admin_kyc_upload_alert(user, document_type):
    """Send admin alert when a user uploads a KYC document.

    Args:
        user: User model instance.
        document_type: str, e.g. 'national_id', 'passport'.
    """
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
