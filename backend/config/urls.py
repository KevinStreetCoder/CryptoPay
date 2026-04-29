from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.core.admin_views import admin_stats_dashboard, admin_sms_health
from apps.core.media_views import ProtectedMediaView, public_media_forbidden
from apps.core.views import (
    ApkDownloadHitView,
    ApkDownloadMetricsView,
    ApkDownloadView,
    HealthCheckView,
)


@api_view(["GET"])
@permission_classes([AllowAny])
def api_root(request):
    return Response({"name": "CryptoPay API", "version": "1.0.0", "status": "ok"})


# D10: obfuscate the admin URL. Defaults to `admin/` for dev + backwards
# compat; production operator sets `ADMIN_URL=<random-slug>/` in .env so
# crawlers + credential-stuffing bots can't find the login page without
# insider knowledge. Always ends with `/`.
_admin_prefix = getattr(settings, "ADMIN_URL", "admin/")
if not _admin_prefix.endswith("/"):
    _admin_prefix = _admin_prefix + "/"

urlpatterns = [
    path("", api_root, name="api-root"),
    path("", include("django_prometheus.urls")),
    path("health/", HealthCheckView.as_view(), name="health-check"),
    # Short-URL APK download (counts hits, 302s to the nginx-served file).
    # Landing page links to /apk/ instead of /download/cryptopay.apk so the
    # counter ticks. The actual binary is still served by nginx.
    path("apk/", ApkDownloadView.as_view(), name="apk-download-tracker"),
    # Side-effect-only counter tick · nginx mirrors direct hits on
    # /download/cryptopay.apk here so the counter can't be bypassed by
    # cache-busted URLs or anyone using the direct path.
    path("apk/hit/", ApkDownloadHitView.as_view(), name="apk-download-hit"),
    path(
        "api/v1/admin/metrics/apk-downloads/",
        ApkDownloadMetricsView.as_view(),
        name="admin-apk-metrics",
    ),
    # Stats dashboards stay under the obfuscated prefix too.
    path(f"{_admin_prefix}stats/", admin_stats_dashboard, name="admin-stats"),
    path(f"{_admin_prefix}health/sms/", admin_sms_health, name="admin-sms-health"),
    path(_admin_prefix, admin.site.urls),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/wallets/", include("apps.wallets.urls")),
    path("api/v1/payments/", include("apps.payments.urls")),
    path("api/v1/mpesa/", include("apps.mpesa.urls")),
    # C2B callback URLs without "mpesa" in path — Safaricom blocks URLs containing "mpesa"
    path("api/v1/hooks/", include("apps.mpesa.hooks_urls")),
    path("api/v1/rates/", include("apps.rates.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
    path("api/v1/referrals/", include("apps.referrals.urls")),
    # Public referral landing JSON — consumed by the mobile /r/[code]
    # screen and any server-rendered OG card. Top-level (not under
    # /api/v1) so the shareable URL cpay.co.ke/r/{code} resolves cleanly.
    path(
        "r/<str:code>/public/",
        __import__("apps.referrals.views", fromlist=["PublicReferrerLandingView"]).PublicReferrerLandingView.as_view(),
        name="referral-public-landing",
    ),
    # ── SasaPay callbacks · LIVE 2026-04-30 ──
    # Re-enabled because Safaricom Daraja onboarding hit the CBK
    # Letter-of-No-Objection blocker (see
    # `docs/research/DARAJA-CBK-BLOCKER-2026-04-30.md`). Cpay routes
    # primary M-Pesa flows through SasaPay (CBK-licensed PSP, in the
    # Nov 2025 PSP directory) until the LNO lands and direct Daraja
    # approves us · then we flip `PAYMENT_PROVIDER` back.
    #
    # Security model:
    #   - Header HMAC `X-SasaPay-Signature` verified against
    #     SASAPAY_WEBHOOK_SECRET (signed by SasaPay)
    #   - Optional URL-token variant (`/<token>/`) checked against
    #     SASAPAY_CALLBACK_HMAC_KEY · per-tx tokens minted by us
    #   - production.py refuses to boot when PAYMENT_PROVIDER=sasapay
    #     AND both secrets are empty
    #   - SASAPAY_ALLOWED_IPS for an extra IP allow-list
    path("api/v1/sasapay/callback/", __import__("apps.mpesa.sasapay_views", fromlist=["sasapay_callback"]).sasapay_callback, name="sasapay-callback-root"),
    path("api/v1/sasapay/callback/<str:token>/", __import__("apps.mpesa.sasapay_views", fromlist=["sasapay_callback"]).sasapay_callback, name="sasapay-callback-root-token"),
    path("api/v1/sasapay/ipn/", __import__("apps.mpesa.sasapay_views", fromlist=["sasapay_ipn"]).sasapay_ipn, name="sasapay-ipn-root"),

    # ── Kopo Kopo callbacks · LIVE 2026-04-30 ──
    # Parallel aggregator rail · applied alongside SasaPay so whichever
    # provider clears compliance first ships first. K2-Connect is the
    # better long-term B2B story (first-class reversal API + KES 50
    # flat outbound) so we route paybills + tills via Kopo Kopo if both
    # approve.
    #
    # Security model mirrors SasaPay:
    #   - Header HMAC `X-KopoKopo-Signature` verified against
    #     KOPOKOPO_API_KEY (or KOPOKOPO_WEBHOOK_SECRET fallback)
    #   - production.py refuses boot when PAYMENT_PROVIDER=kopokopo
    #     AND KOPOKOPO_API_KEY is empty
    #   - KOPOKOPO_ALLOWED_IPS for an extra IP allow-list
    path("api/v1/kopokopo/callback/", __import__("apps.mpesa.kopokopo_views", fromlist=["kopokopo_callback"]).kopokopo_callback, name="kopokopo-callback-root"),
    path("api/v1/kopokopo/callback/<str:token>/", __import__("apps.mpesa.kopokopo_views", fromlist=["kopokopo_callback"]).kopokopo_callback, name="kopokopo-callback-root-token"),
    path("api/v1/kopokopo/ipn/", __import__("apps.mpesa.kopokopo_views", fromlist=["kopokopo_ipn"]).kopokopo_ipn, name="kopokopo-ipn-root"),
    # OpenAPI / Swagger — only in development (exposes full API surface)
    *([
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
        path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    ] if settings.DEBUG else []),
]

# D4: media is ALWAYS served via an authenticated gateway. The previous
# code path used `django.views.static.serve` which exposed every file under
# `media/` to anyone who could guess the URL — including KYC national-ID
# scans. `ProtectedMediaView` authenticates + authorizes every request,
# then either streams (dev) or `X-Accel-Redirect`s to nginx (production).
urlpatterns += [
    re_path(
        r"^media/(?P<path>.*)$",
        ProtectedMediaView.as_view(),
        name="protected-media",
    ),
]
