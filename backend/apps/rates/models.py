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
