from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

app_name = "accounts"

urlpatterns = [
    path("otp/", views.RequestOTPView.as_view(), name="request-otp"),
    path("register/", views.RegisterView.as_view(), name="register"),
    path("login/", views.LoginView.as_view(), name="login"),
    path("google/", views.GoogleLoginView.as_view(), name="google-login"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("profile/", views.ProfileView.as_view(), name="profile"),
    path("devices/", views.DeviceListView.as_view(), name="devices"),
    path("change-pin/", views.ChangePINView.as_view(), name="change-pin"),
    path("kyc/documents/", views.KYCDocumentListView.as_view(), name="kyc-documents"),
    path("push-token/", views.RegisterPushTokenView.as_view(), name="push-token"),
    path("kyc/callback/", views.KYCCallbackView.as_view(), name="kyc-callback"),
]
