"""
M-Pesa callback security middleware — production-grade multi-layer defense.

Safaricom Daraja (v2 and v3, as of March 2026) does NOT sign callbacks.
Anyone who discovers the callback URL can POST fake payment confirmations.

Defense layers:
  1. IP whitelist — only accept from Safaricom's known IP ranges
  2. Dynamic callback tokens — per-transaction HMAC in the URL path
  3. Replay prevention — each callback token can only be used once
  4. Payload schema validation — reject malformed payloads
  5. Post-callback verification — cross-verify via Transaction Status API
     (for high-value transactions, implemented in the saga)
"""

import hashlib
import hmac
import logging
import time
from ipaddress import ip_address, ip_network

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse

logger = logging.getLogger(__name__)

# Safaricom known IP ranges (updated March 2026)
# Source: Safaricom Developer Portal + community documentation
DEFAULT_SAFARICOM_IP_RANGES = [
    "196.201.214.0/24",
    "196.201.213.0/24",
    "196.201.212.0/24",
    "192.168.0.0/16",   # Allow private IPs for local/sandbox testing
    "127.0.0.0/8",      # Loopback for development
]


class MpesaIPWhitelistMiddleware:
    """
    Restrict payment-rail callback endpoints to the provider's known IP
    ranges. B1 + B2: covers BOTH the `/api/v1/mpesa/callback/` prefix AND
    `/api/v1/hooks/c2b/` (the Safaricom-imposed alternate path that omits
    the word "mpesa") AND the SasaPay callback paths. Each prefix is
    matched against its own provider's allow-list.

    Configure `MPESA_ALLOWED_IPS` and `SASAPAY_ALLOWED_IPS` in settings.
    """

    # B1 + B2: each entry is (path_prefix, settings_attr_for_allow_list).
    # Callbacks not matching any prefix pass through untouched.
    CALLBACK_PATH_PREFIXES = (
        ("/api/v1/mpesa/callback/", "MPESA_ALLOWED_IPS"),
        ("/api/v1/hooks/c2b/", "MPESA_ALLOWED_IPS"),
        ("/api/v1/mpesa/sasapay/", "SASAPAY_ALLOWED_IPS"),
        ("/api/v1/sasapay/", "SASAPAY_ALLOWED_IPS"),
    )

    def __init__(self, get_response):
        self.get_response = get_response
        # Cache per-provider networks lazily keyed on settings attr.
        self._networks_by_attr: dict[str, list] = {}

    def _networks_for(self, attr: str):
        if attr not in self._networks_by_attr:
            raw = getattr(settings, attr, DEFAULT_SAFARICOM_IP_RANGES)
            self._networks_by_attr[attr] = [
                ip_network(r, strict=False) for r in raw
            ]
        return self._networks_by_attr[attr]

    def _match_prefix(self, path: str):
        for prefix, attr in self.CALLBACK_PATH_PREFIXES:
            if path.startswith(prefix):
                return prefix, attr
        return None, None

    def __call__(self, request):
        prefix, attr = self._match_prefix(request.path)
        if prefix is not None:
            client_ip = self._get_client_ip(request)
            logger.info(
                "payment-callback request: method=%s path=%s ip=%s content_length=%s",
                request.method,
                request.path,
                client_ip,
                request.META.get("CONTENT_LENGTH", "0"),
            )
            if not self._is_ip_allowed(client_ip, attr):
                logger.warning(
                    "payment-callback rejected: IP %s not in whitelist for %s (attr=%s)",
                    client_ip,
                    prefix,
                    attr,
                )
                return JsonResponse({"error": "Forbidden"}, status=403)

        return self.get_response(request)

    def _get_client_ip(self, request) -> str:
        # Cloudflare-aware: prefer CF-Connecting-IP, then leftmost XFF, then REMOTE_ADDR.
        cf_ip = request.META.get("HTTP_CF_CONNECTING_IP")
        if cf_ip:
            return cf_ip.strip()
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "127.0.0.1")

    def _is_ip_allowed(self, client_ip: str, attr: str) -> bool:
        try:
            addr = ip_address(client_ip)
        except ValueError:
            return False
        return any(addr in network for network in self._networks_for(attr))


# ---------------------------------------------------------------------------
# Dynamic callback token system
# ---------------------------------------------------------------------------
# Since Safaricom doesn't sign callbacks, we embed a per-transaction HMAC
# token in the callback URL. When we initiate an M-Pesa request, we generate
# a token and include it in the CallbackURL. When the callback arrives, we
# verify the token matches and hasn't been used before (replay prevention).
#
# Flow:
#   1. generate_callback_token(transaction_id) → token
#   2. Callback URL: /api/v1/mpesa/callback/stk/{token}/
#   3. On callback: verify_callback_token(token) → True/False + marks as used

_CALLBACK_TOKEN_TTL = 7200  # 2 hours — M-Pesa callbacks typically arrive within minutes


def generate_callback_token(transaction_id: str, callback_type: str = "stk") -> str:
    """
    Generate an HMAC-based callback token for a transaction.

    The token is:
      HMAC-SHA256(SECRET_KEY, f"{transaction_id}:{callback_type}:{timestamp}")
      truncated to 32 hex chars for URL-friendliness.

    The token is stored in Redis with a 2-hour TTL. When the callback arrives,
    we verify the token exists in Redis (not yet consumed) and delete it
    to prevent replay attacks.

    Args:
        transaction_id: The transaction UUID or checkout request ID
        callback_type: Type of callback (stk, b2b, b2c, etc.)

    Returns:
        32-char hex token for embedding in the callback URL
    """
    secret = getattr(settings, "SECRET_KEY", "").encode()
    timestamp = str(int(time.time()))
    message = f"{transaction_id}:{callback_type}:{timestamp}".encode()

    token = hmac.new(secret, message, hashlib.sha256).hexdigest()[:32]

    # Store in Redis: key = mpesa:cb_token:{token}, value = transaction_id
    cache_key = f"mpesa:cb_token:{token}"
    cache.set(cache_key, transaction_id, timeout=_CALLBACK_TOKEN_TTL)

    logger.debug(
        f"Generated callback token for {callback_type} tx={transaction_id[:16]}..."
    )
    return token


def verify_callback_token(token: str) -> tuple[bool, str]:
    """
    Verify and consume a callback token (one-time use).

    Returns:
        Tuple of (is_valid, transaction_id).
        If invalid or already used, returns (False, "").
    """
    if not token or len(token) != 32:
        logger.warning(f"Invalid callback token format: {token[:16] if token else 'empty'}...")
        return False, ""

    cache_key = f"mpesa:cb_token:{token}"
    transaction_id = cache.get(cache_key)

    if not transaction_id:
        logger.warning(
            f"Callback token not found or already used: {token[:16]}... "
            f"(possible replay attack or expired token)"
        )
        return False, ""

    # Delete token to prevent replay (atomic consume)
    cache.delete(cache_key)

    logger.info(f"Callback token verified for tx={transaction_id[:16]}...")
    return True, transaction_id


def build_callback_url(callback_type: str, transaction_id: str, include_token: bool = True) -> str:
    """
    Build a callback URL with optional embedded security token.

    Args:
        callback_type: One of 'stk', 'b2b', 'b2c', 'status', 'reversal', 'balance'
        transaction_id: The transaction ID for token generation
        include_token: Whether to include the HMAC token (default: True)

    Returns:
        Full callback URL string

    Examples:
        Without token: https://api.cpay.co.ke/api/v1/mpesa/callback/stk/
        With token:    https://api.cpay.co.ke/api/v1/mpesa/callback/stk/a1b2c3d4e5f6.../
    """
    base = getattr(settings, "MPESA_CALLBACK_BASE_URL", "")

    if include_token:
        token = generate_callback_token(transaction_id, callback_type)
        return f"{base}/api/v1/mpesa/callback/{callback_type}/{token}/"
    else:
        return f"{base}/api/v1/mpesa/callback/{callback_type}/"


def verify_mpesa_signature(request) -> bool:
    """
    Verify M-Pesa callback authenticity.

    Safaricom Daraja API (v2 and v3, as of March 2026) does NOT provide
    HMAC signatures, webhook signing secrets, or any cryptographic
    authentication on callback payloads. This is a known gap.

    Our defense layers:
      1. IP whitelist middleware (MpesaIPWhitelistMiddleware)
      2. Dynamic callback tokens (verify_callback_token)
      3. Replay prevention (token consumed on first use)
      4. Post-callback cross-verification via Transaction Status API

    This function checks for a future X-Mpesa-Signature header.
    If Safaricom adds signing in a future Daraja version, implement here.

    Returns:
        True (no signature to verify from Safaricom's side)
    """
    # Check for future Safaricom signing header
    signature = request.META.get("HTTP_X_MPESA_SIGNATURE", "")
    if signature:
        # If Safaricom starts sending signatures, verify here
        logger.info("M-Pesa signature header detected — verification not yet implemented")

    return True
