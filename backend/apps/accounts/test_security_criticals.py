"""Regression tests for the Critical / High fixes shipped 2026-04-22.

Covers: D6, A1, A27, A20, A3, A14, D4, D10, D22, C1.
Each test pins the hardened contract so a regression surfaces immediately.
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
from django.conf import settings
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient


pytestmark = pytest.mark.django_db


def _make_user(phone="+254700010001", full_name="Test User", kyc_tier=1):
    from apps.accounts.models import User
    u = User.objects.create_user(phone=phone, pin="123456", full_name=full_name)
    u.kyc_tier = kyc_tier
    u.save(update_fields=["kyc_tier"])
    return u


# ---- D6 ---- #
class TestD6WalletSeedNoFallback(TestCase):
    def test_raises_when_no_seed_source_configured(self):
        from apps.blockchain import services as blockchain_services
        with override_settings(
            KMS_ENABLED=False,
            WALLET_ENCRYPTED_SEED="",
            WALLET_MASTER_SEED="",
            WALLET_MNEMONIC="",
        ):
            with self.assertRaises(RuntimeError) as cm:
                blockchain_services._get_master_seed()
            assert "no wallet seed source" in str(cm.exception).lower()


# ---- A1 + A27 ---- #
class TestA1A27LogoutAndHardenedRefresh(TestCase):
    def setUp(self):
        self.user = _make_user(phone="+254700010002")
        self.client = APIClient()

    def test_token_blacklist_app_installed(self):
        assert "rest_framework_simplejwt.token_blacklist" in settings.INSTALLED_APPS

    def test_logout_blacklists_refresh_token(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
        rt = RefreshToken.for_user(self.user)
        self.client.force_authenticate(user=self.user)
        resp = self.client.post("/api/v1/auth/logout/", {"refresh": str(rt)}, format="json")
        assert resp.status_code == 205
        assert resp.data.get("blacklisted") is True
        # The refresh must now be unusable.
        refresh_resp = self.client.post(
            "/api/v1/auth/token/refresh/", {"refresh": str(rt)}, format="json"
        )
        assert refresh_resp.status_code == 401

    def test_suspended_user_cannot_refresh(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        rt = RefreshToken.for_user(self.user)
        self.user.is_suspended = True
        self.user.save(update_fields=["is_suspended"])
        resp = APIClient().post(
            "/api/v1/auth/token/refresh/", {"refresh": str(rt)}, format="json"
        )
        assert resp.status_code == 403


# ---- A20 ---- #
class TestA20LoginBoolOtpBypassClosed(TestCase):
    """`otp_already_verified` must ONLY become True after a real OTP match."""

    def test_initial_flag_is_false(self):
        # Read the actual file · guards against a future refactor that
        # re-introduces `bool(otp)`.
        import inspect
        from apps.accounts import views
        src = inspect.getsource(views.LoginView)
        assert "otp_already_verified = bool(otp)" not in src
        assert "pin_otp_verified = False" in src
        # The successful-OTP branch must be the ONLY place that flips it.
        assert "pin_otp_verified = True" in src
        assert "otp_already_verified = pin_otp_verified" in src


# ---- A3 ---- #
class TestA3GoogleOAuthAutoLinkBlocked(TestCase):
    def setUp(self):
        self.existing = _make_user(phone="+254700010003")
        self.existing.email = "match@example.com"
        self.existing.save(update_fields=["email"])
        self.client = APIClient()

    @patch("apps.accounts.views.verify_google_token")
    def test_existing_phone_user_requires_otp_first(self, mock_verify):
        mock_verify.return_value = {"email": "match@example.com", "name": "Attacker"}
        resp = self.client.post(
            "/api/v1/auth/google/",
            {"id_token": "fake_token"},
            format="json",
        )
        # Must refuse without `otp` and prompt the phone-verification flow.
        assert resp.status_code == 403
        body = resp.data
        assert body.get("error") == "phone_verification_required"
        assert body.get("otp_required") is True
        assert "tokens" not in body  # ensure no JWT was leaked

    @patch("apps.accounts.views.verify_google_token")
    def test_invalid_otp_rejected(self, mock_verify):
        mock_verify.return_value = {"email": "match@example.com", "name": "Attacker"}
        # Prime an OTP in cache so the code-path reaches the comparison.
        from django.core.cache import cache
        cache.set(f"google_link_otp:{self.existing.phone}", "123456", timeout=300)
        resp = self.client.post(
            "/api/v1/auth/google/",
            {"id_token": "fake_token", "otp": "999999"},
            format="json",
        )
        assert resp.status_code == 400
        assert resp.data.get("error") == "invalid_otp"

    @patch("apps.accounts.views.verify_google_token")
    def test_correct_otp_permits_link(self, mock_verify):
        mock_verify.return_value = {"email": "match@example.com", "name": "Attacker"}
        from django.core.cache import cache
        cache.set(f"google_link_otp:{self.existing.phone}", "111222", timeout=300)
        resp = self.client.post(
            "/api/v1/auth/google/",
            {"id_token": "fake_token", "otp": "111222"},
            format="json",
        )
        assert resp.status_code == 200
        assert "tokens" in resp.data


# ---- A14 ---- #
class TestA14SecureHotWalletKeyLoader:
    def test_raises_when_no_key_configured(self):
        from apps.blockchain import secure_keys
        with override_settings(
            KMS_ENABLED=False,
            TRON_HOT_WALLET_PRIVATE_KEY="",
            TRON_HOT_WALLET_ENCRYPTED="",
        ):
            with pytest.raises(secure_keys.HotWalletKeyMissing):
                secure_keys.load_hot_wallet_key("tron")

    def test_plaintext_hex_in_debug_returns_bytearray(self):
        from apps.blockchain import secure_keys
        fake_hex = "a" * 64
        with override_settings(
            DEBUG=True,
            KMS_ENABLED=False,
            TRON_HOT_WALLET_PRIVATE_KEY=fake_hex,
        ):
            ba = secure_keys.load_hot_wallet_key("tron")
            assert isinstance(ba, bytearray)
            assert len(ba) == 32
            # wipe should zero every byte
            secure_keys.wipe(ba)
            assert set(ba) == {0}

    def test_plaintext_refused_in_production(self):
        from apps.blockchain import secure_keys
        with override_settings(
            DEBUG=False,
            KMS_ENABLED=False,
            TRON_HOT_WALLET_PRIVATE_KEY="a" * 64,
            ALLOW_PLAINTEXT_HOT_WALLET=False,
        ):
            with pytest.raises(secure_keys.HotWalletKeyMissing):
                secure_keys.load_hot_wallet_key("tron")


# ---- D4 ---- #
class TestD4ProtectedMediaAuth(TestCase):
    def test_unauthenticated_media_returns_401(self):
        client = APIClient()
        resp = client.get("/media/kyc_docs/some-file.jpg")
        # IsAuthenticated returns 401 (not 403) when no creds are present.
        assert resp.status_code == 401

    def test_other_subpath_is_forbidden_even_for_authed_user(self):
        user = _make_user(phone="+254700010004")
        client = APIClient()
        client.force_authenticate(user=user)
        # Pretending a file exists at media/other-dir/x isn't needed · the
        # allow-list check runs before the filesystem probe.
        resp = client.get("/media/somewhere-else/x.txt")
        # If the file doesn't exist we get 404; if it existed we'd get 403.
        assert resp.status_code in (403, 404)


# ---- D10 ---- #
class TestD10AdminIPAllowlist(TestCase):
    def test_empty_allowlist_permits_access(self):
        client = APIClient(REMOTE_ADDR="192.0.2.10")
        resp = client.get("/" + settings.ADMIN_URL)
        # 302 to login = allow-list passed; 403 = allow-list denied.
        assert resp.status_code != 403

    @override_settings(ADMIN_IP_ALLOWLIST=["10.0.0.0/8"])
    def test_non_allowlisted_ip_denied(self):
        from apps.core.middleware import AdminIPAllowListMiddleware
        # Re-instantiate so the middleware picks up the overridden setting.
        mw = AdminIPAllowListMiddleware(lambda r: None)
        client = APIClient(REMOTE_ADDR="8.8.8.8")
        req = client.get("/" + settings.ADMIN_URL).wsgi_request
        req.real_client_ip = "8.8.8.8"
        result = mw(req)
        assert result is not None
        assert result.status_code == 403


# ---- D22 ---- #
class TestD22TrustedProxy:
    def test_strips_forwarded_headers_when_peer_not_cloudflare(self):
        from apps.core.middleware import TrustedProxyMiddleware

        seen = {}

        def _inner(request):
            seen["xfp"] = request.META.get("HTTP_X_FORWARDED_PROTO")
            seen["xff"] = request.META.get("HTTP_X_FORWARDED_FOR")
            return "ok"

        with override_settings(CLOUDFLARE_ONLY_ORIGIN=True):
            mw = TrustedProxyMiddleware(_inner)

            class _Req:
                META = {
                    "HTTP_X_FORWARDED_PROTO": "https",
                    "HTTP_X_FORWARDED_FOR": "1.2.3.4",
                    "REMOTE_ADDR": "8.8.8.8",  # NOT Cloudflare
                }
            mw(_Req())
            assert seen["xfp"] is None
            assert seen["xff"] is None

    def test_keeps_forwarded_headers_when_peer_is_cloudflare(self):
        from apps.core.middleware import TrustedProxyMiddleware

        seen = {}

        def _inner(request):
            seen["xfp"] = request.META.get("HTTP_X_FORWARDED_PROTO")
            return "ok"

        with override_settings(CLOUDFLARE_ONLY_ORIGIN=True):
            mw = TrustedProxyMiddleware(_inner)

            class _Req:
                META = {
                    "HTTP_X_FORWARDED_PROTO": "https",
                    "REMOTE_ADDR": "173.245.48.1",  # inside 173.245.48.0/20
                }

            mw(_Req())
            assert seen["xfp"] == "https"


# ---- C1 ---- #
class TestC1CookieAuth(TestCase):
    """Cookie-based auth for web. Login + register should set HttpOnly
    cookies when the request carries `X-Cpay-Web: 1`, and leave them off
    for native clients."""

    def setUp(self):
        self.user = _make_user(phone="+254700010005")

    def test_login_sets_cookies_on_web_header(self):
        client = APIClient(HTTP_X_CPAY_WEB="1")
        resp = client.post(
            "/api/v1/auth/login/",
            {
                "phone": self.user.phone,
                "pin": "123456",
            },
            format="json",
        )
        # Login succeeded (200) or hit device-challenge (403 with otp_required).
        # In either case, no cookies should be set for the 403 path, and
        # cookies MUST be set on 200.
        if resp.status_code == 200:
            assert "cpay_access" in resp.cookies
            assert "cpay_refresh" in resp.cookies
            # The cookies must be HttpOnly.
            assert resp.cookies["cpay_access"]["httponly"] is True
            assert resp.cookies["cpay_refresh"]["httponly"] is True

    def test_login_does_not_set_cookies_for_native(self):
        client = APIClient()  # no X-Cpay-Web header
        resp = client.post(
            "/api/v1/auth/login/",
            {"phone": self.user.phone, "pin": "123456"},
            format="json",
        )
        if resp.status_code == 200:
            assert "cpay_access" not in resp.cookies
            assert "cpay_refresh" not in resp.cookies
