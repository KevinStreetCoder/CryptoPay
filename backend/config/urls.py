from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.core.admin_views import admin_stats_dashboard
from apps.core.views import HealthCheckView


@api_view(["GET"])
@permission_classes([AllowAny])
def api_root(request):
    return Response({
        "name": "CryptoPay API",
        "version": "1.0.0",
        "endpoints": {
            "auth": "/api/v1/auth/",
            "wallets": "/api/v1/wallets/",
            "payments": "/api/v1/payments/",
            "rates": "/api/v1/rates/",
            "health": "/health/",
            "admin": "/admin/",
            "docs": "/api/docs/",
        },
    })


def trigger_error(request):
    """Sentry test endpoint — triggers a ZeroDivisionError to verify error tracking."""
    _ = 1 / 0


urlpatterns = [
    path("sentry-debug/", trigger_error),
    path("", api_root, name="api-root"),
    path("", include("django_prometheus.urls")),
    path("health/", HealthCheckView.as_view(), name="health-check"),
    path("admin/stats/", admin_stats_dashboard, name="admin-stats"),
    path("admin/", admin.site.urls),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/wallets/", include("apps.wallets.urls")),
    path("api/v1/payments/", include("apps.payments.urls")),
    path("api/v1/mpesa/", include("apps.mpesa.urls")),
    # C2B callback URLs without "mpesa" in path — Safaricom blocks URLs containing "mpesa"
    path("api/v1/hooks/", include("apps.mpesa.hooks_urls")),
    path("api/v1/rates/", include("apps.rates.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
    # OpenAPI / Swagger
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

# Always serve media files (nginx proxies /media/ to Django)
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
