"""Tests for the per-user total_kes_balance field added 2026-05-17.

The admin user list + detail endpoints surface each user's total
wallet value in KES, converted via the same crypto/KES rate the
user sees in-app. Two contracts:

  1. The rate map is built ONCE per request (not per user) so the
     paginated list doesn't N+1 the rates provider.
  2. Wallet balances in non-KES currencies are converted at the
     `final_rate` (post-spread) · so the admin total matches the
     headline crypto/KES rate users see when they tap "swap".

Also covers fail-soft behaviour: if the rates provider is down,
affected currencies contribute 0 to the total (conservative · we'd
rather under-report than over-report a balance for an admin action).
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest
from django.test import TestCase, Client
from django.core.cache import cache

from apps.accounts.models import User
from apps.wallets.models import Wallet


pytestmark = pytest.mark.django_db


def _make_user(email, phone, is_staff=False):
    u = User.objects.create_user(email=email, phone=phone, password="t")
    if is_staff:
        u.is_staff = True
        u.save(update_fields=["is_staff"])
    return u


def _make_wallet(user, currency, balance):
    return Wallet.objects.create(
        user=user,
        currency=currency,
        balance=Decimal(str(balance)),
        locked_balance=Decimal("0"),
        deposit_address=f"addr-{user.id}-{currency}",
    )


def _rates_stub(currency):
    """Stub for RateService.get_crypto_kes_rate."""
    rates = {
        "USDT": "130.00",
        "USDC": "130.00",
        "BTC":  "8500000.00",
        "ETH":  "450000.00",
        "SOL":  "20000.00",
    }
    return {
        "currency": currency,
        "final_rate": rates.get(currency, "0"),
    }


class TestAdminUserKesBalance(TestCase):
    def setUp(self):
        self.client = Client()
        cache.delete("admin:user_kes_rate_map")
        self.admin = _make_user("admin@x.com", "+254700000000", is_staff=True)
        self.client.force_authenticate = None  # we use force_login for session
        self.client.force_login(self.admin)

    def _login_with_token(self):
        # The admin endpoints use DRF auth · use JWT auth via REST
        # client. Simpler: hit them with force_authenticate on the DRF
        # client. We use Django Client + session above which works
        # because IsStaffUser only checks `is_staff` once is_authenticated.
        # If the endpoint uses pure DRF JWT, fall back to APIClient.
        pass

    @patch(
        "apps.rates.services.RateService.get_crypto_kes_rate",
        side_effect=lambda ccy: _rates_stub(ccy),
    )
    def test_list_includes_total_kes_balance(self, _rates_mock):
        # User has 100 USDT (× 130) = 13000 KES.
        u = _make_user("u1@x.com", "+254700000001")
        _make_wallet(u, "USDT", "100")

        from rest_framework.test import APIClient
        api = APIClient()
        api.force_authenticate(user=self.admin)
        r = api.get("/api/v1/auth/admin/users/")
        assert r.status_code == 200, r.content
        data = r.json()
        target = next(x for x in data["users"] if x["id"] == str(u.id))
        # 100 USDT × 130 KES = 13000.00
        assert target["total_kes_balance"] == "13000.00", target

    @patch(
        "apps.rates.services.RateService.get_crypto_kes_rate",
        side_effect=lambda ccy: _rates_stub(ccy),
    )
    def test_list_multi_currency_sums_correctly(self, _rates_mock):
        u = _make_user("u-multi@x.com", "+254700000002")
        _make_wallet(u, "USDT", "10")    # 10 × 130 = 1300
        _make_wallet(u, "SOL",  "0.5")   # 0.5 × 20000 = 10000
        _make_wallet(u, "KES",  "200")   # 200 × 1 = 200

        from rest_framework.test import APIClient
        api = APIClient()
        api.force_authenticate(user=self.admin)
        r = api.get("/api/v1/auth/admin/users/")
        data = r.json()
        target = next(x for x in data["users"] if x["id"] == str(u.id))
        # 1300 + 10000 + 200 = 11500.00
        assert target["total_kes_balance"] == "11500.00", target

    @patch(
        "apps.rates.services.RateService.get_crypto_kes_rate",
        side_effect=lambda ccy: _rates_stub(ccy),
    )
    def test_detail_includes_total_and_per_wallet_kes(self, _rates_mock):
        u = _make_user("u-det@x.com", "+254700000003")
        _make_wallet(u, "USDT", "5")     # 5 × 130 = 650
        _make_wallet(u, "BTC",  "0.001") # 0.001 × 8.5M = 8500

        from rest_framework.test import APIClient
        api = APIClient()
        api.force_authenticate(user=self.admin)
        r = api.get(f"/api/v1/auth/admin/users/{u.id}/detail/")
        assert r.status_code == 200, r.content
        data = r.json()

        # Top-level total = 650 + 8500 = 9150.00
        assert data["total_kes_balance"] == "9150.00", data

        # Per-wallet kes_value also surfaced.
        wallets_by_ccy = {w["currency"]: w for w in data["wallets"]}
        assert wallets_by_ccy["USDT"]["kes_value"] == "650.00"
        assert wallets_by_ccy["BTC"]["kes_value"] == "8500.00"
        # Rate map carried so the UI can show "1 BTC = 8.5M KES" inline.
        assert Decimal(wallets_by_ccy["BTC"]["rate_kes_per_unit"]) == Decimal("8500000.00")

    @patch(
        "apps.rates.services.RateService.get_crypto_kes_rate",
        side_effect=RuntimeError("rates provider down"),
    )
    def test_list_fail_soft_when_rates_provider_down(self, _rates_mock):
        # Even if every rate call raises, the endpoint MUST still
        # return 200 + the user list. Per-currency totals fall to 0;
        # KES balance is preserved (rate=1 is hardcoded in the map).
        u = _make_user("u-fail@x.com", "+254700000004")
        _make_wallet(u, "USDT", "50")  # would normally be 6500 KES
        _make_wallet(u, "KES",  "777")  # always 777 (rate=1)

        from rest_framework.test import APIClient
        api = APIClient()
        api.force_authenticate(user=self.admin)
        r = api.get("/api/v1/auth/admin/users/")
        assert r.status_code == 200, r.content
        data = r.json()
        target = next(x for x in data["users"] if x["id"] == str(u.id))
        # USDT × 0 + KES × 1 = 777.00
        assert target["total_kes_balance"] == "777.00", target

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_rate_map_built_once_per_request(self, rates_mock):
        # 5 currencies × 5 users would be 25 rate calls if naively
        # nested. The new helper batches to one rate-map build → max
        # 5 rate calls per request, regardless of user count.
        rates_mock.side_effect = lambda ccy: _rates_stub(ccy)

        for i in range(5):
            u = _make_user(f"u-batch-{i}@x.com", f"+25470011{i:04d}")
            _make_wallet(u, "USDT", "10")

        from rest_framework.test import APIClient
        api = APIClient()
        api.force_authenticate(user=self.admin)
        # Cache is cleared in setUp · this triggers a fresh build.
        api.get("/api/v1/auth/admin/users/")
        # Exactly 5 currencies in the rate map (USDT/USDC/BTC/ETH/SOL),
        # so exactly 5 rate calls, NOT 5-users × 5-currencies = 25.
        assert rates_mock.call_count == 5, (
            f"rate_map MUST be built once per request, got "
            f"{rates_mock.call_count} calls (expected 5 = one per "
            f"supported currency)"
        )

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_rate_map_cached_across_requests(self, rates_mock):
        rates_mock.side_effect = lambda ccy: _rates_stub(ccy)

        u = _make_user("u-cache@x.com", "+254700000099")
        _make_wallet(u, "USDT", "1")

        from rest_framework.test import APIClient
        api = APIClient()
        api.force_authenticate(user=self.admin)
        # First request · 5 rate calls (one per currency).
        api.get("/api/v1/auth/admin/users/")
        first_count = rates_mock.call_count
        # Second request · cache hit, NO new rate calls.
        api.get("/api/v1/auth/admin/users/")
        assert rates_mock.call_count == first_count, (
            "rate map must be cached across requests for 60s"
        )
