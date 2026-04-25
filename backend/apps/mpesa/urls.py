from django.urls import path

from . import views
from . import sasapay_views

app_name = "mpesa"

urlpatterns = [
    # Static callback paths (backward-compatible, IP-whitelisted)
    path("callback/stk/", views.STKCallbackView.as_view(), name="stk-callback"),
    path("callback/b2b/", views.B2BCallbackView.as_view(), name="b2b-callback"),
    path("callback/b2b/timeout/", views.TimeoutCallbackView.as_view(), name="b2b-timeout"),
    path("callback/b2c/", views.B2CCallbackView.as_view(), name="b2c-callback"),
    path("callback/b2c/timeout/", views.TimeoutCallbackView.as_view(), name="b2c-timeout"),
    path("callback/status/", views.TimeoutCallbackView.as_view(), name="status-callback"),
    path("callback/status/timeout/", views.TimeoutCallbackView.as_view(), name="status-timeout"),
    path("callback/reversal/", views.TimeoutCallbackView.as_view(), name="reversal-callback"),
    path("callback/reversal/timeout/", views.TimeoutCallbackView.as_view(), name="reversal-timeout"),
    path("callback/balance/", views.BalanceCallbackView.as_view(), name="balance-callback"),
    path("callback/balance/timeout/", views.TimeoutCallbackView.as_view(), name="balance-timeout"),

    # C2B (Customer to Business) callback paths — for KES deposit flow
    path("callback/c2b/validate/", views.C2BValidationView.as_view(), name="c2b-validate"),
    path("callback/c2b/confirm/", views.C2BConfirmationView.as_view(), name="c2b-confirm"),

    # Dynamic token callback paths (per-transaction HMAC token for anti-forgery)
    path("callback/stk/<str:token>/", views.STKCallbackView.as_view(), name="stk-callback-token"),
    path("callback/b2b/<str:token>/", views.B2BCallbackView.as_view(), name="b2b-callback-token"),
    path("callback/b2b/<str:token>/timeout/", views.TimeoutCallbackView.as_view(), name="b2b-timeout-token"),
    path("callback/b2c/<str:token>/", views.B2CCallbackView.as_view(), name="b2c-callback-token"),
    path("callback/b2c/<str:token>/timeout/", views.TimeoutCallbackView.as_view(), name="b2c-timeout-token"),
    # B11 + B28: token routes for status/reversal/balance
    path("callback/status/<str:token>/", views.TimeoutCallbackView.as_view(), name="status-callback-token"),
    path("callback/status/timeout/<str:token>/", views.TimeoutCallbackView.as_view(), name="status-timeout-token"),
    path("callback/reversal/<str:token>/", views.TimeoutCallbackView.as_view(), name="reversal-callback-token"),
    path("callback/reversal/timeout/<str:token>/", views.TimeoutCallbackView.as_view(), name="reversal-timeout-token"),
    path("callback/balance/<str:token>/", views.BalanceCallbackView.as_view(), name="balance-callback-token"),
    path("callback/balance/timeout/<str:token>/", views.TimeoutCallbackView.as_view(), name="balance-timeout-token"),

    # ── SasaPay callbacks · DISABLED ──
    # Daraja is the primary rail (April 2026 application submitted).
    # See config/urls.py for the rationale; uncomment alongside the
    # top-level routes there when re-enabling SasaPay as a fallback.
    #
    # path("sasapay/callback/", sasapay_views.sasapay_callback, name="sasapay-callback"),
    # path("sasapay/callback/<str:token>/", sasapay_views.sasapay_callback, name="sasapay-callback-token"),
    # path("sasapay/ipn/", sasapay_views.sasapay_ipn, name="sasapay-ipn"),
]
