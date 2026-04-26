"""Account-deletion tests · Google Play compliance flow (2026-04-26).

Verifies:
  - POST /auth/account/delete/ requires PIN, schedules 14 days out
  - POST /auth/account/delete/ refuses when balance is non-zero
  - Login refuses while deletion is pending (403 + error_code)
  - POST /auth/account/delete/cancel/ clears the schedule
  - Celery purge task hard-deletes users past their grace period
  - Wrong PIN never reveals deletion state to attackers
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient


pytestmark = pytest.mark.django_db


def _make_user(phone="+254700050001", pin="123456", balance="0"):
    from apps.accounts.models import User
    from apps.wallets.models import Wallet

    user = User.objects.create_user(phone=phone, pin=pin)
    Wallet.objects.create(user=user, currency="USDT", balance=Decimal(balance))
    return user


def _authed(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class TestDeletionRequest(TestCase):
    def test_schedules_14_days_out(self):
        user = _make_user(phone="+254700050001")
        client = _authed(user)
        before = timezone.now()
        resp = client.post("/api/v1/auth/account/delete/", {"pin": "123456"}, format="json")
        assert resp.status_code == 200, resp.data
        scheduled = resp.data.get("scheduled_for")
        assert scheduled is not None
        user.refresh_from_db()
        assert user.deletion_requested_at is not None
        assert user.deletion_scheduled_for is not None
        # 14 ± 1 days
        delta_days = (user.deletion_scheduled_for - before).total_seconds() / 86400
        assert 13.9 <= delta_days <= 14.1

    def test_wrong_pin_returns_401(self):
        user = _make_user(phone="+254700050002")
        client = _authed(user)
        resp = client.post("/api/v1/auth/account/delete/", {"pin": "999999"}, format="json")
        assert resp.status_code == 401, resp.data
        user.refresh_from_db()
        assert user.deletion_requested_at is None

    def test_refuses_when_already_scheduled(self):
        user = _make_user(phone="+254700050003")
        now = timezone.now()
        user.deletion_requested_at = now
        user.deletion_scheduled_for = now + timedelta(days=14)
        user.save(update_fields=["deletion_requested_at", "deletion_scheduled_for"])
        client = _authed(user)
        resp = client.post("/api/v1/auth/account/delete/", {"pin": "123456"}, format="json")
        assert resp.status_code == 409, resp.data
        assert resp.data.get("error_code") == "already_scheduled"

    def test_refuses_when_balance_non_zero(self):
        user = _make_user(phone="+254700050004", balance="10.5")
        client = _authed(user)
        resp = client.post("/api/v1/auth/account/delete/", {"pin": "123456"}, format="json")
        assert resp.status_code == 409, resp.data
        assert resp.data.get("error_code") == "non_zero_balance"
        user.refresh_from_db()
        assert user.deletion_requested_at is None


class TestDeletionCancel(TestCase):
    def test_clears_pending_deletion(self):
        user = _make_user(phone="+254700050010")
        now = timezone.now()
        user.deletion_requested_at = now
        user.deletion_scheduled_for = now + timedelta(days=14)
        user.save(update_fields=["deletion_requested_at", "deletion_scheduled_for"])
        client = _authed(user)
        resp = client.post("/api/v1/auth/account/delete/cancel/", {"pin": "123456"}, format="json")
        assert resp.status_code == 200, resp.data
        user.refresh_from_db()
        assert user.deletion_requested_at is None
        assert user.deletion_scheduled_for is None

    def test_409_when_nothing_pending(self):
        user = _make_user(phone="+254700050011")
        client = _authed(user)
        resp = client.post("/api/v1/auth/account/delete/cancel/", {"pin": "123456"}, format="json")
        assert resp.status_code == 409, resp.data
        assert resp.data.get("error_code") == "no_pending_deletion"

    def test_wrong_pin_does_not_cancel(self):
        user = _make_user(phone="+254700050012")
        now = timezone.now()
        user.deletion_requested_at = now
        user.deletion_scheduled_for = now + timedelta(days=14)
        user.save(update_fields=["deletion_requested_at", "deletion_scheduled_for"])
        client = _authed(user)
        resp = client.post("/api/v1/auth/account/delete/cancel/", {"pin": "999999"}, format="json")
        assert resp.status_code == 401, resp.data
        user.refresh_from_db()
        assert user.deletion_requested_at is not None


class TestLoginGuard(TestCase):
    def test_login_blocked_for_pending_deletion(self):
        user = _make_user(phone="+254700050020")
        now = timezone.now()
        user.deletion_requested_at = now
        user.deletion_scheduled_for = now + timedelta(days=14)
        user.save(update_fields=["deletion_requested_at", "deletion_scheduled_for"])

        client = APIClient()
        resp = client.post("/api/v1/auth/login/", {
            "phone": "+254700050020",
            "pin": "123456",
        }, format="json")
        assert resp.status_code == 403, resp.data
        assert resp.data.get("error_code") == "account_pending_deletion"
        assert "scheduled_for" in resp.data

    def test_login_works_after_cancel(self):
        user = _make_user(phone="+254700050021")
        now = timezone.now()
        user.deletion_requested_at = now
        user.deletion_scheduled_for = now + timedelta(days=14)
        user.save(update_fields=["deletion_requested_at", "deletion_scheduled_for"])

        # Cancel via authenticated client
        cancel_client = _authed(user)
        cancel_client.post("/api/v1/auth/account/delete/cancel/", {"pin": "123456"}, format="json")

        # New login should succeed
        client = APIClient()
        resp = client.post("/api/v1/auth/login/", {
            "phone": "+254700050021",
            "pin": "123456",
        }, format="json")
        assert resp.status_code == 200, resp.data
        # LoginView returns {"tokens": {"access": ..., "refresh": ...}, "user": ...}
        tokens = resp.data.get("tokens") or {}
        assert tokens.get("access"), resp.data


class TestPurgeTask(TestCase):
    def test_purges_users_past_grace_period(self):
        from apps.accounts.models import User
        from apps.accounts.tasks import purge_pending_deletions

        # Past deadline
        user_due = _make_user(phone="+254700050030")
        user_due.deletion_requested_at = timezone.now() - timedelta(days=15)
        user_due.deletion_scheduled_for = timezone.now() - timedelta(days=1)
        user_due.save(update_fields=["deletion_requested_at", "deletion_scheduled_for"])
        due_id = user_due.id

        # Within grace period
        user_pending = _make_user(phone="+254700050031")
        user_pending.deletion_requested_at = timezone.now() - timedelta(days=2)
        user_pending.deletion_scheduled_for = timezone.now() + timedelta(days=12)
        user_pending.save(update_fields=["deletion_requested_at", "deletion_scheduled_for"])
        pending_id = user_pending.id

        # Not deleting
        user_active = _make_user(phone="+254700050032")
        active_id = user_active.id

        result = purge_pending_deletions()

        assert result["purged"] == 1
        assert User.objects.filter(id=due_id).count() == 0
        assert User.objects.filter(id=pending_id).count() == 1
        assert User.objects.filter(id=active_id).count() == 1
