"""
Payment service functions.

Business logic that sits between views and models.
"""

import logging
from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from .models import Transaction

logger = logging.getLogger(__name__)


class DailyLimitExceededError(Exception):
    def __init__(self, limit: int, spent: Decimal, requested: Decimal):
        self.limit = limit
        self.spent = spent
        self.requested = requested
        super().__init__(
            f"Daily limit of KES {limit:,} exceeded. "
            f"Already spent: KES {spent:,.2f}, requested: KES {requested:,.2f}"
        )


def check_daily_limit(user, amount_kes: Decimal) -> None:
    """
    Check whether a user can transact the given KES amount today,
    based on their KYC tier daily limit.

    Raises DailyLimitExceededError if the limit would be exceeded.
    """
    tier_limits = getattr(settings, "KYC_DAILY_LIMITS", {})
    limit = tier_limits.get(user.kyc_tier, 5_000)

    today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # Sum all completed + processing outgoing transactions today (KES side)
    spent_today = (
        Transaction.objects.filter(
            user=user,
            status__in=[
                Transaction.Status.COMPLETED,
                Transaction.Status.PROCESSING,
                Transaction.Status.CONFIRMING,
            ],
            dest_currency="KES",
            created_at__gte=today_start,
        )
        .exclude(type=Transaction.Type.FEE)
        .values_list("dest_amount", flat=True)
    )

    total_spent = sum((a for a in spent_today if a), Decimal("0"))

    if total_spent + amount_kes > Decimal(str(limit)):
        raise DailyLimitExceededError(
            limit=limit,
            spent=total_spent,
            requested=amount_kes,
        )

    logger.debug(
        "Daily limit check passed for user=%s tier=%d: spent=%s + requested=%s <= limit=%s",
        user.phone, user.kyc_tier, total_spent, amount_kes, limit,
    )
