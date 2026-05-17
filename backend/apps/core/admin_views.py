import json
import logging
import time
from datetime import timedelta
from decimal import Decimal

import requests

from django.conf import settings


logger = logging.getLogger(__name__)
from django.contrib.admin.views.decorators import staff_member_required
from django.db.models import Count, Sum, Q, F
from django.db.models.functions import TruncDate, Substr, Coalesce
from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from apps.accounts.models import User
from apps.blockchain.models import BlockchainDeposit
from apps.payments.models import Transaction
from apps.wallets.models import Wallet


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types."""

    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


def _period_comparison(qs_base, now, days, amount_field="source_amount"):
    """Compare current period vs previous period, return (current, previous, pct_change)."""
    current_start = now - timedelta(days=days)
    previous_start = now - timedelta(days=days * 2)
    current = qs_base.filter(created_at__gte=current_start).aggregate(
        count=Count("id"), volume=Sum(amount_field)
    )
    previous = qs_base.filter(
        created_at__gte=previous_start, created_at__lt=current_start
    ).aggregate(count=Count("id"), volume=Sum(amount_field))
    cur_count = current["count"] or 0
    prev_count = previous["count"] or 0
    cur_vol = float(current["volume"] or 0)
    prev_vol = float(previous["volume"] or 0)
    count_pct = ((cur_count - prev_count) / prev_count * 100) if prev_count else (100 if cur_count else 0)
    vol_pct = ((cur_vol - prev_vol) / prev_vol * 100) if prev_vol else (100 if cur_vol else 0)
    return {
        "count": cur_count, "prev_count": prev_count,
        "volume": cur_vol, "prev_volume": prev_vol,
        "count_change": round(count_pct, 1),
        "volume_change": round(vol_pct, 1),
    }


@staff_member_required
def admin_stats_dashboard(request):
    """Admin statistics dashboard with comprehensive platform metrics."""
    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    thirty_days_ago = now - timedelta(days=30)
    seven_days_ago = now - timedelta(days=7)

    # ── User Stats ──────────────────────────────────────────────────────
    total_users = User.objects.count()
    active_users = User.objects.filter(is_active=True).count()
    new_users_today = User.objects.filter(created_at__gte=today_start).count()
    new_users_7d = User.objects.filter(created_at__gte=seven_days_ago).count()
    new_users_30d = User.objects.filter(created_at__gte=thirty_days_ago).count()
    suspended_users = User.objects.filter(is_suspended=True).count()

    # ── Transaction Stats ───────────────────────────────────────────────
    total_transactions = Transaction.objects.count()
    completed_transactions = Transaction.objects.filter(status="completed").count()
    failed_transactions = Transaction.objects.filter(status="failed").count()
    pending_transactions = Transaction.objects.filter(
        status__in=["pending", "processing", "confirming"]
    ).count()
    success_rate = round(completed_transactions / total_transactions * 100, 1) if total_transactions else 0

    # ── Revenue (fees from completed transactions) ──────────────────────
    revenue_result = Transaction.objects.filter(
        status="completed",
        fee_amount__gt=0,
    ).aggregate(total_fees=Sum("fee_amount"))
    total_revenue = revenue_result["total_fees"] or Decimal("0")

    # ── Revenue analytics (merged from former /admin/revenue/) ─────────
    # 2026-05-17 · folded the standalone /admin/revenue/ endpoint into
    # /admin/stats/ as a dedicated section. Same Transaction-record
    # sums + SystemWallet reconciliation, now rendered as charts +
    # tables on the unified dashboard instead of a JSON-only endpoint.
    from apps.wallets.models import SystemWallet as _SystemWallet
    from apps.wallets.models import FeeLedgerEntry as _FeeLedgerEntry

    def _revenue_sum_block(qs):
        """Per-currency fee + excise + tx_count aggregates."""
        rows = (
            qs.values("fee_currency")
              .annotate(
                  fee=Coalesce(Sum("fee_amount"), Decimal("0")),
                  excise=Coalesce(Sum("excise_duty_amount"), Decimal("0")),
                  tx_count=Count("id"),
              )
        )
        out = {}
        for r in rows:
            ccy = (r["fee_currency"] or "").upper() or "UNKNOWN"
            out[ccy] = {
                "fee": float(r["fee"] or 0),
                "excise": float(r["excise"] or 0),
                "total": float((r["fee"] or 0) + (r["excise"] or 0)),
                "tx_count": r["tx_count"],
            }
        return out

    completed = Transaction.objects.filter(status="completed")
    rev_lifetime = _revenue_sum_block(completed)
    rev_periods = {
        "last_24h": _revenue_sum_block(
            completed.filter(completed_at__gte=now - timedelta(hours=24))
        ),
        "last_7d": _revenue_sum_block(
            completed.filter(completed_at__gte=now - timedelta(days=7))
        ),
        "last_30d": _revenue_sum_block(
            completed.filter(completed_at__gte=now - timedelta(days=30))
        ),
    }

    # Per-tx-type revenue (used for the "BUY may be net-loss" surface)
    rev_by_type_rows = (
        completed.values("type", "fee_currency")
        .annotate(
            fee=Coalesce(Sum("fee_amount"), Decimal("0")),
            excise=Coalesce(Sum("excise_duty_amount"), Decimal("0")),
            tx_count=Count("id"),
            volume_dest=Coalesce(Sum("dest_amount"), Decimal("0")),
        )
        .order_by("type", "fee_currency")
    )
    rev_by_type = [
        {
            "tx_type": r["type"],
            "fee_currency": (r["fee_currency"] or "").upper() or "UNKNOWN",
            "tx_count": r["tx_count"],
            "fee": float(r["fee"] or 0),
            "excise": float(r["excise"] or 0),
            "total_revenue": float((r["fee"] or 0) + (r["excise"] or 0)),
            "dest_volume": float(r["volume_dest"] or 0),
        }
        for r in rev_by_type_rows
    ]

    # Earned-vs-booked reconciliation. After the 9-fix bundle landed
    # (commit f4f6d25), KES gap = 0; USDT gap = the SWAP backfill that
    # hasn't been re-run yet. Surface it so ops sees the residual.
    fee_wallets = {
        w.currency.upper(): w.balance
        for w in _SystemWallet.objects.filter(
            wallet_type=_SystemWallet.WalletType.FEE
        )
    }
    excise_wallets = {
        w.currency.upper(): w.balance
        for w in _SystemWallet.objects.filter(
            wallet_type=_SystemWallet.WalletType.EXCISE
        )
    }
    provider_cost_wallets = {
        w.currency.upper(): w.balance
        for w in _SystemWallet.objects.filter(
            wallet_type=_SystemWallet.WalletType.PROVIDER_COST
        )
    }
    rev_reconciliation = []
    all_ccys = (
        set(rev_lifetime.keys())
        | set(fee_wallets.keys())
        | set(excise_wallets.keys())
    )
    for ccy in sorted(all_ccys):
        earned = Decimal(str(rev_lifetime.get(ccy, {}).get("fee", 0)))
        excise = Decimal(str(rev_lifetime.get(ccy, {}).get("excise", 0)))
        booked = Decimal(str(fee_wallets.get(ccy, 0)))
        booked_excise = Decimal(str(excise_wallets.get(ccy, 0)))
        booked_provider = Decimal(str(provider_cost_wallets.get(ccy, 0)))
        rev_reconciliation.append({
            "currency": ccy,
            "earned": float(earned),
            "booked_fee": float(booked),
            "gap": float(earned - booked),
            "excise_owed": float(excise),
            "excise_booked": float(booked_excise),
            "provider_cost_booked": float(booked_provider),
        })

    # Headline KES equivalent (post-spread rate · matches user-facing).
    rev_kes_equivalent = Decimal("0")
    try:
        from apps.rates.services import RateService
        for ccy, block in rev_lifetime.items():
            fee = Decimal(str(block.get("fee") or 0))
            if ccy == "KES":
                rev_kes_equivalent += fee
                continue
            if ccy == "UNKNOWN" or fee <= 0:
                continue
            try:
                info = RateService.get_crypto_kes_rate(ccy)
                rate = Decimal(str(info.get("final_rate") or 0))
                rev_kes_equivalent += fee * rate
            except Exception:  # noqa: BLE001
                pass
        rev_kes_equivalent = rev_kes_equivalent.quantize(Decimal("0.01"))
    except Exception:
        rev_kes_equivalent = Decimal("0")

    # Total FeeLedgerEntry credits + count for the "ledger health" KPI.
    fee_ledger_count = _FeeLedgerEntry.objects.count()

    # ── Trend Comparisons (24h, 7d, 30d) ───────────────────────────────
    completed_qs = Transaction.objects.filter(status="completed")
    trends_24h = _period_comparison(completed_qs, now, 1)
    trends_7d = _period_comparison(completed_qs, now, 7)
    trends_30d = _period_comparison(completed_qs, now, 30)

    # ── Revenue by period ──────────────────────────────────────────────
    rev_24h = float(Transaction.objects.filter(
        status="completed", fee_amount__gt=0, created_at__gte=now - timedelta(days=1)
    ).aggregate(s=Sum("fee_amount"))["s"] or 0)
    rev_7d = float(Transaction.objects.filter(
        status="completed", fee_amount__gt=0, created_at__gte=seven_days_ago
    ).aggregate(s=Sum("fee_amount"))["s"] or 0)
    rev_30d = float(Transaction.objects.filter(
        status="completed", fee_amount__gt=0, created_at__gte=thirty_days_ago
    ).aggregate(s=Sum("fee_amount"))["s"] or 0)

    # ── Transaction Volume by Type ──────────────────────────────────────
    volume_by_type_qs = (
        Transaction.objects.values("type")
        .annotate(count=Count("id"), total_amount=Sum("source_amount"))
        .order_by("-count")
    )
    volume_by_type = [
        {
            "type": row["type"],
            "count": row["count"],
            "total_amount": row["total_amount"] or Decimal("0"),
        }
        for row in volume_by_type_qs
    ]

    # ── Daily Transaction Volume (last 30 days) ────────────────────────
    daily_volume_qs = (
        Transaction.objects.filter(created_at__gte=thirty_days_ago)
        .annotate(date=TruncDate("created_at"))
        .values("date")
        .annotate(count=Count("id"), total_amount=Sum("source_amount"))
        .order_by("date")
    )
    daily_volume = [
        {
            "date": row["date"].isoformat(),
            "count": row["count"],
            "total_amount": row["total_amount"] or Decimal("0"),
        }
        for row in daily_volume_qs
    ]

    # ── KYC Tier Distribution ───────────────────────────────────────────
    kyc_distribution_qs = (
        User.objects.values("kyc_tier")
        .annotate(count=Count("id"))
        .order_by("kyc_tier")
    )
    kyc_tier_labels = {
        0: "Tier 0 - Phone Only",
        1: "Tier 1 - ID Verified",
        2: "Tier 2 - KRA PIN",
        3: "Tier 3 - Enhanced DD",
    }
    kyc_distribution = [
        {
            "tier": row["kyc_tier"],
            "label": kyc_tier_labels.get(row["kyc_tier"], f"Tier {row['kyc_tier']}"),
            "count": row["count"],
        }
        for row in kyc_distribution_qs
    ]

    # ── Transaction Status Distribution ─────────────────────────────────
    status_distribution_qs = (
        Transaction.objects.values("status")
        .annotate(count=Count("id"))
        .order_by("-count")
    )
    status_distribution = [
        {"status": row["status"], "count": row["count"]}
        for row in status_distribution_qs
    ]

    # ── Phone Prefix / Region Analysis ──────────────────────────────────
    # Phone format: +254 7XX... or +254 1XX...
    # Extract characters 5-7 (0-indexed) to get the 3-digit prefix after +254
    region_qs = (
        User.objects.filter(phone__startswith="+254")
        .annotate(prefix=Substr("phone", 5, 1))
        .values("prefix")
        .annotate(count=Count("id"))
        .order_by("-count")
    )
    prefix_labels = {
        "7": "Safaricom (7xx)",
        "1": "Other Networks (1xx)",
        "0": "Legacy (0xx)",
    }
    region_distribution = [
        {
            "prefix": row["prefix"],
            "label": prefix_labels.get(row["prefix"], f"Prefix {row['prefix']}xx"),
            "count": row["count"],
        }
        for row in region_qs
    ]

    # ── Wallet Stats ────────────────────────────────────────────────────
    active_wallets = Wallet.objects.filter(balance__gt=0).count()
    total_wallets = Wallet.objects.count()

    # ── Crypto Holdings by Currency ─────────────────────────────────────
    holdings_qs = (
        Wallet.objects.values("currency")
        .annotate(
            total_balance=Sum("balance"),
            total_locked=Sum("locked_balance"),
            wallet_count=Count("id"),
        )
        .order_by("currency")
    )
    crypto_holdings = [
        {
            "currency": row["currency"],
            "total_balance": row["total_balance"] or Decimal("0"),
            "total_locked": row["total_locked"] or Decimal("0"),
            "wallet_count": row["wallet_count"],
        }
        for row in holdings_qs
    ]

    # ── Recent Transactions ─────────────────────────────────────────────
    recent_transactions_qs = (
        Transaction.objects.select_related("user")
        .order_by("-created_at")[:20]
    )
    recent_transactions = [
        {
            "id": str(tx.id)[:8],
            "user_phone": tx.user.phone,
            "type": tx.type,
            "status": tx.status,
            "source_amount": tx.source_amount or Decimal("0"),
            "source_currency": tx.source_currency,
            "dest_amount": tx.dest_amount or Decimal("0"),
            "dest_currency": tx.dest_currency,
            "fee_amount": tx.fee_amount or Decimal("0"),
            "created_at": tx.created_at.strftime("%Y-%m-%d %H:%M"),
        }
        for tx in recent_transactions_qs
    ]

    # ── Blockchain Deposit Stats ─────────────────────────────────────────
    total_deposits = BlockchainDeposit.objects.count()
    credited_deposits = BlockchainDeposit.objects.filter(status="credited").count()
    pending_deposits = BlockchainDeposit.objects.filter(
        status__in=["detecting", "confirming", "confirmed"]
    ).count()

    # Credited amount per currency
    deposit_by_currency_qs = (
        BlockchainDeposit.objects.filter(status="credited")
        .values("currency")
        .annotate(
            total_amount=Sum("amount"),
            count=Count("id"),
        )
        .order_by("currency")
    )
    deposit_by_currency = [
        {
            "currency": row["currency"],
            "total_amount": row["total_amount"] or Decimal("0"),
            "count": row["count"],
        }
        for row in deposit_by_currency_qs
    ]

    # Deposits by chain
    deposit_by_chain_qs = (
        BlockchainDeposit.objects.values("chain")
        .annotate(count=Count("id"), total_amount=Sum("amount"))
        .order_by("-count")
    )
    deposit_by_chain = [
        {
            "chain": row["chain"],
            "count": row["count"],
            "total_amount": row["total_amount"] or Decimal("0"),
        }
        for row in deposit_by_chain_qs
    ]

    # ── Transaction Type Breakdown (detailed) ─────────────────────────────
    type_breakdown_qs = (
        Transaction.objects.filter(status="completed")
        .values("type")
        .annotate(
            count=Count("id"),
            total_source=Sum("source_amount"),
            total_dest=Sum("dest_amount"),
            total_fees=Sum("fee_amount"),
        )
        .order_by("-count")
    )
    type_breakdown = [
        {
            "type": row["type"],
            "count": row["count"],
            "total_source": row["total_source"] or Decimal("0"),
            "total_dest": row["total_dest"] or Decimal("0"),
            "total_fees": row["total_fees"] or Decimal("0"),
        }
        for row in type_breakdown_qs
    ]

    # ── Recent Blockchain Deposits ──────────────────────────────────────
    recent_deposits_qs = BlockchainDeposit.objects.order_by("-created_at")[:10]
    # Build address → user phone lookup
    deposit_addresses = [d.to_address for d in recent_deposits_qs]
    address_to_phone = dict(
        Wallet.objects.filter(deposit_address__in=deposit_addresses)
        .select_related("user")
        .values_list("deposit_address", "user__phone")
    )
    recent_deposits = []
    for dep in recent_deposits_qs:
        recent_deposits.append({
            "id": dep.tx_hash[:8] if dep.tx_hash else str(dep.id)[:8],
            "user_phone": address_to_phone.get(dep.to_address, "N/A"),
            "type": "CRYPTO_DEPOSIT",
            "status": dep.status,
            "amount": str(dep.amount),
            "currency": dep.currency,
            "chain": dep.chain,
            "confirmations": dep.confirmations,
            "required_confirmations": dep.required_confirmations,
            "created_at": dep.created_at.strftime("%Y-%m-%d %H:%M"),
        })

    # ── Celery task count (24h) ─────────────────────────────────────────
    # Count transactions processed in last 24h as proxy for Celery activity
    celery_tasks_24h = Transaction.objects.filter(
        created_at__gte=now - timedelta(hours=24)
    ).count()

    # ── System health — live checks ─────────────────────────────────────
    # Measured inline. Keeps the dashboard honest: if the DB/Redis/SMS/
    # rate-provider is slow right now the number turns red.
    import time as _time
    from django.db import connection as _db_conn
    from django.core.cache import cache as _cache
    system_health = {
        "timestamp": now.isoformat(),
        "checks": [],
    }

    def _measure(name, fn):
        t0 = _time.monotonic()
        try:
            fn()
            ok, err = True, None
        except Exception as e:  # noqa: BLE001
            ok, err = False, str(e)[:160]
        latency_ms = int((_time.monotonic() - t0) * 1000)
        system_health["checks"].append({
            "name": name,
            "ok": ok,
            "latency_ms": latency_ms,
            "error": err,
        })

    # Database round-trip
    def _db_check():
        with _db_conn.cursor() as c:
            c.execute("SELECT 1")
            c.fetchone()
    _measure("postgres", _db_check)

    # Redis round-trip
    _measure("redis", lambda: (_cache.set("admin_stats_health_probe", "1", 5), _cache.get("admin_stats_health_probe")))

    # Rate cache freshness — we require at least one cached crypto rate
    def _rate_check():
        if not _cache.get("rate:crypto:USDT:usd"):
            raise RuntimeError("rate cache empty")
    _measure("rate_cache", _rate_check)

    # Forex cache freshness
    def _forex_check():
        if not _cache.get("rate:forex:usd:kes"):
            raise RuntimeError("forex cache empty")
    _measure("forex_cache", _forex_check)

    system_health["all_ok"] = all(c["ok"] for c in system_health["checks"])

    # Recent activity (last 5 min) = proxy for "is the app being used right now"
    from django.contrib.auth import get_user_model as _gum
    _User = _gum()
    online_cutoff = now - timedelta(minutes=5)
    online_users_now = _User.objects.filter(last_activity_at__gt=online_cutoff).count()
    active_24h_users = _User.objects.filter(last_activity_at__gt=now - timedelta(hours=24)).count()

    # ── Enterprise cohort metrics ─────────────────────────────────────────
    # DAU / MAU split — stickiness = DAU/MAU. Industry benchmark is 20%+.
    dau = _User.objects.filter(last_activity_at__gt=now - timedelta(days=1)).count()
    mau = _User.objects.filter(last_activity_at__gt=now - timedelta(days=30)).count()
    stickiness_percent = round(dau / mau * 100, 1) if mau else 0

    # AUM (Assets Under Management) — total balance across all wallets,
    # grouped by KYC tier. Identifies treasury concentration (are most
    # assets held by a small tier-3 cohort?).
    aum_by_tier = list(
        Wallet.objects.filter(user__isnull=False)
        .values("user__kyc_tier")
        .annotate(
            wallet_count=Count("id"),
            total_balance=Coalesce(Sum("balance"), Decimal("0")),
        )
        .order_by("user__kyc_tier")
    )
    # Normalise for JSON encoding.
    aum_by_tier = [
        {
            "tier": r["user__kyc_tier"],
            "label": kyc_tier_labels.get(r["user__kyc_tier"], f"Tier {r['user__kyc_tier']}"),
            "wallet_count": r["wallet_count"],
            "total_balance": r["total_balance"] or Decimal("0"),
        }
        for r in aum_by_tier
    ]

    # Churn-risk cohort — users who had a transaction in the past 30 days
    # but haven't opened the app in the last 7 days. Prime targets for a
    # re-engagement push campaign.
    recent_tx_user_ids = (
        Transaction.objects.filter(created_at__gt=now - timedelta(days=30))
        .values_list("user_id", flat=True)
        .distinct()
    )
    churn_risk_count = _User.objects.filter(
        id__in=recent_tx_user_ids,
    ).exclude(
        last_activity_at__gt=now - timedelta(days=7),
    ).count()

    # High-velocity traders — users with more than N transactions in the
    # last 24 hours. Watch-list for compliance / fraud review.
    HIGH_VELOCITY_THRESHOLD = 10
    high_velocity_qs = (
        Transaction.objects.filter(created_at__gt=now - timedelta(days=1))
        .values("user_id")
        .annotate(tx_count=Count("id"))
        .filter(tx_count__gt=HIGH_VELOCITY_THRESHOLD)
        .order_by("-tx_count")[:10]
    )
    high_velocity = list(high_velocity_qs)

    # 24h transaction failure rate — if this spikes, something's on fire.
    last_day_tx = Transaction.objects.filter(created_at__gt=now - timedelta(days=1))
    tx_24h_total = last_day_tx.count()
    tx_24h_failed = last_day_tx.filter(status="failed").count()
    failure_rate_24h = round(tx_24h_failed / tx_24h_total * 100, 2) if tx_24h_total else 0

    # ── Build Context ───────────────────────────────────────────────────
    context = {
        # 2026-05-17 · revenue analytics block (folded from former
        # /admin/revenue/ endpoint). Charts + tables on the unified
        # stats dashboard surface the same data.
        "rev_lifetime_json": json.dumps(rev_lifetime),
        "rev_periods_json": json.dumps(rev_periods),
        "rev_by_type_json": json.dumps(rev_by_type),
        "rev_reconciliation_json": json.dumps(rev_reconciliation),
        "rev_kes_equivalent": float(rev_kes_equivalent),
        "fee_ledger_count": fee_ledger_count,
        # Scalar stats
        "total_users": total_users,
        "active_users": active_users,
        "new_users_today": new_users_today,
        "new_users_7d": new_users_7d,
        "new_users_30d": new_users_30d,
        "suspended_users": suspended_users,
        "total_transactions": total_transactions,
        "completed_transactions": completed_transactions,
        "failed_transactions": failed_transactions,
        "pending_transactions": pending_transactions,
        "success_rate": success_rate,
        "total_revenue": float(total_revenue),
        "rev_24h": rev_24h,
        "rev_7d": rev_7d,
        "rev_30d": rev_30d,
        "active_wallets": active_wallets,
        "total_wallets": total_wallets,
        # Trend data
        "trends_24h_json": json.dumps(trends_24h),
        "trends_7d_json": json.dumps(trends_7d),
        "trends_30d_json": json.dumps(trends_30d),
        # JSON data for D3 charts
        "volume_by_type_json": json.dumps(volume_by_type, cls=DecimalEncoder),
        "daily_volume_json": json.dumps(daily_volume, cls=DecimalEncoder),
        "kyc_distribution_json": json.dumps(kyc_distribution, cls=DecimalEncoder),
        "status_distribution_json": json.dumps(status_distribution, cls=DecimalEncoder),
        "region_distribution_json": json.dumps(region_distribution, cls=DecimalEncoder),
        "crypto_holdings_json": json.dumps(crypto_holdings, cls=DecimalEncoder),
        "recent_transactions_json": json.dumps(recent_transactions, cls=DecimalEncoder),
        # Blockchain deposit stats
        "total_deposits": total_deposits,
        "credited_deposits": credited_deposits,
        "pending_deposits": pending_deposits,
        "deposit_by_currency_json": json.dumps(deposit_by_currency, cls=DecimalEncoder),
        "deposit_by_chain_json": json.dumps(deposit_by_chain, cls=DecimalEncoder),
        "recent_deposits_json": json.dumps(recent_deposits, cls=DecimalEncoder),
        # Transaction type breakdown
        "type_breakdown_json": json.dumps(type_breakdown, cls=DecimalEncoder),
        # System stats
        "celery_tasks_24h": celery_tasks_24h,
        "system_health": system_health,
        "system_health_json": json.dumps(system_health, cls=DecimalEncoder),
        "online_users_now": online_users_now,
        "active_24h_users": active_24h_users,
        # Enterprise cohort metrics
        "dau": dau,
        "mau": mau,
        "stickiness_percent": stickiness_percent,
        "aum_by_tier_json": json.dumps(aum_by_tier, cls=DecimalEncoder),
        "churn_risk_count": churn_risk_count,
        "high_velocity_json": json.dumps(high_velocity, cls=DecimalEncoder),
        "high_velocity_count": len(high_velocity),
        "high_velocity_threshold": HIGH_VELOCITY_THRESHOLD,
        "failure_rate_24h": failure_rate_24h,
        "tx_24h_total": tx_24h_total,
        "tx_24h_failed": tx_24h_failed,
        # Metadata
        "last_refresh": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
    }

    return render(request, "admin/stats.html", context)


# ---------------------------------------------------------------------------
# SMS health check endpoint — staff-only, verifies eSMS / AT delivery on demand
# ---------------------------------------------------------------------------


# 2026-05-17 · The standalone /admin/revenue/ endpoint is RETIRED.
# All its data is now folded into /admin/stats/ as a dedicated
# "Revenue Analysis" section with charts + tables (see the
# `rev_lifetime` / `rev_periods` / `rev_by_type` / `rev_reconciliation`
# blocks added to `admin_stats_dashboard` above). Keeping one
# canonical admin destination is simpler than maintaining a second
# JSON-only sibling.


@staff_member_required
@require_http_methods(["GET"])
def admin_float_balances(request):
    """Combined float balance dashboard · IntaSend + SasaPay.

    2026-05-17 · ops asked for ONE place to see the total settlement
    float across BOTH M-Pesa rails. Previously each provider was
    monitored separately:
      - SasaPay · `apps.mpesa.tasks.check_float_balance` low-balance alert
      - IntaSend · `intasend_healthcheck` CLI

    This endpoint queries each provider's balance API live and returns
    a normalised JSON shape so the admin dashboard can render a single
    "Total float available to disburse" tile + a per-provider breakdown.

    Public shape:
      {
        "total_disbursable_kes": float,   # SUM across both providers,
                                          # only wallets with can_disburse
                                          # = True for IntaSend or working
                                          # account for SasaPay
        "providers": {
          "intasend": {
              "available_kes": float,
              "total_kes": float,
              "wallets": [
                  {"wallet_id", "label", "currency", "balance",
                   "can_disburse", "wallet_type"}
              ],
              "error": str | null,
          },
          "sasapay": {
              "available_kes": float,
              "total_kes": float,
              "accounts": [
                  {"label", "balance", "is_working", "is_utility"}
              ],
              "error": str | null,
          },
        },
        "checked_at": iso8601,
      }

    Cached for 30 s so a dashboard auto-refresh every few seconds
    doesn't hammer either provider's balance API. Live refresh via
    ?refresh=1 bypasses cache.

    Auth · staff_member_required. Returns 403 to non-staff.
    """
    from django.core.cache import cache as _cache

    CACHE_KEY = "admin:float_balances:v1"
    if not request.GET.get("refresh"):
        cached = _cache.get(CACHE_KEY)
        if cached:
            return JsonResponse(cached, encoder=DecimalEncoder)

    intasend_block = _fetch_intasend_float()
    sasapay_block = _fetch_sasapay_float()

    # Total disbursable = sum of disburse-eligible balances across both
    # providers. For IntaSend that's wallets with can_disburse=True; for
    # SasaPay that's the Working + Utility balance (Bulk Payment isn't
    # routinely used for B2B/B2C).
    total_disbursable = (
        float(intasend_block.get("available_kes", 0))
        + float(sasapay_block.get("available_kes", 0))
    )

    payload = {
        "total_disbursable_kes": round(total_disbursable, 2),
        "providers": {
            "intasend": intasend_block,
            "sasapay": sasapay_block,
        },
        "checked_at": timezone.now().isoformat(),
    }
    _cache.set(CACHE_KEY, payload, timeout=30)
    return JsonResponse(payload, encoder=DecimalEncoder)


def _fetch_intasend_float() -> dict:
    """Query IntaSend's /api/v1/wallets/ and normalise.

    Returns ZERO available_kes if any HTTP or auth error · the admin
    dashboard renders the failure inline rather than blocking the whole
    page on a partial outage.
    """
    out = {
        "available_kes": 0.0,
        "total_kes": 0.0,
        "wallets": [],
        "error": None,
    }
    try:
        from apps.mpesa.intasend_client import IntaSendClient
        client = IntaSendClient()
        resp = requests.get(
            f"{client.base_url}/api/v1/wallets/",
            headers=client._headers(),
            timeout=8,
        )
        if resp.status_code != 200:
            out["error"] = f"HTTP {resp.status_code}: {resp.text[:200]}"
            return out
        wallets = (resp.json() or {}).get("results") or []
        for w in wallets:
            ccy = (w.get("currency") or "").upper()
            bal = float(w.get("current_balance") or 0)
            can_disburse = bool(w.get("can_disburse"))
            out["wallets"].append({
                "wallet_id": w.get("wallet_id") or "",
                "label": w.get("label") or "",
                "currency": ccy,
                "balance": bal,
                "can_disburse": can_disburse,
                "wallet_type": w.get("wallet_type") or "",
            })
            if ccy == "KES":
                out["total_kes"] += bal
                if can_disburse:
                    out["available_kes"] += bal
        out["available_kes"] = round(out["available_kes"], 2)
        out["total_kes"] = round(out["total_kes"], 2)
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:200]
    return out


def _fetch_sasapay_float() -> dict:
    """Query SasaPay's /payments/check-balance/ and normalise."""
    out = {
        "available_kes": 0.0,
        "total_kes": 0.0,
        "accounts": [],
        "error": None,
    }
    try:
        from apps.mpesa.sasapay_client import SasaPayClient
        client = SasaPayClient()
        resp = client.check_balance()
        data = resp.get("data") or {}
        for entry in data.get("Accounts") or []:
            label = (entry.get("account_label") or "").lower()
            bal = float(entry.get("account_balance") or 0)
            is_working = "working" in label
            is_utility = "utility" in label
            out["accounts"].append({
                "label": entry.get("account_label") or "",
                "balance": bal,
                "is_working": is_working,
                "is_utility": is_utility,
            })
            out["total_kes"] += bal
            # Disburse-eligible · Working (B2B / paybill / till settle from
            # here in SasaPay's design) + Utility (B2C).
            if is_working or is_utility:
                out["available_kes"] += bal
        out["available_kes"] = round(out["available_kes"], 2)
        out["total_kes"] = round(out["total_kes"], 2)
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:200]
    return out


@csrf_exempt
@staff_member_required
@require_http_methods(["POST", "GET"])
def admin_sms_health(request):
    """Staff-only endpoint to send a test SMS and report provider outcome.

    GET:  returns which providers are configured (no message sent).
    POST: accepts JSON or form body with 'to' (E.164 phone) and optional
          'message'. Dispatches via send_sms() and returns latency + success.

    Purpose: after provider outages (like eSMS Africa's week of silent drops
    in April 2026) we need a fast, auth-gated way to verify OTP delivery
    without going through the full login flow.
    """
    from apps.core.email import send_sms

    esms_configured = bool(
        getattr(settings, "ESMS_API_KEY", "") and getattr(settings, "ESMS_ACCOUNT_ID", "")
    )
    at_configured = bool(getattr(settings, "AT_API_KEY", ""))

    if request.method == "GET":
        return JsonResponse({
            "providers": {
                "esms_africa": "configured" if esms_configured else "not_configured",
                "africas_talking": "configured" if at_configured else "not_configured",
            },
            "usage": "POST { 'to': '+2547XXXXXXXX', 'message': 'optional test body' }",
        })

    # POST — parse body
    try:
        if request.content_type and "application/json" in request.content_type:
            body = json.loads(request.body.decode("utf-8") or "{}")
        else:
            body = request.POST
        to = (body.get("to") or "").strip()
        message = (body.get("message") or
                   f"CPay health check {timezone.now().strftime('%H:%M:%S')}").strip()
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "invalid_body"}, status=400)

    if not to:
        return JsonResponse({"ok": False, "error": "missing_to"}, status=400)

    t0 = time.monotonic()
    ok = send_sms(to, message)
    latency_ms = int((time.monotonic() - t0) * 1000)

    # Which provider actually delivered is recorded in the structured
    # `sms.dispatch` log entry emitted by send_sms — we just report overall
    # success here to keep the response small.
    return JsonResponse({
        "ok": bool(ok),
        "to_masked": f"***{to[-4:]}" if len(to) >= 4 else "***",
        "latency_ms": latency_ms,
        "providers_tried": {
            "esms_africa": esms_configured,
            "africas_talking_fallback": at_configured,
        },
    })
