import json
from datetime import timedelta
from decimal import Decimal

from django.contrib.admin.views.decorators import staff_member_required
from django.db.models import Count, Sum, Q, F
from django.db.models.functions import TruncDate, Substr
from django.shortcuts import render
from django.utils import timezone

from apps.accounts.models import User
from apps.payments.models import Transaction
from apps.wallets.models import Wallet


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types."""

    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


@staff_member_required
def admin_stats_dashboard(request):
    """Admin statistics dashboard with comprehensive platform metrics."""
    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    thirty_days_ago = now - timedelta(days=30)

    # ── User Stats ──────────────────────────────────────────────────────
    total_users = User.objects.count()
    active_users = User.objects.filter(is_active=True).count()
    new_users_today = User.objects.filter(created_at__gte=today_start).count()
    suspended_users = User.objects.filter(is_suspended=True).count()

    # ── Transaction Stats ───────────────────────────────────────────────
    total_transactions = Transaction.objects.count()
    completed_transactions = Transaction.objects.filter(status="completed").count()
    failed_transactions = Transaction.objects.filter(status="failed").count()
    pending_transactions = Transaction.objects.filter(
        status__in=["pending", "processing", "confirming"]
    ).count()

    # ── Revenue (fees from completed transactions) ──────────────────────
    revenue_result = Transaction.objects.filter(
        status="completed",
        fee_amount__gt=0,
    ).aggregate(total_fees=Sum("fee_amount"))
    total_revenue = revenue_result["total_fees"] or Decimal("0")

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

    # ── Build Context ───────────────────────────────────────────────────
    context = {
        # Scalar stats
        "total_users": total_users,
        "active_users": active_users,
        "new_users_today": new_users_today,
        "suspended_users": suspended_users,
        "total_transactions": total_transactions,
        "completed_transactions": completed_transactions,
        "failed_transactions": failed_transactions,
        "pending_transactions": pending_transactions,
        "total_revenue": float(total_revenue),
        "active_wallets": active_wallets,
        "total_wallets": total_wallets,
        # JSON data for D3 charts
        "volume_by_type_json": json.dumps(volume_by_type, cls=DecimalEncoder),
        "daily_volume_json": json.dumps(daily_volume, cls=DecimalEncoder),
        "kyc_distribution_json": json.dumps(kyc_distribution, cls=DecimalEncoder),
        "status_distribution_json": json.dumps(status_distribution, cls=DecimalEncoder),
        "region_distribution_json": json.dumps(region_distribution, cls=DecimalEncoder),
        "crypto_holdings_json": json.dumps(crypto_holdings, cls=DecimalEncoder),
        "recent_transactions_json": json.dumps(recent_transactions, cls=DecimalEncoder),
        # Metadata
        "last_refresh": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
    }

    return render(request, "admin/stats.html", context)
