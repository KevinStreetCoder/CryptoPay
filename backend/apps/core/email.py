"""Email service module — thin wrappers that dispatch Celery tasks for async email delivery."""

import logging

logger = logging.getLogger(__name__)


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
        transaction: Transaction-like object with amount, currency, tx_type,
                     status, reference, and created_at attributes.
    """
    if not user.email:
        logger.warning(f"Cannot send receipt: user {user.phone} has no email.")
        return

    from apps.core.tasks import send_transaction_receipt_task

    send_transaction_receipt_task.delay(
        user_email=user.email,
        user_full_name=user.full_name or user.phone,
        amount=str(transaction.amount),
        currency=getattr(transaction, "currency", "KES"),
        tx_type=getattr(transaction, "tx_type", "payment"),
        status=str(transaction.status),
        reference=str(transaction.reference),
        timestamp=transaction.created_at.isoformat(),
    )
    logger.info(f"Queued transaction receipt for {user.email} — ref {transaction.reference}")


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
