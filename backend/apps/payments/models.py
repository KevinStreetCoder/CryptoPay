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
    # 2026-05-09 · resolved business name for the paybill/till the user
    # paid · sourced from SasaPay's `account-validation` endpoint at
    # quote time and/or `RecipientName` from the B2B result callback.
    # Surfaced on receipt + tx detail so users see "Paid to KPLC PREPAID"
    # not just "Paybill 888880". Free-form (some Kenyan paybills carry
    # the trade name only, others carry the legal-entity name); we don't
    # validate the value beyond a length cap.
    merchant_name = models.CharField(max_length=120, blank=True)

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


class PlatformLimit(models.Model):
    """Admin-settable safety caps on outgoing payment volume.

    Layered above (independent of) the existing PaymentCircuitBreaker:

      Circuit breaker  · gates per-tx based on LIVE float health.
                         Auto-managed by the float-balance check task.
      PlatformLimit    · gates per-tx + per-window based on ADMIN
                         policy. Survives a healthy float reading.
                         Stops a hot-wallet compromise from draining
                         the treasury even if the float balance is
                         still healthy enough to clear each tx.

    Single-row table by design · accessed via
    `PlatformLimit.current()` which fetches the singleton (creating
    sane defaults on first read). Admin DRF endpoints
    `/api/v1/payments/admin/limits/` GET/PATCH this row.

    All values are KES. Set a cap to 0 to disable that specific guard
    (useful if ops wants to relax one cap without disabling the
    others). `hard_pause=True` is the kill switch · refuses every
    outgoing payment regardless of other caps. Audit log on every
    change so post-incident review can reconstruct who flipped what.
    """

    id = models.AutoField(primary_key=True)

    # Per-transaction maximum · refuses any single outgoing payment
    # above this amount. 0 disables this cap.
    max_per_tx_kes = models.DecimalField(
        max_digits=18, decimal_places=2, default=300_000,
        help_text="Hard cap on a single outgoing transaction (KES). "
                  "0 disables.",
    )

    # Rolling-hour outgoing cap · sum of completed outgoing tx in the
    # last 60 minutes must not exceed this. Protects against burst
    # drain. 0 disables.
    max_per_hour_kes = models.DecimalField(
        max_digits=18, decimal_places=2, default=2_000_000,
        help_text="Cap on outgoing volume in the last 60 minutes "
                  "(KES). 0 disables.",
    )

    # Rolling-day outgoing cap. 0 disables.
    max_per_day_kes = models.DecimalField(
        max_digits=18, decimal_places=2, default=10_000_000,
        help_text="Cap on outgoing volume in the last 24 hours "
                  "(KES). 0 disables.",
    )

    # Velocity guard · refuse if MORE than N outgoing tx in last hour.
    # Caught us in 2026-03-21 audit · a stolen API key was firing
    # 50 KES txs/sec; we want a count cap, not just KES.
    max_tx_per_hour_count = models.IntegerField(
        default=200,
        help_text="Cap on outgoing tx COUNT in the last 60 minutes. "
                  "0 disables.",
    )

    # Kill switch · refuses every outgoing payment regardless of other
    # caps. Use for incident response.
    hard_pause = models.BooleanField(
        default=False,
        help_text="If True, refuses ALL outgoing payments. Kill switch "
                  "for incident response · independent of the float-"
                  "based circuit breaker.",
    )
    hard_pause_reason = models.CharField(
        max_length=255, blank=True, default="",
    )

    # Last admin to update + when (audit summary; full trail in AuditLog).
    last_updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="updated_platform_limits",
    )
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "platform_limits"

    def __str__(self):
        return (
            f"PlatformLimit · per_tx={self.max_per_tx_kes} "
            f"hour={self.max_per_hour_kes} "
            f"day={self.max_per_day_kes} "
            f"count_hr={self.max_tx_per_hour_count} "
            f"paused={self.hard_pause}"
        )

    @classmethod
    def current(cls) -> "PlatformLimit":
        """Return the singleton row · creates with defaults on first read."""
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class DepositIntent(models.Model):
    """Short-code-keyed deposit reservation for the SasaPay C2B flow.

    Why this exists · the SasaPay docs are ambiguous on whether the
    customer-entered Account Number for an aggregator paybill is
    forwarded verbatim in the IPN's `BillRefNumber` field. The docs'
    example value `PR52` looks like a SasaPay-generated short ref,
    not the customer's input. Until that's confirmed (support ticket
    pending) we cannot rely on `1334777-USDT-254712345678` reaching
    our parser intact.

    The DepositIntent flow sidesteps the question entirely:

      1. User picks the crypto + opens the deposit screen
      2. Backend creates an intent with a 6-char Crockford-base32 code
         (~1B possibilities, no I/O/L/U so no 0/O or 1/I confusion)
      3. App displays "Pay Bill 756756, Account: 7K9F2X"
      4. Customer enters that exact 6-char code into M-Pesa
      5. SasaPay forwards it (in whichever field) to our IPN
      6. We look up the intent by code → find the (user, currency) →
         credit the right wallet at the live rate

    Robust against three SasaPay forwarding behaviours:
      - Verbatim forward of full account string (BillRefNumber=7K9F2X) ✓
      - SasaPay-generated short ref (still our 7K9F2X) ✓
      - Strip-after-merchant-code (BillRefNumber=1334777) → falls
        through to legacy `1334777-USDT-phone` parser, then to KES
        credit · all paths safe.

    The legacy `1334777-<CRYPTO>-<phone>` format STILL works as a
    backup · the IPN handler tries the intent-code lookup first,
    then the legacy parser, then KES fallback. So existing users who
    learned the long format aren't broken when we add this.
    """

    class Status(models.TextChoices):
        OPEN = "open", "Open"               # waiting for customer payment
        CONSUMED = "consumed", "Consumed"   # matched to a Transaction
        EXPIRED = "expired", "Expired"      # TTL lapsed before payment
        CANCELLED = "cancelled", "Cancelled"  # user-initiated invalidation

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(
        max_length=12,
        unique=True,
        db_index=True,
        help_text="Short Crockford-base32 code customers enter as the "
                  "M-Pesa account number. Generated by the service · "
                  "never user-supplied.",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="deposit_intents",
    )
    currency = models.CharField(
        max_length=10,
        help_text="Target currency the KES will be auto-converted to. "
                  "Use 'KES' to deposit straight to the KES wallet "
                  "(no auto-buy).",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.OPEN,
        db_index=True,
    )
    expires_at = models.DateTimeField(db_index=True)
    consumed_at = models.DateTimeField(null=True, blank=True)
    transaction = models.ForeignKey(
        "Transaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deposit_intent",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "deposit_intents"
        ordering = ["-created_at"]
        indexes = [
            # Hot path · "find active intent for this code"
            models.Index(fields=["code", "status"], name="deposit_code_status"),
            # Sweep · "find expired intents to mark"
            models.Index(fields=["status", "expires_at"], name="deposit_sweep"),
        ]

    def __str__(self):
        return f"DepositIntent {self.code} · {self.currency} · {self.status}"

    @property
    def is_active(self) -> bool:
        from django.utils import timezone
        return (
            self.status == self.Status.OPEN
            and self.expires_at > timezone.now()
        )
