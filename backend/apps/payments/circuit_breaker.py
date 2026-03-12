"""
Payment Circuit Breaker — Emergency payment pause system.

Uses Redis for real-time state (fast reads on every payment) and Django ORM
for audit trail. When the M-Pesa KES float drops below the emergency
threshold, all outgoing payments are automatically paused until the float
is replenished above the resume threshold.

Thresholds (configurable via Django settings):
  FLOAT_EMERGENCY_KES    — pause ALL outgoing payments (default 200,000)
  FLOAT_CRITICAL_KES     — pause large payments >50K KES (default 500,000)
  FLOAT_RESUME_KES       — auto-resume when float recovers (default 800,000)
  FLOAT_HEALTHY_KES      — normal operations (default 1,500,000)

Manual override:
  PaymentCircuitBreaker.force_pause(reason)
  PaymentCircuitBreaker.force_resume(admin_user)
"""

import logging
from datetime import timedelta
from decimal import Decimal
from typing import Optional

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

# Redis keys
BREAKER_STATE_KEY = "circuit_breaker:payments:state"  # "open" | "half_open" | "closed"
BREAKER_REASON_KEY = "circuit_breaker:payments:reason"
BREAKER_PAUSED_AT_KEY = "circuit_breaker:payments:paused_at"
BREAKER_LAST_FLOAT_KEY = "circuit_breaker:payments:last_float_kes"
BREAKER_MAX_AMOUNT_KEY = "circuit_breaker:payments:max_amount_kes"  # 0 = all paused
BREAKER_MANUAL_KEY = "circuit_breaker:payments:manual_override"

# TTL for circuit breaker state — auto-expire after 24h as safety valve.
# The check_float_balance task refreshes this every 5 minutes.
BREAKER_TTL = 86400  # 24 hours


def _threshold(name: str, default: int) -> Decimal:
    """Read a float threshold from Django settings with a sensible default."""
    return Decimal(str(getattr(settings, name, default)))


# Thresholds
FLOAT_EMERGENCY_KES = _threshold("FLOAT_EMERGENCY_KES", 200_000)
FLOAT_CRITICAL_KES = _threshold("FLOAT_CRITICAL_KES", 500_000)
FLOAT_RESUME_KES = _threshold("FLOAT_RESUME_KES", 800_000)
FLOAT_HEALTHY_KES = _threshold("FLOAT_HEALTHY_KES", 1_500_000)

# Large payment threshold (blocked when in HALF_OPEN / critical state)
LARGE_PAYMENT_KES = _threshold("FLOAT_LARGE_PAYMENT_KES", 50_000)


class PaymentsPaused(Exception):
    """Raised when the circuit breaker has paused payments."""

    def __init__(self, reason: str, max_amount_kes: Optional[Decimal] = None):
        self.reason = reason
        self.max_amount_kes = max_amount_kes
        super().__init__(reason)


class PaymentCircuitBreaker:
    """
    Three-state circuit breaker for outgoing M-Pesa payments.

    States:
      CLOSED     — Normal. All payments allowed.
      HALF_OPEN  — Critical float. Only payments <= LARGE_PAYMENT_KES allowed.
      OPEN       — Emergency. ALL outgoing payments blocked.
    """

    # State constants
    CLOSED = "closed"
    HALF_OPEN = "half_open"
    OPEN = "open"

    # ── Read state ───────────────────────────────────────────────────────

    @classmethod
    def get_state(cls) -> str:
        """Current breaker state. Defaults to CLOSED if no state in Redis."""
        return cache.get(BREAKER_STATE_KEY, cls.CLOSED)

    @classmethod
    def get_reason(cls) -> str:
        return cache.get(BREAKER_REASON_KEY, "")

    @classmethod
    def get_last_float(cls) -> Optional[Decimal]:
        val = cache.get(BREAKER_LAST_FLOAT_KEY)
        return Decimal(str(val)) if val is not None else None

    @classmethod
    def get_max_allowed_amount(cls) -> Optional[Decimal]:
        """Max KES amount allowed. None means no limit (CLOSED). 0 means all paused (OPEN)."""
        state = cls.get_state()
        if state == cls.CLOSED:
            return None  # No limit
        if state == cls.HALF_OPEN:
            return LARGE_PAYMENT_KES
        return Decimal("0")  # OPEN — nothing allowed

    @classmethod
    def get_status_dict(cls) -> dict:
        """Full status for admin dashboard / API."""
        state = cls.get_state()
        return {
            "state": state,
            "is_paused": state != cls.CLOSED,
            "reason": cls.get_reason(),
            "last_float_kes": str(cls.get_last_float() or "unknown"),
            "max_allowed_amount_kes": str(cls.get_max_allowed_amount() or "unlimited"),
            "paused_at": cache.get(BREAKER_PAUSED_AT_KEY),
            "manual_override": cache.get(BREAKER_MANUAL_KEY, False),
            "thresholds": {
                "emergency_kes": str(FLOAT_EMERGENCY_KES),
                "critical_kes": str(FLOAT_CRITICAL_KES),
                "resume_kes": str(FLOAT_RESUME_KES),
                "healthy_kes": str(FLOAT_HEALTHY_KES),
            },
        }

    # ── Check before payment ─────────────────────────────────────────────

    @classmethod
    def check_payment_allowed(cls, amount_kes: Decimal) -> None:
        """
        Call before initiating any outgoing payment.
        Raises PaymentsPaused if the payment should be blocked.

        Args:
            amount_kes: The KES amount of the outgoing payment.

        Raises:
            PaymentsPaused: If the circuit breaker is tripped.
        """
        state = cls.get_state()

        if state == cls.CLOSED:
            return  # All good

        reason = cls.get_reason()

        if state == cls.OPEN:
            raise PaymentsPaused(
                reason=f"Payments temporarily unavailable. {reason}",
                max_amount_kes=Decimal("0"),
            )

        if state == cls.HALF_OPEN:
            if amount_kes > LARGE_PAYMENT_KES:
                raise PaymentsPaused(
                    reason=(
                        f"Large payments (over KES {LARGE_PAYMENT_KES:,.0f}) are "
                        f"temporarily unavailable. {reason}"
                    ),
                    max_amount_kes=LARGE_PAYMENT_KES,
                )
            # Small payments still allowed in HALF_OPEN
            return

    # ── Update state from float balance ──────────────────────────────────

    @classmethod
    def update_from_float(cls, float_balance_kes: Decimal) -> str:
        """
        Called by the float balance callback or check task.
        Updates the circuit breaker state based on current float.

        Returns the new state.
        """
        cache.set(BREAKER_LAST_FLOAT_KEY, str(float_balance_kes), BREAKER_TTL)

        # Don't override manual overrides
        if cache.get(BREAKER_MANUAL_KEY):
            logger.info(
                f"Float balance: KES {float_balance_kes:,.0f} — "
                f"manual override active, skipping auto-update"
            )
            return cls.get_state()

        old_state = cls.get_state()

        if float_balance_kes < FLOAT_EMERGENCY_KES:
            new_state = cls.OPEN
            reason = (
                f"KES float critically low: KES {float_balance_kes:,.0f} "
                f"(emergency threshold: KES {FLOAT_EMERGENCY_KES:,.0f})"
            )
        elif float_balance_kes < FLOAT_CRITICAL_KES:
            new_state = cls.HALF_OPEN
            reason = (
                f"KES float low: KES {float_balance_kes:,.0f} "
                f"(critical threshold: KES {FLOAT_CRITICAL_KES:,.0f}). "
                f"Large payments (>KES {LARGE_PAYMENT_KES:,.0f}) paused."
            )
        elif float_balance_kes >= FLOAT_RESUME_KES:
            new_state = cls.CLOSED
            reason = ""
        else:
            # Between CRITICAL and RESUME — hold current state (hysteresis)
            # This prevents flapping between HALF_OPEN and CLOSED
            new_state = old_state
            reason = cls.get_reason()

        cls._set_state(new_state, reason)

        if old_state != new_state:
            cls._log_transition(old_state, new_state, reason, float_balance_kes)

        return new_state

    # ── Manual controls (admin) ──────────────────────────────────────────

    @classmethod
    def force_pause(cls, reason: str = "Manual pause by admin") -> None:
        """Admin manually pauses all payments."""
        old_state = cls.get_state()
        cls._set_state(cls.OPEN, reason)
        cache.set(BREAKER_MANUAL_KEY, True, BREAKER_TTL)
        cache.set(BREAKER_PAUSED_AT_KEY, timezone.now().isoformat(), BREAKER_TTL)
        cls._log_transition(old_state, cls.OPEN, reason, cls.get_last_float())
        logger.warning(f"Circuit breaker FORCE PAUSED: {reason}")

    @classmethod
    def force_resume(cls, admin_info: str = "admin") -> None:
        """Admin manually resumes payments."""
        old_state = cls.get_state()
        reason = f"Manual resume by {admin_info}"
        cls._set_state(cls.CLOSED, "")
        cache.delete(BREAKER_MANUAL_KEY)
        cache.delete(BREAKER_PAUSED_AT_KEY)
        cls._log_transition(old_state, cls.CLOSED, reason, cls.get_last_float())
        logger.info(f"Circuit breaker FORCE RESUMED by {admin_info}")

    # ── Internal helpers ─────────────────────────────────────────────────

    @classmethod
    def _set_state(cls, state: str, reason: str) -> None:
        cache.set(BREAKER_STATE_KEY, state, BREAKER_TTL)
        cache.set(BREAKER_REASON_KEY, reason, BREAKER_TTL)
        if state != cls.CLOSED:
            # Only set paused_at on transition to non-closed
            if not cache.get(BREAKER_PAUSED_AT_KEY):
                cache.set(BREAKER_PAUSED_AT_KEY, timezone.now().isoformat(), BREAKER_TTL)
        else:
            cache.delete(BREAKER_PAUSED_AT_KEY)

    @classmethod
    def _log_transition(
        cls,
        old_state: str,
        new_state: str,
        reason: str,
        float_balance: Optional[Decimal],
    ) -> None:
        """Log state transitions to both Python logger and Django audit log."""
        msg = (
            f"Circuit breaker: {old_state} -> {new_state} | "
            f"Float: KES {float_balance:,.0f if float_balance else 'unknown'} | "
            f"Reason: {reason}"
        )

        if new_state == cls.OPEN:
            logger.critical(msg)
        elif new_state == cls.HALF_OPEN:
            logger.warning(msg)
        else:
            logger.info(msg)

        # Write to audit log for compliance trail
        try:
            from apps.accounts.models import AuditLog

            AuditLog.objects.create(
                action="CIRCUIT_BREAKER_TRANSITION",
                entity_type="system",
                entity_id="payment_circuit_breaker",
                details={
                    "old_state": old_state,
                    "new_state": new_state,
                    "reason": reason,
                    "float_balance_kes": str(float_balance) if float_balance else None,
                    "timestamp": timezone.now().isoformat(),
                },
            )
        except Exception as e:
            logger.error(f"Failed to create audit log for circuit breaker: {e}")
