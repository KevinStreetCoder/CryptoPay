"""Celery tasks for async email sending and push notifications."""

import logging
import smtplib
import socket
from typing import Optional

from celery import shared_task
from django.core.mail import send_mail
from django.conf import settings
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

# Transient errors worth retrying (network, SMTP, external API issues)
_TRANSIENT_ERRORS = (
    ConnectionError,
    TimeoutError,
    OSError,
    socket.error,
    smtplib.SMTPException,
    IOError,
)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_email_task(self, subject, html_content, recipient_email):
    """Generic email task with retry on failure (max 3 retries, exponential backoff)."""
    try:
        send_mail(
            subject=subject,
            message="",  # plain text fallback is empty; HTML is primary
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient_email],
            html_message=html_content,
            fail_silently=False,
        )
        logger.info(f"Email sent to {recipient_email}: {subject}")
    except Exception as exc:
        logger.error(f"Failed to send email to {recipient_email}: {exc}")
        raise


@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_welcome_email_task(self, user_email, user_full_name, user_phone):
    """Send welcome email to a newly registered user."""
    context = {
        "full_name": user_full_name or user_phone,
        "phone": user_phone,
    }
    html_content = render_to_string("email/welcome.html", context)
    send_email_task.delay(
        subject="Welcome to CryptoPay!",
        html_content=html_content,
        recipient_email=user_email,
    )


@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_transaction_receipt_task(
    self, user_email, user_full_name, amount, currency, tx_type, status, reference, timestamp
):
    """Send transaction receipt email."""
    context = {
        "full_name": user_full_name,
        "amount": amount,
        "currency": currency,
        "tx_type": tx_type,
        "status": status,
        "reference": reference,
        "timestamp": timestamp,
    }
    html_content = render_to_string("email/transaction_receipt.html", context)
    send_email_task.delay(
        subject=f"CryptoPay Transaction Receipt — {reference}",
        html_content=html_content,
        recipient_email=user_email,
    )


@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_kyc_status_email_task(
    self, user_email, user_full_name, document_type, status, rejection_reason=None
):
    """Send KYC document status update email."""
    context = {
        "full_name": user_full_name,
        "document_type": document_type.replace("_", " ").title(),
        "status": status,
        "rejection_reason": rejection_reason,
    }
    html_content = render_to_string("email/kyc_status.html", context)
    send_email_task.delay(
        subject=f"CryptoPay KYC Update — {status.title()}",
        html_content=html_content,
        recipient_email=user_email,
    )


@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_security_alert_task(
    self, user_email, user_full_name, event_type, ip_address, device_info
):
    """Send security alert email."""
    event_labels = {
        "new_device": "New Device Login",
        "password_change": "Password Changed",
        "pin_change": "PIN Changed",
        "suspicious_login": "Suspicious Login Attempt",
        "account_locked": "Account Locked",
        "account_suspended": "Account Suspended",
        "account_unsuspended": "Account Reactivated",
    }
    context = {
        "full_name": user_full_name,
        "event_type": event_type,
        "event_label": event_labels.get(event_type, event_type.replace("_", " ").title()),
        "ip_address": ip_address,
        "device_info": device_info,
    }
    html_content = render_to_string("email/security_alert.html", context)
    send_email_task.delay(
        subject=f"CryptoPay Security Alert — {event_labels.get(event_type, event_type)}",
        html_content=html_content,
        recipient_email=user_email,
    )


@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_transaction_sms_task(self, phone, tx_type, amount, currency, reference):
    """Send SMS notification for completed transactions via Africa's Talking."""
    from django.conf import settings as _settings

    # Format transaction type for display
    type_labels = {
        "PAYBILL_PAYMENT": "Paybill payment",
        "TILL_PAYMENT": "Till payment",
        "SEND_MPESA": "M-Pesa transfer",
        "BUY": "Crypto purchase",
        "DEPOSIT": "Deposit",
    }
    label = type_labels.get(tx_type, tx_type.replace("_", " ").title())

    message = (
        f"CryptoPay: {label} of {currency} {amount} completed successfully. "
        f"Ref: {reference}. Thank you for using CryptoPay."
    )

    if _settings.AT_API_KEY:
        try:
            import africastalking

            africastalking.initialize(_settings.AT_USERNAME, _settings.AT_API_KEY)
            sms = africastalking.SMS
            sms.send(message, [phone], sender_id=_settings.AT_SENDER_ID)
            logger.info(f"Transaction SMS sent to {phone}: ref {reference}")
        except Exception as exc:
            logger.error(f"Transaction SMS failed for {phone}: {exc}")
            raise
    else:
        logger.info(f"[DEV] Transaction SMS to {phone}: {message}")


@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def generate_pdf_receipt_task(self, transaction_id):
    """Generate a branded PDF receipt for a completed transaction."""
    from apps.payments.models import Transaction

    try:
        tx = Transaction.objects.select_related("user").get(id=transaction_id)
    except Transaction.DoesNotExist:
        logger.error(f"Transaction {transaction_id} not found for PDF generation")
        return None

    from apps.core.pdf_receipt import generate_receipt_pdf

    pdf_path = generate_receipt_pdf(tx)
    logger.info(f"PDF receipt generated for transaction {transaction_id}: {pdf_path}")
    return pdf_path


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=60,
)
def send_push_task(
    self,
    user_id: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
):
    """
    Async Celery task to send push notifications to a user's devices
    via the Expo Push API.

    Args:
        user_id: UUID string of the target user.
        title: Notification title.
        body: Notification body text.
        data: Optional JSON-serializable data payload.
    """
    from apps.core.push import send_push_notification

    logger.info(f"Sending push notification to user {user_id}: {title}")
    tickets = send_push_notification(user_id, title, body, data)
    logger.info(f"Push notification sent to user {user_id}: {len(tickets)} ticket(s)")
    return tickets
