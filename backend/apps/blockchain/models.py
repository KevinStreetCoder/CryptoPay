import uuid

from django.db import models


class BlockchainDeposit(models.Model):
    """Tracks incoming crypto deposits detected by the blockchain listener."""

    class Status(models.TextChoices):
        DETECTING = "detecting"
        CONFIRMING = "confirming"
        CONFIRMED = "confirmed"
        CREDITED = "credited"

    id = models.BigAutoField(primary_key=True)
    chain = models.CharField(max_length=20, db_index=True)
    tx_hash = models.CharField(max_length=100)
    from_address = models.CharField(max_length=100, blank=True)
    to_address = models.CharField(max_length=100, db_index=True)
    amount = models.DecimalField(max_digits=28, decimal_places=8)
    currency = models.CharField(max_length=10)
    confirmations = models.IntegerField(default=0)
    required_confirmations = models.IntegerField()
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DETECTING
    )
    credited_at = models.DateTimeField(null=True, blank=True)
    block_number = models.BigIntegerField(null=True, blank=True)
    block_hash = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "blockchain_deposits"
        unique_together = ("chain", "tx_hash")

    def __str__(self):
        return f"{self.chain} {self.amount} {self.currency} - {self.status}"


class SweepOrder(models.Model):
    """
    Tracks consolidation of user deposit addresses into the platform hot wallet.

    When users deposit crypto to their HD-derived addresses, those funds sit in
    individual addresses. This model tracks the sweep transaction that moves
    funds from user deposit addresses to the platform's central hot wallet.

    Flow: User deposit address -> sweep tx -> Platform hot wallet -> SystemWallet HOT updated

    Enterprise patterns:
    - Threshold-based: Only sweep when balance exceeds gas cost by 10x
    - Batch sweeps: Group multiple addresses into one Celery task run
    - Gas optimization: Monitor gas prices, sweep during low-fee periods
    - Idempotent: Redis lock prevents duplicate sweeps per address
    - Audit trail: Every sweep logged for compliance/reconciliation
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ESTIMATING = "estimating", "Estimating"
        SUBMITTED = "submitted", "Submitted"
        CONFIRMING = "confirming", "Confirming"
        CONFIRMED = "confirmed", "Confirmed"
        CREDITED = "credited", "Credited"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    # Statuses that represent an active (in-flight) sweep
    ACTIVE_STATUSES = [
        Status.PENDING,
        Status.SUBMITTED,
        Status.CONFIRMING,
    ]

    class Chain(models.TextChoices):
        TRON = "tron", "Tron"
        ETHEREUM = "ethereum", "Ethereum"
        BITCOIN = "bitcoin", "Bitcoin"
        SOLANA = "solana", "Solana"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chain = models.CharField(max_length=20, choices=Chain.choices)
    currency = models.CharField(max_length=10)
    from_address = models.CharField(max_length=100)
    to_address = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=28, decimal_places=8)
    estimated_fee = models.DecimalField(max_digits=28, decimal_places=8)
    actual_fee = models.DecimalField(
        max_digits=28, decimal_places=8, null=True, blank=True
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    tx_hash = models.CharField(max_length=100, blank=True, default="")
    confirmations = models.IntegerField(default=0)
    required_confirmations = models.IntegerField(default=1)
    error_message = models.TextField(blank=True, default="")
    retry_count = models.SmallIntegerField(default=0)
    batch_id = models.CharField(max_length=64, blank=True, default="")
    skip_reason = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    credited_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sweep_orders"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["status", "-created_at"],
                name="sweep_status_created_idx",
            ),
            models.Index(
                fields=["chain", "from_address"],
                name="sweep_chain_addr_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["chain", "from_address"],
                condition=models.Q(
                    status__in=["pending", "submitted", "confirming"]
                ),
                name="unique_active_sweep_per_address",
            ),
        ]

    def __str__(self):
        return (
            f"Sweep {self.chain} {self.amount} {self.currency} "
            f"({self.from_address[:10]}...) - {self.status}"
        )
