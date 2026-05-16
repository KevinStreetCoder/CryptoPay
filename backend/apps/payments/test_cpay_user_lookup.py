"""Pre-send Cpay user-lookup endpoint · 2026-05-16.

Wired so the Send-to-Cpay mobile screen can validate the recipient
BEFORE the user types their PIN, eliminating the "type PIN, wait,
see 'Recipient not found' 404" UX trap.

Privacy contract under test:
  - Non-matches return HTTP 200 {"found": false}, never 404 ·
    enumeration-resistant.
  - Match response leaks only the bare minimum: display name with
    surname truncated to first initial ("Jane D."), masked phone
    ("+254712••••89"), and the matched-by kind.
  - Self-lookup returns {"found": false} · same shape as unknown ·
    so a user can't enumerate themselves either.
  - Suspended / inactive users return {"found": false}.

Throttle contract:
  - 60 requests/minute is the floor that supports as-you-type
    validation without triggering 429 on legitimate flows.
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User


pytestmark = pytest.mark.django_db


def _make_user(*, phone=None, full_name="", referral_code=None,
               is_active=True, is_suspended=False):
    u = User.objects.create_user(
        email=f"lookup-{uuid4().hex[:8]}@example.com",
        phone=phone or f"+25470{uuid4().int % 10000000:07d}",
        password="testing12345",
    )
    if full_name:
        u.full_name = full_name
    u.is_active = is_active
    if hasattr(u, "is_suspended"):
        u.is_suspended = is_suspended
    u.save()
    # ReferralCode is a separate OneToOne · attach via the related model.
    if referral_code:
        from apps.referrals.models import ReferralCode
        ReferralCode.objects.create(user=u, code=referral_code)
    return u


class TestCpayUserLookupResolution(TestCase):
    """Phone / username / referral-code resolution."""

    def setUp(self):
        self.caller = _make_user(
            phone="+254700111222",
            full_name="Caller One",
        )
        self.recipient = _make_user(
            phone="+254712345678",
            full_name="Jane Mary Doe",
            referral_code="JANE123",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.caller)
        self.url = reverse("payments:cpay-user-lookup")

    def test_lookup_by_phone_canonical(self):
        r = self.client.get(self.url, {"q": "+254712345678"})
        assert r.status_code == 200, r.content
        data = r.json()
        assert data["found"] is True
        assert data["matched_by"] == "phone"
        # display_name surname → initial
        assert data["display_name"] == "Jane D.", data["display_name"]
        # phone masked
        assert "••••" in data["phone_masked"]
        assert data["phone_masked"].startswith("+254712")
        assert data["phone_masked"].endswith("78")

    def test_lookup_by_phone_07_prefix(self):
        r = self.client.get(self.url, {"q": "0712345678"})
        assert r.status_code == 200
        assert r.json()["found"] is True

    def test_lookup_by_phone_254_no_plus(self):
        # 254-prefixed without the `+` · Safaricom SMS format.
        r = self.client.get(self.url, {"q": "254712345678"})
        assert r.status_code == 200
        assert r.json()["found"] is True

    def test_lookup_by_full_name(self):
        # User model has no `username` field · `full_name` is the
        # human-typeable identifier. Lookup is case-insensitive.
        r = self.client.get(self.url, {"q": "jane mary doe"})
        assert r.status_code == 200
        data = r.json()
        assert data["found"] is True
        assert data["matched_by"] == "full_name"

    def test_lookup_by_referral_code(self):
        r = self.client.get(self.url, {"q": "JANE123"})
        assert r.status_code == 200
        data = r.json()
        assert data["found"] is True
        assert data["matched_by"] == "referral_code"


class TestCpayUserLookupPrivacy(TestCase):
    """Privacy + enumeration-resistance contract."""

    def setUp(self):
        self.caller = _make_user(
            phone="+254700111222",
            full_name="Caller User",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.caller)
        self.url = reverse("payments:cpay-user-lookup")

    def test_unknown_phone_returns_200_found_false(self):
        # NOT 404 · 404 would leak "no such user" via response code
        r = self.client.get(self.url, {"q": "+254799999999"})
        assert r.status_code == 200, r.content
        assert r.json() == {"found": False}

    def test_unknown_full_name_returns_200_found_false(self):
        r = self.client.get(self.url, {"q": "nonexistent person xyz"})
        assert r.status_code == 200
        assert r.json() == {"found": False}

    def test_self_lookup_returns_found_false(self):
        # Sender looking themselves up · still constant-shape response.
        r = self.client.get(self.url, {"q": "Caller User"})
        assert r.status_code == 200
        assert r.json() == {"found": False}

    def test_inactive_user_returns_found_false(self):
        _make_user(
            phone="+254755555555",
            full_name="Suspended Jane",
            is_active=False,
        )
        r = self.client.get(self.url, {"q": "+254755555555"})
        assert r.status_code == 200
        assert r.json() == {"found": False}

    def test_no_query_returns_400(self):
        r = self.client.get(self.url, {"q": ""})
        assert r.status_code == 400


class TestCpayUserLookupAuth(TestCase):
    """Endpoint is auth-required · anonymous gets 401."""

    def test_anonymous_rejected(self):
        c = APIClient()
        r = c.get(reverse("payments:cpay-user-lookup"), {"q": "+254712345678"})
        assert r.status_code in (401, 403)
