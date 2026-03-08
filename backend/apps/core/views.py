"""
Core views — health check and system status.
"""

import logging
import time

from django.core.cache import cache
from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


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
