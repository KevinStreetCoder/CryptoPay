"""Unit tests for the Binance / Coinbase / Noones clients.

We mock all HTTP calls (the suite must not hit live exchange APIs)
and verify:

  - Request signing / OAuth body construction is correct
  - Error mapping covers the documented codes
  - Status mapping covers every code we observe
  - Token refresh persists the rotated tokens onto the link
  - Configuration guards refuse to operate when secrets are missing
"""
from __future__ import annotations

import hashlib
import hmac
from decimal import Decimal
from unittest import mock
from urllib.parse import parse_qs, urlparse

import pytest
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.exchanges import binance, coinbase, noones
from apps.exchanges.models import ExchangeLink


# ─────────────────────────────────────────────────────────────────
# Binance
# ─────────────────────────────────────────────────────────────────


class BinanceSigningTests(TestCase):
    def test_sign_is_deterministic_hmac_sha256(self):
        params = {"a": "1", "b": "2", "timestamp": 1700000000000}
        sig = binance._sign(params, "supersecret")
        # HMAC of "a=1&b=2&timestamp=1700000000000" with key "supersecret"
        from urllib.parse import urlencode
        expected = hmac.new(
            b"supersecret",
            urlencode(params).encode(),
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(sig, expected)

    def test_signed_request_appends_timestamp_signature_apikey_header(self):
        with mock.patch("apps.exchanges.binance.requests.get") as mget:
            mock_resp = mock.MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = []
            mget.return_value = mock_resp
            binance._signed_get("api_K", "secret_S", "/sapi/v1/ping")
            args, kwargs = mget.call_args
            sent_params = kwargs["params"]
            self.assertIn("timestamp", sent_params)
            self.assertIn("signature", sent_params)
            self.assertEqual(sent_params["recvWindow"], 5000)
            self.assertEqual(kwargs["headers"]["X-MBX-APIKEY"], "api_K")


class BinanceErrorMappingTests(TestCase):
    def test_4xx_raises_with_upstream_code(self):
        with mock.patch("apps.exchanges.binance.requests.get") as mget:
            mock_resp = mock.MagicMock()
            mock_resp.status_code = 400
            mock_resp.json.return_value = {
                "code": -2014, "msg": "API-key format invalid."
            }
            mget.return_value = mock_resp
            with self.assertRaises(binance.BinanceError) as cm:
                binance._signed_get("k", "s", "/sapi/v1/account")
            self.assertEqual(cm.exception.code, "-2014")
            self.assertIn("invalid", cm.exception.message)
            self.assertEqual(cm.exception.http_status, 400)

    def test_network_error_wraps_to_binance_error(self):
        import requests
        with mock.patch("apps.exchanges.binance.requests.get") as mget:
            mget.side_effect = requests.ConnectionError("no route")
            with self.assertRaises(binance.BinanceError) as cm:
                binance._signed_get("k", "s", "/")
            self.assertEqual(cm.exception.code, "network")


class BinanceStatusMappingTests(TestCase):
    def test_0_to_pending(self):
        self.assertEqual(binance.map_binance_status(0), "pending")

    def test_4_to_confirming(self):
        self.assertEqual(binance.map_binance_status(4), "confirming")

    def test_6_to_done(self):
        self.assertEqual(binance.map_binance_status(6), "done")

    def test_3_to_failed(self):
        self.assertEqual(binance.map_binance_status(3), "failed")

    def test_unknown_code_defaults_to_pending(self):
        self.assertEqual(binance.map_binance_status(99), "pending")


# ─────────────────────────────────────────────────────────────────
# Coinbase
# ─────────────────────────────────────────────────────────────────


@override_settings(
    COINBASE_OAUTH_CLIENT_ID="cb_test_id",
    COINBASE_OAUTH_CLIENT_SECRET="cb_test_secret",
    EXCHANGE_OAUTH_REDIRECT_BASE="https://cpay.co.ke",
)
class CoinbaseOAuthTests(TestCase):
    def test_authorize_url_includes_required_params(self):
        url = coinbase.build_authorize_url(state="csrf-xyz", scheme="app")
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        self.assertEqual(params["response_type"][0], "code")
        self.assertEqual(params["client_id"][0], "cb_test_id")
        self.assertEqual(params["redirect_uri"][0], "cryptopay://oauth/coinbase")
        self.assertEqual(params["state"][0], "csrf-xyz")
        # All 3 default scopes present
        self.assertIn("wallet:transactions:send", params["scope"][0])
        self.assertIn("wallet:accounts:read", params["scope"][0])

    def test_web_redirect_uri_uses_https_callback(self):
        url = coinbase.build_authorize_url(state="x", scheme="web")
        params = parse_qs(urlparse(url).query)
        self.assertTrue(
            params["redirect_uri"][0].startswith("https://cpay.co.ke")
        )
        self.assertIn(
            "/exchanges/coinbase/oauth/callback/",
            params["redirect_uri"][0],
        )

    def test_exchange_code_posts_correct_body(self):
        with mock.patch("apps.exchanges.coinbase.requests.post") as mpost:
            mr = mock.MagicMock()
            mr.status_code = 200
            mr.json.return_value = {
                "access_token": "AT",
                "refresh_token": "RT",
                "expires_in": 7200,
                "scope": "wallet:user:read",
                "token_type": "Bearer",
            }
            mpost.return_value = mr
            tokens = coinbase.exchange_code("the_code", scheme="app")
            self.assertEqual(tokens["access_token"], "AT")
            args, kwargs = mpost.call_args
            self.assertEqual(args[0], coinbase.COINBASE_TOKEN_URL)
            body = kwargs["data"]
            self.assertEqual(body["grant_type"], "authorization_code")
            self.assertEqual(body["code"], "the_code")
            self.assertEqual(body["client_id"], "cb_test_id")
            self.assertEqual(body["client_secret"], "cb_test_secret")

    def test_token_endpoint_4xx_raises_with_oauth_error_code(self):
        with mock.patch("apps.exchanges.coinbase.requests.post") as mpost:
            mr = mock.MagicMock()
            mr.status_code = 400
            mr.json.return_value = {
                "error": "invalid_grant",
                "error_description": "expired",
            }
            mpost.return_value = mr
            with self.assertRaises(coinbase.CoinbaseError) as cm:
                coinbase.exchange_code("bad")
            self.assertEqual(cm.exception.code, "invalid_grant")


class CoinbaseConfigGuardTests(TestCase):
    @override_settings(COINBASE_OAUTH_CLIENT_ID="", COINBASE_OAUTH_CLIENT_SECRET="")
    def test_authorize_url_refuses_when_not_configured(self):
        with self.assertRaises(coinbase.CoinbaseError) as cm:
            coinbase.build_authorize_url("state")
        self.assertEqual(cm.exception.code, "not_configured")

    @override_settings(COINBASE_OAUTH_CLIENT_ID="", COINBASE_OAUTH_CLIENT_SECRET="")
    def test_is_configured_returns_false(self):
        self.assertFalse(coinbase.is_configured())

    @override_settings(
        COINBASE_OAUTH_CLIENT_ID="x", COINBASE_OAUTH_CLIENT_SECRET="y"
    )
    def test_is_configured_returns_true_when_both_set(self):
        self.assertTrue(coinbase.is_configured())


class CoinbaseStatusMappingTests(TestCase):
    def test_completed_to_done(self):
        self.assertEqual(coinbase.map_coinbase_status("completed"), "done")

    def test_pending_to_pending(self):
        self.assertEqual(coinbase.map_coinbase_status("pending"), "pending")

    def test_failed_to_failed(self):
        self.assertEqual(coinbase.map_coinbase_status("failed"), "failed")

    def test_canceled_to_failed(self):
        self.assertEqual(coinbase.map_coinbase_status("canceled"), "failed")

    def test_unknown_defaults_to_pending(self):
        self.assertEqual(coinbase.map_coinbase_status("frobnicated"), "pending")


@override_settings(
    COINBASE_OAUTH_CLIENT_ID="cb_id",
    COINBASE_OAUTH_CLIENT_SECRET="cb_secret",
)
class CoinbaseTokenRefreshTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254700000001")
        self.link = ExchangeLink.objects.create(
            user=self.user,
            provider=ExchangeLink.PROVIDER_COINBASE,
            access_token="OLD_AT",
            refresh_token="OLD_RT",
            access_token_expires_at=timezone.now() - timezone.timedelta(seconds=60),
        )

    def test_refresh_persists_rotated_tokens(self):
        with mock.patch("apps.exchanges.coinbase.requests.post") as mpost:
            mr = mock.MagicMock()
            mr.status_code = 200
            mr.json.return_value = {
                "access_token": "NEW_AT",
                "refresh_token": "NEW_RT",
                "expires_in": 7200,
            }
            mpost.return_value = mr
            tok = coinbase.access_token_for(self.link)
            self.assertEqual(tok, "NEW_AT")
            self.link.refresh_from_db()
            self.assertEqual(self.link.access_token, "NEW_AT")
            self.assertEqual(self.link.refresh_token, "NEW_RT")
            self.assertIsNotNone(self.link.last_used_at)

    def test_no_refresh_when_token_still_valid(self):
        self.link.access_token_expires_at = timezone.now() + timezone.timedelta(hours=2)
        self.link.save(update_fields=["access_token_expires_at"])
        with mock.patch("apps.exchanges.coinbase.requests.post") as mpost:
            tok = coinbase.access_token_for(self.link)
            self.assertEqual(tok, "OLD_AT")
            mpost.assert_not_called()


# ─────────────────────────────────────────────────────────────────
# Noones
# ─────────────────────────────────────────────────────────────────


@override_settings(
    NOONES_OAUTH_CLIENT_ID="no_id",
    NOONES_OAUTH_CLIENT_SECRET="no_secret",
    EXCHANGE_OAUTH_REDIRECT_BASE="https://cpay.co.ke",
)
class NoonesOAuthTests(TestCase):
    def test_authorize_url_uses_space_separated_scopes(self):
        # OAuth 2.0 spec is space-separated scopes; some providers use
        # comma. Noones follows the spec strictly · verify.
        url = noones.build_authorize_url(state="csrf", scheme="app")
        params = parse_qs(urlparse(url).query)
        scope = params["scope"][0]
        self.assertIn("read_balance", scope)
        self.assertIn("read_account", scope)
        self.assertIn(" ", scope)  # space-separated

    def test_authorize_url_app_scheme_uses_deep_link(self):
        url = noones.build_authorize_url(state="x", scheme="app")
        params = parse_qs(urlparse(url).query)
        self.assertEqual(params["redirect_uri"][0], "cryptopay://oauth/noones")


class NoonesErrorMappingTests(TestCase):
    @override_settings(
        NOONES_OAUTH_CLIENT_ID="x", NOONES_OAUTH_CLIENT_SECRET="y",
    )
    def test_token_4xx_raises(self):
        with mock.patch("apps.exchanges.noones.requests.post") as mpost:
            mr = mock.MagicMock()
            mr.status_code = 400
            mr.json.return_value = {
                "error": "invalid_request",
                "error_description": "missing code",
            }
            mpost.return_value = mr
            with self.assertRaises(noones.NoonesError) as cm:
                noones.exchange_code("x")
            self.assertEqual(cm.exception.code, "invalid_request")

    def test_api_post_unwraps_noones_error_envelope(self):
        with mock.patch("apps.exchanges.noones.requests.post") as mpost:
            mr = mock.MagicMock()
            mr.status_code = 400
            mr.json.return_value = {
                "status": "error",
                "error": {
                    "code": "insufficient_scope",
                    "message": "wallet:withdraw not granted",
                },
            }
            mpost.return_value = mr
            with self.assertRaises(noones.NoonesError) as cm:
                noones._api_post("AT", "/wallet/send", {})
            self.assertEqual(cm.exception.code, "insufficient_scope")


class NoonesStatusMappingTests(TestCase):
    def test_completed_to_done(self):
        self.assertEqual(noones.map_noones_status("completed"), "done")

    def test_succeeded_to_done(self):
        self.assertEqual(noones.map_noones_status("succeeded"), "done")

    def test_processing_to_confirming(self):
        self.assertEqual(noones.map_noones_status("processing"), "confirming")

    def test_failed_to_failed(self):
        self.assertEqual(noones.map_noones_status("failed"), "failed")


class NoonesConfigGuardTests(TestCase):
    @override_settings(NOONES_OAUTH_CLIENT_ID="", NOONES_OAUTH_CLIENT_SECRET="")
    def test_authorize_refuses_when_not_configured(self):
        with self.assertRaises(noones.NoonesError) as cm:
            noones.build_authorize_url("state")
        self.assertEqual(cm.exception.code, "not_configured")

    @override_settings(NOONES_OAUTH_CLIENT_ID="x", NOONES_OAUTH_CLIENT_SECRET="y")
    def test_is_configured_true_when_both_set(self):
        self.assertTrue(noones.is_configured())


# ─────────────────────────────────────────────────────────────────
# Smoke test · model creation + encryption round-trip
# ─────────────────────────────────────────────────────────────────


class ExchangeLinkEncryptionTests(TestCase):
    """Verify the PIIEncryptedField wraps the secrets transparently."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+254700000099")

    def test_roundtrip_refresh_and_access_token(self):
        link = ExchangeLink.objects.create(
            user=self.user,
            provider=ExchangeLink.PROVIDER_COINBASE,
            access_token="AT_plaintext_in_memory",
            refresh_token="RT_plaintext_in_memory",
        )
        link.refresh_from_db()
        # PIIEncryptedField transparently decrypts on read
        self.assertEqual(link.access_token, "AT_plaintext_in_memory")
        self.assertEqual(link.refresh_token, "RT_plaintext_in_memory")

    def test_one_active_link_per_provider_unique_constraint(self):
        ExchangeLink.objects.create(
            user=self.user,
            provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="key1", api_secret="sec1",
        )
        # Second active link for same provider should fail
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            ExchangeLink.objects.create(
                user=self.user,
                provider=ExchangeLink.PROVIDER_BINANCE,
                api_key="key2", api_secret="sec2",
            )

    def test_revoked_link_does_not_block_relink(self):
        old = ExchangeLink.objects.create(
            user=self.user,
            provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k1", api_secret="s1",
        )
        old.revoked_at = timezone.now()
        old.save(update_fields=["revoked_at"])
        # Now a fresh link succeeds
        new = ExchangeLink.objects.create(
            user=self.user,
            provider=ExchangeLink.PROVIDER_BINANCE,
            api_key="k2", api_secret="s2",
        )
        self.assertTrue(new.is_active)
        self.assertFalse(old.is_active)
