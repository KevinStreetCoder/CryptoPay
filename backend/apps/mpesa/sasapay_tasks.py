"""SasaPay-specific Celery tasks · 2026-05-10.

Periodic tasks that maintain SasaPay-side state:

  - auto_rebalance_utility · runs every 5 min · moves Working → Utility
    when Utility falls below threshold so B2C/B2B never fail with
    "insufficient balance". The user already lost a transaction to
    this earlier in the day.

  - sync_sasapay_balance · runs every 5 min · pulls the merchant
    balance and pushes it to Prometheus + the float circuit breaker
    so we have proper observability.

  - sync_channel_codes · runs daily · refreshes the cached bank list
    used by `/api/v1/payments/banks/`.

Wire the schedule in `config/celery.py` or `apps/core/tasks.py`
beat schedule.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)


def _provider_is_sasapay() -> bool:
    return (getattr(settings, "PAYMENT_PROVIDER", "daraja") or "daraja").lower() == "sasapay"


@shared_task(name="apps.mpesa.sasapay_tasks.auto_rebalance_utility")
def auto_rebalance_utility():
    """Move Working → Utility when Utility drops below threshold.

    Settings:
      SASAPAY_MIN_UTILITY_KES   · trigger threshold (default 5000 KES)
      SASAPAY_TARGET_UTILITY_KES · top-up target (default 20000 KES)
      SASAPAY_REBALANCE_ENABLED · master switch (default True)

    Idempotent · won't double-move if Utility is already healthy.
    Logs every action so ops can audit via Grafana.
    """
    if not _provider_is_sasapay():
        return None
    if not getattr(settings, "SASAPAY_REBALANCE_ENABLED", True):
        logger.info("auto_rebalance.disabled by setting")
        return None

    min_util = Decimal(str(getattr(settings, "SASAPAY_MIN_UTILITY_KES", 5000)))
    target_util = Decimal(str(getattr(settings, "SASAPAY_TARGET_UTILITY_KES", 20000)))

    try:
        from .sasapay_client import SasaPayClient
        client = SasaPayClient()
        balance_raw = client.check_balance()
    except Exception as e:
        logger.exception("auto_rebalance.balance_fetch_failed")
        return {"error": str(e)[:200]}

    accounts = (balance_raw.get("data") or {}).get("Accounts") or []
    util_bal = working_bal = Decimal("0")
    for a in accounts:
        label = (a.get("account_label") or "").strip()
        bal = Decimal(str(a.get("account_balance") or 0))
        if label == "Utility Account":
            util_bal = bal
        elif label == "Working Account":
            working_bal = bal

    logger.info(
        "auto_rebalance.snapshot · utility=%s working=%s min=%s target=%s",
        util_bal, working_bal, min_util, target_util,
    )

    if util_bal >= min_util:
        return {
            "skipped": "utility_healthy",
            "utility": str(util_bal),
            "working": str(working_bal),
        }

    needed = target_util - util_bal
    if needed > working_bal:
        logger.warning(
            "auto_rebalance.insufficient_working · need=%s have=%s · "
            "ops should top up the SasaPay merchant float",
            needed, working_bal,
        )
        # Move whatever Working has rather than nothing · partial top-up
        # is better than zero.
        needed = working_bal
        if needed <= 0:
            return {"error": "working_account_empty", "utility": str(util_bal)}

    # 2026-05-17 · SasaPay's fund-movement endpoint REJECTS amounts
    # with more than 2 decimal places (`{"error":{"amount":["Ensure
    # that there are no more than 2 decimal places."]}}`). Floor (not
    # round-half-up) so we never accidentally move 0.01 KES more than
    # Working actually has. Using ROUND_DOWN on the Decimal preserves
    # the value through float() without binary-fraction artefacts.
    from decimal import ROUND_DOWN as _RD
    needed_2dp = needed.quantize(Decimal("0.01"), rounding=_RD)
    if needed_2dp <= 0:
        return {
            "skipped": "rounded_to_zero",
            "raw_needed": str(needed),
            "utility": str(util_bal),
        }

    try:
        result = client.move_funds_to_utility(amount=float(needed_2dp))
    except Exception as e:
        logger.exception("auto_rebalance.move_failed amount=%s", needed_2dp)
        return {"error": str(e)[:200], "amount": str(needed_2dp)}
    # Update `needed` so the log line below reflects what we actually moved
    needed = needed_2dp

    logger.info(
        "auto_rebalance.moved · amount=%s working_was=%s utility_was=%s",
        needed, working_bal, util_bal,
    )
    return {
        "moved": str(needed),
        "utility_before": str(util_bal),
        "working_before": str(working_bal),
        "raw": result,
    }


@shared_task(name="apps.mpesa.sasapay_tasks.sync_sasapay_balance")
def sync_sasapay_balance():
    """Pull the SasaPay balance + push to Prometheus + circuit breaker.

    Replaces `apps.mpesa.tasks.check_float_balance` (which targeted
    Daraja) when PAYMENT_PROVIDER is sasapay. Both can run in parallel
    safely · the breaker just sees whichever fired most recently.
    """
    if not _provider_is_sasapay():
        return None

    try:
        from .sasapay_client import SasaPayClient
        client = SasaPayClient()
        raw = client.check_balance()
    except Exception as e:
        logger.exception("sync_sasapay_balance.failed")
        return {"error": str(e)[:200]}

    accounts = (raw.get("data") or {}).get("Accounts") or []
    util_bal = Decimal("0")
    working_bal = Decimal("0")
    for a in accounts:
        label = (a.get("account_label") or "").strip()
        bal = Decimal(str(a.get("account_balance") or 0))
        if label == "Utility Account":
            util_bal = bal
        elif label == "Working Account":
            working_bal = bal

    # Update circuit breaker · use total Utility + Working as the "float".
    # Utility is what funds B2C; Working is reserve.
    total_float = util_bal + working_bal
    try:
        from apps.payments.circuit_breaker import PaymentCircuitBreaker
        PaymentCircuitBreaker.update_from_float(total_float)
    except Exception:
        logger.exception("sync_sasapay_balance.circuit_breaker_update_failed")

    # Optional Prometheus gauge · only when prometheus_client is
    # configured.
    try:
        from prometheus_client import Gauge
        if not hasattr(sync_sasapay_balance, "_gauges"):
            sync_sasapay_balance._gauges = {
                "utility": Gauge(
                    "sasapay_utility_balance_kes",
                    "SasaPay Utility account balance (KES)",
                ),
                "working": Gauge(
                    "sasapay_working_balance_kes",
                    "SasaPay Working account balance (KES)",
                ),
                "total": Gauge(
                    "sasapay_total_float_kes",
                    "SasaPay total available float (Working + Utility, KES)",
                ),
            }
        sync_sasapay_balance._gauges["utility"].set(float(util_bal))
        sync_sasapay_balance._gauges["working"].set(float(working_bal))
        sync_sasapay_balance._gauges["total"].set(float(total_float))
    except Exception:
        # Prometheus not installed or duplicate gauge registration ·
        # skip the metric without failing the task.
        pass

    logger.info(
        "sync_sasapay_balance · utility=%s working=%s total=%s",
        util_bal, working_bal, total_float,
    )
    return {
        "utility": str(util_bal),
        "working": str(working_bal),
        "total": str(total_float),
    }


@shared_task(name="apps.mpesa.sasapay_tasks.sync_channel_codes")
def sync_channel_codes():
    """Daily refresh of the SasaPay channel-codes cache (banks list).

    The mobile `Send to Bank` picker reads from
    `/api/v1/payments/banks/` which serves this cache. Running daily
    means new banks SasaPay onboards appear in the app within 24 h
    without an APK rebuild.
    """
    if not _provider_is_sasapay():
        return None

    try:
        from django.core.cache import cache
        from .sasapay_client import SasaPayClient
        raw = SasaPayClient()._request("GET", "/payments/channel-codes/")
    except Exception as e:
        logger.warning("sync_channel_codes.failed err=%s", str(e)[:200])
        return {"error": str(e)[:200]}

    banks = raw.get("data") or []
    out = [
        {"slug": (b.get("bank_code") or "").strip(),
         "name": (b.get("bank_name") or "").strip(),
         "code": (b.get("bank_code") or "").strip()}
        for b in banks if b.get("bank_code")
    ]
    cache.set("sasapay_channel_codes_v1", out, timeout=86400)
    logger.info("sync_channel_codes · cached %d banks", len(out))
    return {"count": len(out)}
