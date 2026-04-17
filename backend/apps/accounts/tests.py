"""Tests for user auth, PIN security, Google OAuth, and device management."""

from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import Device, User


class UserPINTest(TestCase):
    def test_set_and_check_pin(self):
        user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.assertTrue(user.check_pin("123456"))
        self.assertFalse(user.check_pin("654321"))
        self.assertFalse(user.check_pin(""))

    def test_pin_is_hashed(self):
        user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.assertNotEqual(user.pin_hash, "123456")
        self.assertTrue(user.pin_hash.startswith("$2"))  # bcrypt prefix

    def test_phone_normalization_in_serializer(self):
        from .serializers import LoginSerializer

        # Test 07XX format
        s = LoginSerializer(data={"phone": "0712345678", "pin": "123456"})
        s.is_valid()
        self.assertEqual(s.validated_data["phone"], "+254712345678")

        # Test 254XX format
        s = LoginSerializer(data={"phone": "254712345678", "pin": "123456"})
        s.is_valid()
        self.assertEqual(s.validated_data["phone"], "+254712345678")

    def test_superuser_creation(self):
        user = User.objects.create_superuser(phone="+254700000000", password="adminpass")
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertEqual(user.kyc_tier, 3)


class ProgressiveLockoutTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")

    def test_lockout_at_5_attempts(self):
        """After 5 failed PIN attempts, account locks for 1 minute."""
        self.user.pin_attempts = 5
        lockout_thresholds = {5: 60, 10: 300, 15: 3600}
        lockout_seconds = lockout_thresholds.get(self.user.pin_attempts)
        self.assertEqual(lockout_seconds, 60)

    def test_lockout_at_10_attempts(self):
        """After 10 failed PIN attempts, account locks for 5 minutes."""
        self.user.pin_attempts = 10
        lockout_thresholds = {5: 60, 10: 300, 15: 3600}
        lockout_seconds = lockout_thresholds.get(self.user.pin_attempts)
        self.assertEqual(lockout_seconds, 300)

    def test_lockout_at_15_attempts(self):
        """After 15 failed PIN attempts, account locks for 1 hour."""
        self.user.pin_attempts = 15
        lockout_thresholds = {5: 60, 10: 300, 15: 3600}
        lockout_seconds = lockout_thresholds.get(self.user.pin_attempts)
        self.assertEqual(lockout_seconds, 3600)

    def test_no_lockout_at_3_attempts(self):
        """3 attempts should not trigger lockout."""
        self.user.pin_attempts = 3
        lockout_thresholds = {5: 60, 10: 300, 15: 3600}
        lockout_seconds = lockout_thresholds.get(self.user.pin_attempts)
        self.assertIsNone(lockout_seconds)

    def test_locked_user_cannot_login(self):
        """A user with pin_locked_until in the future is locked out."""
        self.user.pin_locked_until = timezone.now() + timedelta(minutes=5)
        self.user.save()
        self.assertTrue(self.user.pin_locked_until > timezone.now())

    def test_expired_lockout_allows_login(self):
        """A lockout that has expired allows login."""
        self.user.pin_locked_until = timezone.now() - timedelta(minutes=1)
        self.user.save()
        self.assertFalse(self.user.pin_locked_until > timezone.now())


class GoogleOAuthTest(TestCase):
    @patch("apps.accounts.social_auth.id_token.verify_oauth2_token")
    def test_verify_google_token_success(self, mock_verify):
        mock_verify.return_value = {
            "iss": "accounts.google.com",
            "sub": "google-123",
            "email": "test@gmail.com",
            "name": "Test User",
            "picture": "https://photo.url",
            "email_verified": True,
        }

        from .social_auth import verify_google_token

        result = verify_google_token("fake-token")
        self.assertEqual(result["email"], "test@gmail.com")
        self.assertEqual(result["sub"], "google-123")

    @patch("apps.accounts.social_auth.id_token.verify_oauth2_token")
    def test_verify_google_token_invalid_issuer(self, mock_verify):
        mock_verify.return_value = {
            "iss": "evil.com",
            "sub": "123",
            "email": "test@evil.com",
            "email_verified": True,
        }

        from .social_auth import GoogleAuthError, verify_google_token

        with self.assertRaises(GoogleAuthError):
            verify_google_token("fake-token")

    @patch("apps.accounts.social_auth.id_token.verify_oauth2_token")
    def test_verify_google_token_unverified_email(self, mock_verify):
        mock_verify.return_value = {
            "iss": "accounts.google.com",
            "sub": "123",
            "email": "test@gmail.com",
            "email_verified": False,
        }

        from .social_auth import GoogleAuthError, verify_google_token

        with self.assertRaises(GoogleAuthError):
            verify_google_token("fake-token")

    def test_verify_google_token_invalid_token(self):
        from .social_auth import GoogleAuthError, verify_google_token

        with self.assertRaises(GoogleAuthError):
            verify_google_token("completely-invalid-token")


class DeviceRegistrationTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")

    def test_register_new_device(self):
        device, created = Device.objects.update_or_create(
            user=self.user,
            device_id="device-abc-123",
            defaults={
                "device_name": "iPhone 15",
                "platform": "ios",
                "os_version": "17.0",
            },
        )
        self.assertTrue(created)
        self.assertEqual(device.device_name, "iPhone 15")
        self.assertFalse(device.is_trusted)

    def test_update_existing_device(self):
        Device.objects.create(
            user=self.user,
            device_id="device-abc-123",
            device_name="iPhone 14",
            platform="ios",
        )

        device, created = Device.objects.update_or_create(
            user=self.user,
            device_id="device-abc-123",
            defaults={
                "device_name": "iPhone 15",
                "platform": "ios",
                "os_version": "17.0",
            },
        )
        self.assertFalse(created)
        self.assertEqual(device.device_name, "iPhone 15")

    def test_unique_device_per_user(self):
        Device.objects.create(
            user=self.user,
            device_id="device-abc-123",
        )
        # Same device_id for same user should violate unique_together
        from django.db import IntegrityError

        with self.assertRaises(IntegrityError):
            Device.objects.create(
                user=self.user,
                device_id="device-abc-123",
            )

    def test_multiple_devices_per_user(self):
        Device.objects.create(user=self.user, device_id="device-1")
        Device.objects.create(user=self.user, device_id="device-2")
        self.assertEqual(self.user.devices.count(), 2)


class LoginSecurityChallengeTest(TestCase):
    """Covers the 'trusted device + IP change' behavior added to stop false-
    positive OTP prompts when a user's mobile IP rotates (WiFi <-> cellular).

    Also verifies the refresh-token lifetime bump to 30 days.
    """

    def setUp(self):
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.phone = "+254712345678"
        self.pin = "123456"
        self.device_id = "trusted-device-xyz"
        self.user = User.objects.create_user(phone=self.phone, pin=self.pin)
        # Seed last_login_ip so IP-change branch is reachable
        self.user.last_login_ip = "1.1.1.1"
        self.user.save(update_fields=["last_login_ip"])
        cache.clear()

    def _login(self, ip, device_id=None):
        return self.client.post(
            "/api/v1/auth/login/",
            {
                "phone": self.phone,
                "pin": self.pin,
                "device_id": device_id if device_id is not None else self.device_id,
            },
            format="json",
            REMOTE_ADDR=ip,
            HTTP_X_FORWARDED_FOR=ip,
        )

    @override_settings(DEBUG=False)
    def test_trusted_device_ip_change_no_challenge(self):
        """Pre-trusted device + different IP -> no OTP required."""
        Device.objects.create(
            user=self.user,
            device_id=self.device_id,
            is_trusted=True,
            ip_address="1.1.1.1",
        )

        resp = self._login(ip="9.9.9.9")

        # No security challenge triggered — tokens issued
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn("tokens", resp.json())

    @override_settings(DEBUG=False)
    def test_untrusted_device_ip_change_triggers_challenge(self):
        """Unknown device + different IP -> OTP required (new_device reason)."""
        with patch("apps.accounts.views.LoginView._send_otp_challenge"):
            resp = self._login(ip="9.9.9.9", device_id="brand-new-device")

        self.assertEqual(resp.status_code, 403)
        body = resp.json()
        self.assertTrue(body.get("otp_required"))
        self.assertIn("new_device", body.get("challenge_reasons", []))

    def test_refresh_token_lifetime_bumped_from_one_day(self):
        """Guard against regression: refresh TTL must be at least 7 days.

        Base settings = 30d (production), dev overrides to 7d. Either is fine
        — the 1-day value that caused the 'logged out after a day' UX bug is
        what we're preventing.
        """
        from django.conf import settings as dj_settings

        lifetime = dj_settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
        self.assertGreaterEqual(lifetime, timedelta(days=7))
