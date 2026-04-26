"""Email-verify-on-login gate · the login response carries
`email_verify_required: true` whenever the user is sitting on:
  - empty email
  - a disposable email (already in our blocklist)
  - an unverified real email

The mobile client uses this flag to route to an in-app gate that
forces the user to provide a real, deliverable address before
reaching the home tabs.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from django.test import TestCase
from rest_framework.test import APIClient


pytestmark = pytest.mark.django_db


def _create_user(phone, pin="123456", email="", email_verified=False):
    from apps.accounts.models import User
    user = User.objects.create_user(phone=phone, pin=pin)
    if email:
        user.email = email
        user.email_verified = email_verified
        user.save(update_fields=["email", "email_verified"])
    return user


class TestEmailVerifyOnLoginGate(TestCase):
    def test_empty_email_triggers_gate(self):
        _create_user(phone="+254700060001", email="")
        client = APIClient()
        resp = client.post("/api/v1/auth/login/", {
            "phone": "+254700060001",
            "pin": "123456",
        }, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data.get("email_verify_required") is True

    def test_disposable_email_triggers_gate(self):
        # Add a known disposable domain to the blocklist for the test
        from apps.accounts import email_validation
        original = email_validation.DISPOSABLE_DOMAINS
        try:
            email_validation.DISPOSABLE_DOMAINS = frozenset(
                list(original) + ["mailinator.com"]
            )
            user = _create_user(
                phone="+254700060002",
                email="throwaway@mailinator.com",
                email_verified=True,  # Even if "verified" upstream, disposable still triggers
            )
            client = APIClient()
            resp = client.post("/api/v1/auth/login/", {
                "phone": "+254700060002",
                "pin": "123456",
            }, format="json")
            assert resp.status_code == 200, resp.data
            assert resp.data.get("email_verify_required") is True
        finally:
            email_validation.DISPOSABLE_DOMAINS = original

    def test_unverified_real_email_triggers_gate(self):
        _create_user(
            phone="+254700060003",
            email="real@example.com",
            email_verified=False,
        )
        client = APIClient()
        resp = client.post("/api/v1/auth/login/", {
            "phone": "+254700060003",
            "pin": "123456",
        }, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data.get("email_verify_required") is True

    def test_verified_real_email_passes(self):
        _create_user(
            phone="+254700060004",
            email="verified@example.com",
            email_verified=True,
        )
        client = APIClient()
        resp = client.post("/api/v1/auth/login/", {
            "phone": "+254700060004",
            "pin": "123456",
        }, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data.get("email_verify_required") is False
