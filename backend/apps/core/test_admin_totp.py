"""D10 regression tests · admin TOTP enrolment + verification.

What we pin:
  1. ADMIN_REQUIRE_TOTP=False → middleware is a no-op (dev default).
  2. Staff user without totp_enabled → redirected to /admin-totp/setup/
     when hitting any admin URL.
  3. Staff user WITH totp_enabled but no fresh session flag → redirected
     to /admin-totp/verify/.
  4. Staff user with fresh session flag → admin access passes through.
  5. Anonymous + non-staff users are NOT trapped by the middleware
     (Django admin's own auth handles them).
  6. POST to /admin-totp/setup/ with the correct code enables TOTP +
     sets the session flag + redirects to `?next=`.
  7. POST to /admin-totp/verify/ with the correct code sets the session
     flag + redirects to `?next=`.
  8. Open-redirect defence · `?next=//evil.com/foo` is rejected and the
     user lands on the admin root instead.
"""
from __future__ import annotations

import time
from unittest.mock import patch

from django.test import TestCase, RequestFactory, override_settings
from django.urls import reverse

from apps.accounts.models import User
from apps.accounts.totp import generate_totp_secret, verify_totp
from apps.core.middleware import (
    ADMIN_TOTP_FRESHNESS_SECONDS,
    ADMIN_TOTP_SESSION_KEY,
    AdminTOTPRequiredMiddleware,
)


def _make_user(staff=False, totp_enabled=False, totp_secret=""):
    u = User.objects.create_user(phone=f"+25470000{User.objects.count():04d}", pin="123456")
    if staff:
        u.is_staff = True
        u.save(update_fields=["is_staff"])
    if totp_enabled:
        u.totp_enabled = True
        if totp_secret:
            # `set_totp_secret` encrypts under the primary key · the
            # view reads back via the `totp_secret_decrypted` property.
            # Plain assignment would store ciphertext-shape strings
            # without the encryption envelope and break the verify.
            u.set_totp_secret(totp_secret)
        u.save()
    return u


@override_settings(ADMIN_REQUIRE_TOTP=True, ADMIN_URL="cp-admin/")
class AdminTOTPMiddlewareTest(TestCase):
    """Middleware redirect logic · the four states above."""

    def setUp(self):
        self.factory = RequestFactory()

    def _run(self, request):
        called = {"v": False}
        def _next(req):
            called["v"] = True
            from django.http import HttpResponse
            return HttpResponse("admin_passthrough")
        mw = AdminTOTPRequiredMiddleware(_next)
        return mw(request), called["v"]

    def test_anonymous_user_passes_through(self):
        """Unauthenticated · let Django admin handle the login redirect."""
        request = self.factory.get("/cp-admin/")
        from django.contrib.auth.models import AnonymousUser
        request.user = AnonymousUser()
        request.session = {}
        response, called = self._run(request)
        self.assertTrue(called, "anon admin request was wrongly intercepted")

    def test_non_staff_user_passes_through(self):
        """Authenticated non-staff · Django admin returns 403 anyway."""
        request = self.factory.get("/cp-admin/")
        request.user = _make_user(staff=False)
        request.session = {}
        response, called = self._run(request)
        self.assertTrue(called)

    def test_staff_no_totp_redirects_to_setup(self):
        u = _make_user(staff=True, totp_enabled=False)
        request = self.factory.get("/cp-admin/some-page/")
        request.user = u
        request.session = {}
        response, called = self._run(request)
        self.assertFalse(called, "staff w/o TOTP must NOT reach admin")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin-totp/setup/", response["Location"])
        self.assertIn("next=/cp-admin/some-page/", response["Location"])

    def test_staff_with_totp_no_session_flag_redirects_to_verify(self):
        secret = generate_totp_secret()
        u = _make_user(staff=True, totp_enabled=True, totp_secret=secret)
        request = self.factory.get("/cp-admin/")
        request.user = u
        request.session = {}  # no ADMIN_TOTP_SESSION_KEY
        response, called = self._run(request)
        self.assertFalse(called)
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin-totp/verify/", response["Location"])

    def test_staff_with_fresh_session_flag_passes_through(self):
        secret = generate_totp_secret()
        u = _make_user(staff=True, totp_enabled=True, totp_secret=secret)
        request = self.factory.get("/cp-admin/")
        request.user = u
        request.session = {ADMIN_TOTP_SESSION_KEY: int(time.time())}
        response, called = self._run(request)
        self.assertTrue(called, "fresh-session admin request was wrongly intercepted")

    def test_staff_with_stale_session_flag_redirects_to_verify(self):
        """A session that hasn't seen a TOTP verify in > 4 h is stale."""
        secret = generate_totp_secret()
        u = _make_user(staff=True, totp_enabled=True, totp_secret=secret)
        request = self.factory.get("/cp-admin/")
        request.user = u
        request.session = {
            ADMIN_TOTP_SESSION_KEY: int(time.time()) - ADMIN_TOTP_FRESHNESS_SECONDS - 60,
        }
        response, called = self._run(request)
        self.assertFalse(called)
        self.assertIn("/admin-totp/verify/", response["Location"])

    def test_enrolment_paths_are_exempt(self):
        """/admin-totp/setup/ and /admin-totp/verify/ must NOT redirect
        themselves · would be an infinite loop."""
        u = _make_user(staff=True, totp_enabled=False)
        for path in ["/admin-totp/setup/", "/admin-totp/verify/"]:
            request = self.factory.get(path)
            request.user = u
            request.session = {}
            response, called = self._run(request)
            self.assertTrue(called, f"middleware wrongly intercepted {path}")

    @override_settings(ADMIN_REQUIRE_TOTP=False)
    def test_flag_off_makes_middleware_noop(self):
        u = _make_user(staff=True, totp_enabled=False)
        request = self.factory.get("/cp-admin/")
        request.user = u
        request.session = {}
        response, called = self._run(request)
        self.assertTrue(called, "middleware should be no-op when flag is off")


@override_settings(ADMIN_REQUIRE_TOTP=True, ADMIN_URL="cp-admin/")
class AdminTOTPViewsTest(TestCase):
    """End-to-end · setup + verify flow through the real Django view."""

    def setUp(self):
        from django.test import Client
        self.client = Client()

    def test_setup_get_renders_qr(self):
        u = _make_user(staff=True, totp_enabled=False)
        self.client.force_login(u)
        r = self.client.get("/admin-totp/setup/")
        self.assertEqual(r.status_code, 200)
        # QR image is sourced from chart.googleapis.com so the HTML must
        # carry that hostname plus the otpauth:// URI inside its query.
        self.assertIn(b"chart.googleapis.com", r.content)
        self.assertIn(b"otpauth", r.content)
        self.assertIn(b"Set up admin TOTP", r.content)

    def test_setup_post_with_valid_code_enables_totp(self):
        u = _make_user(staff=True, totp_enabled=False)
        self.client.force_login(u)
        # GET once to seed the pending secret in cache.
        self.client.get("/admin-totp/setup/")

        # Extract the secret from the cache the view wrote (it's keyed
        # on user.pk so we can find it without re-implementing the path).
        from django.core.cache import cache
        secret = cache.get(f"admin_totp_pending_secret:{u.pk}")
        self.assertIsNotNone(secret, "view must have cached a pending secret")

        # Generate the legit current TOTP code and submit.
        import pyotp
        code = pyotp.TOTP(secret).now()
        r = self.client.post("/admin-totp/setup/", {"code": code, "next": "/cp-admin/"})

        self.assertEqual(r.status_code, 302)
        self.assertEqual(r["Location"], "/cp-admin/")
        u.refresh_from_db()
        self.assertTrue(u.totp_enabled)
        # Session flag must be set so subsequent admin requests skip the
        # verify step within the freshness window.
        session = self.client.session
        self.assertIn(ADMIN_TOTP_SESSION_KEY, session)

    def test_setup_post_with_wrong_code_re_renders_with_error(self):
        u = _make_user(staff=True, totp_enabled=False)
        self.client.force_login(u)
        self.client.get("/admin-totp/setup/")
        r = self.client.post("/admin-totp/setup/", {"code": "000000"})
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"Wrong code", r.content)
        u.refresh_from_db()
        self.assertFalse(u.totp_enabled)

    def test_verify_post_with_valid_code_sets_session(self):
        secret = generate_totp_secret()
        u = _make_user(staff=True, totp_enabled=True, totp_secret=secret)
        self.client.force_login(u)
        import pyotp
        code = pyotp.TOTP(secret).now()
        r = self.client.post("/admin-totp/verify/", {"code": code, "next": "/cp-admin/"})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r["Location"], "/cp-admin/")
        self.assertIn(ADMIN_TOTP_SESSION_KEY, self.client.session)

    def test_verify_open_redirect_defence(self):
        """`?next=//evil.com/x` must NOT redirect off-host."""
        secret = generate_totp_secret()
        u = _make_user(staff=True, totp_enabled=True, totp_secret=secret)
        self.client.force_login(u)
        import pyotp
        code = pyotp.TOTP(secret).now()
        r = self.client.post(
            "/admin-totp/verify/",
            {"code": code, "next": "//evil.com/x"},
        )
        self.assertEqual(r.status_code, 302)
        # The defence should land on the admin root, NOT evil.com.
        self.assertFalse(
            r["Location"].startswith("//"),
            f"open-redirect breach · location={r['Location']}",
        )
        self.assertFalse(
            "evil.com" in r["Location"],
            f"open-redirect breach · location={r['Location']}",
        )

    def test_non_staff_cannot_use_setup(self):
        u = _make_user(staff=False, totp_enabled=False)
        self.client.force_login(u)
        r = self.client.get("/admin-totp/setup/")
        self.assertEqual(r.status_code, 302)
        # Bounced to root · not allowed to enrol an admin-TOTP device
        self.assertEqual(r["Location"], "/")
