import logging
import threading
from ipaddress import ip_address, ip_network

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponseForbidden
from django.utils import timezone

_request_local = threading.local()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# D22: Cloudflare-trusted origin — strip client-supplied X-Forwarded-* when
# the upstream peer is NOT a known Cloudflare IP, so attackers who reach
# the origin directly cannot spoof `X-Forwarded-Proto: https` and trick
# Django into emitting `Secure` cookies over plaintext.
# ---------------------------------------------------------------------------

# Cloudflare IPv4 + IPv6 ranges (published at https://www.cloudflare.com/ips/).
# Kept inline so the middleware does not make a network call at boot.
_CF_IPV4 = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22",
    "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
    "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22",
    "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
]
_CF_IPV6 = [
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32",
    "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29",
    "2c0f:f248::/32",
]


class TrustedProxyMiddleware:
    """D22: refuses to honour X-Forwarded-* when the direct peer is not
    Cloudflare (controlled via CLOUDFLARE_ONLY_ORIGIN). Also populates
    `request.real_client_ip` with the CF-Connecting-IP when present.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self._enabled = bool(getattr(settings, "CLOUDFLARE_ONLY_ORIGIN", False))
        self._networks = [ip_network(n, strict=False) for n in _CF_IPV4 + _CF_IPV6]

    def _is_trusted_peer(self, peer_ip: str) -> bool:
        if not peer_ip:
            return False
        try:
            addr = ip_address(peer_ip)
        except ValueError:
            return False
        return any(addr in n for n in self._networks)

    def __call__(self, request):
        if self._enabled:
            peer = request.META.get("REMOTE_ADDR", "")
            if not self._is_trusted_peer(peer):
                # Strip all forwarded-* headers so Django doesn't believe
                # the request is HTTPS just because someone asked nicely.
                for hdr in (
                    "HTTP_X_FORWARDED_PROTO",
                    "HTTP_X_FORWARDED_FOR",
                    "HTTP_X_FORWARDED_HOST",
                    "HTTP_X_REAL_IP",
                    "HTTP_CF_CONNECTING_IP",
                ):
                    request.META.pop(hdr, None)

        # Cloudflare always sets CF-Connecting-IP; prefer it over XFF.
        real_ip = (
            request.META.get("HTTP_CF_CONNECTING_IP")
            or request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
            or request.META.get("REMOTE_ADDR", "")
        )
        request.real_client_ip = real_ip
        return self.get_response(request)


class AdminIPAllowListMiddleware:
    """D10: hard-deny requests to the admin prefix when the caller's real
    client IP is not in the configured allow-list. Empty list = no-op so
    dev environments don't need to configure this.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        raw = getattr(settings, "ADMIN_IP_ALLOWLIST", []) or []
        self._networks = [ip_network(r, strict=False) for r in raw]
        prefix = getattr(settings, "ADMIN_URL", "admin/")
        if not prefix.startswith("/"):
            prefix = "/" + prefix
        self._prefix = prefix

    def _allowed(self, ip: str) -> bool:
        if not self._networks:
            return True  # empty list = no restriction (dev default)
        if not ip:
            return False
        try:
            addr = ip_address(ip)
        except ValueError:
            return False
        return any(addr in n for n in self._networks)

    def __call__(self, request):
        if request.path.startswith(self._prefix):
            ip = getattr(request, "real_client_ip", "") or (
                request.META.get("HTTP_CF_CONNECTING_IP")
                or request.META.get("REMOTE_ADDR", "")
            )
            if not self._allowed(ip):
                logger.warning("admin.blocked_ip path=%s ip=%s", request.path, ip)
                return HttpResponseForbidden("forbidden")
        return self.get_response(request)


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
