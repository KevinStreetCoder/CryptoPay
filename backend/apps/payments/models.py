import uuid

from django.conf import settings
from django.db import models


class Transaction(models.Model):
    """Core transaction record. Every financial operation is a transaction."""

    class Type(models.TextChoices):
        DEPOSIT = "DEPOSIT"
        WITHDRAWAL = "WITHDRAWAL"
        BUY = "BUY"
        SELL = "SELL"
        PAYBILL_PAYMENT = "PAYBILL_PAYMENT"
        TILL_PAYMENT = "TILL_PAYMENT"
        SEND_MPESA = "SEND_MPESA"
        KES_DEPOSIT = "KES_DEPOSIT"
        KES_DEPOSIT_C2B = "KES_DEPOSIT_C2B"
        SWAP = "SWAP"
        INTERNAL_TRANSFER = "INTERNAL_TRANSFER"
        FEE = "FEE"

    class Status(models.TextChoices):
        PENDING = "pending"
        PROCESSING = "processing"
        CONFIRMING = "confirming"
        COMPLETED = "completed"
        FAILED = "failed"
        REVERSED = "reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    idempotency_key = models.CharField(max_length=64, unique=True, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    type = models.CharField(max_length=30, choices=Type.choices, db_index=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True
    )

    # Amounts
    source_currency = models.CharField(max_length=10, blank=True)
    source_amount = models.DecimalField(max_digits=28, decimal_places=8, null=True, blank=True)
    dest_currency = models.CharField(max_length=10, blank=True)
    dest_amount = models.DecimalField(max_digits=28, decimal_places=8, null=True, blank=True)
    exchange_rate = models.DecimalField(max_digits=18, decimal_places=8, null=True, blank=True)
    fee_amount = models.DecimalField(max_digits=28, decimal_places=8, default=0)
    fee_currency = models.CharField(max_length=10, blank=True)
    excise_duty_amount = models.DecimalField(max_digits=28, decimal_places=8, default=0)

    # M-Pesa fields
    mpesa_paybill = models.CharField(max_length=20, blank=True)
    mpesa_till = models.CharField(max_length=20, blank=True)
    mpesa_account = models.CharField(max_length=50, blank=True)
    mpesa_phone = models.CharField(max_length=15, blank=True)
    mpesa_receipt = models.CharField(max_length=30, blank=True)

    # Blockchain fields
    chain = models.CharField(max_length=20, blank=True)
    tx_hash = models.CharField(max_length=100, blank=True)
    confirmations = models.IntegerField(default=0)

    # Metadata
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    device_id = models.CharField(max_length=100, blank=True)
    risk_score = models.DecimalField(max_digits=3, decimal_places=2, null=True, blank=True)
    failure_reason = models.TextField(blank=True)

    # Saga tracking
    saga_step = models.SmallIntegerField(default=0)
    saga_data = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "transactions"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=['user', 'status', 'created_at'], name='tx_user_status_created'),
            models.Index(fields=['user', 'created_at'], name='tx_user_created'),
        ]

    def __str__(self):
        return f"{self.type} {self.status} - {self.source_amount} {self.source_currency}"


class SavedPaybill(models.Model):
    """User-saved paybill for quick repeat payments."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="saved_paybills",
    )
    paybill_number = models.CharField(max_length=20)
    account_number = models.CharField(max_length=50)
    label = models.CharField(max_length=100, blank=True, help_text="e.g. KPLC Home, DSTV")
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "saved_paybills"
        ordering = ["-last_used_at", "-created_at"]
        unique_together = [("user", "paybill_number", "account_number")]

    def __str__(self):
        return f"{self.user} — {self.label or self.paybill_number} ({self.account_number})"
