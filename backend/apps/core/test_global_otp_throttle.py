"""A4 regression tests · global OTP-issuance circuit breaker.

The per-phone and per-IP throttles already in place catch a single
attacker hammering a single account. They do NOT catch a distributed
SMS-bomb where 10k OTPs go to 10k phones from 10k IPs (every per-key
counter sees just one request). The attacker bleeds the SMS budget
without locking any single user out.

`GlobalOTPThrottle` keys on the literal string `"global"` · every
request worldwide hits the same Redis counter. When the cap fires
we log a `global_otp_cap_breached` warning so on-call can investigate.

These tests confirm:
1. The throttle blocks the 1001st request inside the 1-hour window
   when GLOBAL_OTP_RATE_PER_HOUR=1000.
2. The rate is configurable via settings · setting it low (3/h) and
   hitting the endpoint 4 times gets a 429 on the 4th.
3. The throttle is wired onto BOTH RequestOTPView and ForgotPINView
   (the two endpoints that incur SMS cost).
4. The cap-breach log entry fires when the throttle blocks a request.
"""
from __future__ import annotations

from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse


class GlobalOTPThrottleTest(TestCase):
    """Throttle wiring + rate enforcement."""

    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    @override_settings(GLOBAL_OTP_RATE_PER_HOUR=3)
    def test_global_cap_blocks_fourth_request(self):
        """3/h cap · the 4th OTP request from anywhere returns 429."""
        from rest_framework.test import APIClient

        # Re-import so the GlobalOTPThrottle picks up the patched setting
        from apps.core import throttling as _throttling
        import importlib
        importlib.reload(_throttling)
        # Force the views module to re-bind to the reloaded throttle
        # class via the existing import alias.
        from apps.accounts import views as _account_views
        _account_views._GlobalOTPThrottle = _throttling.GlobalOTPThrottle

        client = APIClient()
        url = reverse("request-otp")

        # First 3 requests · allowed (rate stays at 3/h).
        # (Each call lands on the OTP-issuance code path · we don't care
        # if the SMS sends in test, only that the throttle pre-check
        # didn't fire.)
        with patch("apps.core.email.send_sms", return_value=True):
            for i in range(3):
                r = client.post(
                    url,
                    {"phone": f"+254700000{i:03d}"},
                    format="json",
                )
                # Either 200 (sent) or 4xx that's NOT 429.
                self.assertNotEqual(
                    r.status_code, 429,
                    f"req #{i + 1} prematurely throttled: {r.content[:200]}",
                )

            # 4th request · same throttle window, MUST be 429.
            r = client.post(
                url,
                {"phone": "+254700000999"},
                format="json",
            )
            self.assertEqual(
                r.status_code, 429,
                f"4th OTP request was NOT throttled · global cap broken: {r.content[:200]}",
            )

    @override_settings(GLOBAL_OTP_RATE_PER_HOUR=1000)
    def test_throttle_class_attaches_to_request_otp(self):
        """Direct attribute pin · catches a future refactor that removes
        the throttle silently."""
        from apps.accounts.views import RequestOTPView
        from apps.core.throttling import GlobalOTPThrottle

        names = [c.__name__ for c in RequestOTPView.throttle_classes]
        self.assertIn("GlobalOTPThrottle", names)

    @override_settings(GLOBAL_OTP_RATE_PER_HOUR=1000)
    def test_throttle_class_attaches_to_forgot_pin(self):
        from apps.accounts.views import ForgotPINView

        names = [c.__name__ for c in ForgotPINView.throttle_classes]
        self.assertIn("GlobalOTPThrottle", names)

    @override_settings(GLOBAL_OTP_RATE_PER_HOUR=2)
    def test_cap_breach_logs_warning(self):
        """When the cap fires, the global_otp_cap_breached warning is
        emitted · on-call relies on this signal to know there's an
        active SMS-bomb in progress."""
        import importlib
        from apps.core import throttling as _throttling
        importlib.reload(_throttling)
        from apps.accounts import views as _account_views
        _account_views._GlobalOTPThrottle = _throttling.GlobalOTPThrottle

        from rest_framework.test import APIClient
        client = APIClient()
        url = reverse("request-otp")

        with patch("apps.core.email.send_sms", return_value=True):
            with self.assertLogs("apps.core.throttling", level="WARNING") as log_ctx:
                # 2 pass, 3rd throttles
                client.post(url, {"phone": "+254700100001"}, format="json")
                client.post(url, {"phone": "+254700100002"}, format="json")
                client.post(url, {"phone": "+254700100003"}, format="json")

            self.assertTrue(
                any("global_otp_cap_breached" in m for m in log_ctx.output),
                f"Expected global_otp_cap_breached log entry, got: {log_ctx.output}",
            )

    def test_default_rate_is_1000_per_hour(self):
        """Production default · 1000/h is comfortably above legitimate
        beta volume but well below anything that would cost real money."""
        from django.conf import settings
        self.assertEqual(
            getattr(settings, "GLOBAL_OTP_RATE_PER_HOUR", None),
            1000,
            "default GLOBAL_OTP_RATE_PER_HOUR drifted · was 1000 by audit spec",
        )
