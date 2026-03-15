"""Celery tasks for periodic rate fetching."""

import logging

from celery import shared_task
from django.core.cache import cache

from .services import RateService

logger = logging.getLogger(__name__)

SUPPORTED_CURRENCIES = ["USDT", "USDC", "BTC", "ETH", "SOL"]


@shared_task
def refresh_rates():
    """Refresh all crypto/USD rates and USD/KES rate.
    Uses batch API call (1 request for all currencies) to stay within
    CoinGecko free tier (10K calls/month). Falls back to CryptoCompare."""
    try:
        RateService.refresh_all_crypto_rates()
    except Exception as e:
        logger.error(f"Failed batch rate refresh: {e}")

    try:
        RateService.get_usd_kes_rate()
    except Exception as e:
        logger.error(f"Failed to refresh USD/KES: {e}")

    # Broadcast updated rates to all WebSocket clients
    _broadcast_current_rates()


def _broadcast_current_rates():
    """Build rates dict from cache and broadcast via WebSocket."""
    try:
        from apps.core.broadcast import broadcast_rates

        usd_kes = cache.get("rate:forex:usd:kes")
        rates = {}

        for currency in SUPPORTED_CURRENCIES:
            usd_rate = cache.get(f"rate:crypto:{currency}:usd")
            if usd_rate:
                rates[currency] = {
                    "usd": float(usd_rate),
                    "kes": round(float(usd_rate) * float(usd_kes), 2) if usd_kes else None,
                }

        if rates:
            broadcast_rates(rates)
    except Exception as e:
        logger.warning(f"Failed to broadcast rates: {e}")
