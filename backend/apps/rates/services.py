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
# B30: 24h % change cache kept longer than the rate itself so brief provider
# hiccups don't wipe the dashboard display back to 0.00%. Refreshed on every
# successful batch fetch.
CHANGE_24H_CACHE_TTL = 900  # 15 minutes


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
            params = {"ids": all_ids, "vs_currencies": "usd", "include_24hr_change": "true"}
            headers = {}
            if getattr(settings, "COINGECKO_API_KEY", ""):
                headers["x-cg-demo-api-key"] = settings.COINGECKO_API_KEY

            response = requests.get(url, params=params, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()

            for currency, coin_id in COINGECKO_IDS.items():
                if coin_id in data and "usd" in data[coin_id]:
                    rate = Decimal(str(data[coin_id]["usd"]))
                    if rate <= 0:
                        logger.error(f"CoinGecko returned non-positive rate for {currency}: {rate}")
                        continue  # B30: reject zero/negative rates
                    cache_key = f"rate:crypto:{currency}:usd"
                    cache.set(cache_key, str(rate), timeout=CRYPTO_RATE_CACHE_TTL)
                    ExchangeRate.objects.create(
                        pair=f"{currency}/USD", rate=rate, source="coingecko",
                    )
                    change_24h = data[coin_id].get("usd_24h_change")
                    if change_24h is not None:
                        cache.set(
                            f"rate:change24h:{currency}",
                            str(round(change_24h, 2)),
                            timeout=CHANGE_24H_CACHE_TTL,
                        )

            fetched = True
            # Set debounce lock — don't call again for 55 seconds
            cache.set("rate:batch:lock", "1", timeout=55)
            cache.delete("rate:stale")  # Clear stale flag on success
            logger.info("Batch rate refresh from CoinGecko successful")

        except Exception as e:
            logger.warning(f"CoinGecko batch fetch failed: {e}, trying CryptoCompare...")

        # Fallback: CryptoCompare pricemultifull (carries CHANGEPCT24HOUR)
        if not fetched:
            try:
                symbols = ",".join(CRYPTOCOMPARE_SYMBOLS.values())
                url = "https://min-api.cryptocompare.com/data/pricemultifull"
                params = {"fsyms": symbols, "tsyms": "USD"}
                headers = {}
                cc_key = getattr(settings, "CRYPTOCOMPARE_API_KEY", "")
                if cc_key:
                    headers["authorization"] = f"Apikey {cc_key}"

                response = requests.get(url, params=params, headers=headers, timeout=10)
                response.raise_for_status()
                data = response.json().get("RAW", {})

                for currency, symbol in CRYPTOCOMPARE_SYMBOLS.items():
                    if symbol in data and "USD" in data[symbol]:
                        entry = data[symbol]["USD"]
                        rate = Decimal(str(entry.get("PRICE", 0)))
                        if rate <= 0:
                            logger.error(f"CryptoCompare returned non-positive rate for {currency}: {rate}")
                            continue  # B30: reject zero/negative rates
                        cache_key = f"rate:crypto:{currency}:usd"
                        cache.set(cache_key, str(rate), timeout=CRYPTO_RATE_CACHE_TTL)
                        ExchangeRate.objects.create(
                            pair=f"{currency}/USD", rate=rate, source="cryptocompare",
                        )
                        change_24h = entry.get("CHANGEPCT24HOUR")
                        if change_24h is not None:
                            cache.set(
                                f"rate:change24h:{currency}",
                                str(round(float(change_24h), 2)),
                                timeout=CHANGE_24H_CACHE_TTL,
                            )

                cache.set("rate:batch:lock", "1", timeout=55)
                cache.delete("rate:stale")  # Clear stale flag on success
                logger.info("Batch rate refresh from CryptoCompare successful")

            except Exception as e:
                logger.error(f"CryptoCompare batch fetch also failed: {e}")
                # Both providers failed · mark cached rates as stale so consumers
                # know they are using potentially outdated prices.
                cache.set("rate:stale", True, timeout=300)

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
        """Get USD/KES forex rate with tiered provider fallback.

        Delegates to apps.rates.forex.fetch_usd_kes_rate(), which tries
        exchangerate-api -> openexchangerates -> fixer -> most-recent DB row
        -> hard-coded worst-case. Guarantees a non-zero Decimal.

        Cache TTL is shortened when the fallback path is used so that live
        providers are tried again sooner on recovery.
        """
        cache_key = "rate:forex:usd:kes"
        cached = cache.get(cache_key)
        if cached:
            return Decimal(str(cached))

        from .forex import fetch_usd_kes_rate

        quote = fetch_usd_kes_rate()
        # Shorter TTL on degraded sources so we re-try live providers sooner.
        ttl = 300 if quote.source not in ("fallback", "db") else 60
        cache.set(cache_key, str(quote.rate), timeout=ttl)
        cache.set("rate:forex:source", quote.source, timeout=ttl)
        return quote.rate

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

        is_stale = bool(cache.get("rate:stale"))

        # Get 24h change from cache (set by batch rate refresh)
        change_24h = cache.get(f"rate:change24h:{currency}")

        return {
            "currency": currency,
            "crypto_usd": str(crypto_usd),
            "usd_kes": str(usd_kes),
            "raw_rate": str(raw_rate),
            "spread_percent": settings.PLATFORM_SPREAD_PERCENT,
            "final_rate": str(final_rate.quantize(Decimal("0.01"))),
            "flat_fee_kes": settings.FLAT_FEE_KES,
            "excise_duty_percent": settings.EXCISE_DUTY_PERCENT,
            "rate_freshness": "stale" if is_stale else "live",
            "rate_stale": is_stale,
            "change_24h": change_24h or "0",
            "swap_fee_percent": getattr(settings, "SWAP_FEE_PERCENT", 0.5),
        }

    @staticmethod
    def lock_rate(currency: str, kes_amount: Decimal, user_id: str = "") -> dict:
        """
        Lock a rate for 30 seconds. Returns a quote with a unique quote_id.
        The user must confirm within the TTL or the quote expires.
        """
        rate_info = RateService.get_crypto_kes_rate(currency)
        final_rate = Decimal(rate_info["final_rate"])
        flat_fee = Decimal(str(rate_info["flat_fee_kes"]))

        # Calculate platform fee (spread revenue + flat fee).
        # Both components are real revenue the user pays, and excise duty
        # is levied on the TOTAL (spread + flat) per VASP Act 2025.
        spread_revenue = (
            kes_amount * Decimal(str(settings.PLATFORM_SPREAD_PERCENT)) / Decimal("100")
        ).quantize(Decimal("0.01"))
        platform_fee = (spread_revenue + flat_fee).quantize(Decimal("0.01"))

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
            # `fee_kes` is the **total** platform fee the user pays
            # (spread revenue baked into rate + flat fee). This is what
            # Transaction.fee_amount must record so KRA reconciliation
            # on the 10 % excise duty matches what we remit. Previously
            # `fee_kes` returned only the flat component, under-reporting
            # the true fee by (PLATFORM_SPREAD_PERCENT × kes_amount) — a
            # KRA audit trail risk.
            "fee_kes": str(platform_fee),
            # Explicit breakdown for receipts / admin dashboards.
            "flat_fee_kes": str(flat_fee),
            "spread_revenue_kes": str(spread_revenue),
            "platform_fee_kes": str(platform_fee),
            "excise_duty_kes": str(excise_duty),
            "total_kes": str(total_kes),
            "user_id": user_id,  # Bind quote to requesting user
            **rate_info,
        }

        # Lock in Redis
        cache.set(f"quote:{quote_id}", quote, timeout=settings.RATE_LOCK_TTL_SECONDS)

        return quote

    @staticmethod
    def get_locked_quote(quote_id: str, user_id: str = "") -> dict | None:
        """Retrieve a locked quote. Returns None if expired or wrong user.

        B26: if the quote has a user_id, the CALLER MUST pass a matching
        user_id. Empty caller user_id is treated as mismatch so we don't
        silently hand a quote back to an anonymous path."""
        quote = cache.get(f"quote:{quote_id}")
        if quote is None:
            return None

        quote_user = quote.get("user_id", "")
        if quote_user and quote_user != user_id:
            return None

        return quote

    @staticmethod
    def consume_locked_quote(quote_id: str, user_id: str = "") -> dict | None:
        """Retrieve and DELETE a locked quote. Atomic single-use via claim key."""
        cache_key = f"quote:{quote_id}"

        # Atomic: try to "claim" the quote — cache.add is atomic in Redis
        # If two requests race, only one succeeds at adding the claim key
        claim_key = f"quote_claimed:{quote_id}"
        if not cache.add(claim_key, "1", timeout=60):
            return None  # Already claimed by another request

        quote = cache.get(cache_key)
        if quote is None:
            cache.delete(claim_key)
            return None

        # B26: quote-to-user binding is MANDATORY. If the quote was locked
        # with a user_id, the caller MUST supply a matching user_id. Empty
        # caller user_id is treated as mismatch.
        quote_user = quote.get("user_id", "")
        if quote_user and quote_user != user_id:
            cache.delete(claim_key)
            return None

        cache.delete(cache_key)
        return quote

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

        # Prevent cache stampede — only one fetch per currency/period at a time
        lock_key = f"market_chart_lock:{currency}:{days}"
        if cache.get(lock_key):
            # Another request is already fetching, return empty (frontend handles gracefully)
            return []
        cache.set(lock_key, "1", timeout=30)

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
