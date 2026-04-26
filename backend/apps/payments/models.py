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

    # 2026-04-26 · denormalised flag set when a `ReconciliationCase`
    # in OPEN status exists for this transaction. The user-facing API
    # uses this to refuse sensitive actions (withdraw, swap) on a row
    # that ops are still investigating · cheaper than a join on every
    # request. Maintained by signal handlers on ReconciliationCase
    # save / delete.
    has_open_reconciliation = models.BooleanField(
        default=False, db_index=True,
        help_text="True while at least one ReconciliationCase row is OPEN/ESCALATED for this tx.",
    )

    class Meta:
        db_table = "transactions"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=['user', 'status', 'created_at'], name='tx_user_status_created'),
            models.Index(fields=['user', 'created_at'], name='tx_user_created'),
        ]

    def __str__(self):
        return f"{self.type} {self.status} - {self.source_amount} {self.source_currency}"


class ReconciliationCase(models.Model):
    """Anomaly queue for payments that need ops attention.

    2026-04-26 · introduced for the saga's "late M-Pesa success on
    a compensated transaction" double-settlement case (saga.py:307).
    Schema follows the Stripe-style ledger-intent pattern · separate
    table holds the anomaly history; the parent Transaction stays in
    its terminal status (`compensated`, `completed`, etc.) and a
    denormalised `Transaction.has_open_reconciliation` flag lets
    the API layer block sensitive actions while a case is open.

    Industry-standard time-to-detect for double-settlement is 5
    minutes (Wise, Adyen). `sla_breach_at = detected_at + 5 min`;
    the daily sweep cron escalates breached cases to PagerDuty.
    """

    class CaseType(models.TextChoices):
        # Compensation completed, but a late M-Pesa success callback
        # arrived afterwards · user got both crypto refund AND M-Pesa
        # transfer. The most dangerous failure mode in our system.
        DOUBLE_SETTLEMENT = "double_settlement", "Double settlement"
        # M-Pesa callback arrived AFTER our timeout-driven compensation
        # decided to refund. Resolves to DOUBLE_SETTLEMENT once we
        # confirm the M-Pesa side actually succeeded.
        LATE_CALLBACK = "late_callback", "Late callback"
        # M-Pesa B2B succeeded but no compensation was triggered AND
        # no completion was recorded · saga state machine bug.
        ORPHAN_B2B = "orphan_b2b", "Orphan B2B"
        # `compensate_convert_async` exhausted all retries · user has
        # NOT been credited the crypto refund they're owed.
        COMPENSATE_FAILED = "compensate_failed", "Compensation failed"
        # M-Pesa reversal call failed AND the active provider doesn't
        # support automated reversal · ops must phone Safaricom.
        REVERSAL_NOT_SUPPORTED = "reversal_not_supported", "Reversal not supported"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        # Auto-recovery succeeded (e.g. B2C clawback to user phone for
        # late-callback when amount < KES 10k AND user balance >= owed).
        AUTO_RESOLVED = "auto_resolved", "Auto-resolved"
        # Ops manually fixed it · resolution_action describes how.
        HUMAN_RESOLVED = "human_resolved", "Human-resolved"
        # SLA breached AND/OR severity bumped · routed to PagerDuty.
        ESCALATED = "escalated", "Escalated"

    class Severity(models.IntegerChoices):
        INFO = 1, "Info"
        LOW = 2, "Low"
        MEDIUM = 3, "Medium"
        HIGH = 4, "High"
        CRITICAL = 5, "Critical · page on-call"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.ForeignKey(
        "Transaction",
        on_delete=models.CASCADE,
        related_name="recon_cases",
        db_index=True,
    )
    case_type = models.CharField(max_length=32, choices=CaseType.choices, db_index=True)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.OPEN, db_index=True,
    )
    severity = models.IntegerField(
        choices=Severity.choices, default=Severity.HIGH,
    )
    detected_at = models.DateTimeField(auto_now_add=True, db_index=True)
    sla_breach_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When this case crosses its SLO · auto-escalation trigger.",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_action = models.CharField(
        max_length=32, blank=True, default="",
        help_text="reverse_refund / b2c_clawback / write_off / human_review / not_applicable",
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="assigned_recon_cases",
    )
    correlation_id = models.CharField(
        max_length=64, blank=True, default="", db_index=True,
        help_text="Saga correlation ID · ties together every log line, retry, and alert for this case.",
    )
    evidence = models.JSONField(
        default=dict, blank=True,
        help_text="Both callback payloads, timestamps, amounts, ABI codes, etc.",
    )
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "reconciliation_cases"
        ordering = ["-detected_at"]
        indexes = [
            # Hot-path: ops dashboard "open cases by severity descending"
            models.Index(fields=["status", "-severity", "detected_at"], name="recon_open_sev"),
            # Daily sweep: cases whose SLA has expired
            models.Index(fields=["status", "sla_breach_at"], name="recon_sla_sweep"),
        ]

    def __str__(self):
        return f"{self.get_case_type_display()} · {self.transaction_id} · {self.status}"


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
