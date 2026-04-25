"""Tests for the layered email-abuse defence (Cluster 1 of the
2026-04-25 abuse-mitigation work).

Covers:

  Layer 1 · disposable blocklist (`is_disposable`)
  Layer 2 · MX validation (skipped network calls, mocked at the helper)
  Layer 4 · gmail dot+plus normalisation (`normalise_email`)
  Layer 4 · `User.normalised_email` partial-unique constraint
  Layer 3 · `AdminVerifyUserView` refuses tier-2 promotion when the
            target user's email isn't verified

Each test pins one piece of contract so a regression is loud at the
test layer rather than silent in production.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient


pytestmark = pytest.mark.django_db


def _make_user(phone="+254700020001", **kwargs):
    from apps.accounts.models import User
    defaults = {"pin": "123456"}
    defaults.update(kwargs)
    return User.objects.create_user(phone=phone, **defaults)


def _force_authed(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# ------------------------------------------------------------------
# Layer 1 · disposable-domain blocklist
# ------------------------------------------------------------------
class TestIsDisposable(TestCase):
    """The blocklist file ships ~150 entries · spot-check the obvious ones."""

    def test_catches_known_disposable_domains(self):
        from apps.accounts.email_validation import is_disposable
        for email in [
            "test@mailinator.com",
            "Test@MAILINATOR.com",  # case-insensitive
            "abuser@10minutemail.com",
            "x@guerrillamail.com",
            "y@tempmail.dev",
            "z@throwawaymail.com",
            "burner@yopmail.com",
            "junk@sharklasers.com",
            "alias@getnada.com",
            "trash@fakeinbox.com",
            "tmp@maildrop.cc",
            "user@dispostable.com",
        ]:
            assert is_disposable(email), f"Expected {email} to be disposable"

    def test_passes_real_domains(self):
        from apps.accounts.email_validation import is_disposable
        for email in [
            "real@gmail.com",
            "user@outlook.com",
            "j.smith@yahoo.com",
            "kevin@example.co.ke",
            "alice@work-domain.co.ke",
            "bob@protonmail.com",
            "team@hotmail.com",
            "ceo@anthropic.com",
            "test@safaricom.co.ke",
        ]:
            assert not is_disposable(email), f"{email} should not be flagged"

    def test_malformed_input_returns_false(self):
        # Garbage in, garbage-as-False out · the EmailField validator has
        # already done shape validation upstream of this call.
        from apps.accounts.email_validation import is_disposable
        assert not is_disposable("")
        assert not is_disposable("no-at-sign")
        assert not is_disposable("@nowhere.com")
        assert not is_disposable("local@")


# ------------------------------------------------------------------
# Layer 4 · normalisation
# ------------------------------------------------------------------
class TestNormaliseEmail(TestCase):
    def test_gmail_dots_and_plus_collapse(self):
        from apps.accounts.email_validation import normalise_email
        assert normalise_email("j.o.h.n.d.o.e+anything@gmail.com") == "johndoe@gmail.com"
        assert normalise_email("johndoe+abuse123@gmail.com") == "johndoe@gmail.com"
        assert normalise_email("john.doe@gmail.com") == "johndoe@gmail.com"
        assert normalise_email("JOHNDOE@gmail.com") == "johndoe@gmail.com"

    def test_googlemail_rewritten_to_gmail(self):
        from apps.accounts.email_validation import normalise_email
        assert normalise_email("alice@googlemail.com") == "alice@gmail.com"
        assert normalise_email("a.l.i.c.e+x@googlemail.com") == "alice@gmail.com"

    def test_other_provider_keeps_dots_strips_plus(self):
        from apps.accounts.email_validation import normalise_email
        # Outlook treats dots as significant; only the +tag is stripped.
        assert normalise_email("j.o.h.n+ref@outlook.com") == "j.o.h.n@outlook.com"
        assert normalise_email("user.name@yahoo.com") == "user.name@yahoo.com"
        assert normalise_email("kevin+spam@cpay.co.ke") == "kevin@cpay.co.ke"

    def test_idempotent(self):
        from apps.accounts.email_validation import normalise_email
        once = normalise_email("X.Y+abuse@Gmail.com")
        twice = normalise_email(once)
        assert once == twice

    def test_malformed_returns_empty(self):
        from apps.accounts.email_validation import normalise_email
        assert normalise_email("") == ""
        assert normalise_email("no-at") == ""
        assert normalise_email("+only@gmail.com") == ""  # local strips to empty


# ------------------------------------------------------------------
# Layer 2 · MX validation (mocked DNS)
# ------------------------------------------------------------------
class TestHasValidMx(TestCase):
    def test_valid_mx_when_records_exist(self):
        from apps.accounts import email_validation
        # Bypass the lru_cache so this test doesn't get a stale True from
        # a previous run.
        email_validation.has_valid_mx.cache_clear()
        with patch("dns.resolver.resolve", return_value=["mx1.example.com"]):
            assert email_validation.has_valid_mx("example.com") is True

    def test_nxdomain_returns_false(self):
        from apps.accounts import email_validation
        import dns.resolver
        email_validation.has_valid_mx.cache_clear()
        with patch("dns.resolver.resolve", side_effect=dns.resolver.NXDOMAIN()):
            assert email_validation.has_valid_mx("doesnotexist.invalid") is False

    def test_timeout_returns_false(self):
        from apps.accounts import email_validation
        import dns.exception
        email_validation.has_valid_mx.cache_clear()
        with patch("dns.resolver.resolve", side_effect=dns.exception.Timeout()):
            assert email_validation.has_valid_mx("slow.example") is False


# ------------------------------------------------------------------
# Register endpoint · disposable rejection wired up
# ------------------------------------------------------------------
class TestRegisterRejectsDisposable(TestCase):
    """`POST /auth/register/` returns 400 with the disposable copy when
    the email's domain is on the blocklist."""

    def setUp(self):
        self.client = APIClient()
        # Prime an OTP so we don't bail on the OTP check before reaching
        # the email validator.
        cache.set("otp:+254700020201", "123456", timeout=300)

    @override_settings(EMAIL_VALIDATION_REQUIRE_MX=False)
    def test_disposable_email_rejected(self):
        resp = self.client.post(
            "/api/v1/auth/register/",
            {
                "phone": "+254700020201",
                "pin": "654321",
                "otp": "123456",
                "email": "abuser@mailinator.com",
            },
            format="json",
        )
        assert resp.status_code == 400, resp.data
        # The error should mention "not accepted" so we know the
        # disposable branch fired (vs a generic uniqueness clash).
        body = resp.data.get("email", []) or []
        if isinstance(body, list):
            body_str = " ".join(str(b) for b in body)
        else:
            body_str = str(body)
        assert "not accepted" in body_str.lower()

    @override_settings(EMAIL_VALIDATION_REQUIRE_MX=False)
    def test_real_email_accepted(self):
        resp = self.client.post(
            "/api/v1/auth/register/",
            {
                "phone": "+254700020201",
                "pin": "654321",
                "otp": "123456",
                "email": "real-user@example.com",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data


# ------------------------------------------------------------------
# Layer 4 · partial-unique constraint via normalised_email
# ------------------------------------------------------------------
class TestNormalisedEmailUniqueness(TestCase):
    """Two distinct gmail aliases hashing to the same normalised form
    must collide. Phone-only users with empty email must NOT collide."""

    def setUp(self):
        self.client = APIClient()

    @override_settings(EMAIL_VALIDATION_REQUIRE_MX=False)
    def test_alias_blocked_after_first_signup(self):
        # First signup with the canonical address.
        cache.set("otp:+254700020301", "123456", timeout=300)
        first = self.client.post(
            "/api/v1/auth/register/",
            {
                "phone": "+254700020301",
                "pin": "111222",
                "otp": "123456",
                "email": "johndoe@gmail.com",
            },
            format="json",
        )
        assert first.status_code == 201, first.data

        # Second signup from a DIFFERENT phone with a gmail alias of
        # the same address. Must reject as already-in-use.
        cache.set("otp:+254700020302", "123456", timeout=300)
        second = self.client.post(
            "/api/v1/auth/register/",
            {
                "phone": "+254700020302",
                "pin": "111222",
                "otp": "123456",
                "email": "j.o.h.n.d.o.e+abuse@gmail.com",
            },
            format="json",
        )
        assert second.status_code == 400, second.data

    def test_phone_only_users_do_not_collide(self):
        from apps.accounts.models import User
        u1 = User.objects.create_user(phone="+254700020401", pin="123456")
        u2 = User.objects.create_user(phone="+254700020402", pin="123456")
        assert u1.normalised_email == ""
        assert u2.normalised_email == ""

    def test_save_keeps_normalised_in_lockstep(self):
        from apps.accounts.models import User
        u = User.objects.create_user(phone="+254700020501", pin="123456")
        assert u.normalised_email == ""

        u.email = "X.Y+ref@Gmail.com"
        u.save()
        assert u.normalised_email == "xy@gmail.com"

        # Setting back to None should clear the normalised form.
        u.email = None
        u.save()
        assert u.normalised_email == ""


# ------------------------------------------------------------------
# Layer 3 · admin can't bump tier ≥2 until email is verified
# ------------------------------------------------------------------
class TestAdminVerifyRequiresEmail(TestCase):
    def setUp(self):
        self.staff = _make_user(phone="+254700020601", is_staff=True, kyc_tier=3)
        self.target = _make_user(phone="+254700020602", kyc_tier=1)
        self.target.email = "target@example.com"
        self.target.email_verified = False
        self.target.save(update_fields=["email", "email_verified"])
        self.client = _force_authed(self.staff)

    def test_tier2_blocked_when_email_not_verified(self):
        url = f"/api/v1/auth/admin/users/{self.target.id}/verify/"
        resp = self.client.post(url, {"kyc_tier": 2}, format="json")
        assert resp.status_code == 403, resp.data
        assert resp.data.get("error_code") == "email_verification_required"

        # Tier didn't change.
        self.target.refresh_from_db()
        assert self.target.kyc_tier == 1

    def test_tier1_still_allowed(self):
        # Tier 1 doesn't require email · only tier 2+ does.
        url = f"/api/v1/auth/admin/users/{self.target.id}/verify/"
        resp = self.client.post(url, {"kyc_tier": 1}, format="json")
        assert resp.status_code == 200, resp.data

    def test_tier2_allowed_when_email_verified(self):
        self.target.email_verified = True
        self.target.save(update_fields=["email_verified"])
        url = f"/api/v1/auth/admin/users/{self.target.id}/verify/"
        resp = self.client.post(url, {"kyc_tier": 2}, format="json")
        assert resp.status_code == 200, resp.data
        self.target.refresh_from_db()
        assert self.target.kyc_tier == 2
