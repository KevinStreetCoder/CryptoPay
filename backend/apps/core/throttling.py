"""
Custom DRF throttle classes for CryptoPay.

These enforce per-action rate limits beyond the global defaults,
covering PIN attempts, transactions, OTP, and sensitive profile changes.
"""

from django.conf import settings
from django.core.cache import cache
from rest_framework.throttling import SimpleRateThrottle


class PINAttemptThrottle(SimpleRateThrottle):
    """
    5 PIN verification attempts per 10 minutes per user.
    Applied to payment endpoints that require PIN confirmation.
    """

    scope = "pin_attempt"
    rate = "5/600s"
    THROTTLE_RATES = {"pin_attempt": "5/600s"}

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {
                "scope": self.scope,
                "ident": str(request.user.id),
            }
        return self.get_ident(request)

    def parse_rate(self, rate):
        if rate is None:
            return (None, None)
        # Support "5/600s" format
        num, period = rate.split("/")
        num_requests = int(num)
        if period.endswith("s"):
            duration = int(period[:-1])
        else:
            duration = {"s": 1, "m": 60, "h": 3600, "d": 86400}.get(period[-1], 1)
            duration = int(period[:-1]) * duration if len(period) > 1 else duration
        return (num_requests, duration)


class TransactionThrottle(SimpleRateThrottle):
    """
    Transaction rate limit based on KYC tier.
    Higher tiers get more transactions per hour.

    Tier 0: 5/hour
    Tier 1: 20/hour
    Tier 2: 50/hour
    Tier 3: 100/hour
    """

    scope = "transaction"

    TIER_RATES = {
        0: (5, 3600),
        1: (20, 3600),
        2: (50, 3600),
        3: (100, 3600),
    }

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {
            "scope": self.scope,
            "ident": str(request.user.id),
        }

    def get_rate(self):
        return None  # We handle this manually

    def allow_request(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return True

        key = self.get_cache_key(request, view)
        if key is None:
            return True

        tier = getattr(request.user, "kyc_tier", 0)
        num_requests, duration = self.TIER_RATES.get(tier, (5, 3600))

        self.history = cache.get(key, [])
        self.now = self.timer()

        # Drop old entries
        while self.history and self.history[-1] <= self.now - duration:
            self.history.pop()

        if len(self.history) >= num_requests:
            self.wait_time = duration - (self.now - self.history[-1])
            return False

        self.history.insert(0, self.now)
        cache.set(key, self.history, duration)
        return True

    def wait(self):
        return getattr(self, "wait_time", None)


class OTPThrottle(SimpleRateThrottle):
    """
    3 OTP requests per 10 minutes per phone/IP.
    Mirrors the inline logic in RequestOTPView but as a reusable throttle class.
    """

    scope = "otp"
    rate = "3/600s"
    THROTTLE_RATES = {"otp": "3/600s"}

    def get_cache_key(self, request, view):
        # Use phone from request body if available, fall back to IP
        phone = None
        if hasattr(request, "data") and isinstance(request.data, dict):
            phone = request.data.get("phone")
        if phone:
            return self.cache_format % {"scope": self.scope, "ident": phone}
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}

    def parse_rate(self, rate):
        if rate is None:
            return (None, None)
        num, period = rate.split("/")
        num_requests = int(num)
        if period.endswith("s"):
            duration = int(period[:-1])
        else:
            duration = {"s": 1, "m": 60, "h": 3600, "d": 86400}.get(period[-1], 1)
        return (num_requests, duration)


class SensitiveActionThrottle(SimpleRateThrottle):
    """
    10 sensitive actions per hour per user.
    Applied to profile changes, PIN changes, device management, etc.
    """

    scope = "sensitive_action"
    rate = "10/h"
    THROTTLE_RATES = {"sensitive_action": "10/h"}

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {
                "scope": self.scope,
                "ident": str(request.user.id),
            }
        return None


class GlobalOTPThrottle(SimpleRateThrottle):
    """A4 · global circuit breaker on OTP issuance + verification.

    Per-phone and per-IP throttles (existing) catch a single attacker
    hammering a single account or hitting from a single IP. They do
    NOT catch a distributed SMS-bomb · 10k OTP requests across 10k
    phones from 10k IPs would slip through every per-key throttle.
    SMS providers (Africa's Talking, Twilio) charge per send, so an
    attacker can bleed Cpay's SMS budget without ever locking a single
    user out.

    This throttle keys on the literal string `"global"` so every
    request worldwide hits the same counter. When the cap fires we
    log to Sentry / on-call so a human looks immediately.

    Configurable via `GLOBAL_OTP_RATE_PER_HOUR` env (default 1000/h).
    """

    scope = "global_otp"
    cache_format = "throttle_%(scope)s_%(ident)s"

    def __init__(self):
        # Read rate at construction · settings can be patched in tests
        # via @override_settings(GLOBAL_OTP_RATE_PER_HOUR=...).
        rate_per_hour = getattr(settings, "GLOBAL_OTP_RATE_PER_HOUR", 1000)
        self.rate = f"{rate_per_hour}/h"
        # SimpleRateThrottle parses this in __init__, so we have to set
        # `self.rate` BEFORE super().__init__.
        super().__init__()

    def get_cache_key(self, request, view):
        # Single global counter · same key for every request.
        return self.cache_format % {"scope": self.scope, "ident": "global"}

    def throttle_failure(self):
        """Log to Sentry / structured-log channel when the global cap
        fires · this is "something is wrong, page someone" territory."""
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(
            "global_otp_cap_breached",
            extra={
                "scope": self.scope,
                "rate": self.rate,
                "wait_seconds": int(self.wait() or 0),
            },
        )
        return False  # signature contract · returns the throttled bool
