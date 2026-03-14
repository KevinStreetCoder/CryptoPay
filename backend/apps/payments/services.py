"""
Payment service functions.

Business logic that sits between views and models.
"""

import logging
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from .models import Transaction

logger = logging.getLogger(__name__)


class DailyLimitExceededError(Exception):
    def __init__(self, limit=0, spent=Decimal("0"), requested=Decimal("0"), message=""):
        self.limit = limit
        self.spent = spent
        self.requested = requested
        if message:
            super().__init__(message)
        else:
            super().__init__(
                f"Daily limit of KES {limit:,} exceeded. "
                f"Already spent: KES {spent:,.2f}, requested: KES {requested:,.2f}"
            )


def check_daily_limit(user, amount_kes: Decimal) -> None:
    """
    Check whether a user can transact the given KES amount today,
    based on their KYC tier daily limit.

    Uses a per-user Redis lock to prevent TOCTOU race conditions where
    two concurrent payments both pass the limit check.

    Raises DailyLimitExceededError if the limit would be exceeded.
    """
    # Acquire a per-user lock to prevent concurrent limit checks
    lock_key = f"daily_limit_check:{user.id}"
    if not cache.add(lock_key, "1", timeout=5):
        raise DailyLimitExceededError(
            message="Please wait and try again",
        )

    try:
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
    finally:
        cache.delete(lock_key)
