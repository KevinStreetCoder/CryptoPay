"""D4: Authenticated media serving.

Replaces the Django `serve` view that previously exposed `/media/` to any
unauthenticated visitor. Two modes:

  1. X-Accel-Redirect  · when `USE_X_ACCEL_REDIRECT=True` (production):
     Django validates the request, then tells nginx to serve the file
     internally · Django never streams bytes itself. nginx must have a
     matching `internal` `location /protected-media/` block.

  2. FileResponse      · when `USE_X_ACCEL_REDIRECT=False` (development):
     Django streams the file itself. Still gated on authentication.

Access rules (today, extendable via `_user_can_access`):
  - KYC documents (`kyc_docs/<user_id>/…`)   · only the owning user OR staff
  - Receipts       (`receipts/receipt_<id>…`) · only the owning user OR staff
  - Everything else                           · staff only

Set `DJANGO_MEDIA_URL=/media/` and `DJANGO_PROTECTED_MEDIA_URL=/protected-media/`
in nginx to match this view.
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.http import FileResponse, HttpResponse, HttpResponseForbidden, HttpResponseNotFound
from django.utils.http import http_date
from django.views.decorators.http import require_safe
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

logger = logging.getLogger(__name__)


_ALLOWED_SUBPATHS = (
    "kyc_docs",   # per-user KYC uploads
    "receipts",   # generated payment receipts
)


def _normalize_path(path: str) -> Path | None:
    """Resolve a relative media path safely. Refuses `..` traversal."""
    media_root = Path(settings.MEDIA_ROOT).resolve()
    candidate = (media_root / path).resolve()
    try:
        candidate.relative_to(media_root)
    except ValueError:
        return None
    if not candidate.exists() or not candidate.is_file():
        return None
    return candidate


def _user_can_access(user, rel_path: str) -> bool:
    """Per-subtree access rules. Staff can read anything."""
    if user.is_staff or user.is_superuser:
        return True

    # KYC documents: kyc_docs/<user_id>/... — owner only.
    m = re.match(r"^kyc_docs/([^/]+)/", rel_path)
    if m:
        return str(user.id) == m.group(1)

    # Receipts are generated per-transaction; match by filename prefix.
    # File naming is `receipt_<tx_id_prefix>_<yyyymmdd>.pdf` (see pdf_receipt.py).
    # We cannot cheaply check ownership without a DB hit, so for non-staff we
    # require the caller to use the signed `TransactionReceiptView` flow
    # (B18 · signed one-shot URL) instead of the raw media path.
    if rel_path.startswith("receipts/"):
        return False

    # All other subpaths are private by default.
    return False


class ProtectedMediaView(APIView):
    """Authenticated gateway to every file under MEDIA_ROOT."""

    authentication_classes = [JWTAuthentication, SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, path):
        # Reject traversal early.
        safe = _normalize_path(path)
        if safe is None:
            return HttpResponseNotFound()

        rel_path = str(safe.relative_to(Path(settings.MEDIA_ROOT).resolve())).replace(
            os.sep, "/"
        )

        # Only subtrees we explicitly list are eligible.
        if not any(rel_path.startswith(sub + "/") for sub in _ALLOWED_SUBPATHS):
            return HttpResponseForbidden("forbidden")

        if not _user_can_access(request.user, rel_path):
            logger.warning(
                "Media access denied: user=%s path=%s", request.user.id, rel_path
            )
            return HttpResponseForbidden("forbidden")

        # Production: hand off to nginx via X-Accel-Redirect.
        if getattr(settings, "USE_X_ACCEL_REDIRECT", False):
            protected_url = getattr(
                settings, "PROTECTED_MEDIA_INTERNAL_PREFIX", "/protected-media/"
            )
            response = HttpResponse()
            response["Content-Type"] = ""  # let nginx set it from the file
            response["X-Accel-Redirect"] = quote(protected_url + rel_path)
            # Browsers will cache these aggressively; tell them not to.
            response["Cache-Control"] = "private, no-store, max-age=0"
            logger.info(
                "Media X-Accel-Redirect: user=%s path=%s", request.user.id, rel_path
            )
            return response

        # Dev: stream the file directly.
        stat = safe.stat()
        response = FileResponse(open(safe, "rb"))
        response["Cache-Control"] = "private, no-store, max-age=0"
        response["Last-Modified"] = http_date(stat.st_mtime)
        return response


@require_safe
def public_media_forbidden(request, path):
    """Drop-in replacement for `django.views.static.serve` that always 404s.
    We keep the URL pattern so nginx-routed mistakes surface quickly instead
    of Django rendering an untrusted file."""
    return HttpResponseNotFound()
