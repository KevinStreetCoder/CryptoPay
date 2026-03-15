import json
from datetime import timedelta
from decimal import Decimal

from django.contrib.admin.views.decorators import staff_member_required
from django.db.models import Count, Sum, Q, F
from django.db.models.functions import TruncDate, Substr
from django.shortcuts import render
from django.utils import timezone

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

    # ── Celery task count (24h) ─────────────────────────────────────────
    # Count transactions processed in last 24h as proxy for Celery activity
    celery_tasks_24h = Transaction.objects.filter(
        created_at__gte=now - timedelta(hours=24)
    ).count()

    # ── Build Context ───────────────────────────────────────────────────
    context = {
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
        # Transaction type breakdown
        "type_breakdown_json": json.dumps(type_breakdown, cls=DecimalEncoder),
        # System stats
        "celery_tasks_24h": celery_tasks_24h,
        # Metadata
        "last_refresh": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
    }

    return render(request, "admin/stats.html", context)
