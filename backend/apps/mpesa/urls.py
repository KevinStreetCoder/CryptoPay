from django.urls import path

from . import views

app_name = "mpesa"

urlpatterns = [
    path("callback/stk/", views.STKCallbackView.as_view(), name="stk-callback"),
    path("callback/b2b/", views.B2BCallbackView.as_view(), name="b2b-callback"),
    path("callback/b2b/timeout/", views.TimeoutCallbackView.as_view(), name="b2b-timeout"),
    path("callback/b2c/", views.B2CCallbackView.as_view(), name="b2c-callback"),
    path("callback/b2c/timeout/", views.TimeoutCallbackView.as_view(), name="b2c-timeout"),
    path("callback/status/", views.TimeoutCallbackView.as_view(), name="status-callback"),
    path("callback/status/timeout/", views.TimeoutCallbackView.as_view(), name="status-timeout"),
    path("callback/reversal/", views.TimeoutCallbackView.as_view(), name="reversal-callback"),
    path("callback/reversal/timeout/", views.TimeoutCallbackView.as_view(), name="reversal-timeout"),
    path("callback/balance/", views.TimeoutCallbackView.as_view(), name="balance-callback"),
    path("callback/balance/timeout/", views.TimeoutCallbackView.as_view(), name="balance-timeout"),
]
