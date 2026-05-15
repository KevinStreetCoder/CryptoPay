"""Regression tests for the Redis-backed wallet-list cache.

2026-05-15 · the user dashboard hits WalletListView on every load,
running a Postgres query per request. 30 s of cached JSON cuts the
Postgres load by ~95 %. Cache must invalidate on credit/debit so the
dashboard never shows stale balances after a real money movement.
"""
from __future__ import annotations

from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.wallets.models import Wallet
from apps.wallets.services import WalletService
from apps.wallets.views import _wallet_cache_key, invalidate_wallet_cache


class WalletListCacheTest(TestCase):

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            phone="+254711000001", pin="123456",
        )
        # Pre-seed two wallets so the response has real content.
        self.usdt = Wallet.objects.create(
            user=self.user, currency="USDT",
            balance=Decimal("10"),
            deposit_address="TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1",
        )
        self.btc = Wallet.objects.create(
            user=self.user, currency="BTC",
            balance=Decimal("0.001"),
            deposit_address="bc1q" + "x" * 38,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_first_request_misses_then_populates_cache(self):
        key = _wallet_cache_key(self.user.id)
        self.assertIsNone(cache.get(key), "cache must be cold at test start")

        r = self.client.get("/api/v1/wallets/")
        self.assertEqual(r.status_code, 200)
        self.assertIsNotNone(cache.get(key), "cache must be populated on miss")

    def test_second_request_serves_from_cache(self):
        """Confirm the cache hit path returns the same payload without
        re-querying Postgres."""
        # Prime the cache.
        r1 = self.client.get("/api/v1/wallets/")
        # Mutate the DB directly · skip the WalletService so we DON'T
        # bust the cache. If the view re-queries, the new value would
        # show up. If it serves the cache, the old value persists.
        Wallet.objects.filter(id=self.usdt.id).update(balance=Decimal("999"))

        r2 = self.client.get("/api/v1/wallets/")
        self.assertEqual(r1.data, r2.data, "cache hit must serve identical bytes")
        # Confirm by inspecting the cached usdt balance · NOT 999.
        cached = cache.get(_wallet_cache_key(self.user.id))
        usdt_row = next(w for w in cached if w["currency"] == "USDT")
        self.assertEqual(Decimal(usdt_row["balance"]), Decimal("10"))

    def test_credit_invalidates_cache(self):
        """A real credit must invalidate the cache so the dashboard sees
        the new balance on next read."""
        self.client.get("/api/v1/wallets/")  # prime cache
        self.assertIsNotNone(cache.get(_wallet_cache_key(self.user.id)))

        WalletService.credit(
            wallet_id=self.usdt.id,
            amount=Decimal("5"),
            transaction_id=__import__("uuid").uuid4(),
        )
        # Cache MUST be dropped by the credit hook.
        self.assertIsNone(
            cache.get(_wallet_cache_key(self.user.id)),
            "credit must invalidate the wallet-list cache",
        )

    def test_debit_invalidates_cache(self):
        self.client.get("/api/v1/wallets/")  # prime
        self.assertIsNotNone(cache.get(_wallet_cache_key(self.user.id)))

        WalletService.debit(
            wallet_id=self.usdt.id,
            amount=Decimal("1"),
            transaction_id=__import__("uuid").uuid4(),
        )
        self.assertIsNone(cache.get(_wallet_cache_key(self.user.id)))

    def test_invalidate_helper_is_idempotent(self):
        """Calling invalidate twice (or on a cold cache) must not raise."""
        invalidate_wallet_cache(self.user.id)
        invalidate_wallet_cache(self.user.id)
        # Still cold · no exception means we passed.

    def test_cross_user_cache_isolation(self):
        """User A's cache must NOT serve User B's data."""
        other = User.objects.create_user(phone="+254711000002", pin="123456")
        Wallet.objects.create(
            user=other, currency="USDT", balance=Decimal("777"),
            deposit_address="TYyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
        )

        # Prime user A's cache.
        self.client.get("/api/v1/wallets/")

        # Switch to user B · their cache key is different, so they should
        # hit the DB and see THEIR wallet, not user A's.
        client_b = APIClient()
        client_b.force_authenticate(other)
        rb = client_b.get("/api/v1/wallets/")
        self.assertEqual(rb.status_code, 200)
        b_payload = rb.data if isinstance(rb.data, list) else list(rb.data)
        currencies = {w["currency"] for w in b_payload}
        self.assertIn("USDT", currencies)
        # User B has 1 wallet, user A had 2 · the payloads MUST differ
        # in row count (or at minimum in balance).
        balances = {w["currency"]: w["balance"] for w in b_payload}
        self.assertEqual(Decimal(balances["USDT"]), Decimal("777"))
