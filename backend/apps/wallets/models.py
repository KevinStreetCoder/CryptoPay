import uuid

from django.conf import settings
from django.db import models


class Currency(models.TextChoices):
    USDT = "USDT"
    USDC = "USDC"
    BTC = "BTC"
    ETH = "ETH"
    SOL = "SOL"
    KES = "KES"


class WalletTier(models.TextChoices):
    HOT = "hot", "Hot (online, instant access)"
    WARM = "warm", "Warm (online, delayed access)"
    COLD = "cold", "Cold (offline, manual access)"


class Wallet(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wallets",
    )
    currency = models.CharField(max_length=10, choices=Currency.choices)
    balance = models.DecimalField(max_digits=28, decimal_places=8, default=0)
    locked_balance = models.DecimalField(max_digits=28, decimal_places=8, default=0)
    deposit_address = models.CharField(max_length=255, blank=True)
    address_index = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "wallets"
        unique_together = ("user", "currency")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(balance__gte=0),
                name="wallet_balance_non_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(locked_balance__gte=0),
                name="wallet_locked_balance_non_negative",
            ),
            models.UniqueConstraint(
                fields=["deposit_address"],
                name="wallet_deposit_address_unique",
                condition=models.Q(deposit_address__gt=""),
            ),
        ]

    def __str__(self):
        return f"{self.user.phone} - {self.currency}: {self.balance}"

    @property
    def available_balance(self):
        return self.balance - self.locked_balance


class LedgerEntry(models.Model):
    """Double-entry bookkeeping. Every financial operation creates balanced entries."""

    class EntryType(models.TextChoices):
        DEBIT = "DEBIT"
        CREDIT = "CREDIT"

    id = models.BigAutoField(primary_key=True)
    transaction_id = models.UUIDField(db_index=True)
    wallet = models.ForeignKey(Wallet, on_delete=models.CASCADE, related_name="ledger_entries")
    entry_type = models.CharField(max_length=10, choices=EntryType.choices)
    amount = models.DecimalField(max_digits=28, decimal_places=8)
    balance_after = models.DecimalField(max_digits=28, decimal_places=8)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ledger_entries"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="ledger_amount_positive",
            ),
            models.UniqueConstraint(
                fields=["transaction_id", "wallet_id", "entry_type"],
                name="ledger_idempotent_entry",
            ),
        ]

    def __str__(self):
        return f"{self.entry_type} {self.amount} {self.wallet.currency} → {self.balance_after}"


# System wallets for the platform's own funds (hot wallet, fee collection, etc.)
class SystemWallet(models.Model):
    """Platform-owned wallets for float, fees, and liquidity."""

    class WalletType(models.TextChoices):
        HOT = "hot"
        WARM = "warm"
        COLD = "cold"
        FEE = "fee"
        FLOAT = "float"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    wallet_type = models.CharField(max_length=10, choices=WalletType.choices)
    currency = models.CharField(max_length=10, choices=Currency.choices)
    chain = models.CharField(
        max_length=20,
        blank=True,
        help_text="Blockchain network (tron, ethereum, bitcoin, solana, polygon)",
    )
    tier = models.CharField(
        max_length=10,
        choices=WalletTier.choices,
        default=WalletTier.HOT,
        db_index=True,
        help_text="Custody tier for this wallet",
    )
    address = models.CharField(
        max_length=255,
        blank=True,
        help_text="On-chain address of this system wallet",
    )
    balance = models.DecimalField(max_digits=28, decimal_places=8, default=0)
    last_reconciled = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last time on-chain balance was verified against DB balance",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Whether this wallet is currently in use",
    )
    max_daily_withdrawal = models.DecimalField(
        max_digits=28,
        decimal_places=8,
        null=True,
        blank=True,
        help_text="Maximum daily withdrawal limit for this wallet",
    )
    notes = models.TextField(
        blank=True,
        help_text="Admin notes about this wallet (e.g., HSM location, signing procedure)",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "system_wallets"
        unique_together = ("wallet_type", "currency")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(balance__gte=0),
                name="system_wallet_balance_non_negative",
            ),
        ]

    def __str__(self):
        tier_label = f" [{self.tier}]" if self.tier else ""
        return f"System {self.wallet_type}{tier_label} - {self.currency}: {self.balance}"


class CustodyTransfer(models.Model):
    """
    Tracks transfers between custody tiers (hot/warm/cold).

    Every movement of funds between tiers is recorded here for audit and
    reconciliation purposes. Transfers may be automatic (threshold-based)
    or manual (admin-initiated).
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUBMITTED = "submitted", "Submitted (TX broadcast)"
        CONFIRMED = "confirmed", "Confirmed on-chain"
        COMPLETED = "completed", "Completed (balances updated)"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    from_tier = models.CharField(max_length=10, choices=WalletTier.choices)
    to_tier = models.CharField(max_length=10, choices=WalletTier.choices)
    currency = models.CharField(max_length=10, choices=Currency.choices)
    amount = models.DecimalField(max_digits=28, decimal_places=8)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )

    # On-chain details
    tx_hash = models.CharField(max_length=255, blank=True)
    from_address = models.CharField(max_length=255, blank=True)
    to_address = models.CharField(max_length=255, blank=True)
    gas_fee = models.DecimalField(
        max_digits=28, decimal_places=8, null=True, blank=True,
        help_text="Network fee paid for this transfer",
    )

    # Who initiated this transfer
    initiated_by = models.CharField(
        max_length=100,
        blank=True,
        help_text="'system' for automatic, or admin username for manual",
    )
    reason = models.TextField(
        blank=True,
        help_text="Why this transfer was initiated",
    )
    error_message = models.TextField(blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "custody_transfers"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["from_tier", "to_tier"]),
            models.Index(fields=["-created_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="custody_transfer_amount_positive",
            ),
        ]

    def __str__(self):
        return (
            f"Custody {str(self.id)[:8]} | "
            f"{self.from_tier}→{self.to_tier} | "
            f"{self.amount} {self.currency} | {self.status}"
        )

    @property
    def is_active(self) -> bool:
        """Transfer is still in-flight."""
        return self.status in (
            self.Status.PENDING,
            self.Status.SUBMITTED,
            self.Status.CONFIRMED,
        )


class RebalanceOrder(models.Model):
    """
    Tracks a single rebalance operation from trigger to settlement.

    Lifecycle:
      PENDING    — Order calculated, awaiting submission to exchange
      SUBMITTED  — Sent to exchange (or admin notified for manual)
      SETTLING   — Exchange confirmed sell, KES settlement in progress
      COMPLETED  — KES credited to M-Pesa float, SystemWallet updated
      FAILED     — Something went wrong (exchange error, timeout, etc.)
      CANCELLED  — Admin or system cancelled before completion
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUBMITTED = "submitted", "Submitted to Exchange"
        SETTLING = "settling", "Settlement in Progress"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    class TriggerType(models.TextChoices):
        AUTO = "auto", "Automatic (circuit breaker)"
        MANUAL = "manual", "Manual (admin)"
        SCHEDULED = "scheduled", "Scheduled (periodic check)"

    class ExecutionMode(models.TextChoices):
        MANUAL = "manual", "Manual (admin sells on exchange dashboard)"
        API = "api", "API (automated via Yellow Card API)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # What triggered this rebalance
    trigger = models.CharField(max_length=20, choices=TriggerType.choices)
    execution_mode = models.CharField(
        max_length=20,
        choices=ExecutionMode.choices,
        default=ExecutionMode.MANUAL,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )

    # Float state at trigger time
    float_balance_at_trigger = models.DecimalField(
        max_digits=28, decimal_places=2,
        help_text="M-Pesa float balance when rebalance was triggered",
    )
    target_float_balance = models.DecimalField(
        max_digits=28, decimal_places=2,
        default=1_500_000,
        help_text="Target float balance after rebalance",
    )

    # Crypto sell details
    sell_currency = models.CharField(max_length=10, default="USDT")
    sell_amount = models.DecimalField(
        max_digits=28, decimal_places=8,
        help_text="Amount of crypto to sell",
    )
    expected_kes_amount = models.DecimalField(
        max_digits=28, decimal_places=2,
        help_text="Expected KES from the sale (at quote time)",
    )
    exchange_rate_at_quote = models.DecimalField(
        max_digits=18, decimal_places=8,
        help_text="Exchange rate when order was calculated",
    )

    # Actual settlement
    actual_kes_received = models.DecimalField(
        max_digits=28, decimal_places=2,
        null=True, blank=True,
        help_text="Actual KES received after settlement",
    )
    actual_exchange_rate = models.DecimalField(
        max_digits=18, decimal_places=8,
        null=True, blank=True,
        help_text="Actual rate at execution",
    )
    exchange_fee_kes = models.DecimalField(
        max_digits=28, decimal_places=2,
        null=True, blank=True,
        help_text="Fee charged by exchange",
    )

    # Exchange tracking
    exchange_provider = models.CharField(
        max_length=50, default="yellow_card",
        help_text="Which exchange was used",
    )
    exchange_order_id = models.CharField(
        max_length=255, blank=True,
        help_text="Order ID from exchange (for reconciliation)",
    )
    exchange_reference = models.CharField(
        max_length=255, blank=True,
        help_text="Any reference from the exchange (receipt, tx hash, etc.)",
    )

    # Admin notes (for manual mode)
    admin_notes = models.TextField(
        blank=True,
        help_text="Notes from admin about manual execution",
    )

    # State tracking
    reason = models.TextField(
        blank=True,
        help_text="Why this rebalance was triggered",
    )
    error_message = models.TextField(blank=True)
    retry_count = models.SmallIntegerField(default=0)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    settled_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "rebalance_orders"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["-created_at"]),
        ]

    def __str__(self):
        return (
            f"Rebalance {str(self.id)[:8]} | "
            f"{self.sell_amount} {self.sell_currency} → "
            f"KES {self.expected_kes_amount:,.0f} | {self.status}"
        )

    @property
    def is_active(self) -> bool:
        """Order is still in-flight (not terminal)."""
        return self.status in (
            self.Status.PENDING,
            self.Status.SUBMITTED,
            self.Status.SETTLING,
        )

    @property
    def slippage_kes(self):
        """Difference between expected and actual KES received."""
        if self.actual_kes_received is not None:
            return self.actual_kes_received - self.expected_kes_amount
        return None

    @property
    def age_minutes(self) -> float:
        """How long since this order was created."""
        from django.utils import timezone
        return (timezone.now() - self.created_at).total_seconds() / 60
