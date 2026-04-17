from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

app_name = "accounts"

urlpatterns = [
    path("otp/", views.RequestOTPView.as_view(), name="request-otp"),
    path("register/", views.RegisterView.as_view(), name="register"),
    path("login/", views.LoginView.as_view(), name="login"),
    path("google/", views.GoogleLoginView.as_view(), name="google-login"),
    path("google/complete-profile/", views.GoogleCompleteProfileView.as_view(), name="google-complete-profile"),
    path("set-initial-pin/", views.SetInitialPINView.as_view(), name="set-initial-pin"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("profile/", views.ProfileView.as_view(), name="profile"),
    path("devices/", views.DeviceListView.as_view(), name="devices"),
    path("devices/<uuid:device_id>/", views.DeviceDeleteView.as_view(), name="device-delete"),
    path("change-pin/", views.ChangePINView.as_view(), name="change-pin"),
    path("verify-pin/", views.VerifyPINView.as_view(), name="verify-pin"),
    path("kyc/documents/", views.KYCDocumentListView.as_view(), name="kyc-documents"),
    path("push-token/", views.RegisterPushTokenView.as_view(), name="push-token"),
    path("kyc/callback/", views.KYCCallbackView.as_view(), name="kyc-callback"),
    # Email verification
    path("email/verify/", views.SendEmailVerificationView.as_view(), name="send-email-verify"),
    path("email/confirm/", views.ConfirmEmailVerificationView.as_view(), name="confirm-email-verify"),
    # TOTP authenticator (legacy combined endpoint)
    path("totp/setup/", views.SetupTOTPView.as_view(), name="totp-setup"),
    # TOTP authenticator (separate endpoints)
    path("totp/init/", views.TOTPSetupView.as_view(), name="totp-init"),
    path("totp/confirm/", views.TOTPConfirmView.as_view(), name="totp-confirm"),
    path("totp/disable/", views.TOTPDisableView.as_view(), name="totp-disable"),
    path("totp/verify/", views.TOTPVerifyView.as_view(), name="totp-verify"),
    # Recovery settings
    path("recovery/", views.RecoveryEmailView.as_view(), name="recovery-settings"),
    # Security settings overview
    path("security/", views.SecuritySettingsView.as_view(), name="security-settings"),
    # Push login challenge (2FA via tap-to-approve on trusted device)
    path("challenge/<str:challenge_id>/status/", views.PushChallengeStatusView.as_view(), name="challenge-status"),
    path("challenge/<str:challenge_id>/approve/", views.PushChallengeApproveView.as_view(), name="challenge-approve"),
    path("challenge/<str:challenge_id>/deny/", views.PushChallengeDenyView.as_view(), name="challenge-deny"),
    # Forgot PIN recovery flow (3-step: initiate -> verify OTP -> reset)
    path("forgot-pin/", views.ForgotPINView.as_view(), name="forgot-pin"),
    path("forgot-pin/verify/", views.VerifyPINResetOTPView.as_view(), name="forgot-pin-verify"),
    path("reset-pin/", views.ResetPINView.as_view(), name="reset-pin"),
    # Admin endpoints (staff only)
    path("admin/users/", views.AdminUserListView.as_view(), name="admin-users"),
    path("admin/users/<uuid:user_id>/verify/", views.AdminVerifyUserView.as_view(), name="admin-verify-user"),
    path("admin/users/<uuid:user_id>/suspend/", views.AdminSuspendUserView.as_view(), name="admin-suspend-user"),
    path("admin/users/<uuid:user_id>/detail/", views.AdminUserDetailView.as_view(), name="admin-user-detail"),
    path("admin/kyc/<uuid:doc_id>/review/", views.AdminReviewKYCView.as_view(), name="admin-review-kyc"),
    # Super admin only — staff promotion/demotion
    path("admin/users/<uuid:user_id>/promote/", views.AdminPromoteStaffView.as_view(), name="admin-promote-staff"),
]
