"""
Rate Engine

Composes crypto/KES rates from:
  - CoinGecko API (crypto/USD) — primary, with batch requests
  - CryptoCompare API (crypto/USD) — fallback provider
  - Forex API (USD/KES)

Locks rates in Redis for 30 seconds for user quotes.
All rates cached 60s in Redis to stay within CoinGecko free tier (10K calls/month).
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

# CryptoCompare symbols (fallback)
CRYPTOCOMPARE_SYMBOLS = {
    "USDT": "USDT",
    "USDC": "USDC",
    "BTC": "BTC",
    "ETH": "ETH",
    "SOL": "SOL",
}

# Cache TTL for crypto rates (seconds)
CRYPTO_RATE_CACHE_TTL = 60


class RateService:

    @staticmethod
    def refresh_all_crypto_rates():
        """Batch-fetch all crypto/USD rates in a single API call.
        This replaces individual per-currency calls and saves API quota.
        CoinGecko free tier: 10K calls/month, 30/min."""
        # Check if we recently refreshed (debounce)
        if cache.get("rate:batch:lock"):
            return

        all_ids = ",".join(COINGECKO_IDS.values())
        fetched = False

        # Try CoinGecko first (batch request = 1 API call for all currencies)
        try:
            url = "https://api.coingecko.com/api/v3/simple/price"
            params = {"ids": all_ids, "vs_currencies": "usd"}
            headers = {}
            if getattr(settings, "COINGECKO_API_KEY", ""):
                headers["x-cg-demo-api-key"] = settings.COINGECKO_API_KEY

            response = requests.get(url, params=params, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()

            for currency, coin_id in COINGECKO_IDS.items():
                if coin_id in data and "usd" in data[coin_id]:
                    rate = Decimal(str(data[coin_id]["usd"]))
                    cache_key = f"rate:crypto:{currency}:usd"
                    cache.set(cache_key, str(rate), timeout=CRYPTO_RATE_CACHE_TTL)
                    ExchangeRate.objects.create(
                        pair=f"{currency}/USD", rate=rate, source="coingecko",
                    )

            fetched = True
            # Set debounce lock — don't call again for 55 seconds
            cache.set("rate:batch:lock", "1", timeout=55)
            logger.info("Batch rate refresh from CoinGecko successful")

        except Exception as e:
            logger.warning(f"CoinGecko batch fetch failed: {e}, trying CryptoCompare...")

        # Fallback: CryptoCompare (single batch call)
        if not fetched:
            try:
                symbols = ",".join(CRYPTOCOMPARE_SYMBOLS.values())
                url = "https://min-api.cryptocompare.com/data/pricemulti"
                params = {"fsyms": symbols, "tsyms": "USD"}
                headers = {}
                cc_key = getattr(settings, "CRYPTOCOMPARE_API_KEY", "")
                if cc_key:
                    headers["authorization"] = f"Apikey {cc_key}"

                response = requests.get(url, params=params, headers=headers, timeout=10)
                response.raise_for_status()
                data = response.json()

                for currency, symbol in CRYPTOCOMPARE_SYMBOLS.items():
                    if symbol in data and "USD" in data[symbol]:
                        rate = Decimal(str(data[symbol]["USD"]))
                        cache_key = f"rate:crypto:{currency}:usd"
                        cache.set(cache_key, str(rate), timeout=CRYPTO_RATE_CACHE_TTL)
                        ExchangeRate.objects.create(
                            pair=f"{currency}/USD", rate=rate, source="cryptocompare",
                        )

                cache.set("rate:batch:lock", "1", timeout=55)
                logger.info("Batch rate refresh from CryptoCompare successful")

            except Exception as e:
                logger.error(f"CryptoCompare batch fetch also failed: {e}")

    @staticmethod
    def get_crypto_usd_rate(currency: str) -> Decimal:
        """Get crypto/USD rate from cache or fetch fresh."""
        cache_key = f"rate:crypto:{currency}:usd"
        cached = cache.get(cache_key)
        if cached:
            return Decimal(str(cached))

        coin_id = COINGECKO_IDS.get(currency)
        if not coin_id:
            raise ValueError(f"Unsupported currency: {currency}")

        # Try batch refresh first (populates all currencies in 1 call)
        RateService.refresh_all_crypto_rates()

        # Check cache again after batch refresh
        cached = cache.get(cache_key)
        if cached:
            return Decimal(str(cached))

        # Final fallback: latest DB rate
        latest = ExchangeRate.objects.filter(pair=f"{currency}/USD").order_by("-created_at").first()
        if latest:
            cache.set(cache_key, str(latest.rate), timeout=CRYPTO_RATE_CACHE_TTL)
            return latest.rate

        raise ValueError(f"No rate available for {currency}/USD")

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
            "excise_duty_percent": settings.EXCISE_DUTY_PERCENT,
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

        # Calculate platform fee (spread revenue + flat fee)
        spread_revenue = (kes_amount * Decimal(str(settings.PLATFORM_SPREAD_PERCENT)) / Decimal("100"))
        platform_fee = spread_revenue + flat_fee

        # 10% excise duty on platform fees (VASP Act 2025, remitted to KRA)
        excise_rate = Decimal(str(settings.EXCISE_DUTY_PERCENT)) / Decimal("100")
        excise_duty = (platform_fee * excise_rate).quantize(Decimal("0.01"))

        # Calculate crypto amount needed (includes fee + excise)
        total_kes = kes_amount + flat_fee + excise_duty
        crypto_amount = (total_kes / final_rate).quantize(Decimal("0.00000001"))

        quote_id = str(uuid.uuid4())

        quote = {
            "quote_id": quote_id,
            "currency": currency,
            "kes_amount": str(kes_amount),
            "crypto_amount": str(crypto_amount),
            "exchange_rate": str(final_rate),
            "fee_kes": str(flat_fee),
            "excise_duty_kes": str(excise_duty),
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

    @staticmethod
    def get_market_chart(currency: str, days: int = 7) -> list[dict]:
        """Fetch real historical market price data from CoinGecko /market_chart.
        Returns actual market prices, not our internal exchange rates.
        Cached aggressively: 5 min for 1d, 30 min for 7d, 2h for 30d/90d."""
        coin_id = COINGECKO_IDS.get(currency)
        if not coin_id:
            raise ValueError(f"Unsupported currency: {currency}")

        cache_key = f"market_chart:{currency}:{days}"
        cached = cache.get(cache_key)
        if cached:
            return cached

        # Determine cache TTL based on period
        if days <= 1:
            cache_ttl = 300       # 5 min for 1-day chart
        elif days <= 7:
            cache_ttl = 1800      # 30 min for 7-day chart
        else:
            cache_ttl = 7200      # 2 hours for 30d/90d

        # Try CoinGecko market_chart endpoint
        try:
            url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart"
            params = {"vs_currency": "usd", "days": str(days)}
            headers = {}
            if getattr(settings, "COINGECKO_API_KEY", ""):
                headers["x-cg-demo-api-key"] = settings.COINGECKO_API_KEY

            response = requests.get(url, params=params, headers=headers, timeout=15)
            response.raise_for_status()
            data = response.json()

            # CoinGecko returns {"prices": [[timestamp_ms, price], ...]}
            result = [
                {"timestamp": p[0], "rate": round(p[1], 8)}
                for p in data.get("prices", [])
            ]

            if result:
                cache.set(cache_key, result, timeout=cache_ttl)
                return result

        except Exception as e:
            logger.warning(f"CoinGecko market_chart failed for {currency}: {e}")

        # Fallback: CryptoCompare histohour/histoday
        try:
            symbol = CRYPTOCOMPARE_SYMBOLS.get(currency, currency)
            if days <= 1:
                url = "https://min-api.cryptocompare.com/data/v2/histominute"
                params = {"fsym": symbol, "tsym": "USD", "limit": 1440}
            elif days <= 7:
                url = "https://min-api.cryptocompare.com/data/v2/histohour"
                params = {"fsym": symbol, "tsym": "USD", "limit": days * 24}
            else:
                url = "https://min-api.cryptocompare.com/data/v2/histoday"
                params = {"fsym": symbol, "tsym": "USD", "limit": days}

            cc_headers = {}
            cc_key = getattr(settings, "CRYPTOCOMPARE_API_KEY", "")
            if cc_key:
                cc_headers["authorization"] = f"Apikey {cc_key}"

            response = requests.get(url, params=params, headers=cc_headers, timeout=15)
            response.raise_for_status()
            raw = response.json()

            entries = raw.get("Data", {}).get("Data", [])
            result = [
                {"timestamp": e["time"] * 1000, "rate": round(e["close"], 8)}
                for e in entries
                if e.get("close", 0) > 0
            ]

            if result:
                cache.set(cache_key, result, timeout=cache_ttl)
                return result

        except Exception as e:
            logger.warning(f"CryptoCompare chart fallback also failed for {currency}: {e}")

        return []
