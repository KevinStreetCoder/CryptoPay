"""Celery tasks for periodic rate fetching."""

import logging

from celery import shared_task

from .services import RateService

logger = logging.getLogger(__name__)


@shared_task
def refresh_rates():
    """Refresh all crypto/USD rates and USD/KES rate. Run every 30 seconds."""
    currencies = ["USDT", "USDC", "BTC", "ETH", "SOL"]
    for currency in currencies:
        try:
            RateService.get_crypto_usd_rate(currency)
        except Exception as e:
            logger.error(f"Failed to refresh {currency}/USD: {e}")

    try:
        RateService.get_usd_kes_rate()
    except Exception as e:
        logger.error(f"Failed to refresh USD/KES: {e}")
