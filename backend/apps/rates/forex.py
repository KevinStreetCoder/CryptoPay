"""
USD -> KES forex rate with tiered provider fallback.

Providers are tried in order until one returns a valid rate. Each provider
is wrapped in a ~3 s timeout so a slow provider can't block the whole
chain. On total failure we fall back first to the most recent rate in
the ExchangeRate DB table, then finally to a hard-coded conservative
worst-case rate so the quote endpoint never hangs for the user.

The hard-coded fallback deliberately underestimates the KES side (uses
a lower KES/USD figure) so that user crypto -> KES conversions err on
the side of CREDITING LESS KES when the live rate is unknown. This
protects the platform treasury in a degraded state. Quotes made against
this fallback are marked `rate_source="fallback"` and cached only for
60 s (not the usual 300 s) so a real provider takes over as soon as it
recovers.

Configuration (env vars, all optional — service degrades gracefully):

  EXCHANGERATE_API_KEY         exchangerate-api.com (primary, free tier)
  OPEN_EXCHANGE_RATES_APP_ID   openexchangerates.org
  FIXER_API_KEY                fixer.io
  FOREX_FALLBACK_USD_KES       worst-case rate (default 120.0)

The module exposes:
  fetch_usd_kes_rate() -> (Decimal, str)   # rate, source
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# Per-provider HTTP timeout. Keep tight — the whole chain must complete
# faster than the /quote/ endpoint's own timeout (~10 s).
PROVIDER_TIMEOUT = 3.0

# Conservative worst-case KES/USD. Kenya shilling has traded roughly
# 120-160 KES/USD in recent years; we pick the LOW end so crypto -> KES
# conversions favour the platform when we don't have fresh data.
DEFAULT_HARDCODED_RATE = Decimal("120.00")


@dataclass
class ForexQuote:
    rate: Decimal
    source: str  # exchangerate-api | openexchangerates | fixer | db | fallback


def _provider_exchangerate_api() -> Optional[Decimal]:
    """Primary: exchangerate-api.com — free tier, no key required, generous limits."""
    try:
        r = requests.get(
            "https://api.exchangerate-api.com/v4/latest/USD",
            timeout=PROVIDER_TIMEOUT,
        )
        r.raise_for_status()
        return Decimal(str(r.json()["rates"]["KES"]))
    except Exception as e:  # noqa: BLE001
        logger.warning("forex.provider_failed", extra={"provider": "exchangerate-api", "error": str(e)})
        return None


def _provider_open_exchange_rates() -> Optional[Decimal]:
    """Fallback: openexchangerates.org. Requires OPEN_EXCHANGE_RATES_APP_ID."""
    app_id = getattr(settings, "OPEN_EXCHANGE_RATES_APP_ID", "")
    if not app_id:
        return None
    try:
        r = requests.get(
            "https://openexchangerates.org/api/latest.json",
            params={"app_id": app_id, "symbols": "KES"},
            timeout=PROVIDER_TIMEOUT,
        )
        r.raise_for_status()
        return Decimal(str(r.json()["rates"]["KES"]))
    except Exception as e:  # noqa: BLE001
        logger.warning("forex.provider_failed", extra={"provider": "openexchangerates", "error": str(e)})
        return None


def _provider_fixer() -> Optional[Decimal]:
    """Fallback: fixer.io. Requires FIXER_API_KEY. Note: free tier uses EUR
    as base — convert through EUR/USD and EUR/KES."""
    key = getattr(settings, "FIXER_API_KEY", "")
    if not key:
        return None
    try:
        r = requests.get(
            "https://data.fixer.io/api/latest",
            params={"access_key": key, "symbols": "USD,KES"},
            timeout=PROVIDER_TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            return None
        rates = data["rates"]
        eur_usd = Decimal(str(rates["USD"]))
        eur_kes = Decimal(str(rates["KES"]))
        if eur_usd == 0:
            return None
        return (eur_kes / eur_usd).quantize(Decimal("0.0001"))
    except Exception as e:  # noqa: BLE001
        logger.warning("forex.provider_failed", extra={"provider": "fixer", "error": str(e)})
        return None


# Ordered chain of live providers. Order matters — exchangerate-api is
# keyless and most reliable, so try it first. Store function *names* and
# resolve them via module globals at call time so that unit tests can
# monkey-patch individual providers without having to replace this list.
_PROVIDER_ORDER: list[tuple[str, str]] = [
    ("exchangerate-api", "_provider_exchangerate_api"),
    ("openexchangerates", "_provider_open_exchange_rates"),
    ("fixer", "_provider_fixer"),
]


def fetch_usd_kes_rate() -> ForexQuote:
    """Return (rate, source_name). Guaranteed to return *something* non-zero.

    Order of preference:
      1. Live providers in _PROVIDER_ORDER chain, resolved at call time so
         tests can patch individual provider functions.
      2. Most recent ExchangeRate DB row for USD/KES.
      3. Hard-coded DEFAULT_HARDCODED_RATE (configurable via env).
    """
    from .models import ExchangeRate  # local import to avoid Django boot issues

    module_globals = globals()
    for name, fn_name in _PROVIDER_ORDER:
        fn = module_globals.get(fn_name)
        if fn is None:
            continue
        t0 = time.monotonic()
        try:
            rate = fn()
        except Exception as e:  # noqa: BLE001 — provider failure never kills the chain
            logger.warning(
                "forex.provider_raised",
                extra={"provider": name, "error": str(e)},
            )
            rate = None
        latency_ms = int((time.monotonic() - t0) * 1000)
        if rate is not None and rate > 0:
            logger.info(
                "forex.fetched",
                extra={"provider": name, "rate": str(rate), "latency_ms": latency_ms},
            )
            try:
                ExchangeRate.objects.create(pair="USD/KES", rate=rate, source=name)
            except Exception:
                # Never let a DB write failure kill the forex fetch.
                logger.exception("forex.db_persist_failed", extra={"provider": name})
            return ForexQuote(rate=rate, source=name)

    # All live providers failed. Try the DB last-known-good.
    latest = ExchangeRate.objects.filter(pair="USD/KES").order_by("-created_at").first()
    if latest and latest.rate > 0:
        logger.warning(
            "forex.using_db_fallback",
            extra={"rate": str(latest.rate), "age_seconds": None},
        )
        return ForexQuote(rate=latest.rate, source="db")

    # Final fallback — hard-coded worst case. This guarantees the quote
    # endpoint never crashes, at the cost of a conservatively-priced rate.
    hardcoded = Decimal(str(getattr(settings, "FOREX_FALLBACK_USD_KES", DEFAULT_HARDCODED_RATE)))
    logger.error(
        "forex.using_hardcoded_fallback",
        extra={"rate": str(hardcoded)},
    )
    return ForexQuote(rate=hardcoded, source="fallback")
