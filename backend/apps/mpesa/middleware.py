"""
M-Pesa callback security middleware.

- IP whitelist enforcement for callback endpoints
- Request logging for audit trail
- Signature verification placeholder for future Safaricom signing
"""

import logging
from ipaddress import ip_address, ip_network

from django.conf import settings
from django.http import JsonResponse

logger = logging.getLogger(__name__)

# Safaricom known IP ranges (configurable via settings)
DEFAULT_SAFARICOM_IP_RANGES = [
    "196.201.214.0/24",
    "196.201.213.0/24",
    "196.201.212.0/24",
    "192.168.0.0/16",   # Allow private IPs for local/sandbox testing
    "127.0.0.0/8",      # Loopback for development
]


class MpesaIPWhitelistMiddleware:
    """
    Restrict M-Pesa callback endpoints to Safaricom's known IP ranges.

    Only applies to paths starting with /api/v1/mpesa/callback/.
    All other endpoints pass through untouched.

    Configure MPESA_ALLOWED_IPS in settings to override defaults.
    """

    CALLBACK_PATH_PREFIX = "/api/v1/mpesa/callback/"

    def __init__(self, get_response):
        self.get_response = get_response
        raw_ranges = getattr(settings, "MPESA_ALLOWED_IPS", DEFAULT_SAFARICOM_IP_RANGES)
        self.allowed_networks = [ip_network(r, strict=False) for r in raw_ranges]

    def __call__(self, request):
        if request.path.startswith(self.CALLBACK_PATH_PREFIX):
            client_ip = self._get_client_ip(request)

            # Log every callback request for audit
            logger.info(
                "M-Pesa callback request: method=%s path=%s ip=%s content_length=%s",
                request.method,
                request.path,
                client_ip,
                request.META.get("CONTENT_LENGTH", "0"),
            )

            if not self._is_ip_allowed(client_ip):
                logger.warning(
                    "M-Pesa callback rejected: IP %s not in whitelist",
                    client_ip,
                )
                return JsonResponse(
                    {"error": "Forbidden"},
                    status=403,
                )

        return self.get_response(request)

    def _get_client_ip(self, request) -> str:
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "127.0.0.1")

    def _is_ip_allowed(self, client_ip: str) -> bool:
        try:
            addr = ip_address(client_ip)
        except ValueError:
            return False

        return any(addr in network for network in self.allowed_networks)


def verify_mpesa_signature(request) -> bool:
    """
    Placeholder for Safaricom callback signature verification.

    Safaricom does not currently sign callbacks, but this function is here
    for forward compatibility. When/if they add signing, implement the
    verification logic here.

    Returns True for now (no signature to verify).
    """
    # TODO: Implement when Safaricom provides callback signing
    return True
