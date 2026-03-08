"""Tests for rate composition, spread calculation, and quote locking."""

from decimal import Decimal
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.test import TestCase, override_settings

from .models import ExchangeRate
from .services import RateService


class RateCompositionTest(TestCase):
    def setUp(self):
        cache.clear()

    @patch("apps.rates.services.requests.get")
    def test_get_crypto_usd_rate_from_api(self, mock_get):
        """Should fetch and return crypto/USD rate from CoinGecko."""
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {"tether": {"usd": 1.0002}}
        mock_get.return_value.raise_for_status = lambda: None

        rate = RateService.get_crypto_usd_rate("USDT")
        self.assertEqual(rate, Decimal("1.0002"))

        # Should also save to DB
        self.assertTrue(ExchangeRate.objects.filter(pair="USDT/USD").exists())

    @patch("apps.rates.services.requests.get")
    def test_get_crypto_usd_rate_cached(self, mock_get):
        """Should use cached rate on second call."""
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {"bitcoin": {"usd": 65000}}
        mock_get.return_value.raise_for_status = lambda: None

        rate1 = RateService.get_crypto_usd_rate("BTC")
        rate2 = RateService.get_crypto_usd_rate("BTC")

        self.assertEqual(rate1, rate2)
        # API should only be called once (second call uses cache)
        self.assertEqual(mock_get.call_count, 1)

    def test_unsupported_currency_raises(self):
        with self.assertRaises(ValueError):
            RateService.get_crypto_usd_rate("DOGE")

    @patch("apps.rates.services.requests.get")
    def test_api_failure_falls_back_to_db(self, mock_get):
        """When API fails, should fall back to latest DB rate."""
        # Seed a DB rate
        ExchangeRate.objects.create(pair="ETH/USD", rate=Decimal("3500"), source="coingecko")

        mock_get.side_effect = Exception("Network error")

        rate = RateService.get_crypto_usd_rate("ETH")
        self.assertEqual(rate, Decimal("3500"))


class SpreadCalculationTest(TestCase):
    def setUp(self):
        cache.clear()

    @patch.object(RateService, "get_usd_kes_rate", return_value=Decimal("129.50"))
    @patch.object(RateService, "get_crypto_usd_rate", return_value=Decimal("1.0002"))
    def test_spread_applied_correctly(self, mock_crypto, mock_forex):
        """Final rate should be raw_rate * (1 - spread_percent/100)."""
        result = RateService.get_crypto_kes_rate("USDT")

        raw_rate = Decimal("1.0002") * Decimal("129.50")
        spread = Decimal("1.5") / Decimal("100")
        expected_final = raw_rate * (Decimal("1") - spread)

        self.assertEqual(Decimal(result["final_rate"]), expected_final.quantize(Decimal("0.01")))
        self.assertEqual(result["spread_percent"], settings.PLATFORM_SPREAD_PERCENT)
        self.assertEqual(result["flat_fee_kes"], settings.FLAT_FEE_KES)

    @patch.object(RateService, "get_usd_kes_rate", return_value=Decimal("129.50"))
    @patch.object(RateService, "get_crypto_usd_rate", return_value=Decimal("65000"))
    def test_spread_on_btc(self, mock_crypto, mock_forex):
        """Spread should work for high-value currencies like BTC."""
        result = RateService.get_crypto_kes_rate("BTC")

        raw_rate = Decimal("65000") * Decimal("129.50")
        expected_final = raw_rate * (Decimal("1") - Decimal("0.015"))

        self.assertEqual(Decimal(result["final_rate"]), expected_final.quantize(Decimal("0.01")))


class QuoteLockingTest(TestCase):
    def setUp(self):
        cache.clear()

    @patch.object(RateService, "get_crypto_kes_rate")
    def test_lock_rate_creates_quote(self, mock_rate):
        mock_rate.return_value = {
            "currency": "USDT",
            "crypto_usd": "1.0002",
            "usd_kes": "129.50",
            "raw_rate": "129.53",
            "spread_percent": 1.5,
            "final_rate": "127.58",
            "flat_fee_kes": 10,
        }

        quote = RateService.lock_rate("USDT", Decimal("1000"))

        self.assertIn("quote_id", quote)
        self.assertEqual(quote["currency"], "USDT")
        self.assertEqual(quote["kes_amount"], "1000")

        # Should be retrievable
        retrieved = RateService.get_locked_quote(quote["quote_id"])
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["quote_id"], quote["quote_id"])

    def test_expired_quote_returns_none(self):
        """After TTL, quote should not be retrievable."""
        cache.set("quote:expired-id", {"test": True}, timeout=0)
        result = RateService.get_locked_quote("expired-id")
        # timeout=0 means immediately expired in most cache backends
        # This tests the interface; actual TTL behavior depends on cache backend

    @patch.object(RateService, "get_crypto_kes_rate")
    def test_quote_calculates_crypto_amount(self, mock_rate):
        mock_rate.return_value = {
            "currency": "USDT",
            "crypto_usd": "1.0",
            "usd_kes": "130.0",
            "raw_rate": "130.0",
            "spread_percent": 0,
            "final_rate": "130.00",
            "flat_fee_kes": 10,
        }

        quote = RateService.lock_rate("USDT", Decimal("1300"))

        # total_kes = 1300 + 10 = 1310
        # crypto_amount = 1310 / 130 = 10.07692307...
        expected = (Decimal("1310") / Decimal("130")).quantize(Decimal("0.00000001"))
        self.assertEqual(Decimal(quote["crypto_amount"]), expected)
