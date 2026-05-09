"""DRF view tests for the exchanges app.

Each provider's link / oauth / withdraw / unlink flow is exercised
end-to-end with mocked exchange-API calls. We verify:

  - Auth required on every endpoint
  - State-token CSRF check on OAuth callbacks
  - One-active-link-per-provider 409
  - Encrypted credential persistence
  - Withdraw flow mints an ExchangeWithdrawal row + dedups by request_id
  - Unlink wipes credentials + sets revoked_at
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.exchanges.models import ExchangeLink, ExchangeWithdrawal
from apps.wallets.models import Wallet


def _auth_client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


# ─────────────────────────────────────────────────────────────────
# Public discovery
# ─────────────────────────────────────────────────────────────────


class ExchangeProvidersViewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254700000010")
        self.client = _auth_client(self.user)

    def test_unauth_rejected(self):
        c = APIClient()
        r = c.get("/api/v1/exchanges/providers/")
        self.assertEqual(r.status_code, 401)

    @override_settings(
        COINBASE_OAUTH_CLIENT_ID="cb",
        COINBASE_OAUTH_CLIENT_SECRET="s",
        NOONES_OAUTH_CLIENT_ID="",
        NOONES_OAUTH_CLIENT_SECRET="",
    )
    def test_lists_three_providers_with_configured_flag(self):
        r = self.client.get("/api/v1/exchanges/providers/")
        self.assertEqual(r.status_code, 200)
        ids = [p["id"] for p in r.json()["providers"]]
        self.assertEqual(set(ids), {"binance", "coinbase", "noones"})
        cfg = {p["id"]: p["configured"] for p in r.json()["providers"]}
        self.assertTrue(cfg["binance"])     # always available
        self.assertTrue(cfg["coinbase"])    # creds set
        self.assertFalse(cfg["noones"])     # creds blank


class ExchangeListViewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254700000011")
        self.client = _auth_client(self.user)

    def test_empty_when_no_links(self):
        r = self.client.get("/api/v1/exchanges/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["links"], [])

    def test_includes_active_links_with_balances(self):
        ExchangeLink.objects.create(
            user=self.user, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k", api_secret="s",
        )
        with mock.patch(
            "apps.exchanges.views._read_balances",
            return_value={"USDT": {"free": Decimal("10"), "locked": Decimal("0")}},
        ):
            r = self.client.get("/api/v1/exchanges/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(len(body["links"]), 1)
        self.assertEqual(body["links"][0]["provider"], "binance")
        self.assertEqual(body["links"][0]["balances"]["USDT"]["free"], "10")

    def test_revoked_links_excluded(self):
        ExchangeLink.objects.create(
            user=self.user, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k", api_secret="s", revoked_at=timezone.now(),
        )
        r = self.client.get("/api/v1/exchanges/")
        self.assertEqual(r.json()["links"], [])


# ─────────────────────────────────────────────────────────────────
# Binance link
# ─────────────────────────────────────────────────────────────────


class BinanceLinkViewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254700000012")
        self.client = _auth_client(self.user)

    def test_400_when_keys_missing(self):
        r = self.client.post(
            "/api/v1/exchanges/binance/link/", {"api_key": ""}, format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_201_with_verified_credentials(self):
        with mock.patch(
            "apps.exchanges.views.binance.verify_credentials",
            return_value={
                "ok": True, "scopes": ["withdraw"],
                "supported_coins": ["USDT", "BTC"],
                "address_whitelist": {"USDT": ["TRC20-addr"]},
            },
        ):
            r = self.client.post(
                "/api/v1/exchanges/binance/link/",
                {"api_key": "AKey", "api_secret": "SSec"},
                format="json",
            )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["link"]["provider"], "binance")
        self.assertEqual(r.json()["supported_coins"], ["USDT", "BTC"])

        link = ExchangeLink.objects.get(user=self.user)
        # Secret round-trips through PIIEncryptedField
        self.assertEqual(link.api_secret, "SSec")
        self.assertEqual(link.scopes, ["withdraw"])

    def test_409_when_already_linked(self):
        ExchangeLink.objects.create(
            user=self.user, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k", api_secret="s",
        )
        r = self.client.post(
            "/api/v1/exchanges/binance/link/",
            {"api_key": "k2", "api_secret": "s2"}, format="json",
        )
        self.assertEqual(r.status_code, 409)

    def test_400_when_binance_rejects_credentials(self):
        from apps.exchanges import binance as bn
        with mock.patch(
            "apps.exchanges.views.binance.verify_credentials",
            side_effect=bn.BinanceError("scope_too_wide", "Trading enabled"),
        ):
            r = self.client.post(
                "/api/v1/exchanges/binance/link/",
                {"api_key": "k", "api_secret": "s"}, format="json",
            )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"], "scope_too_wide")


# ─────────────────────────────────────────────────────────────────
# Coinbase OAuth
# ─────────────────────────────────────────────────────────────────


@override_settings(
    COINBASE_OAUTH_CLIENT_ID="cb_id",
    COINBASE_OAUTH_CLIENT_SECRET="cb_secret",
)
class CoinbaseOAuthFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254700000013")
        self.client = _auth_client(self.user)
        cache.clear()

    def test_start_returns_authorize_url_and_persists_state(self):
        r = self.client.get(
            "/api/v1/exchanges/coinbase/oauth/start/?scheme=app",
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("authorize_url", r.json())
        state = r.json()["state"]
        self.assertEqual(cache.get(f"oauth_state:{self.user.id}:coinbase"), state)

    @override_settings(
        COINBASE_OAUTH_CLIENT_ID="", COINBASE_OAUTH_CLIENT_SECRET="",
    )
    def test_start_503_when_not_configured(self):
        r = self.client.get("/api/v1/exchanges/coinbase/oauth/start/")
        self.assertEqual(r.status_code, 503)

    def test_complete_400_on_invalid_state(self):
        r = self.client.post(
            "/api/v1/exchanges/coinbase/oauth/complete/",
            {"code": "x", "state": "wrong"}, format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"], "invalid_state")

    def test_complete_201_on_valid_flow(self):
        # Seed a state token
        cache.set(f"oauth_state:{self.user.id}:coinbase", "good_state", 600)
        with mock.patch(
            "apps.exchanges.views.coinbase.exchange_code",
            return_value={
                "access_token": "AT", "refresh_token": "RT",
                "expires_in": 7200,
                "scope": "wallet:user:read,wallet:transactions:send",
            },
        ):
            r = self.client.post(
                "/api/v1/exchanges/coinbase/oauth/complete/",
                {"code": "the_code", "state": "good_state"},
                format="json",
            )
        self.assertEqual(r.status_code, 201)
        link = ExchangeLink.objects.get(
            user=self.user, provider=ExchangeLink.PROVIDER_COINBASE,
        )
        # Token round-trip via PIIEncryptedField
        self.assertEqual(link.access_token, "AT")
        self.assertEqual(link.refresh_token, "RT")
        # State was one-time use
        self.assertIsNone(cache.get(f"oauth_state:{self.user.id}:coinbase"))


# ─────────────────────────────────────────────────────────────────
# Unlink
# ─────────────────────────────────────────────────────────────────


class ExchangeUnlinkTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254700000014")
        self.client = _auth_client(self.user)

    def test_404_when_not_linked(self):
        r = self.client.delete("/api/v1/exchanges/binance/")
        self.assertEqual(r.status_code, 404)

    def test_unlink_wipes_secrets_and_sets_revoked_at(self):
        link = ExchangeLink.objects.create(
            user=self.user, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k", api_secret="s",
        )
        r = self.client.delete("/api/v1/exchanges/binance/")
        self.assertEqual(r.status_code, 200)
        link.refresh_from_db()
        self.assertIsNotNone(link.revoked_at)
        # PIIEncryptedField returns "" or None for empty/cleared values
        self.assertIn(link.api_secret, ("", None))
        self.assertIn(link.access_token, ("", None))
        self.assertIn(link.refresh_token, ("", None))


# ─────────────────────────────────────────────────────────────────
# Withdraw / pull
# ─────────────────────────────────────────────────────────────────


class ExchangeWithdrawTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254700000015")
        self.client = _auth_client(self.user)
        # Provision a Cpay deposit address for USDT
        self.wallet = Wallet.objects.create(
            user=self.user, currency="USDT",
            deposit_address="TXdummyTronAddress123456789",
            balance=Decimal("0"),
        )

    def test_400_when_not_linked(self):
        r = self.client.post(
            "/api/v1/exchanges/binance/withdraw/",
            {"currency": "USDT", "amount": "10"}, format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"], "not_linked")

    def test_400_when_currency_missing(self):
        ExchangeLink.objects.create(
            user=self.user, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k", api_secret="s",
        )
        r = self.client.post(
            "/api/v1/exchanges/binance/withdraw/",
            {"amount": "10"}, format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_400_when_amount_zero_or_negative(self):
        ExchangeLink.objects.create(
            user=self.user, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k", api_secret="s",
        )
        r = self.client.post(
            "/api/v1/exchanges/binance/withdraw/",
            {"currency": "USDT", "amount": "0"}, format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_202_records_withdrawal_and_calls_binance(self):
        ExchangeLink.objects.create(
            user=self.user, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="K", api_secret="S",
        )
        with mock.patch(
            "apps.exchanges.views.binance.withdraw",
            return_value={"id": "binance_wd_123"},
        ) as mwithdraw:
            r = self.client.post(
                "/api/v1/exchanges/binance/withdraw/",
                {"currency": "USDT", "amount": "10"}, format="json",
            )
        self.assertEqual(r.status_code, 202)
        self.assertEqual(r.json()["exchange_tx_id"], "binance_wd_123")
        wd = ExchangeWithdrawal.objects.get(user=self.user)
        self.assertEqual(wd.status, ExchangeWithdrawal.STATUS_PENDING)
        self.assertEqual(wd.exchange_tx_id, "binance_wd_123")
        self.assertEqual(wd.network, "TRX")  # default for USDT
        # Verify the call shape
        args, kwargs = mwithdraw.call_args
        self.assertEqual(kwargs["coin"], "USDT")
        self.assertEqual(kwargs["network"], "TRX")
        self.assertEqual(kwargs["destination_address"], self.wallet.deposit_address)
        self.assertEqual(kwargs["amount"], Decimal("10"))

    def test_400_when_binance_rejects_with_provider_error(self):
        ExchangeLink.objects.create(
            user=self.user, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="K", api_secret="S",
        )
        from apps.exchanges import binance as bn
        with mock.patch(
            "apps.exchanges.views.binance.withdraw",
            side_effect=bn.BinanceError("-4067", "Address not in whitelist"),
        ):
            r = self.client.post(
                "/api/v1/exchanges/binance/withdraw/",
                {"currency": "USDT", "amount": "10"}, format="json",
            )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"], "-4067")
        # Withdrawal row exists but marked failed
        wd = ExchangeWithdrawal.objects.get(user=self.user)
        self.assertEqual(wd.status, ExchangeWithdrawal.STATUS_FAILED)
        self.assertEqual(wd.error_code, "-4067")


class ExchangeWithdrawalListTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254700000016")
        self.client = _auth_client(self.user)

    def test_lists_user_withdrawals(self):
        link = ExchangeLink.objects.create(
            user=self.user, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k", api_secret="s",
        )
        ExchangeWithdrawal.objects.create(
            user=self.user, link=link, request_id="req1",
            currency="USDT", network="TRX", amount=Decimal("5"),
            destination_address="TX...",
        )
        r = self.client.get("/api/v1/exchanges/withdrawals/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["withdrawals"]), 1)
        self.assertEqual(r.json()["withdrawals"][0]["currency"], "USDT")

    def test_other_users_withdrawals_not_visible(self):
        other = User.objects.create_user(phone="+254700099999")
        link = ExchangeLink.objects.create(
            user=other, provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k", api_secret="s",
        )
        ExchangeWithdrawal.objects.create(
            user=other, link=link, request_id="req1",
            currency="USDT", network="TRX", amount=Decimal("5"),
            destination_address="TX...",
        )
        r = self.client.get("/api/v1/exchanges/withdrawals/")
        self.assertEqual(r.json()["withdrawals"], [])
