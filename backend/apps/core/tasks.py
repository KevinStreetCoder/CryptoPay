"""Celery tasks for async email sending, push notifications, and admin alerts."""

import logging
import smtplib
import socket
from decimal import Decimal
from typing import Optional

from celery import shared_task
from django.core.mail import send_mail, mail_admins
from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone

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

# Human-readable transaction type labels
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
    "INTERNAL_TRANSFER": "Internal Transfer",
    "FEE": "Fee",
}


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


# ---------------------------------------------------------------------------
# OTP Email
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_otp_email_task(self, user_email, user_full_name, otp_code):
    """Send OTP verification email."""
    context = {
        "full_name": user_full_name,
        "otp_code": otp_code,
    }
    html_content = render_to_string("email/otp.html", context)
    send_email_task.delay(
        subject=f"CPay — Your verification code is {otp_code}",
        html_content=html_content,
        recipient_email=user_email,
    )


# ---------------------------------------------------------------------------
# Welcome Email
# ---------------------------------------------------------------------------

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
        subject="Welcome to CPay!",
        html_content=html_content,
        recipient_email=user_email,
    )


# ---------------------------------------------------------------------------
# Transaction Receipt
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_transaction_receipt_task(
    self, user_email, user_full_name, amount, currency, tx_type, status, reference, timestamp,
    source_amount=None, source_currency=None, exchange_rate=None,
    fee_amount=None, fee_currency=None, mpesa_receipt=None,
):
    """Send transaction receipt email with full details."""
    tx_type_label = TX_TYPE_LABELS.get(tx_type, tx_type.replace("_", " ").title())

    # Determine crypto side for display
    crypto_amount = None
    crypto_currency = None
    if source_currency and source_currency != "KES":
        crypto_amount = source_amount
        crypto_currency = source_currency
    elif currency and currency != "KES":
        crypto_amount = amount
        crypto_currency = currency

    context = {
        "full_name": user_full_name,
        "amount": amount,
        "currency": currency,
        "tx_type": tx_type,
        "tx_type_label": tx_type_label,
        "status": status,
        "reference": reference,
        "timestamp": timestamp,
        "crypto_amount": crypto_amount,
        "crypto_currency": crypto_currency,
        "exchange_rate": exchange_rate,
        "fee_amount": fee_amount,
        "fee_currency": fee_currency or "KES",
        "mpesa_receipt": mpesa_receipt,
    }
    html_content = render_to_string("email/transaction_receipt.html", context)
    send_email_task.delay(
        subject=f"CPay Receipt — {tx_type_label} {reference}",
        html_content=html_content,
        recipient_email=user_email,
    )


# ---------------------------------------------------------------------------
# KYC Status
# ---------------------------------------------------------------------------

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
        subject=f"CPay KYC Update — {status.title()}",
        html_content=html_content,
        recipient_email=user_email,
    )


# ---------------------------------------------------------------------------
# Security Alert
# ---------------------------------------------------------------------------

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
        "timestamp": timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z"),
    }
    html_content = render_to_string("email/security_alert.html", context)
    send_email_task.delay(
        subject=f"CPay Security Alert — {event_labels.get(event_type, event_type)}",
        html_content=html_content,
        recipient_email=user_email,
    )


# ---------------------------------------------------------------------------
# SMS Notification
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_transaction_sms_task(self, phone, tx_type, amount, currency, reference):
    """Send SMS notification for completed transactions (eSMS primary, AT fallback)."""
    from apps.core.email import send_sms

    label = TX_TYPE_LABELS.get(tx_type, tx_type.replace("_", " ").title())

    message = (
        f"CPay: {label} of {currency} {amount} completed successfully. "
        f"Ref: {reference}. Thank you for using CPay."
    )

    sent = send_sms(phone, message)
    if sent:
        logger.info(f"Transaction SMS sent to {phone}: ref {reference}")
    else:
        logger.warning(f"Transaction SMS delivery failed for {phone}: ref {reference}")


# ---------------------------------------------------------------------------
# Generic SMS Task (eSMS Africa + Africa's Talking)
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    max_retries=3,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def send_sms_task(self, phone, message):
    """Send an SMS using the reusable send_sms helper (eSMS primary, AT fallback)."""
    from apps.core.email import send_sms

    sent = send_sms(phone, message)
    if not sent:
        logger.warning(f"SMS delivery failed for {phone[:7]}*** (all providers)")
    return sent


# ---------------------------------------------------------------------------
# PDF Receipt
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Push Notification
# ---------------------------------------------------------------------------

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
    """
    from apps.core.push import send_push_notification

    logger.info(f"Sending push notification to user {user_id}: {title}")
    tickets = send_push_notification(user_id, title, body, data)
    logger.info(f"Push notification sent to user {user_id}: {len(tickets)} ticket(s)")
    return tickets


# ---------------------------------------------------------------------------
# Database Backup
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def daily_database_backup(self):
    """Run the database backup script daily via Celery Beat."""
    import os
    import subprocess

    script_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "scripts",
        "backup_db.sh",
    )

    if not os.path.isfile(script_path):
        logger.error(f"Backup script not found at {script_path}")
        return {"status": "error", "message": "Backup script not found"}

    env = os.environ.copy()
    from django.conf import settings as _settings

    db_conf = _settings.DATABASES.get("default", {})
    env.setdefault("DB_NAME", db_conf.get("NAME", "cryptopay"))
    env.setdefault("DB_USER", db_conf.get("USER", "cryptopay"))
    env.setdefault("DB_HOST", db_conf.get("HOST", "localhost"))
    env.setdefault("DB_PORT", str(db_conf.get("PORT", "5432")))
    env.setdefault("DB_PASSWORD", db_conf.get("PASSWORD", ""))

    try:
        result = subprocess.run(
            ["bash", script_path],
            capture_output=True,
            text=True,
            timeout=600,
            env=env,
        )

        if result.returncode != 0:
            logger.error(f"Backup script failed (exit {result.returncode}): {result.stderr}")
            raise RuntimeError(f"Backup script exited with code {result.returncode}")

        logger.info(f"Database backup completed successfully: {result.stdout[-200:]}")
        return {"status": "success", "output": result.stdout[-500:]}

    except subprocess.TimeoutExpired:
        logger.error("Database backup timed out after 600 seconds")
        raise
    except Exception as exc:
        logger.error(f"Database backup failed: {exc}")
        raise


# ===========================================================================
# ADMIN ALERT TASKS (Feature 3)
# ===========================================================================


# ---------------------------------------------------------------------------
# 3a. New User Registration Alert
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    max_retries=2,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=120,
)
def send_admin_new_user_alert_task(self, user_phone, user_full_name, user_email, kyc_tier=0):
    """Email admin when a new user registers."""
    now = timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z")
    body = (
        f"New CPay User Registration\n"
        f"{'=' * 40}\n"
        f"Phone: {user_phone}\n"
        f"Name: {user_full_name or '(not set)'}\n"
        f"Email: {user_email or '(not set)'}\n"
        f"KYC Tier: {kyc_tier}\n"
        f"Registered at: {now}\n"
    )
    try:
        mail_admins(
            subject=f"[CPay] New user registered: {user_phone}",
            message=body,
            fail_silently=False,
        )
        logger.info(f"Admin new-user alert sent for {user_phone}")
    except Exception as exc:
        logger.error(f"Failed to send admin new-user alert for {user_phone}: {exc}")
        raise


# ---------------------------------------------------------------------------
# 3c. Daily Summary Email (Celery Beat at 8:00 AM EAT)
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    name="apps.core.tasks.daily_summary_email",
    max_retries=2,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=300,
)
def daily_summary_email(self):
    """
    Send daily operations summary to admins at 8:00 AM EAT.
    Includes: new users, transaction counts, volume, wallet balances.
    """
    from datetime import timedelta
    from django.db.models import Sum, Count, Q

    now = timezone.now()
    yesterday = now - timedelta(hours=24)
    date_str = now.strftime("%Y-%m-%d")

    # --- New users ---
    # Our User model inherits AbstractBaseUser (NOT AbstractUser), so there is
    # no `date_joined` field — use the `created_at` column that the model
    # defines via auto_now_add=True. The previous code used `date_joined`
    # which raised FieldError on every run and produced "N/A" in the email.
    try:
        from apps.accounts.models import User
        new_users_count = User.objects.filter(created_at__gte=yesterday).count()
    except Exception as e:
        # Log loudly so a future model rename can't silently break the email
        # back to "N/A" without us noticing.
        logger.error(f"Daily summary: new-users count query failed: {e}", exc_info=True)
        new_users_count = "N/A"

    # --- Transaction stats ---
    try:
        from apps.payments.models import Transaction

        tx_qs = Transaction.objects.filter(created_at__gte=yesterday)
        total_transactions = tx_qs.count()
        completed_transactions = tx_qs.filter(status="completed").count()
        failed_transactions = tx_qs.filter(status="failed").count()

        # Volume in KES (dest_amount for KES transactions, source_amount for crypto->KES)
        volume_agg = tx_qs.filter(status="completed").aggregate(
            kes_volume=Sum("source_amount", filter=Q(source_currency="KES")),
            dest_volume=Sum("dest_amount", filter=Q(dest_currency="KES")),
        )
        kes_in = volume_agg["kes_volume"] or Decimal("0")
        kes_out = volume_agg["dest_volume"] or Decimal("0")
        total_volume_kes = f"{(kes_in + kes_out):,.0f}"
    except Exception as e:
        logger.error(f"Daily summary: transaction stats failed: {e}")
        total_transactions = "N/A"
        completed_transactions = "N/A"
        failed_transactions = "N/A"
        total_volume_kes = "N/A"

    # --- System wallet balances ---
    wallet_balances = []
    try:
        from apps.wallets.models import SystemWallet
        for sw in SystemWallet.objects.all().order_by("wallet_type", "currency"):
            wallet_balances.append({
                "wallet_type": sw.wallet_type.title(),
                "currency": sw.currency,
                "balance": f"{sw.balance:,.8f}".rstrip("0").rstrip("."),
            })
    except Exception as e:
        logger.error(f"Daily summary: wallet balances failed: {e}")

    # --- Render HTML email ---
    context = {
        "date": date_str,
        "new_users_count": new_users_count,
        "total_transactions": total_transactions,
        "completed_transactions": completed_transactions,
        "failed_transactions": failed_transactions,
        "total_volume_kes": total_volume_kes,
        "wallet_balances": wallet_balances,
    }
    html_content = render_to_string("email/admin_daily_summary.html", context)

    # --- Also send plain text to admins ---
    plain_text = (
        f"CPay Daily Summary — {date_str}\n"
        f"{'=' * 40}\n"
        f"New users: {new_users_count}\n"
        f"Transactions: {total_transactions} "
        f"(completed: {completed_transactions}, failed: {failed_transactions})\n"
        f"Volume (KES): {total_volume_kes}\n"
    )
    if wallet_balances:
        plain_text += f"\nWallet Balances:\n"
        for w in wallet_balances:
            plain_text += f"  {w['currency']} ({w['wallet_type']}): {w['balance']}\n"

    try:
        mail_admins(
            subject=f"[CPay] Daily Summary — {date_str}",
            message=plain_text,
            html_message=html_content,
            fail_silently=False,
        )
        logger.info(f"Daily summary email sent for {date_str}")
    except Exception as exc:
        logger.error(f"Failed to send daily summary email: {exc}")
        raise

    return {"date": date_str, "new_users": new_users_count, "transactions": total_transactions}


# ---------------------------------------------------------------------------
# 3d. Failed Transaction Alert
# ---------------------------------------------------------------------------

@shared_task(
    bind=True,
    name="apps.core.tasks.send_failed_transaction_alert",
    max_retries=2,
    autoretry_for=_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_backoff_max=120,
)
def send_failed_transaction_alert_task(self, transaction_id):
    """Email admin immediately when a transaction fails."""
    from apps.payments.models import Transaction

    try:
        tx = Transaction.objects.select_related("user").get(id=transaction_id)
    except Transaction.DoesNotExist:
        logger.error(f"Failed tx alert: transaction {transaction_id} not found")
        return

    user = tx.user
    ref = str(tx.id)[:8].upper()
    tx_label = TX_TYPE_LABELS.get(tx.type, tx.type)
    now = timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z")

    body = (
        f"FAILED TRANSACTION ALERT\n"
        f"{'=' * 40}\n"
        f"Reference: {ref}\n"
        f"Type: {tx_label}\n"
        f"User: {user.phone} ({user.full_name or 'N/A'})\n"
        f"Amount: {tx.source_amount} {tx.source_currency} -> {tx.dest_amount} {tx.dest_currency}\n"
        f"Error: {tx.failure_reason or 'Unknown'}\n"
        f"M-Pesa Receipt: {tx.mpesa_receipt or 'N/A'}\n"
        f"Created: {tx.created_at.isoformat()}\n"
        f"Alert time: {now}\n\n"
        f"Action: Review in admin panel.\n"
    )

    try:
        mail_admins(
            subject=f"[CPay ALERT] Failed Transaction — {tx_label} {ref}",
            message=body,
            fail_silently=False,
        )
        logger.info(f"Failed transaction alert sent for {ref}")
    except Exception as exc:
        logger.error(f"Failed to send failed-tx alert for {ref}: {exc}")
        raise

    # Also push to admin devices
    try:
        from apps.core.push import send_admin_alert
        send_admin_alert(
            title=f"Failed: {tx_label}",
            body=f"{user.phone} — {tx.source_amount} {tx.source_currency}. Error: {tx.failure_reason or 'Unknown'}",
        )
    except Exception:
        pass
