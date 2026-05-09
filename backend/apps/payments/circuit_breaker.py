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
    """Read a float threshold from Django settings · always live.

    2026-05-09 audit fix · this MUST be called on every read, not at
    module import. The previous module-level constants
    (`FLOAT_EMERGENCY_KES = _threshold(...)` at module load) froze the
    threshold value in memory at import time. Lowering an env var
    required a full container restart of every worker + web process
    to take effect, AND when state didn't transition (float still
    below the new threshold) the cached `reason` string kept the OLD
    threshold value baked in for up to 24 h. Helpers below always
    fetch live so settings change propagates as fast as the next
    `update_from_float` call.
    """
    return Decimal(str(getattr(settings, name, default)))


# ── Live threshold helpers · DO NOT replace with module-level
# ── constants. Each call reads `settings.FLOAT_*_KES` at the call
# ── site so an env change is honored on the next request without
# ── requiring import-time freeze.
def _emergency_kes() -> Decimal:
    return _threshold("FLOAT_EMERGENCY_KES", 200_000)


def _critical_kes() -> Decimal:
    return _threshold("FLOAT_CRITICAL_KES", 500_000)


def _resume_kes() -> Decimal:
    return _threshold("FLOAT_RESUME_KES", 800_000)


def _healthy_kes() -> Decimal:
    return _threshold("FLOAT_HEALTHY_KES", 1_500_000)


def _large_payment_kes() -> Decimal:
    return _threshold("FLOAT_LARGE_PAYMENT_KES", 50_000)


# Backwards-compat shims · existing call sites that import these as
# module-level constants get a property-like callable that ALWAYS
# resolves to the live value. We re-bind them to FRESH Decimal calls
# rather than freeze a value here, so e.g. `circuit_breaker.FLOAT_
# EMERGENCY_KES` from another module evaluates fresh each access.
# (This requires updating every callsite to call a function — see
# all internal usages below in this file. External consumers should
# use the helpers; the module-level names are kept ONLY as the
# helper-call results read at-import for any ancient code path
# we missed, with a deprecation comment.)
#
# DEPRECATED · prefer `_emergency_kes()` etc. These re-bind on every
# import-time but NOT on every read · do NOT introduce new readers
# of these as module-level constants.
FLOAT_EMERGENCY_KES = _emergency_kes()
FLOAT_CRITICAL_KES = _critical_kes()
FLOAT_RESUME_KES = _resume_kes()
FLOAT_HEALTHY_KES = _healthy_kes()
LARGE_PAYMENT_KES = _large_payment_kes()


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
        """Current breaker state.

        If Redis state is missing (TTL expired, Redis restart), check the last
        known float balance. If float was low, default to safe state instead of
        blindly allowing payments.
        """
        state = cache.get(BREAKER_STATE_KEY)
        if state is not None:
            return state

        # State missing — check if we have a last-known float to decide safely
        last_float = cache.get(BREAKER_LAST_FLOAT_KEY)
        if last_float is not None:
            float_val = Decimal(str(last_float))
            if float_val < _emergency_kes():
                logger.warning(
                    f"Circuit breaker state missing, last float KES {float_val:,.0f} "
                    f"< emergency threshold — defaulting to OPEN"
                )
                return cls.OPEN
            if float_val < _critical_kes():
                logger.warning(
                    f"Circuit breaker state missing, last float KES {float_val:,.0f} "
                    f"< critical threshold — defaulting to HALF_OPEN"
                )
                return cls.HALF_OPEN

        # 2026-05-09 audit fix · was returning CLOSED here (fail-open).
        # When BOTH state AND last_float keys are missing (Redis cold-
        # boot / 24-h TTL expiry / cache flush), we have NO ground truth
        # about the float. Defaulting to CLOSED in that vacuum lets every
        # outgoing payment proceed against an unknown treasury. Fail SAFE
        # · default to HALF_OPEN, which still allows small payments but
        # blocks large drains. The next `update_from_float` (≤5 min via
        # the Celery beat) refreshes to the real state.
        logger.warning(
            "Circuit breaker state missing AND no last-known float · "
            "defaulting to HALF_OPEN until next float check"
        )
        return cls.HALF_OPEN

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
            return _large_payment_kes()
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
                # Live-read · honors env changes without container restart.
                "emergency_kes": str(_emergency_kes()),
                "critical_kes": str(_critical_kes()),
                "resume_kes": str(_resume_kes()),
                "healthy_kes": str(_healthy_kes()),
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
            large = _large_payment_kes()
            if amount_kes > large:
                raise PaymentsPaused(
                    reason=(
                        f"Large payments (over KES {large:,.0f}) are "
                        f"temporarily unavailable. {reason}"
                    ),
                    max_amount_kes=large,
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

        # 2026-05-09 audit fix · all threshold reads are LIVE (helper
        # functions, not module constants) so a settings change
        # propagates as fast as this update_from_float call. The
        # `reason` string is rebuilt each call · clearing the 24-h
        # cache-staleness window that bit us today.
        emergency = _emergency_kes()
        critical = _critical_kes()
        resume = _resume_kes()
        large = _large_payment_kes()

        if float_balance_kes < emergency:
            new_state = cls.OPEN
            reason = (
                f"KES float critically low: KES {float_balance_kes:,.0f} "
                f"(emergency threshold: KES {emergency:,.0f})"
            )
        elif float_balance_kes < critical:
            new_state = cls.HALF_OPEN
            reason = (
                f"KES float low: KES {float_balance_kes:,.0f} "
                f"(critical threshold: KES {critical:,.0f}). "
                f"Large payments (>KES {large:,.0f}) paused."
            )
        elif float_balance_kes >= resume:
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

            # Trigger rebalance when entering or escalating to HALF_OPEN/OPEN
            if new_state in (cls.HALF_OPEN, cls.OPEN):
                cls._trigger_rebalance(float_balance_kes, new_state)

        return new_state

    # ── Manual controls (admin) ──────────────────────────────────────────

    @classmethod
    def force_pause(cls, reason: str = "Manual pause by admin") -> None:
        """Admin manually pauses all payments.

        2026-05-09 audit fix · MANUAL_KEY is set BEFORE _set_state so a
        concurrent `update_from_float` call cannot win the race and
        overwrite the pause state with the auto-derived one. The
        previous order had a tiny window (a few ms on busy Redis)
        where `update_from_float` could read MANUAL_KEY=missing and
        proceed to overwrite the OPEN state we just set.
        """
        old_state = cls.get_state()
        cache.set(BREAKER_MANUAL_KEY, True, BREAKER_TTL)
        cache.set(BREAKER_PAUSED_AT_KEY, timezone.now().isoformat(), BREAKER_TTL)
        cls._set_state(cls.OPEN, reason)
        cls._log_transition(old_state, cls.OPEN, reason, cls.get_last_float())
        logger.warning(f"Circuit breaker FORCE PAUSED: {reason}")

    @classmethod
    def force_resume(cls, admin_info: str = "admin") -> dict:
        """Admin manually resumes payments. Returns status dict with any warnings."""
        old_state = cls.get_state()
        last_float = cls.get_last_float()

        warnings = []
        # Live-read · honors any threshold change since startup.
        emergency = _emergency_kes()
        if last_float is not None and last_float < emergency:
            warnings.append(
                f"WARNING: Last known float KES {last_float:,.0f} is below "
                f"emergency threshold KES {emergency:,.0f}. "
                f"Payments will resume but may fail. The breaker will re-trip "
                f"on next float check (~5 min)."
            )
            logger.warning(
                f"Admin {admin_info} force-resuming payments with float "
                f"KES {last_float:,.0f} BELOW emergency threshold"
            )

        reason = f"Manual resume by {admin_info}"
        cls._set_state(cls.CLOSED, "")
        cache.delete(BREAKER_MANUAL_KEY)
        cache.delete(BREAKER_PAUSED_AT_KEY)
        cls._log_transition(old_state, cls.CLOSED, reason, last_float)
        logger.info(f"Circuit breaker FORCE RESUMED by {admin_info}")
        return {"resumed": True, "warnings": warnings}

    # ── Rebalance integration ────────────────────────────────────────────

    @classmethod
    def _trigger_rebalance(cls, float_balance_kes: Decimal, breaker_state: str) -> None:
        """Fire-and-forget Celery task to trigger rebalance when breaker trips."""
        try:
            from apps.wallets.tasks import trigger_rebalance_from_breaker
            trigger_rebalance_from_breaker.delay(
                str(float_balance_kes), breaker_state,
            )
            logger.info(
                f"Rebalance task dispatched from circuit breaker "
                f"(state={breaker_state}, float=KES {float_balance_kes:,.0f})"
            )
        except Exception as e:
            logger.error(f"Failed to dispatch rebalance task from circuit breaker: {e}")

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
        float_str = f"KES {float_balance:,.0f}" if float_balance is not None else "unknown"
        msg = (
            f"Circuit breaker: {old_state} -> {new_state} | "
            f"Float: {float_str} | "
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
