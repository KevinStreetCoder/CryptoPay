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


# 2026-05-16 · multi-result typeahead mode (`?suggest=1`) ────────────


class TestCpayUserLookupSuggest(TestCase):
    """Typeahead lookup · returns up to 5 matches across name / phone
    suffix / referral code. Used by the send-to-cpay form so the
    sender can pick the right recipient from a dropdown when there
    are multiple "John"s."""

    def setUp(self):
        self.caller = _make_user(
            phone="+254700000001", full_name="Caller One",
        )
        # Three Johns with different surnames + one Jane.
        self.john_s = _make_user(
            phone="+254712111111", full_name="John Smith",
        )
        self.john_d = _make_user(
            phone="+254712222222", full_name="John Doe",
        )
        self.john_n = _make_user(
            phone="+254745454554", full_name="John Njongoro",
        )
        self.jane = _make_user(
            phone="+254799887766", full_name="Jane Mwangi",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.caller)
        self.url = reverse("payments:cpay-user-lookup")

    def test_name_prefix_returns_all_matching(self):
        r = self.client.get(self.url, {"q": "John", "suggest": "1"})
        assert r.status_code == 200
        results = r.json()["results"]
        names = [x["display_name"] for x in results]
        # All three Johns surface (surname truncated to initial).
        assert "John S." in names
        assert "John D." in names
        assert "John N." in names
        # Jane is NOT in the results.
        assert "Jane M." not in names

    def test_phone_suffix_match(self):
        # Last 4 digits "4554" should pull up John Njongoro.
        r = self.client.get(self.url, {"q": "4554", "suggest": "1"})
        assert r.status_code == 200
        results = r.json()["results"]
        assert any(x["display_name"] == "John N." for x in results), results

    def test_returns_at_most_5(self):
        for i in range(7):
            _make_user(
                phone=f"+25470000{2000+i:04d}",
                full_name=f"Bulk Person{i}",
            )
        r = self.client.get(self.url, {"q": "Bulk", "suggest": "1"})
        results = r.json()["results"]
        assert len(results) <= 5

    def test_short_query_returns_empty(self):
        # 1- or 2-char queries match too many users · the endpoint
        # short-circuits to an empty list rather than fanning out.
        r = self.client.get(self.url, {"q": "Jo", "suggest": "1"})
        assert r.status_code == 200
        assert r.json()["results"] == []

    def test_self_excluded_from_results(self):
        r = self.client.get(self.url, {"q": "Caller", "suggest": "1"})
        results = r.json()["results"]
        assert all(x["display_name"] != "Caller O." for x in results)


# 2026-05-16 · POST send-to-cpay accepts both prefixed + unprefixed keys


class TestSendToCpayFieldNameCompat(TestCase):
    """Regression · the mobile send-to-cpay form was spreading its
    detect-kind result `{username: ...}` directly into the POST body,
    but the backend was reading the PREFIXED `recipient_username` key.
    Result · every send-to-cpay POST returned 404 "Recipient not
    found" even though the pre-flight lookup succeeded. Backend now
    accepts EITHER shape for back-compat."""

    def setUp(self):
        self.sender = _make_user(
            phone="+254712000001", full_name="Sender User",
        )
        self.recipient = _make_user(
            phone="+254745454554", full_name="John Njongoro",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.sender)
        self.url = reverse("payments:send-to-cpay")

    def _common_payload(self):
        return {
            "currency": "USDT",
            "amount": "0.01",
            "idempotency_key": "test-idem-1",
            "pin": "WRONG_PIN_BUT_SHOWS_FIELD_NAME_BEHAVIOUR",
        }

    def test_unprefixed_username_key_resolves(self):
        # Mobile shape · {username: "John Njongoro"}.
        payload = {**self._common_payload(), "username": "John Njongoro"}
        r = self.client.post(self.url, payload, format="json")
        # We expect NOT 404 (recipient resolved). PIN is wrong so we
        # get 400/403 from PIN check · the point is the resolution
        # branch passed.
        assert r.status_code != 404, r.content
        # Body should NOT carry the "Recipient not found" message.
        body = r.json() if r.headers.get("Content-Type", "").startswith("application/json") else {}
        assert "Recipient not found" not in str(body), body

    def test_prefixed_recipient_username_key_resolves(self):
        # Backend-canonical shape · {recipient_username: "John Njongoro"}.
        payload = {**self._common_payload(), "recipient_username": "John Njongoro"}
        r = self.client.post(self.url, payload, format="json")
        assert r.status_code != 404, r.content

    def test_unprefixed_phone_key_resolves(self):
        payload = {**self._common_payload(), "phone": "+254745454554"}
        r = self.client.post(self.url, payload, format="json")
        assert r.status_code != 404, r.content
