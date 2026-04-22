"""
Regression tests for the 08:00 EAT daily-summary email Celery task.

Historical bug (2026-04-22): the task queried `User.date_joined`, a field
that exists on Django's `AbstractUser` but NOT on our `AbstractBaseUser`
subclass. Every run raised FieldError, got swallowed by a bare except,
and the admin email showed "New Users Today: N/A" even when real users
had signed up. The user who registered "around 2pm" never got counted.

This test pins the contract: the task must return a real integer count
that matches how many User rows were created within the last 24 hours,
and must keep working when additional users arrive mid-window.
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import User


@override_settings(ADMINS=[("Ops", "ops@cpay.co.ke")])
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

        # An older user outside the 24h window — must NOT be counted.
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

    def test_no_users_returns_zero_not_na(self):
        """Empty DB → integer 0, never the string "N/A"."""
        from apps.core.tasks import daily_summary_email

        result = daily_summary_email.apply().result
        self.assertIsInstance(result["new_users"], int)
        self.assertEqual(result["new_users"], 0)

    def test_new_users_appears_in_email_body(self):
        """End-to-end: the count is rendered in the outgoing email."""
        User.objects.create_user(phone="+254711000333", pin="123456")
        User.objects.create_user(phone="+254711000444", pin="123456")
        User.objects.create_user(phone="+254711000555", pin="123456")

        from apps.core.tasks import daily_summary_email

        daily_summary_email.apply()

        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        # Plain text body must show the real count
        self.assertIn("New users: 3", message.body)
        # HTML alternative (if attached) must also show the count & NOT "N/A"
        for alternative, mime in getattr(message, "alternatives", []):
            if "html" in mime.lower():
                self.assertIn("3", alternative)
                self.assertNotIn(">N/A<", alternative)

    def test_field_rename_logs_error_not_silent_na(self):
        """
        If the User model ever renames `created_at`, the except branch must
        LOG the error (so we notice) even while falling back to N/A.
        """
        from apps.core import tasks as core_tasks

        # Simulate a DB-level failure on the new-users query. Patch the
        # UserManager's `.objects` so the .filter() chain raises. We patch
        # at the QuerySet.count level.
        with patch.object(
            User.objects, "filter",
            side_effect=RuntimeError("simulated DB failure"),
        ):
            with self.assertLogs("apps.core.tasks", level="ERROR") as log_ctx:
                result = core_tasks.daily_summary_email.apply().result

        self.assertEqual(result["new_users"], "N/A")
        self.assertTrue(
            any("new-users count query failed" in msg for msg in log_ctx.output),
            f"Expected error log entry, got: {log_ctx.output}",
        )
