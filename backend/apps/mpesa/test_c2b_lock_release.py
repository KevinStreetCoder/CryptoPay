"""
Regression test for A5 (audit): C2BValidationView was holding the
per-user daily-limit Redis lock for the full 30 s TTL because the
returned `DailyLimitLock` handle was dropped. Every user who paid a
Paybill self-locked their own account for 30 s, making the next
payment attempt fail with "Please wait and try again".

Post-fix: the view uses the lock's context-manager form so it's
released immediately after validation (the C2B confirmation callback
creates the actual Transaction on a separate request path).
"""
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase

from apps.accounts.models import User


class C2BValidationLockReleaseTest(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            phone="+254733000000", pin="123456", kyc_tier=1,
        )

    def test_validation_releases_daily_limit_lock(self):
        """After a successful C2B validation, the per-user daily-limit
        Redis lock must NOT be held — the user must be able to hit
        another limit-gated codepath immediately."""
        from apps.payments.services import check_daily_limit

        # Simulate the view's flow: enter + exit the context manager.
        with check_daily_limit(self.user, Decimal("500")):
            pass  # C2B validation does no Transaction work here.

        # The same user should be able to acquire the lock again
        # right away — if the bug comes back, this raises
        # DailyLimitExceededError("Please wait and try again").
        lock_key = f"daily_limit_check:{self.user.id}"
        self.assertIsNone(cache.get(lock_key))

        with check_daily_limit(self.user, Decimal("500")):
            # Lock is held INSIDE the block. That's intentional.
            self.assertIsNotNone(cache.get(lock_key))
        # And released on exit.
        self.assertIsNone(cache.get(lock_key))

    def test_validation_releases_lock_on_exception(self):
        """If the caller raises inside the `with`, the lock still
        gets released — crucial so a downstream bug doesn't strand
        every user behind a 30 s lockout."""
        from apps.payments.services import check_daily_limit

        try:
            with check_daily_limit(self.user, Decimal("500")):
                raise ValueError("simulated downstream failure")
        except ValueError:
            pass

        lock_key = f"daily_limit_check:{self.user.id}"
        self.assertIsNone(cache.get(lock_key))
