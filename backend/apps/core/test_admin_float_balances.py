"""Tests for /admin/float/balances/ · combined IntaSend + SasaPay view.

2026-05-17 · ops needed one place to see total disbursable KES across
both M-Pesa rails. The endpoint queries each provider live, normalises
the response, and caches for 30 s.

Contract:
  - Staff-required (403 for non-staff, 302 redirect to login for anon)
  - 200 with normalised JSON · `total_disbursable_kes` SUMS across
    both providers (intasend can_disburse=True + sasapay working/utility)
  - Partial provider outage doesn't break the response · the failing
    provider gets `error` populated, the other still surfaces
  - `?refresh=1` bypasses the 30-s cache
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
from django.core.cache import cache
from django.test import TestCase, Client

from apps.accounts.models import User


pytestmark = pytest.mark.django_db


def _staff_user():
    u = User.objects.create_user(
        email="staff@example.com",
        phone="+254700000111",
        password="testing12345",
    )
    u.is_staff = True
    u.save(update_fields=["is_staff"])
    return u


def _intasend_response(can_disburse: bool = True, balance: float = 1000.0):
    """Mock IntaSend /api/v1/wallets/ response."""
    return {
        "results": [
            {
                "wallet_id": "WID-KES-1",
                "label": "default",
                "currency": "KES",
                "current_balance": balance,
                "can_disburse": can_disburse,
                "wallet_type": "SETTLEMENT",
            },
            {
                "wallet_id": "WID-USD-1",
                "label": "usd",
                "currency": "USD",
                "current_balance": 50.0,
                "can_disburse": True,
                "wallet_type": "SETTLEMENT",
            },
        ]
    }


def _sasapay_response(working: float = 500.0, utility: float = 200.0):
    """Mock SasaPay /payments/check-balance/ response."""
    return {
        "data": {
            "Accounts": [
                {"account_label": "Working", "account_balance": working},
                {"account_label": "Utility", "account_balance": utility},
                {"account_label": "Bulk Payment", "account_balance": 0},
            ]
        }
    }


class TestAdminFloatBalances(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = _staff_user()
        self.client.force_login(self.user)
        cache.delete("admin:float_balances:v1")

    def test_requires_auth(self):
        c = Client()
        # Anonymous · django staff_member_required redirects to admin login
        r = c.get("/admin/float/balances/")
        assert r.status_code in (302, 403), r.status_code

    def test_non_staff_forbidden(self):
        # Authenticated but not staff · same redirect/403 behaviour.
        u = User.objects.create_user(
            email="user@example.com",
            phone="+254700000222",
            password="testing12345",
        )
        c = Client()
        c.force_login(u)
        r = c.get("/admin/float/balances/")
        assert r.status_code in (302, 403)

    # We mock the per-provider fetchers directly · the underlying
    # `_fetch_intasend_float` body needs INTASEND_API_SECRET to even
    # construct the client, which complicates a focused contract test.
    # Mocking the fetcher is the right abstraction layer here · the
    # individual fetcher logic is exercised by separate unit tests
    # below (`TestFetchIntasendFloat`, `TestFetchSasapayFloat`).

    @patch("apps.core.admin_views._fetch_intasend_float")
    @patch("apps.core.admin_views._fetch_sasapay_float")
    def test_happy_path_combines_balances(self, sasapay_mock, intasend_mock):
        intasend_mock.return_value = {
            "available_kes": 1000.0,
            "total_kes": 1050.0,
            "wallets": [
                {"wallet_id": "WID-KES-1", "label": "default",
                 "currency": "KES", "balance": 1000.0,
                 "can_disburse": True, "wallet_type": "SETTLEMENT"},
                {"wallet_id": "WID-USD-1", "label": "usd",
                 "currency": "USD", "balance": 50.0,
                 "can_disburse": True, "wallet_type": "SETTLEMENT"},
            ],
            "error": None,
        }
        sasapay_mock.return_value = {
            "available_kes": 700.0,
            "total_kes": 700.0,
            "accounts": [
                {"label": "Working", "balance": 500.0,
                 "is_working": True, "is_utility": False},
                {"label": "Utility", "balance": 200.0,
                 "is_working": False, "is_utility": True},
            ],
            "error": None,
        }

        r = self.client.get("/admin/float/balances/")
        assert r.status_code == 200, r.content
        data = r.json()

        # Sum check · 1000 (IntaSend disbursable) + 700 (SasaPay) = 1700
        assert data["total_disbursable_kes"] == 1700.0, data
        assert data["providers"]["intasend"]["available_kes"] == 1000.0
        assert data["providers"]["sasapay"]["available_kes"] == 700.0
        # USD wallet visible but doesn't inflate KES disbursable.
        intasend = data["providers"]["intasend"]
        assert any(w["currency"] == "USD" for w in intasend["wallets"])

    @patch("apps.core.admin_views._fetch_intasend_float")
    @patch("apps.core.admin_views._fetch_sasapay_float")
    def test_intasend_outage_doesnt_break_response(self, sasapay_mock, intasend_mock):
        # IntaSend fetcher returns an error block · the endpoint must
        # still render with sasapay's balance surfaced.
        intasend_mock.return_value = {
            "available_kes": 0.0, "total_kes": 0.0, "wallets": [],
            "error": "HTTP 502: Bad Gateway",
        }
        sasapay_mock.return_value = {
            "available_kes": 700.0,
            "total_kes": 700.0,
            "accounts": [{"label": "Working", "balance": 700.0,
                          "is_working": True, "is_utility": False}],
            "error": None,
        }

        r = self.client.get("/admin/float/balances/")
        assert r.status_code == 200
        data = r.json()
        assert "502" in data["providers"]["intasend"]["error"]
        assert data["providers"]["sasapay"]["available_kes"] == 700.0
        assert data["total_disbursable_kes"] == 700.0  # only sasapay

    @patch("apps.core.admin_views._fetch_intasend_float")
    @patch("apps.core.admin_views._fetch_sasapay_float")
    def test_cache_serves_repeated_requests(self, sasapay_mock, intasend_mock):
        intasend_mock.return_value = {
            "available_kes": 100.0, "total_kes": 100.0, "wallets": [],
            "error": None,
        }
        sasapay_mock.return_value = {
            "available_kes": 200.0, "total_kes": 200.0, "accounts": [],
            "error": None,
        }
        self.client.get("/admin/float/balances/")
        self.client.get("/admin/float/balances/")
        # Each fetcher called exactly once · the second hit was served
        # from the 30-s cache.
        assert intasend_mock.call_count == 1
        assert sasapay_mock.call_count == 1

    @patch("apps.core.admin_views._fetch_intasend_float")
    @patch("apps.core.admin_views._fetch_sasapay_float")
    def test_refresh_bypasses_cache(self, sasapay_mock, intasend_mock):
        intasend_mock.return_value = {
            "available_kes": 100.0, "total_kes": 100.0, "wallets": [],
            "error": None,
        }
        sasapay_mock.return_value = {
            "available_kes": 200.0, "total_kes": 200.0, "accounts": [],
            "error": None,
        }
        self.client.get("/admin/float/balances/")
        self.client.get("/admin/float/balances/?refresh=1")
        # `?refresh=1` MUST re-query both providers (2 calls each).
        assert intasend_mock.call_count == 2
        assert sasapay_mock.call_count == 2


class TestFetchIntasendFloat(TestCase):
    """Unit tests for the IntaSend wallet-list normaliser. Important
    contract · wallets with can_disburse=False MUST NOT count toward
    available_kes. That field drives the saga's pre-flight check and
    leaking can_disburse=False money would re-create the bug that
    sent every paybill into a 10-min timeout."""

    @patch("apps.core.admin_views.requests.get")
    def test_can_disburse_false_excluded_from_available(self, requests_mock):
        from apps.core.admin_views import _fetch_intasend_float

        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = _intasend_response(
            can_disburse=False, balance=1000.0,
        )
        requests_mock.return_value = resp

        with patch("apps.mpesa.intasend_client.IntaSendClient") as cls:
            inst = cls.return_value
            inst.base_url = "https://payments.intasend.com"
            inst._headers.return_value = {"Authorization": "Bearer test"}
            out = _fetch_intasend_float()

        assert out["total_kes"] == 1000.0
        assert out["available_kes"] == 0.0, (
            "can_disburse=False must NOT count toward disbursable balance"
        )

    @patch("apps.core.admin_views.requests.get")
    def test_only_kes_currency_counted_in_kes_totals(self, requests_mock):
        from apps.core.admin_views import _fetch_intasend_float

        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "results": [
                {"wallet_id": "W1", "label": "kes", "currency": "KES",
                 "current_balance": 500.0, "can_disburse": True,
                 "wallet_type": "SETTLEMENT"},
                {"wallet_id": "W2", "label": "usd", "currency": "USD",
                 "current_balance": 999.0, "can_disburse": True,
                 "wallet_type": "SETTLEMENT"},
            ]
        }
        requests_mock.return_value = resp

        with patch("apps.mpesa.intasend_client.IntaSendClient") as cls:
            inst = cls.return_value
            inst.base_url = "https://payments.intasend.com"
            inst._headers.return_value = {"Authorization": "Bearer test"}
            out = _fetch_intasend_float()

        # USD wallet must NOT show up in KES tallies even though
        # can_disburse=True (we'd be promising disbursable KES we
        # can't actually pay out).
        assert out["available_kes"] == 500.0
        assert out["total_kes"] == 500.0


class TestFetchSasapayFloat(TestCase):
    """Unit tests for the SasaPay accounts normaliser."""

    @patch("apps.mpesa.sasapay_client.SasaPayClient")
    def test_working_plus_utility_counts_as_disbursable(self, cls):
        from apps.core.admin_views import _fetch_sasapay_float

        inst = cls.return_value
        inst.check_balance.return_value = _sasapay_response(
            working=500.0, utility=200.0,
        )
        out = _fetch_sasapay_float()
        # Working (500) + Utility (200) = 700 disbursable.
        # Bulk Payment (0) included in total but not relevant here.
        assert out["available_kes"] == 700.0
        assert out["total_kes"] == 700.0

    @patch("apps.mpesa.sasapay_client.SasaPayClient")
    def test_check_balance_exception_surfaces_as_error(self, cls):
        from apps.core.admin_views import _fetch_sasapay_float

        inst = cls.return_value
        inst.check_balance.side_effect = RuntimeError("rate limited")
        out = _fetch_sasapay_float()
        assert out["available_kes"] == 0.0
        assert "rate limited" in (out["error"] or "")
