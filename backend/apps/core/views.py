"""
Core views — health check and system status.
"""

import logging
import time
from urllib.parse import quote

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import HttpResponse, HttpResponseRedirect
from django.views.decorators.cache import never_cache
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

# Redis counter key for APK download tallies. Incremented once per request
# to the short-URL redirect view below; read by the admin metrics endpoint.
APK_DOWNLOAD_COUNTER_KEY = "metrics:apk_downloads_total"


class HealthCheckView(APIView):
    """
    System health check endpoint.

    Returns the status of all critical services:
    - database (PostgreSQL)
    - cache (Redis)
    - celery (worker responsiveness)
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        checks = {}
        overall_healthy = True

        # ── DB + Redis are MUST-BE-UP for the API to serve traffic.
        #    A failure on either marks the response 503 so the docker
        #    healthcheck restarts the container.

        checks["database"] = self._check_database()
        if checks["database"]["status"] != "healthy":
            overall_healthy = False

        checks["redis"] = self._check_redis()
        if checks["redis"]["status"] != "healthy":
            overall_healthy = False

        # ── Celery is INFORMATIONAL · the web container can serve API
        #    requests fine even if the worker is busy or briefly down.
        #    Previous code used `inspect.active()` which broadcasts a
        #    control message via Redis and waits for a roundtrip · under
        #    load (or when the worker was processing a long task) the
        #    2 s window expired and `active` came back None, the check
        #    flipped to 503, and docker marked the container unhealthy.
        #    On 2026-04-29 prod logs we saw 26 such intermittent 503s
        #    in the last hour · all false positives, all triggered by
        #    the worker being mid-task during the docker healthcheck
        #    poll.
        #
        #    The fix keeps the celery probe (so /health/full payload
        #    still surfaces worker status to the ops dashboard) but
        #    DOES NOT contribute to the overall_healthy boolean. A
        #    real worker outage is caught by the celery container's
        #    own healthcheck + the dedicated celery-exporter Prometheus
        #    metric · two stronger signals than a 2 s broadcast.
        checks["celery"] = self._check_celery()

        status_code = 200 if overall_healthy else 503

        # 2026-05-17 · N3 fix · expose git commit SHA + image fingerprint
        # so deploys can be SHA-pinned + a CI assert can fail the
        # rollout if web/celery containers report different SHAs.
        # `/app/.git-sha` is written by the Dockerfile RUN step at
        # image build time; falls back to "unknown" in dev or when
        # the file is absent.
        deploy = {}
        try:
            import os as _os
            sha_path = "/app/.git-sha"
            if _os.path.exists(sha_path):
                with open(sha_path, "r") as f:
                    deploy["git_sha"] = f.read().strip()[:40]
            else:
                deploy["git_sha"] = "unknown"
            deploy["fingerprint_path"] = sha_path if _os.path.exists(sha_path) else None
            # Process role · helps ops compare web vs celery vs beat.
            deploy["role"] = _os.environ.get("CPAY_ROLE", "web")
        except Exception as e:
            deploy["error"] = str(e)[:160]

        return Response(
            {
                "status": "healthy" if overall_healthy else "degraded",
                "checks": checks,
                "deploy": deploy,
            },
            status=status_code,
        )

    def _check_database(self) -> dict:
        try:
            start = time.monotonic()
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            return {"status": "healthy", "latency_ms": latency_ms}
        except Exception as e:
            logger.error(f"Database health check failed: {e}")
            return {"status": "unhealthy", "error": str(e)}

    def _check_redis(self) -> dict:
        try:
            start = time.monotonic()
            cache.set("health_check", "ok", timeout=10)
            value = cache.get("health_check")
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            if value != "ok":
                return {"status": "unhealthy", "error": "Cache read/write mismatch"}
            return {"status": "healthy", "latency_ms": latency_ms}
        except Exception as e:
            logger.error(f"Redis health check failed: {e}")
            return {"status": "unhealthy", "error": str(e)}

    def _check_celery(self) -> dict:
        """Lightweight celery probe · informational only.

        Uses `app.control.ping()` with a short 1 s timeout (returns
        a list per-worker, no broadcast queue traffic) and degrades
        silently if no worker replies. Matches the Celery user-guide
        recommendation for liveness probes (broadcast `inspect.active`
        is for the management UI, not health endpoints).

        See `HealthCheckView.get()` for why a celery degradation no
        longer flips the overall response to 503.
        """
        try:
            from config.celery import app as celery_app

            replies = celery_app.control.ping(timeout=1.0) or []
            if not replies:
                # No worker responded inside the timeout window. Mark
                # degraded but DO NOT fail the overall health check ·
                # the worker is probably mid-task and will reply on the
                # next poll. The Celery container's own healthcheck +
                # celery-exporter cover the real "worker actually down"
                # case with a much stronger signal.
                return {"status": "degraded", "warning": "no workers responded within 1s"}
            return {"status": "healthy", "workers": len(replies)}
        except Exception as e:
            # Connection blip to the broker · don't flap the API
            # health on it. Surface to ops via the response payload.
            logger.warning(f"Celery health check probe failed: {e}")
            return {"status": "degraded", "warning": str(e)}


# ────────────────────────────────────────────────────────────────
# APK download tracking
# ────────────────────────────────────────────────────────────────

#: Canonical Google Play listing for Cpay's Android app.
#: 2026-05-16 · transitioned from VPS-hosted APK distribution to
#: Play Store distribution after closed-testing approval landed.
#: The /apk/ short URL now redirects here so:
#:   - Existing share links (QR codes, emails, SMS, social posts)
#:     keep working · they just land on Play Store now.
#:   - The download counter still ticks · we keep analytics on
#:     CTA engagement even when distribution moved to Play.
#:   - First-time installers get auto-updates from Play forever.
PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=ke.co.cryptopay.app"

#: Closed-testing enrollment URL · users tap this to JOIN the alpha
#: cohort before they can install from Play. Once they enroll, the
#: production Play Store listing lets them install.
#: Listed under Play Console → Testing → Closed testing → Alpha →
#: Testers tab → "Join on the web" link.
PLAY_TESTING_URL = "https://play.google.com/apps/testing/ke.co.cryptopay.app"


class ApkDownloadView(APIView):
    """
    GET /apk  →  302 to the Google Play listing, after incrementing a
    Redis counter so the admin dashboard keeps tracking install-CTA
    engagement.

    2026-05-16 · was redirecting to /download/cryptopay.apk (a
    VPS-hosted 110 MB APK file we shipped pre-Play-Store-approval).
    Now points at Play Store · the VPS file is gone, the counter
    semantic just shifts from "downloads started" to "Play Store
    landings". Same metric name (`metrics:apk_downloads_total`) for
    historical continuity.

    The /apk/ short URL was used in: QR codes on print materials,
    SMS invites, email CTAs, the landing page's "Download Android"
    button, and pasted into WhatsApp groups during the closed beta.
    Keeping the same redirect point means none of those break.

    We intentionally do NOT require auth here · the Play Store
    redirect is public.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        try:
            # `cache.incr` raises if the key hasn't been set yet.
            cache.incr(APK_DOWNLOAD_COUNTER_KEY)
        except ValueError:
            # First-ever hit. Seed to 1 with NO expiry · Django's default
            # cache timeout (300 s) would silently reset the counter to 0
            # every 5 minutes of inactivity, which is the exact symptom
            # the admin dashboard hit before this fix ("0 downloads"
            # despite a live prod build). `timeout=None` → persist until
            # explicitly deleted or Redis is flushed.
            cache.set(APK_DOWNLOAD_COUNTER_KEY, 1, timeout=None)
        except Exception as e:  # noqa: BLE001
            # Never let a telemetry failure block the download itself.
            logger.warning(f"APK download counter incr failed: {e}")

        # 2026-05-16 · 302 to Play Store (was /download/cryptopay.apk).
        # 302 (temporary) so caching proxies don't memoise this past
        # any future URL rotation (e.g. App Store launch when iOS
        # ships and we conditionally route by User-Agent).
        resp = HttpResponseRedirect(PLAY_STORE_URL)
        resp["Cache-Control"] = "no-store"
        return resp


class PlayTestingRedirectView(APIView):
    """GET /testing  →  302 to the Google Play closed-testing enrollment URL.

    Convenience short URL for inviting alpha / beta cohort users.
    Distinct from the production Play Store listing · tapping this
    enrolls the user in the testing track BEFORE they can install
    the closed-testing build.

    Same Redis counter shape as the main `/apk/` endpoint so we can
    distinguish "early-access invite clicks" from "general install
    clicks" in the admin dashboard.

    Add to invite emails / SMS / personal messages as
    `https://cpay.co.ke/testing/` instead of pasting the long
    Play Store URL.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        try:
            cache.incr("metrics:apk_testing_invites_total")
        except ValueError:
            cache.set("metrics:apk_testing_invites_total", 1, timeout=None)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Testing-invite counter incr failed: {e}")

        resp = HttpResponseRedirect(PLAY_TESTING_URL)
        resp["Cache-Control"] = "no-store"
        return resp


class ApkDownloadHitView(APIView):
    """
    POST (or GET) /apk/hit/  →  204 No Content

    Side-effect-only endpoint nginx's `mirror` directive targets when
    someone hits `/download/cryptopay.apk` directly. Previously those
    direct hits bypassed Django and never ticked the counter — the
    admin dashboard stayed at 0 while real downloads happened.

    nginx mirrors the sub-request to this URL; the 200 MB file is
    still served from disk by nginx's `alias` location (no Django in
    the data path). `mirror_request_body off` means we never see the
    response body size — we only count the fact that a download
    started.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return self._tick()

    def post(self, request):
        return self._tick()

    @staticmethod
    def _tick():
        from django.http import HttpResponse
        try:
            cache.incr(APK_DOWNLOAD_COUNTER_KEY)
        except ValueError:
            # `timeout=None` → persist; without it the counter silently
            # resets every 5 min (Django default).
            cache.set(APK_DOWNLOAD_COUNTER_KEY, 1, timeout=None)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"APK download counter incr failed: {e}")
        return HttpResponse(status=204)


# ────────────────────────────────────────────────────────────────
# Smart "open in app" redirect (for email CTAs)
# ────────────────────────────────────────────────────────────────


# Whitelist of in-app paths that the smart redirect accepts. Anything
# else is rejected as a 400 · we don't want an open redirector that
# would let an attacker craft `/open/?path=https://evil.example`.
_DEEP_LINK_PATHS = {
    "payment/detail",      # transaction receipt
    "(tabs)/wallet",       # money-received deep link
    "(tabs)/dashboard",    # generic "open the app"
    "(tabs)/pay",          # send / pay flow
    "(tabs)/notifications",
    "settings/security",
    "settings/profile",
}


class OpenInAppView(APIView):
    """
    GET /open/?path=<deep-link>&id=<uuid>  →  HTML that:
      1. On Android: fires `intent://...#Intent;package=ke.co.cryptopay.app;
         S.browser_fallback_url=<Play Store>;end` · opens the app if
         installed, redirects to Play Store if not.
      2. On iOS / desktop: meta-refreshes to
         `https://app.cpay.co.ke/<path>?id=<id>` (the web bundle, which
         renders the same screen).

    Why this exists (2026-05-17):
      Email "View in App" buttons used to link straight to
      `https://app.cpay.co.ke/<path>`. Android App Links + autoVerify
      already route that into the installed app · but users WITHOUT
      the app land on the web login screen, with no nudge to install.
      This view bridges the gap: every email CTA now goes through here
      and gets routed correctly regardless of install state, with the
      Play Store as the auto-fallback for Android users who haven't
      installed yet.

    Security:
      Whitelisted `path` only (see `_DEEP_LINK_PATHS`). The `id` param
      is forwarded as-is but URL-encoded so a crafted UUID can't break
      out into a new query parameter or path segment.

    Public · no auth. The link sits in transactional emails sent to
    pre-login users (welcome / first-receipt).
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        path = (request.query_params.get("path") or "").strip()
        if path not in _DEEP_LINK_PATHS:
            return HttpResponse(
                f"Unknown deep-link path: {path!r}",
                status=400,
                content_type="text/plain",
            )

        # Optional `id` param (tx UUID for the receipt deep link). Pass
        # through as a single query param — caller's responsibility to
        # quote any further data.
        tx_id = (request.query_params.get("id") or "").strip()
        query = f"?id={quote(tx_id)}" if tx_id else ""

        # Web fallback / iOS / desktop · the app.cpay.co.ke web bundle
        # renders the same Expo Router screen.
        web_url = f"https://app.cpay.co.ke/{path}{query}"

        # Android intent URL · `scheme=https` ensures App Link handlers
        # match the same intent filter we ship in app.json. The
        # `S.browser_fallback_url` (URL-encoded) is opened when the
        # package isn't installed, dropping the user on the Play Store
        # listing rather than a 404.
        play_store = settings.MOBILE_VERSION_STORE_URL or (
            "https://play.google.com/store/apps/details"
            "?id=ke.co.cryptopay.app"
        )
        intent_url = (
            f"intent://{path}{query}"
            "#Intent;scheme=https;package=ke.co.cryptopay.app"
            f";S.browser_fallback_url={quote(play_store, safe='')};end"
        )

        ua = (request.META.get("HTTP_USER_AGENT") or "").lower()
        is_android = "android" in ua

        # Render a tiny HTML page. Why HTML and not a 302?
        #   - On Android, a 302 to `intent://...` is honored by Chrome
        #     but stripped by some webviews / Gmail's in-app browser.
        #     A page with `window.location.href = "<intent>"` is more
        #     reliable across clients.
        #   - We can also offer a "Continue in browser" fallback so
        #     users who can't / don't want to install always have a
        #     way forward.
        html = _render_open_in_app_html(
            target_path=path,
            web_url=web_url,
            intent_url=intent_url if is_android else None,
            play_store_url=play_store,
        )
        resp = HttpResponse(html, content_type="text/html; charset=utf-8")
        # Never cache · the chosen branch depends on the user-agent and
        # we may switch the intent URL when we ship iOS.
        resp["Cache-Control"] = "no-store"
        return resp


def _render_open_in_app_html(
    *,
    target_path: str,
    web_url: str,
    intent_url: str | None,
    play_store_url: str,
) -> str:
    """Tiny self-contained HTML page that:
      - On Android (intent_url provided): tries the intent URL on
        document load, falls back to Play Store after 1.5s if the app
        didn't intercept (which means the Play Store fallback already
        kicked in via the intent's `S.browser_fallback_url`).
      - On non-Android: meta-refreshes to the web bundle URL after
        300ms · also offers a "Continue in browser" link in case the
        user lands here in an exotic browser that doesn't auto-refresh.
    """
    # Brand-styled minimal page · matches the brand dark colours used
    # in the email template so the transition feels native.
    if intent_url:
        primary_script = (
            f"window.location.href = {intent_url!r};\n"
            "setTimeout(function(){\n"
            f"  window.location.href = {play_store_url!r};\n"
            "}, 1500);"
        )
    else:
        primary_script = f"window.location.href = {web_url!r};"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url={web_url}">
<title>Opening Cpay</title>
<style>
  body {{
    margin: 0;
    background: #060E1F;
    color: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 24px;
    text-align: center;
  }}
  .badge {{
    display: inline-block;
    background: #10B981;
    color: #fff;
    font-weight: 700;
    padding: 14px 28px;
    border-radius: 8px;
    text-decoration: none;
    margin-top: 16px;
  }}
  .muted {{ color: #94a3b8; font-size: 13px; margin-top: 24px; max-width: 360px; }}
  .muted a {{ color: #10B981; text-decoration: underline; }}
  h1 {{ font-size: 22px; margin: 0 0 4px; }}
  p.lead {{ color: #cbd5e1; margin: 0; }}
</style>
</head>
<body>
  <h1>Opening Cpay&hellip;</h1>
  <p class="lead">If the app doesn't open automatically, choose an option below.</p>
  <a class="badge" href="{play_store_url}">Get it on Google Play</a>
  <p class="muted">
    Already installed? <a href="{intent_url or web_url}">Open in the app</a>.<br>
    Prefer the web? <a href="{web_url}">Continue in browser</a>.
  </p>
  <script>{primary_script}</script>
</body>
</html>
"""


class ApkDownloadMetricsView(APIView):
    """
    GET /api/v1/admin/metrics/apk-downloads/  →  { "total": N }

    Admin-only. Reads the Redis counter maintained by ApkDownloadView.
    Cheap enough that the admin dashboard can refresh it every tile
    refresh without pressure on the cache.
    """

    permission_classes = [IsAdminUser]

    def get(self, request):
        total = cache.get(APK_DOWNLOAD_COUNTER_KEY, 0)
        try:
            total = int(total)
        except (TypeError, ValueError):
            total = 0
        return Response({"total": total})


# ────────────────────────────────────────────────────────────────
# Mobile version manifest
# ────────────────────────────────────────────────────────────────


class AppVersionView(APIView):
    """
    GET /api/v1/app/version/  →  Mobile version manifest.

    Read by the mobile app on cold-start (`UpdateAvailableBanner`).
    The bundled `Constants.expoConfig.version` /
    `expo.android.versionCode` is compared against this payload to
    decide:

      - bundled >= latest_version_code  →  silent · no banner
      - bundled <  latest_version_code AND
        bundled >= minimum_supported_version_code  →  optional update
        (dismissable banner)
      - bundled <  minimum_supported_version_code  →  recommended
        update (full-screen modal, still dismissable)
      - bundled <  force_update_below_version_code  →  forced update
        (modal with NO dismiss, only "Update now" → store)

    Public endpoint · no auth required. The mobile client hits it
    pre-login so even users sitting on the auth screen with a stale
    build see the banner. Cached for 5 min on the client side to
    avoid hammering the API on every focus event.

    Source of truth: `settings.MOBILE_VERSION_*` (env-overridable so
    ops can bump version metadata without a backend redeploy).
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        platform = (request.query_params.get("platform") or "android").lower()
        if platform not in ("android", "ios"):
            return Response(
                {"detail": "platform must be one of: android, ios"},
                status=400,
            )

        # iOS not shipped yet · return a sentinel so the client knows
        # to skip the banner entirely (no point telling iOS users to
        # update to a build that doesn't exist).
        if platform == "ios":
            return Response({
                "platform": "ios",
                "available": False,
                "latest_version": None,
                "latest_version_code": None,
                "minimum_supported_version_code": None,
                "force_update_below_version_code": None,
                "store_url": None,
                "release_notes": None,
            })

        return Response({
            "platform": "android",
            "available": True,
            "latest_version": settings.MOBILE_VERSION_LATEST_NAME,
            "latest_version_code": int(settings.MOBILE_VERSION_LATEST_CODE),
            "minimum_supported_version_code": int(
                settings.MOBILE_VERSION_MIN_SUPPORTED_CODE
            ),
            "force_update_below_version_code": int(
                settings.MOBILE_VERSION_FORCE_BELOW_CODE
            ),
            "store_url": settings.MOBILE_VERSION_STORE_URL,
            "release_notes": settings.MOBILE_VERSION_RELEASE_NOTES,
        })
