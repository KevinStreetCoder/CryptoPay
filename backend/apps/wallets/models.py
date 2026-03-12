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
                check=models.Q(balance__gte=0),
                name="wallet_balance_non_negative",
            ),
            models.CheckConstraint(
                check=models.Q(locked_balance__gte=0),
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
                check=models.Q(amount__gt=0),
                name="ledger_amount_positive",
            ),
        ]

    def __str__(self):
        return f"{self.entry_type} {self.amount} {self.wallet.currency} → {self.balance_after}"


# System wallets for the platform's own funds (hot wallet, fee collection, etc.)
class SystemWallet(models.Model):
    """Platform-owned wallets for float, fees, and liquidity."""

    class WalletType(models.TextChoices):
        HOT = "hot"
        FEE = "fee"
        FLOAT = "float"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    wallet_type = models.CharField(max_length=10, choices=WalletType.choices)
    currency = models.CharField(max_length=10, choices=Currency.choices)
    balance = models.DecimalField(max_digits=28, decimal_places=8, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "system_wallets"
        unique_together = ("wallet_type", "currency")

    def __str__(self):
        return f"System {self.wallet_type} - {self.currency}: {self.balance}"
