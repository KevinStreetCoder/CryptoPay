"""
Core views — health check and system status.
"""

import logging
import time

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import HttpResponseRedirect
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

        return Response(
            {
                "status": "healthy" if overall_healthy else "degraded",
                "checks": checks,
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
