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
