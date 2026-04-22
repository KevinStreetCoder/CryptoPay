"""
Regression tests for the 08:00 EAT daily-summary email Celery task.

Historical bug (2026-04-22): the task queried `User.date_joined`, a field
that exists on Django's `AbstractUser` but NOT on our `AbstractBaseUser`
subclass. Every run raised FieldError, got swallowed by a bare except,
and the admin email showed "New Users Today: N/A" even when real users
had signed up. The user who registered "around 2pm" never got counted.

Extended 2026-04-22 (pm): the summary now also reports total users,
login counts (total / unique / new-device / failed), and activity
(active-24h + online-now). Subject dropped the "[Django] " prefix.
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import AuditLog, User


@override_settings(
    ADMINS=[("Ops", "ops@cpay.co.ke")],
    EMAIL_SUBJECT_PREFIX="",
)
class DailySummaryEmailTest(TestCase):
    """Task returns real counts, not the legacy "N/A" sentinel."""

    def setUp(self):
        mail.outbox = []

    def test_new_users_count_reflects_last_24h(self):
        """A user created 2h ago should show up in the 8:00 AM summary."""
        # Registered "around 2pm" yesterday (i.e. 18 hours before the task
        # fires at 8 AM today) — must be counted.
        fresh_user = User.objects.create_user(
            phone="+254711000111",
            pin="123456",
        )
        User.objects.filter(id=fresh_user.id).update(
            created_at=timezone.now() - timedelta(hours=18),
        )

        # An older user outside the 24h window — must NOT be counted as "new"
        # but still counted in the total-users figure.
        old_user = User.objects.create_user(
            phone="+254711000222",
            pin="123456",
        )
        User.objects.filter(id=old_user.id).update(
            created_at=timezone.now() - timedelta(days=8),
        )

        from apps.core.tasks import daily_summary_email

        result = daily_summary_email.apply().result

        # The real bug: this used to be the string "N/A". Now it must be int.
        self.assertIsInstance(result["new_users"], int)
        self.assertEqual(result["new_users"], 1)
        # Total users is the new cumulative count
        self.assertEqual(result["total_users"], 2)

    def test_no_users_returns_zero_not_na(self):
        """Empty DB → integer 0, never the string "N/A"."""
        from apps.core.tasks import daily_summary_email

        result = daily_summary_email.apply().result
        self.assertIsInstance(result["new_users"], int)
        self.assertIsInstance(result["total_users"], int)
        self.assertEqual(result["new_users"], 0)
        self.assertEqual(result["total_users"], 0)

    def test_new_users_appears_in_email_body(self):
        """End-to-end: the counts are rendered in the outgoing email."""
        User.objects.create_user(phone="+254711000333", pin="123456")
        User.objects.create_user(phone="+254711000444", pin="123456")
        User.objects.create_user(phone="+254711000555", pin="123456")

        from apps.core.tasks import daily_summary_email

        daily_summary_email.apply()

        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        # Professional subject line — no "Django" prefix
        self.assertNotIn("[Django]", message.subject)
        self.assertIn("CPay", message.subject)
        self.assertIn("Daily Operations Summary", message.subject)

        # Plain text body shows both total + new
        self.assertIn("Total users:", message.body)
        self.assertIn("New users (24 h):", message.body)
        self.assertIn("3", message.body)  # 3 users total AND 3 new

        # HTML alternative mirrors the same figures
        for alternative, mime in getattr(message, "alternatives", []):
            if "html" in mime.lower():
                self.assertIn("Total Users", alternative)
                self.assertIn("New Users", alternative)
                self.assertNotIn(">N/A<", alternative)

    def test_login_and_activity_counts(self):
        """Login events + activity signals render as integers."""
        # Create users with distinct login fingerprints:
        u_logged = User.objects.create_user(phone="+254711000666", pin="123456")
        u_new_device = User.objects.create_user(phone="+254711000777", pin="123456")
        u_active_only = User.objects.create_user(phone="+254711000888", pin="123456")

        now = timezone.now()

        # u_logged: 1 successful LOGIN within the window
        AuditLog.objects.create(
            user=u_logged, action="LOGIN",
            details={"device_id": "dev-a", "ip": "1.1.1.1", "new_device": False},
            ip_address="1.1.1.1",
        )
        # u_new_device: LOGIN flagged as new_device
        AuditLog.objects.create(
            user=u_new_device, action="LOGIN",
            details={"device_id": "dev-b", "ip": "2.2.2.2", "new_device": True},
            ip_address="2.2.2.2",
        )
        # Two LOGIN_FAILED rows (some attacker or user mistypes)
        AuditLog.objects.create(
            user=None, action="LOGIN_FAILED",
            details={"reason": "wrong_pin"}, ip_address="3.3.3.3",
        )
        AuditLog.objects.create(
            user=None, action="LOGIN_FAILED",
            details={"reason": "wrong_pin"}, ip_address="3.3.3.3",
        )

        # Nudge `last_activity_at` — u_logged was active 2h ago,
        # u_active_only was active 3 min ago (so "online now"), u_new_device
        # got only a login event but never made an authenticated request,
        # so they don't count as active.
        User.objects.filter(id=u_logged.id).update(
            last_activity_at=now - timedelta(hours=2),
        )
        User.objects.filter(id=u_active_only.id).update(
            last_activity_at=now - timedelta(minutes=3),
        )

        from apps.core.tasks import daily_summary_email
        result = daily_summary_email.apply().result

        # Two LOGIN rows, two distinct users
        self.assertEqual(result["logins"], 2)
        self.assertEqual(result["unique_login_users"], 2)

        # Active-24h: u_logged + u_active_only = 2; online-now (≤5 min) = 1
        self.assertEqual(result["active_24h"], 2)
        self.assertEqual(result["online_now"], 1)

    def test_field_rename_logs_error_not_silent_na(self):
        """
        If the User model ever renames `created_at`, the except branch must
        LOG the error (so we notice) even while falling back to N/A.
        """
        from apps.core import tasks as core_tasks

        # Simulate a DB-level failure on the user-count query. Patch .count
        # so both objects.count() AND objects.filter(...).count() blow up.
        original_count = User.objects.count

        def boom(*a, **k):
            raise RuntimeError("simulated DB failure")

        with patch.object(type(User.objects), "count", side_effect=boom):
            with self.assertLogs("apps.core.tasks", level="ERROR") as log_ctx:
                result = core_tasks.daily_summary_email.apply().result

        self.assertEqual(result["new_users"], "N/A")
        self.assertEqual(result["total_users"], "N/A")
        self.assertTrue(
            any("user counts query failed" in msg for msg in log_ctx.output),
            f"Expected error log entry, got: {log_ctx.output}",
        )
