"""DepositIntent service · short-code generation, lookup, consumption.

Six-character Crockford-base32 codes (32^6 = ~1.07B possibilities).
Crockford excludes I/O/L/U so customers can't confuse 0/O or 1/I when
typing into M-Pesa. With a 30-min default TTL the active-code space
is in single-digit billionths · collisions are practically impossible
even at production scale.

Generation strategy: random 6 chars + DB unique-index check + retry.
At <1% utilisation the first try succeeds 99.999% of the time. We
retry up to 5 times before raising.
"""
from __future__ import annotations

import logging
import secrets
from datetime import timedelta
from decimal import Decimal
from typing import Optional

from django.db import IntegrityError, transaction as db_tx
from django.utils import timezone

from .models import DepositIntent

logger = logging.getLogger(__name__)


# Crockford base32 alphabet · excludes I, L, O, U for human-typability.
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_CODE_LENGTH = 6
_DEFAULT_TTL_MINUTES = 30
_SUPPORTED_CURRENCIES = ("USDT", "USDC", "BTC", "ETH", "SOL", "KES")


def _generate_code() -> str:
    """Generate a single fresh 6-char Crockford code."""
    return "".join(secrets.choice(_CROCKFORD) for _ in range(_CODE_LENGTH))


def create_intent(
    user,
    currency: str,
    *,
    ttl_minutes: int = _DEFAULT_TTL_MINUTES,
) -> DepositIntent:
    """Create a fresh DepositIntent for `user` targeting `currency`.

    Raises:
      ValueError · currency not in supported list
      RuntimeError · code-collision retries exhausted (theoretically
        impossible without enormous load · indicates a Redis-side bug)
    """
    currency = (currency or "").strip().upper()
    if currency not in _SUPPORTED_CURRENCIES:
        raise ValueError(
            f"Unsupported deposit currency {currency!r}. "
            f"Pick one of {_SUPPORTED_CURRENCIES}."
        )

    expires_at = timezone.now() + timedelta(minutes=ttl_minutes)

    # Retry 5 times on the unbelievably-rare collision · the unique
    # index is the source of truth.
    for attempt in range(5):
        code = _generate_code()
        try:
            with db_tx.atomic():
                return DepositIntent.objects.create(
                    user=user,
                    currency=currency,
                    code=code,
                    expires_at=expires_at,
                )
        except IntegrityError:
            logger.warning(
                "deposit_intent.code_collision",
                extra={"attempt": attempt + 1, "code": code},
            )
            continue

    raise RuntimeError(
        "Failed to generate a unique DepositIntent code after 5 tries."
    )


def lookup_active(code: str) -> Optional[DepositIntent]:
    """Return the active OPEN intent for `code`, or None.

    Active = status==OPEN AND expires_at > now. Consumed / expired /
    cancelled codes return None so a replayed callback can't credit
    the same intent twice.
    """
    if not code:
        return None
    code = code.strip().upper()
    if not code:
        return None

    intent = (
        DepositIntent.objects
        .filter(code=code, status=DepositIntent.Status.OPEN)
        .first()
    )
    if intent is None:
        return None
    if not intent.is_active:
        # Expired but not yet swept · mark + return None.
        intent.status = DepositIntent.Status.EXPIRED
        intent.save(update_fields=["status"])
        return None
    return intent


def consume(intent: DepositIntent, transaction) -> DepositIntent:
    """Mark `intent` consumed against `transaction`. Idempotent · a
    second consume with the same transaction is a no-op."""
    if intent.status == DepositIntent.Status.CONSUMED:
        if intent.transaction_id == transaction.id:
            return intent
        # Different transaction trying to consume an already-consumed
        # intent · this is a real bug or a replay. Refuse loudly.
        raise ValueError(
            f"Intent {intent.code} already consumed by transaction "
            f"{intent.transaction_id}; refusing to re-consume against "
            f"{transaction.id}."
        )
    intent.status = DepositIntent.Status.CONSUMED
    intent.consumed_at = timezone.now()
    intent.transaction = transaction
    intent.save(update_fields=["status", "consumed_at", "transaction"])
    return intent


def cancel(intent: DepositIntent) -> DepositIntent:
    """User-initiated invalidation · returns the intent unchanged
    if it's already in a terminal state."""
    if intent.status != DepositIntent.Status.OPEN:
        return intent
    intent.status = DepositIntent.Status.CANCELLED
    intent.save(update_fields=["status"])
    return intent


def sweep_expired() -> int:
    """Background sweep · marks OPEN intents past their expires_at as
    EXPIRED. Idempotent. Called from a Celery beat task daily.

    Not strictly required for correctness · `lookup_active` already
    self-heals expired-but-not-marked intents on read · but keeps the
    DB tidy for analytics + admin queries.
    """
    count = (
        DepositIntent.objects
        .filter(
            status=DepositIntent.Status.OPEN,
            expires_at__lt=timezone.now(),
        )
        .update(status=DepositIntent.Status.EXPIRED)
    )
    if count:
        logger.info("deposit_intent.swept_expired", extra={"count": count})
    return count
