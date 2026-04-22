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


class DailyLimitLock:
    """B4: explicit lock handle returned by check_daily_limit. Caller is
    responsible for calling .release() only AFTER the Transaction row has
    been committed · so concurrent callers see that row and can't both
    pass the limit check on stale state. Safe to release multiple times."""

    __slots__ = ("_key", "_released")

    def __init__(self, key: str):
        self._key = key
        self._released = False

    def release(self):
        if self._released:
            return
        try:
            cache.delete(self._key)
        finally:
            self._released = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.release()
        return False


def check_daily_limit(user, amount_kes: Decimal) -> DailyLimitLock:
    """
    Check whether a user can transact the given KES amount today,
    based on their KYC tier daily limit.

    B4: the per-user Redis lock is held past this function's return · the
    returned `DailyLimitLock` must be released by the caller only after
    the corresponding Transaction has been persisted. This closes the
    TOCTOU window between "sum spent_today" and "Transaction.objects.create".

    Raises DailyLimitExceededError if the limit would be exceeded.
    """
    lock_key = f"daily_limit_check:{user.id}"
    # 30s: comfortably longer than any realistic Transaction.create path.
    if not cache.add(lock_key, "1", timeout=30):
        raise DailyLimitExceededError(
            message="Please wait and try again",
        )

    try:
        tier_limits = getattr(settings, "KYC_DAILY_LIMITS", {})
        limit = tier_limits.get(user.kyc_tier, 5_000)

        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)

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
            # Release before raising · caller can retry without waiting.
            cache.delete(lock_key)
            raise DailyLimitExceededError(
                limit=limit,
                spent=total_spent,
                requested=amount_kes,
            )

        logger.debug(
            "Daily limit check passed for user=%s tier=%d: spent=%s + requested=%s <= limit=%s",
            user.phone, user.kyc_tier, total_spent, amount_kes, limit,
        )
    except DailyLimitExceededError:
        raise
    except Exception:
        cache.delete(lock_key)
        raise

    return DailyLimitLock(lock_key)
