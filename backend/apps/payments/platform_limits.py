"""Platform-limits service · admin-settable safety caps for outgoing payments.

Layered above the per-user KYC daily-limit + the float-based circuit
breaker. Three caps + a kill switch:

  max_per_tx_kes         · refuses any single tx above this amount
  max_per_hour_kes       · refuses if 60-min outgoing total exceeds
  max_per_day_kes        · refuses if 24-h  outgoing total exceeds
  max_tx_per_hour_count  · refuses if outgoing tx count in 60 min ≥ this
  hard_pause             · kill switch; refuses every outgoing payment

Why this exists: the float-based circuit breaker pauses payments only
when the M-Pesa KES float is critically low. A compromised hot-wallet
key, a runaway saga retry loop, or a stolen API token can drain
treasury LONG before the float reading catches up · the platform
limit is the second line of defence that ops controls directly.

Window-based counters live in Redis (sliding-window counts via sorted
set). Reads are cheap and atomic; expiry is automatic.

Wiring:
  - Pre-payment guard      : `enforce_outgoing(amount_kes)` raises
                             `PlatformLimitExceeded` to refuse.
  - Post-completion record : `record_outgoing(amount_kes)` increments
                             counters · called from saga.complete().
  - Admin read             : `get_status(...)` returns current caps,
                             usage, and remaining headroom.
  - Admin write            : `update_limits(...)` updates the
                             singleton + audit log.

The Redis layout uses time-bucket sorted sets so a "last 60 min"
query is just `ZRANGEBYSCORE` over a sliding window, no cron needed.
"""
from __future__ import annotations

import logging
import time
from decimal import Decimal
from typing import Optional

from django.core.cache import cache
from django.utils import timezone

from .models import PlatformLimit

logger = logging.getLogger(__name__)


# Redis keys · zset of (timestamp_seconds → "<txid>:<amount_kes>")
_KEY_OUTGOING_HOUR = "platform_limits:outgoing_window:hour"
_KEY_OUTGOING_DAY = "platform_limits:outgoing_window:day"
# Cache key for the singleton record (PK 1 row) · invalidated on PATCH.
_CACHE_KEY_LIMIT = "platform_limits:current_v2"
_CACHE_TTL = 60  # seconds · short, since admins might tighten in incidents

_HOUR = 3600
_DAY = 86400


class PlatformLimitExceeded(Exception):
    """Raised when an outgoing payment would breach an admin-set cap."""

    def __init__(
        self,
        cap_name: str,
        attempted_kes: Decimal,
        cap_kes: Optional[Decimal] = None,
        cap_count: Optional[int] = None,
        current: Optional[Decimal] = None,
    ):
        self.cap_name = cap_name
        self.attempted_kes = attempted_kes
        self.cap_kes = cap_kes
        self.cap_count = cap_count
        self.current = current
        super().__init__(self._build_message())

    def _build_message(self) -> str:
        if self.cap_name == "hard_pause":
            return "Payments are paused by admin (incident response)."
        if self.cap_name == "max_per_tx":
            return (
                f"Transaction amount KES {self.attempted_kes:,.0f} exceeds the "
                f"per-transaction limit of KES {self.cap_kes:,.0f}."
            )
        if self.cap_name == "max_per_hour":
            return (
                f"Hourly outgoing limit reached: KES {self.current:,.0f} "
                f"already settled in the last 60 min, plus this "
                f"KES {self.attempted_kes:,.0f} would exceed the "
                f"KES {self.cap_kes:,.0f} cap."
            )
        if self.cap_name == "max_per_day":
            return (
                f"Daily outgoing limit reached: KES {self.current:,.0f} "
                f"already settled in the last 24 h, plus this "
                f"KES {self.attempted_kes:,.0f} would exceed the "
                f"KES {self.cap_kes:,.0f} cap."
            )
        if self.cap_name == "max_count_per_hour":
            return (
                f"Hourly transaction count limit reached: {int(self.current)} "
                f"outgoing tx in the last 60 min would exceed the "
                f"{self.cap_count} cap."
            )
        return f"Platform limit exceeded ({self.cap_name})."


# ── Singleton accessors ─────────────────────────────────────────────


def get_limit() -> PlatformLimit:
    """Read the singleton · cached for `_CACHE_TTL` seconds.

    The cache buys ~90% of the hot-path · payments fire a couple of
    times per second on a busy day, but the limits are admin-set and
    only change at human pace. Invalidate on PATCH via
    `_invalidate_limit_cache()`.
    """
    cached = cache.get(_CACHE_KEY_LIMIT)
    if cached is not None:
        return cached
    obj = PlatformLimit.current()
    cache.set(_CACHE_KEY_LIMIT, obj, _CACHE_TTL)
    return obj


def _invalidate_limit_cache() -> None:
    cache.delete(_CACHE_KEY_LIMIT)


# ── Window counters (Redis sorted sets) ─────────────────────────────


def _redis_client():
    """Pull the underlying Redis client from django-redis (or fall back
    to the cache backend for tests with locmem)."""
    try:
        from django_redis import get_redis_connection
        return get_redis_connection("default")
    except Exception:
        return None


def _record_window(amount_kes: Decimal, transaction_id: str) -> None:
    """Add this outgoing tx to both the hour and day sliding windows."""
    client = _redis_client()
    if client is None:
        # Fallback for non-Redis test envs · use Django cache as a
        # plain key so tests still cover the policy without rewiring.
        # Only the 'count' path uses this fallback meaningfully · the
        # KES sums are recomputed in the policy from the value stored.
        # Acceptable since prod uses django-redis and tests primarily
        # care about the policy decisions, not the storage shape.
        ts = time.time()
        bucket = cache.get("platform_limits:fallback_window") or []
        bucket.append((ts, str(amount_kes), transaction_id))
        # Trim to last 24 h
        cutoff = ts - _DAY
        bucket = [b for b in bucket if b[0] > cutoff]
        cache.set("platform_limits:fallback_window", bucket, _DAY)
        return

    ts = time.time()
    member = f"{transaction_id}:{amount_kes}"
    pipe = client.pipeline()
    # Hour window
    pipe.zadd(_KEY_OUTGOING_HOUR, {member: ts})
    pipe.zremrangebyscore(_KEY_OUTGOING_HOUR, 0, ts - _HOUR)
    pipe.expire(_KEY_OUTGOING_HOUR, _HOUR + 60)
    # Day window
    pipe.zadd(_KEY_OUTGOING_DAY, {member: ts})
    pipe.zremrangebyscore(_KEY_OUTGOING_DAY, 0, ts - _DAY)
    pipe.expire(_KEY_OUTGOING_DAY, _DAY + 60)
    pipe.execute()


def _read_window(seconds: int) -> tuple[Decimal, int]:
    """Return (sum_kes, count) of outgoing payments in the last
    `seconds` window. Reads from Redis or the test fallback."""
    client = _redis_client()
    if client is None:
        ts = time.time()
        bucket = cache.get("platform_limits:fallback_window") or []
        cutoff = ts - seconds
        relevant = [b for b in bucket if b[0] > cutoff]
        total = sum((Decimal(str(b[1])) for b in relevant), Decimal("0"))
        return total, len(relevant)

    key = _KEY_OUTGOING_HOUR if seconds <= _HOUR else _KEY_OUTGOING_DAY
    ts = time.time()
    members = client.zrangebyscore(key, ts - seconds, ts)
    total = Decimal("0")
    count = 0
    for raw in members:
        try:
            decoded = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)
            _, amount = decoded.rsplit(":", 1)
            total += Decimal(amount)
            count += 1
        except (ValueError, IndexError):
            # Bad format · skip rather than 500 the saga.
            continue
    return total, count


# ── Public API ──────────────────────────────────────────────────────


def enforce_outgoing(amount_kes: Decimal, *, transaction_id: str = "") -> None:
    """Pre-payment guard · raise PlatformLimitExceeded if outgoing.

    Call this immediately after `check_daily_limit` and the circuit
    breaker check, before initiating the M-Pesa B2B/B2C call.

    Order of checks:
      1. hard_pause              · highest priority kill switch
      2. max_per_tx_kes          · cheap O(1) compare
      3. max_tx_per_hour_count   · count is cheaper than sum
      4. max_per_hour_kes        · sum the hour window
      5. max_per_day_kes         · sum the day window
    """
    limit = get_limit()
    amount = Decimal(str(amount_kes))

    if limit.hard_pause:
        raise PlatformLimitExceeded(
            "hard_pause", attempted_kes=amount,
        )

    if limit.max_per_tx_kes and amount > Decimal(limit.max_per_tx_kes):
        raise PlatformLimitExceeded(
            "max_per_tx",
            attempted_kes=amount,
            cap_kes=Decimal(limit.max_per_tx_kes),
        )

    if limit.max_tx_per_hour_count:
        _, count_hour = _read_window(_HOUR)
        if count_hour + 1 > limit.max_tx_per_hour_count:
            raise PlatformLimitExceeded(
                "max_count_per_hour",
                attempted_kes=amount,
                cap_count=limit.max_tx_per_hour_count,
                current=Decimal(count_hour),
            )

    if limit.max_per_hour_kes:
        sum_hour, _ = _read_window(_HOUR)
        if sum_hour + amount > Decimal(limit.max_per_hour_kes):
            raise PlatformLimitExceeded(
                "max_per_hour",
                attempted_kes=amount,
                cap_kes=Decimal(limit.max_per_hour_kes),
                current=sum_hour,
            )

    if limit.max_per_day_kes:
        sum_day, _ = _read_window(_DAY)
        if sum_day + amount > Decimal(limit.max_per_day_kes):
            raise PlatformLimitExceeded(
                "max_per_day",
                attempted_kes=amount,
                cap_kes=Decimal(limit.max_per_day_kes),
                current=sum_day,
            )


def record_outgoing(amount_kes: Decimal, transaction_id: str) -> None:
    """Post-completion recorder · adds this tx to the sliding windows.

    Call from the saga `complete()` path AFTER the M-Pesa side has
    confirmed success. Calling on initiation would over-count failed
    txs. Idempotent on transaction_id · the same tx contributes once
    per window even if `record_outgoing` is invoked more than once
    (sorted-set members are unique).
    """
    try:
        _record_window(Decimal(str(amount_kes)), transaction_id)
    except Exception:
        logger.exception(
            "platform_limits.record_outgoing_failed",
            extra={"transaction_id": transaction_id, "amount": str(amount_kes)},
        )


def get_status() -> dict:
    """Admin-dashboard payload · caps + current usage + headroom.

    Shape:
      {
        "limits": {max_per_tx_kes, max_per_hour_kes, ...},
        "usage": {
            "last_hour": {"sum_kes", "count"},
            "last_day":  {"sum_kes", "count"},
        },
        "remaining": {
            "hour_kes":  cap - sum_hour     (None if cap == 0),
            "day_kes":   cap - sum_day      (None if cap == 0),
            "count_hour": cap - count_hour  (None if cap == 0),
        },
        "hard_pause":         bool,
        "hard_pause_reason":  str,
        "as_of":              isoformat,
      }
    """
    limit = get_limit()
    sum_hour, count_hour = _read_window(_HOUR)
    sum_day, count_day = _read_window(_DAY)

    def remaining(cap: Decimal, used: Decimal):
        if not cap:
            return None
        return max(Decimal("0"), Decimal(cap) - used)

    return {
        "limits": {
            "max_per_tx_kes": str(limit.max_per_tx_kes),
            "max_per_hour_kes": str(limit.max_per_hour_kes),
            "max_per_day_kes": str(limit.max_per_day_kes),
            "max_tx_per_hour_count": limit.max_tx_per_hour_count,
        },
        "usage": {
            "last_hour": {
                "sum_kes": str(sum_hour),
                "count": count_hour,
            },
            "last_day": {
                "sum_kes": str(sum_day),
                "count": count_day,
            },
        },
        "remaining": {
            "hour_kes": str(remaining(limit.max_per_hour_kes, sum_hour))
                       if limit.max_per_hour_kes else None,
            "day_kes": str(remaining(limit.max_per_day_kes, sum_day))
                      if limit.max_per_day_kes else None,
            "count_hour": (limit.max_tx_per_hour_count - count_hour)
                          if limit.max_tx_per_hour_count else None,
        },
        "hard_pause": limit.hard_pause,
        "hard_pause_reason": limit.hard_pause_reason,
        "updated_at": limit.updated_at.isoformat() if limit.updated_at else None,
        "as_of": timezone.now().isoformat(),
    }


def update_limits(actor, **fields) -> PlatformLimit:
    """Update one or more fields on the singleton · invalidates cache.

    Only updates fields that are explicitly provided (None means
    "leave as-is"). All updates are logged via Django's AuditLog so
    post-incident review can reconstruct who flipped what.
    """
    from apps.accounts.models import AuditLog

    limit = PlatformLimit.current()
    before = {
        "max_per_tx_kes": str(limit.max_per_tx_kes),
        "max_per_hour_kes": str(limit.max_per_hour_kes),
        "max_per_day_kes": str(limit.max_per_day_kes),
        "max_tx_per_hour_count": limit.max_tx_per_hour_count,
        "hard_pause": limit.hard_pause,
        "hard_pause_reason": limit.hard_pause_reason,
    }

    update_fields = []
    # Quantize all KES amounts to 2 decimal places so the stored value
    # matches the field's decimal_places=2 spec exactly. Without this,
    # `Decimal('100000')` stays as `100000` (no trailing zeros) while
    # the field round-trips through Postgres as `100000.00`. The audit
    # log diff would then show inconsistent shapes for the same value.
    _money_q = Decimal("0.01")
    for k, v in fields.items():
        if v is None:
            continue
        if k in ("max_per_tx_kes", "max_per_hour_kes", "max_per_day_kes"):
            setattr(limit, k, Decimal(str(v)).quantize(_money_q))
            update_fields.append(k)
        elif k in ("max_tx_per_hour_count",):
            setattr(limit, k, int(v))
            update_fields.append(k)
        elif k == "hard_pause":
            setattr(limit, k, bool(v))
            update_fields.append(k)
        elif k == "hard_pause_reason":
            setattr(limit, k, str(v)[:255])
            update_fields.append(k)

    if not update_fields:
        return limit

    if actor and getattr(actor, "id", None):
        limit.last_updated_by = actor
        update_fields.append("last_updated_by")
    update_fields.append("updated_at")

    limit.save(update_fields=update_fields)
    _invalidate_limit_cache()

    after = {
        k: str(getattr(limit, k)) for k in (
            "max_per_tx_kes", "max_per_hour_kes", "max_per_day_kes",
            "max_tx_per_hour_count", "hard_pause", "hard_pause_reason",
        )
    }

    try:
        AuditLog.objects.create(
            user=actor if actor and getattr(actor, "id", None) else None,
            action="PLATFORM_LIMITS_UPDATED",
            entity_type="system",
            entity_id="payment_platform_limits",
            details={"before": before, "after": after, "changed": update_fields},
        )
    except Exception:
        logger.exception("platform_limits.audit_log_failed")

    return limit
