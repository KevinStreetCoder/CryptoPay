"""D10 · admin-side TOTP enrolment + verification views.

Mounted at /admin-totp/setup/ and /admin-totp/verify/. The
`AdminTOTPRequiredMiddleware` (in apps.core.middleware) redirects
staff users here when ADMIN_REQUIRE_TOTP=True · setup if no device
exists, verify if the session flag is stale.

The views use the existing TOTP infrastructure from
`apps.accounts.totp` end-to-end · no new crypto, no django-otp
dependency.
"""
from __future__ import annotations

import io
import time
import logging
from html import escape as html_escape  # stdlib · supports quote=True
from urllib.parse import urlparse

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse, HttpResponseRedirect, HttpResponseBadRequest
from django.utils.decorators import method_decorator
from django.utils.html import escape
from django.views.decorators.http import require_http_methods

from apps.accounts.totp import (
    generate_totp_secret,
    get_totp_uri,
    verify_totp,
)
from apps.core.middleware import (
    ADMIN_TOTP_SESSION_KEY,
)

logger = logging.getLogger(__name__)


def _safe_next(request) -> str:
    """Return a safe `?next=` target · refuses anything that would
    redirect off-host (open-redirect defence)."""
    nxt = request.GET.get("next") or request.POST.get("next") or ""
    if not nxt or not nxt.startswith("/"):
        nxt = "/" + (getattr(settings, "ADMIN_URL", "admin/")).lstrip("/")
    # Strip protocol-relative `//evil.com/path` shenanigans.
    if nxt.startswith("//"):
        return "/"
    parsed = urlparse(nxt)
    if parsed.scheme or parsed.netloc:
        return "/"
    return nxt


def _render_setup_page(qr_uri: str, next_url: str, error: str = "") -> HttpResponse:
    """Minimal, framework-free HTML · QR code rendered via the otpauth://
    URI through Google Chart API server-side OR via an inline canvas if
    we add a JS QR library. For now we render both the URI text and an
    img tag pointing at chart.googleapis.com (zero JS, no inline data
    URLs that might trip Content-Security-Policy)."""
    err_html = (
        f'<div style="background:#fee2e2;color:#991b1b;padding:12px 14px;'
        f'border-radius:6px;margin:12px 0;font-size:13px;">{escape(error)}</div>'
        if error else ""
    )
    return HttpResponse(_setup_html(qr_uri, next_url, err_html))


def _setup_html(otpauth_uri: str, next_url: str, err_html: str) -> str:
    # url-encode the otpauth:// URI so a stray `&` doesn't truncate the
    # query string passed to chart.googleapis.com. `html_escape(... quote=True)`
    # is stdlib and accepts the kwarg; Django's html.escape does not.
    qr_src = (
        "https://chart.googleapis.com/chart?chs=220x220&cht=qr&chl="
        + html_escape(otpauth_uri, quote=True)
    )
    return f"""<!doctype html>
<html><head>
<title>Cpay admin · TOTP setup</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background:#0B1220; color:#F8FAFC; padding:32px 16px; }}
  .card {{ max-width: 420px; margin: 0 auto; background:#0F172A;
           border:1px solid #1E293B; border-radius:14px; padding:24px;
           box-shadow:0 8px 24px rgba(0,0,0,0.4); }}
  h1 {{ margin: 0 0 8px 0; font-size: 18px; color: #10B981; }}
  p  {{ margin: 8px 0; font-size: 13px; color: #94A3B8; line-height:1.6; }}
  img.qr {{ display:block; margin: 16px auto; border:1px solid #1E293B;
            background:#FFFFFF; padding:8px; border-radius:8px; }}
  input[type=text] {{ width:100%; box-sizing:border-box; padding:12px 14px;
                     border-radius:8px; border:1px solid #1E293B;
                     background:#0B1220; color:#F8FAFC; font-size:18px;
                     letter-spacing:8px; text-align:center;
                     font-family:"JetBrains Mono",Consolas,monospace; }}
  button {{ width:100%; margin-top:14px; padding:12px 16px; border:0;
            border-radius:8px; background:#10B981; color:#FFFFFF;
            font-size:14px; font-weight:600; cursor:pointer; }}
</style>
</head><body>
<div class="card">
  <h1>Set up admin TOTP</h1>
  <p>Scan this QR code in Google Authenticator, Authy, or 1Password.
     Then enter the 6-digit code to confirm.</p>
  <img class="qr" src="{qr_src}" alt="TOTP QR code" width="220" height="220">
  {err_html}
  <form method="post" action="/admin-totp/setup/">
    <input type="hidden" name="next" value="{escape(next_url)}">
    <input type="text" name="code" inputmode="numeric" pattern="[0-9]{{6}}"
           maxlength="6" required autofocus autocomplete="off"
           placeholder="123456">
    <button type="submit">Confirm + enable</button>
  </form>
  <p style="margin-top:18px;font-size:11px;color:#475569;">
    Manual key (if you can't scan):
    <code style="color:#94A3B8;font-size:12px;">{_extract_secret(otpauth_uri)}</code>
  </p>
</div>
</body></html>"""


def _extract_secret(otpauth_uri: str) -> str:
    """Pull the base32 secret out of an otpauth:// URI for the
    manual-entry fallback (visually impaired users, or anyone with
    camera issues)."""
    try:
        from urllib.parse import urlparse, parse_qs
        return parse_qs(urlparse(otpauth_uri).query).get("secret", [""])[0]
    except Exception:
        return ""


def _verify_html(next_url: str, err_html: str) -> str:
    return f"""<!doctype html>
<html><head>
<title>Cpay admin · TOTP verify</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background:#0B1220; color:#F8FAFC; padding:32px 16px; }}
  .card {{ max-width: 360px; margin: 0 auto; background:#0F172A;
           border:1px solid #1E293B; border-radius:14px; padding:24px; }}
  h1 {{ margin: 0 0 8px 0; font-size: 18px; color: #10B981; }}
  p  {{ margin: 8px 0; font-size: 13px; color: #94A3B8; }}
  input[type=text] {{ width:100%; box-sizing:border-box; padding:12px 14px;
                     border-radius:8px; border:1px solid #1E293B;
                     background:#0B1220; color:#F8FAFC; font-size:18px;
                     letter-spacing:8px; text-align:center;
                     font-family:"JetBrains Mono",Consolas,monospace; }}
  button {{ width:100%; margin-top:14px; padding:12px 16px; border:0;
            border-radius:8px; background:#10B981; color:#FFFFFF;
            font-size:14px; font-weight:600; cursor:pointer; }}
</style>
</head><body>
<div class="card">
  <h1>Admin TOTP required</h1>
  <p>Enter your 6-digit code to continue to the admin panel.</p>
  {err_html}
  <form method="post" action="/admin-totp/verify/">
    <input type="hidden" name="next" value="{escape(next_url)}">
    <input type="text" name="code" inputmode="numeric" pattern="[0-9]{{6}}"
           maxlength="6" required autofocus autocomplete="off"
           placeholder="123456">
    <button type="submit">Verify</button>
  </form>
</div>
</body></html>"""


@require_http_methods(["GET", "POST"])
@login_required
def admin_totp_setup(request):
    """Show TOTP QR + prompt for the first code · on success, mark the
    user's totp_enabled=True and set the session flag so they're not
    immediately bounced to /admin-totp/verify/."""
    user = request.user
    if not user.is_staff:
        return HttpResponseRedirect("/")

    next_url = _safe_next(request)

    # Reuse an existing pending secret across the GET → POST round-trip;
    # otherwise an attacker who intercepts the QR could submit a code
    # against a different secret on a re-display.
    pending_key = f"admin_totp_pending_secret:{user.pk}"
    from django.core.cache import cache as _cache
    secret = _cache.get(pending_key)
    if not secret:
        secret = generate_totp_secret()
        _cache.set(pending_key, secret, timeout=600)  # 10 min to scan + confirm

    otpauth_uri = get_totp_uri(secret, user.phone if hasattr(user, "phone") else str(user.pk))

    if request.method == "GET":
        return _render_setup_page(otpauth_uri, next_url)

    code = (request.POST.get("code") or "").strip()
    if not verify_totp(secret, code):
        logger.warning("admin.totp.setup_failed user=%s", user.pk)
        return _render_setup_page(otpauth_uri, next_url, error="Wrong code · try again.")

    # Persist · `set_totp_secret(...)` is the model's canonical
    # encryption path (Fernet under the user's primary key). See
    # apps.accounts.models.User. Reading back via `totp_secret_decrypted`.
    try:
        user.set_totp_secret(secret)
        user.totp_enabled = True
        user.save(update_fields=["totp_secret", "totp_enabled"])
    except Exception:
        logger.exception("admin.totp.setup_persist_failed user=%s", user.pk)
        return _render_setup_page(
            otpauth_uri, next_url,
            error="Could not save TOTP device · contact support.",
        )

    _cache.delete(pending_key)
    request.session[ADMIN_TOTP_SESSION_KEY] = int(time.time())
    logger.info("admin.totp.setup_ok user=%s", user.pk)
    return HttpResponseRedirect(next_url)


@require_http_methods(["GET", "POST"])
@login_required
def admin_totp_verify(request):
    """Prompt the staff user for their current TOTP code, set the
    session flag on success so subsequent admin pages don't re-prompt
    for the next ADMIN_TOTP_FRESHNESS_SECONDS window."""
    user = request.user
    if not user.is_staff:
        return HttpResponseRedirect("/")
    if not getattr(user, "totp_enabled", False):
        # No device · bounce to setup.
        return HttpResponseRedirect("/admin-totp/setup/?next=" + _safe_next(request))

    next_url = _safe_next(request)

    if request.method == "GET":
        return HttpResponse(_verify_html(next_url, ""))

    code = (request.POST.get("code") or "").strip()
    # The User model encrypts totp_secret on write (set_totp_secret)
    # and exposes the decrypted form via the `totp_secret_decrypted`
    # property. Reading `user.totp_secret` directly returns the Fernet
    # ciphertext · pyotp would then choke with `Non-base32 digit found`.
    secret = ""
    try:
        secret = user.totp_secret_decrypted or ""
    except Exception:
        logger.exception("admin.totp.verify_decrypt_failed user=%s", user.pk)

    if not verify_totp(secret, code):
        logger.warning("admin.totp.verify_failed user=%s", user.pk)
        return HttpResponse(
            _verify_html(next_url, err_html=(
                '<div style="background:#fee2e2;color:#991b1b;padding:12px 14px;'
                'border-radius:6px;margin:12px 0;font-size:13px;">'
                'Wrong code · try again.</div>'
            ))
        )

    request.session[ADMIN_TOTP_SESSION_KEY] = int(time.time())
    logger.info("admin.totp.verify_ok user=%s", user.pk)
    return HttpResponseRedirect(next_url)
