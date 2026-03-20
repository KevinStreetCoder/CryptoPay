import uuid

from django.conf import settings
from django.db import models


class ExchangeRate(models.Model):
    """Cached exchange rate snapshot."""

    pair = models.CharField(max_length=20, db_index=True)  # e.g., "USDT/KES", "BTC/USD"
    rate = models.DecimalField(max_digits=18, decimal_places=8)
    source = models.CharField(max_length=30)  # coingecko, yellowcard, forex
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "exchange_rates"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.pair}: {self.rate} ({self.source})"


class RateAlert(models.Model):
    """User-configured rate alert. Triggers notification when target rate is reached."""

    class Direction(models.TextChoices):
        ABOVE = "above", "Above"
        BELOW = "below", "Below"

    class Currency(models.TextChoices):
        USDT = "USDT", "USDT"
        BTC = "BTC", "BTC"
        ETH = "ETH", "ETH"
        SOL = "SOL", "SOL"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="rate_alerts",
    )
    currency = models.CharField(max_length=10, choices=Currency.choices)
    target_rate = models.DecimalField(max_digits=18, decimal_places=8, help_text="Target KES rate")
    direction = models.CharField(max_length=10, choices=Direction.choices)
    is_active = models.BooleanField(default=True, db_index=True)
    triggered_at = models.DateTimeField(null=True, blank=True)
    trigger_count = models.PositiveIntegerField(default=0, help_text="How many times this alert has fired")
    last_triggered_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, help_text="Alert auto-deactivates after this time")
    cooldown_minutes = models.PositiveIntegerField(default=60, help_text="Min minutes between re-triggers")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "rate_alerts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["is_active", "currency"], name="ratealert_active_currency"),
        ]

    def __str__(self):
        return f"{self.user} — {self.currency} {self.direction} {self.target_rate}"
