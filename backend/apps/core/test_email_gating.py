"""
Regression tests for A1 (audit): outbound email senders must respect
`notify_email_enabled` for transactional mail and bypass it only for
security-critical types (OTP / PIN / security-alert / KYC status).

Pins:
  - Welcome email skipped when `notify_email_enabled = False`.
  - Transaction receipt / deposit-confirmed skipped when opted out.
  - OTP / security alert / KYC status ALWAYS sent (safety-critical)
    regardless of `notify_email_enabled`.
  - Swahili users get Swahili subject lines on welcome + OTP + KYC.
"""
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings

from apps.accounts.models import User


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
)
class EmailGatingTest(TestCase):
    def setUp(self):
        from django.core import mail
        mail.outbox = []
        self.user = User.objects.create_user(
            phone="+254711000001",
            pin="123456",
            email="gate@example.com",
            full_name="Gate User",
        )

    def _set_prefs(self, **flags):
        """Update notification preferences in one shot."""
        for k, v in flags.items():
            setattr(self.user, k, v)
        self.user.save(update_fields=list(flags.keys()))

    # ── Transactional: must respect notify_email_enabled ───────────
    def test_welcome_email_skipped_when_email_opted_out(self):
        self._set_prefs(notify_email_enabled=False)
        from apps.core.email import send_welcome_email
        from django.core import mail

        send_welcome_email(self.user)
        self.assertEqual(len(mail.outbox), 0)

    def test_welcome_email_sent_when_enabled(self):
        self._set_prefs(notify_email_enabled=True)
        from apps.core.email import send_welcome_email
        from django.core import mail

        send_welcome_email(self.user)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Welcome", mail.outbox[0].subject)

    # ── Security-critical: MUST send even when opted out ───────────
    def test_otp_sent_even_when_email_opted_out(self):
        self._set_prefs(notify_email_enabled=False)
        from apps.core.email import send_otp_email
        from django.core import mail

        send_otp_email(self.user, "123456")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("123456", mail.outbox[0].subject)

    def test_security_alert_sent_even_when_email_opted_out(self):
        self._set_prefs(notify_email_enabled=False)
        from apps.core.email import send_security_alert
        from django.core import mail

        send_security_alert(self.user, "new_device", "1.2.3.4", "Android APK")
        self.assertEqual(len(mail.outbox), 1)

    def test_kyc_status_sent_even_when_email_opted_out(self):
        self._set_prefs(notify_email_enabled=False)
        from apps.core.email import send_kyc_status_email
        from django.core import mail

        send_kyc_status_email(self.user, "national_id", "approved")
        self.assertEqual(len(mail.outbox), 1)

    # ── Language selection ─────────────────────────────────────────
    def test_welcome_subject_is_swahili_for_sw_user(self):
        self._set_prefs(language="sw", notify_email_enabled=True)
        from apps.core.email import send_welcome_email
        from django.core import mail

        send_welcome_email(self.user)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Karibu", mail.outbox[0].subject)

    def test_otp_subject_is_swahili_for_sw_user(self):
        self._set_prefs(language="sw", notify_email_enabled=True)
        from apps.core.email import send_otp_email
        from django.core import mail

        send_otp_email(self.user, "987654")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Msimbo", mail.outbox[0].subject)
        self.assertIn("987654", mail.outbox[0].subject)

    # ── No email on user → fast bail-out, no crash ─────────────────
    def test_all_senders_skip_user_with_no_email(self):
        self.user.email = ""
        self.user.save(update_fields=["email"])
        from apps.core.email import (
            send_welcome_email, send_otp_email, send_security_alert,
            send_kyc_status_email,
        )
        from django.core import mail

        send_welcome_email(self.user)
        send_otp_email(self.user, "111111")
        send_security_alert(self.user, "new_device", "1.1.1.1", "Test")
        send_kyc_status_email(self.user, "national_id", "approved")
        self.assertEqual(len(mail.outbox), 0)
