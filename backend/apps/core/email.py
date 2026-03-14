"""Email service module — thin wrappers that dispatch Celery tasks for async email delivery."""

import logging

logger = logging.getLogger(__name__)


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

    # Admin alert for failed transactions
    if str(transaction.status) == "failed":
        from apps.core.tasks import send_failed_transaction_alert_task

        send_failed_transaction_alert_task.delay(
            transaction_id=str(transaction.id),
        )


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
