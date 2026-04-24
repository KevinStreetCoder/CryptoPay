"""
Core views — health check and system status.
"""

import logging
import time

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

        # Database check
        checks["database"] = self._check_database()
        if checks["database"]["status"] != "healthy":
            overall_healthy = False

        # Redis check
        checks["redis"] = self._check_redis()
        if checks["redis"]["status"] != "healthy":
            overall_healthy = False

        # Celery check
        checks["celery"] = self._check_celery()
        if checks["celery"]["status"] != "healthy":
            overall_healthy = False

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
        try:
            from config.celery import app as celery_app

            inspector = celery_app.control.inspect(timeout=2.0)
            active = inspector.active()

            if active is None:
                return {"status": "unhealthy", "error": "No workers responding"}

            worker_count = len(active)
            return {"status": "healthy", "workers": worker_count}
        except Exception as e:
            logger.error(f"Celery health check failed: {e}")
            return {"status": "unhealthy", "error": str(e)}


# ────────────────────────────────────────────────────────────────
# APK download tracking
# ────────────────────────────────────────────────────────────────

class ApkDownloadView(APIView):
    """
    GET /apk  →  302 to /download/cryptopay.apk, after incrementing a
    Redis counter. The actual file is served by nginx (fast path, no
    Django in the data path). We only participate in the redirect so
    we can count, without bloating nginx with a custom Lua module.

    Counter key: `metrics:apk_downloads_total` (integer).
    Read via the admin metrics endpoint below.

    We intentionally do NOT require auth here — anonymous downloads
    are the norm for public APK distribution before Play Store gating.
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

        # 302 (temporary) so caching proxies don't memoise the redirect
        # destination past a URL rotation.
        resp = HttpResponseRedirect("/download/cryptopay.apk")
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
