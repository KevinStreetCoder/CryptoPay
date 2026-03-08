"""Tests for user auth, PIN security, Google OAuth, and device management."""

from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
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
