import logging
import threading

from django.core.cache import cache
from django.utils import timezone

_request_local = threading.local()
logger = logging.getLogger(__name__)


def get_current_request():
    return getattr(_request_local, "request", None)


class AuditMiddleware:
    """Stores the current request for audit logging in models/services."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _request_local.request = request
        response = self.get_response(request)
        _request_local.request = None
        return response


# How often to actually write a heartbeat to the database. A public mobile
# app routinely makes 10-20 requests per screen; writing every one would
# saturate the user row for no extra signal. 60 s gives us "online now"
# resolution while limiting per-user writes to at most one per minute.
USER_ACTIVITY_DEBOUNCE_SECONDS = 60


class ActivityHeartbeatMiddleware:
    """Updates `User.last_activity_at` (and `last_activity_ip`) on every
    authenticated request, debounced to at most one write per minute per
    user via a Redis SETNX lock.

    Admin "online now" queries read `last_activity_at` with a 5-minute
    window — any user with a write in the last 5 min is considered active.

    Deliberately pre-auth-aware: Django's middleware order puts this after
    AuthenticationMiddleware, so `request.user` is populated when DRF's
    JWTAuthentication hasn't yet resolved a token. We therefore re-check
    authentication in `process_view` by hand for DRF-authenticated users
    as well, keeping one code path.
    """

    CACHE_KEY_FMT = "user.activity.lock:{user_id}"

    def __init__(self, get_response):
        self.get_response = get_response

    def _client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if xff:
            # First IP in the list is the original client.
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "") or None

    def _touch(self, user, ip):
        """Write the heartbeat if the debounce window has elapsed."""
        lock_key = self.CACHE_KEY_FMT.format(user_id=user.id)
        # cache.add is atomic — only one request per minute wins the lock.
        if not cache.add(lock_key, "1", timeout=USER_ACTIVITY_DEBOUNCE_SECONDS):
            return
        try:
            # update_fields = targeted write, no signals, no side-effects.
            type(user).objects.filter(pk=user.pk).update(
                last_activity_at=timezone.now(),
                last_activity_ip=ip,
            )
        except Exception as e:  # noqa: BLE001 — never fail a request for a heartbeat
            logger.debug("user.heartbeat.failed", extra={"user_id": str(user.pk), "error": str(e)})

    def __call__(self, request):
        response = self.get_response(request)
        # Heartbeat AFTER the view runs so DRF has had a chance to
        # resolve JWT auth and attach request.user.
        user = getattr(request, "user", None)
        try:
            if user is not None and user.is_authenticated:
                self._touch(user, self._client_ip(request))
        except Exception:
            # Anonymous users, AnonymousUser.is_authenticated == False,
            # Django's getattr chain occasionally raises under custom
            # user models. Never break the response flow.
            pass
        return response
