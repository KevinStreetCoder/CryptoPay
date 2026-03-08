"""
Rate Engine

Composes crypto/KES rates from:
  - CoinGecko API (crypto/USD)
  - Forex API / Yellow Card (USD/KES)

Locks rates in Redis for 30 seconds for user quotes.
"""

import logging
import uuid
from decimal import Decimal

import requests
from django.conf import settings
from django.core.cache import cache

from .models import ExchangeRate

logger = logging.getLogger(__name__)

# CoinGecko IDs for supported currencies
COINGECKO_IDS = {
    "USDT": "tether",
    "USDC": "usd-coin",
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
}


class RateService:
    @staticmethod
    def get_crypto_usd_rate(currency: str) -> Decimal:
        """Get crypto/USD rate from cache or CoinGecko."""
        cache_key = f"rate:crypto:{currency}:usd"
        cached = cache.get(cache_key)
        if cached:
            return Decimal(str(cached))

        coin_id = COINGECKO_IDS.get(currency)
        if not coin_id:
            raise ValueError(f"Unsupported currency: {currency}")

        try:
            url = "https://api.coingecko.com/api/v3/simple/price"
            params = {"ids": coin_id, "vs_currencies": "usd"}
            headers = {}
            if settings.COINGECKO_API_KEY:
                headers["x-cg-demo-api-key"] = settings.COINGECKO_API_KEY

            response = requests.get(url, params=params, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()

            rate = Decimal(str(data[coin_id]["usd"]))

            # Cache for 30 seconds
            cache.set(cache_key, str(rate), timeout=30)

            # Save to DB for history
            ExchangeRate.objects.create(
                pair=f"{currency}/USD",
                rate=rate,
                source="coingecko",
            )

            return rate

        except Exception as e:
            logger.error(f"Failed to fetch {currency}/USD rate: {e}")
            # Fallback to latest DB rate
            latest = ExchangeRate.objects.filter(pair=f"{currency}/USD").first()
            if latest:
                return latest.rate
            raise

    @staticmethod
    def get_usd_kes_rate() -> Decimal:
        """Get USD/KES forex rate."""
        cache_key = "rate:forex:usd:kes"
        cached = cache.get(cache_key)
        if cached:
            return Decimal(str(cached))

        try:
            # Use a free forex API as fallback
            response = requests.get(
                "https://api.exchangerate-api.com/v4/latest/USD",
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
            rate = Decimal(str(data["rates"]["KES"]))

            cache.set(cache_key, str(rate), timeout=300)  # Cache 5 min

            ExchangeRate.objects.create(
                pair="USD/KES",
                rate=rate,
                source="exchangerate-api",
            )

            return rate

        except Exception as e:
            logger.error(f"Failed to fetch USD/KES rate: {e}")
            latest = ExchangeRate.objects.filter(pair="USD/KES").first()
            if latest:
                return latest.rate
            raise

    @staticmethod
    def get_crypto_kes_rate(currency: str) -> dict:
        """
        Compose the full crypto/KES rate with platform spread.

        Returns:
            {
                "currency": "USDT",
                "crypto_usd": 1.0002,
                "usd_kes": 129.50,
                "raw_rate": 129.53,
                "spread_percent": 1.5,
                "final_rate": 131.47,
                "flat_fee_kes": 10,
            }
        """
        crypto_usd = RateService.get_crypto_usd_rate(currency)
        usd_kes = RateService.get_usd_kes_rate()

        raw_rate = crypto_usd * usd_kes
        spread = Decimal(str(settings.PLATFORM_SPREAD_PERCENT)) / Decimal("100")
        final_rate = raw_rate * (Decimal("1") - spread)  # User gets less KES per crypto

        return {
            "currency": currency,
            "crypto_usd": str(crypto_usd),
            "usd_kes": str(usd_kes),
            "raw_rate": str(raw_rate),
            "spread_percent": settings.PLATFORM_SPREAD_PERCENT,
            "final_rate": str(final_rate.quantize(Decimal("0.01"))),
            "flat_fee_kes": settings.FLAT_FEE_KES,
        }

    @staticmethod
    def lock_rate(currency: str, kes_amount: Decimal) -> dict:
        """
        Lock a rate for 30 seconds. Returns a quote with a unique quote_id.
        The user must confirm within the TTL or the quote expires.
        """
        rate_info = RateService.get_crypto_kes_rate(currency)
        final_rate = Decimal(rate_info["final_rate"])
        flat_fee = Decimal(str(rate_info["flat_fee_kes"]))

        # Calculate crypto amount needed
        total_kes = kes_amount + flat_fee
        crypto_amount = (total_kes / final_rate).quantize(Decimal("0.00000001"))

        quote_id = str(uuid.uuid4())

        quote = {
            "quote_id": quote_id,
            "currency": currency,
            "kes_amount": str(kes_amount),
            "crypto_amount": str(crypto_amount),
            "exchange_rate": str(final_rate),
            "fee_kes": str(flat_fee),
            "total_kes": str(total_kes),
            **rate_info,
        }

        # Lock in Redis
        cache.set(f"quote:{quote_id}", quote, timeout=settings.RATE_LOCK_TTL_SECONDS)

        return quote

    @staticmethod
    def get_locked_quote(quote_id: str) -> dict | None:
        """Retrieve a locked quote. Returns None if expired."""
        return cache.get(f"quote:{quote_id}")
