"""Celery tasks for periodic rate fetching."""

import logging

from celery import shared_task

from .services import RateService

logger = logging.getLogger(__name__)


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
