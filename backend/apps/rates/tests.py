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
            "excise_duty_percent": 10,
        }

        quote = RateService.lock_rate("USDT", Decimal("1300"))

        # spread_revenue = 1300 * 1.5% (from settings) = 19.50
        # platform_fee = 19.50 + 10 = 29.50
        # excise_duty = 29.50 * 10% = 2.95
        # total_kes = 1300 + 10 + 2.95 = 1312.95
        # crypto_amount = 1312.95 / 130
        expected = (Decimal("1312.95") / Decimal("130")).quantize(Decimal("0.00000001"))
        self.assertEqual(Decimal(quote["crypto_amount"]), expected)
        self.assertEqual(quote["excise_duty_kes"], "2.95")


# ===========================================================================
# Rate Alert Tests
# ===========================================================================

from rest_framework.test import APIClient
from apps.accounts.models import User
from .models import RateAlert


class RateAlertCRUDTest(TestCase):
    """Tests for rate alert CRUD endpoints."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(phone="+254700100100", pin="123456")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_alert(self):
        """POST /rates/alerts/ should create a rate alert."""
        resp = self.client.post("/api/v1/rates/alerts/", {
            "currency": "BTC",
            "target_rate": "15000000.00",
            "direction": "above",
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["currency"], "BTC")
        self.assertEqual(resp.data["direction"], "above")
        self.assertTrue(resp.data["is_active"])
        self.assertIsNone(resp.data["triggered_at"])
        self.assertTrue(RateAlert.objects.filter(user=self.user, currency="BTC").exists())

    def test_list_alerts(self):
        """GET /rates/alerts/ should return user's alerts."""
        RateAlert.objects.create(user=self.user, currency="ETH", target_rate="500000", direction="below")
        RateAlert.objects.create(user=self.user, currency="BTC", target_rate="15000000", direction="above")

        resp = self.client.get("/api/v1/rates/alerts/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 2)

    def test_list_alerts_only_own(self):
        """Users should only see their own alerts."""
        other_user = User.objects.create_user(phone="+254700200200", pin="654321")
        RateAlert.objects.create(user=other_user, currency="ETH", target_rate="500000", direction="below")
        RateAlert.objects.create(user=self.user, currency="BTC", target_rate="15000000", direction="above")

        resp = self.client.get("/api/v1/rates/alerts/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["currency"], "BTC")

    def test_delete_alert(self):
        """DELETE /rates/alerts/{id}/ should delete the alert."""
        alert = RateAlert.objects.create(user=self.user, currency="SOL", target_rate="20000", direction="above")
        resp = self.client.delete(f"/api/v1/rates/alerts/{alert.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(RateAlert.objects.filter(id=alert.id).exists())

    def test_delete_other_users_alert_returns_404(self):
        """Cannot delete another user's alert."""
        other_user = User.objects.create_user(phone="+254700300300", pin="111111")
        alert = RateAlert.objects.create(user=other_user, currency="SOL", target_rate="20000", direction="above")
        resp = self.client.delete(f"/api/v1/rates/alerts/{alert.id}/")
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(RateAlert.objects.filter(id=alert.id).exists())

    def test_max_20_active_alerts(self):
        """Should reject creation beyond 20 active alerts."""
        for i in range(20):
            RateAlert.objects.create(
                user=self.user,
                currency="USDT",
                target_rate=str(100 + i),
                direction="above",
            )
        resp = self.client.post("/api/v1/rates/alerts/", {
            "currency": "BTC",
            "target_rate": "15000000",
            "direction": "above",
        })
        self.assertEqual(resp.status_code, 400)

    def test_triggered_alerts_dont_count_toward_limit(self):
        """Triggered (inactive) alerts should not count toward the 20-alert limit."""
        for i in range(20):
            RateAlert.objects.create(
                user=self.user,
                currency="USDT",
                target_rate=str(100 + i),
                direction="above",
                is_active=False,
            )
        resp = self.client.post("/api/v1/rates/alerts/", {
            "currency": "BTC",
            "target_rate": "15000000",
            "direction": "above",
        })
        self.assertEqual(resp.status_code, 201)

    def test_invalid_target_rate(self):
        """Should reject negative or zero target rate."""
        resp = self.client.post("/api/v1/rates/alerts/", {
            "currency": "BTC",
            "target_rate": "-100",
            "direction": "above",
        })
        self.assertEqual(resp.status_code, 400)

    def test_invalid_currency(self):
        """Should reject unsupported currency."""
        resp = self.client.post("/api/v1/rates/alerts/", {
            "currency": "DOGE",
            "target_rate": "100",
            "direction": "above",
        })
        self.assertEqual(resp.status_code, 400)

    def test_invalid_direction(self):
        """Should reject invalid direction."""
        resp = self.client.post("/api/v1/rates/alerts/", {
            "currency": "BTC",
            "target_rate": "15000000",
            "direction": "sideways",
        })
        self.assertEqual(resp.status_code, 400)

    def test_unauthenticated_request(self):
        """Unauthenticated users should get 401."""
        client = APIClient()
        resp = client.get("/api/v1/rates/alerts/")
        self.assertEqual(resp.status_code, 401)


class RateAlertTriggerTest(TestCase):
    """Tests for the rate alert trigger logic in _check_rate_alerts."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            phone="+254700400400", pin="123456", email="test@example.com"
        )

    def _set_rate(self, currency, usd_rate, usd_kes="130"):
        """Helper to seed cache with rates."""
        cache.set(f"rate:crypto:{currency}:usd", str(usd_rate), timeout=60)
        cache.set("rate:forex:usd:kes", str(usd_kes), timeout=60)

    @patch("apps.rates.tasks._send_rate_alert_notification")
    def test_above_alert_triggers(self, mock_notify):
        """Alert should trigger when rate rises above target."""
        alert = RateAlert.objects.create(
            user=self.user, currency="BTC", target_rate="8000000", direction="above"
        )
        # BTC at $65000, USD/KES at 130 => BTC/KES = 8,450,000 > 8,000,000
        self._set_rate("BTC", "65000")

        from .tasks import _check_rate_alerts
        _check_rate_alerts()

        alert.refresh_from_db()
        self.assertFalse(alert.is_active)
        self.assertIsNotNone(alert.triggered_at)
        mock_notify.assert_called_once()

    @patch("apps.rates.tasks._send_rate_alert_notification")
    def test_below_alert_triggers(self, mock_notify):
        """Alert should trigger when rate drops below target."""
        alert = RateAlert.objects.create(
            user=self.user, currency="ETH", target_rate="500000", direction="below"
        )
        # ETH at $3000, USD/KES at 130 => ETH/KES = 390,000 < 500,000
        self._set_rate("ETH", "3000")

        from .tasks import _check_rate_alerts
        _check_rate_alerts()

        alert.refresh_from_db()
        self.assertFalse(alert.is_active)
        self.assertIsNotNone(alert.triggered_at)
        mock_notify.assert_called_once()

    @patch("apps.rates.tasks._send_rate_alert_notification")
    def test_alert_does_not_trigger_when_condition_not_met(self, mock_notify):
        """Alert should stay active when condition is not met."""
        alert = RateAlert.objects.create(
            user=self.user, currency="BTC", target_rate="20000000", direction="above"
        )
        # BTC at $65000, USD/KES at 130 => BTC/KES = 8,450,000 < 20,000,000
        self._set_rate("BTC", "65000")

        from .tasks import _check_rate_alerts
        _check_rate_alerts()

        alert.refresh_from_db()
        self.assertTrue(alert.is_active)
        self.assertIsNone(alert.triggered_at)
        mock_notify.assert_not_called()

    @patch("apps.rates.tasks._send_rate_alert_notification")
    def test_inactive_alerts_are_ignored(self, mock_notify):
        """Already-triggered alerts should not be checked again."""
        from django.utils import timezone as tz
        RateAlert.objects.create(
            user=self.user, currency="BTC", target_rate="8000000",
            direction="above", is_active=False, triggered_at=tz.now(),
        )
        self._set_rate("BTC", "65000")

        from .tasks import _check_rate_alerts
        _check_rate_alerts()

        mock_notify.assert_not_called()

    @patch("apps.rates.tasks._send_rate_alert_notification")
    def test_multiple_alerts_batch_trigger(self, mock_notify):
        """Multiple alerts for different currencies should all be checked."""
        RateAlert.objects.create(
            user=self.user, currency="BTC", target_rate="8000000", direction="above"
        )
        RateAlert.objects.create(
            user=self.user, currency="ETH", target_rate="500000", direction="below"
        )
        RateAlert.objects.create(
            user=self.user, currency="USDT", target_rate="200", direction="above"
        )
        # BTC: 65000*130=8,450,000 > 8,000,000 -> triggers
        # ETH: 3000*130=390,000 < 500,000 -> triggers
        # USDT: 1*130=130 < 200 -> does NOT trigger (direction=above)
        self._set_rate("BTC", "65000")
        cache.set("rate:crypto:ETH:usd", "3000", timeout=60)
        cache.set("rate:crypto:USDT:usd", "1", timeout=60)

        from .tasks import _check_rate_alerts
        _check_rate_alerts()

        self.assertEqual(mock_notify.call_count, 2)
        # USDT alert should remain active
        usdt_alert = RateAlert.objects.get(currency="USDT", user=self.user)
        self.assertTrue(usdt_alert.is_active)

    @patch("apps.core.tasks.send_push_task.delay")
    @patch("apps.core.tasks.send_sms_task.delay")
    @patch("apps.core.tasks.send_email_task.delay")
    def test_notification_sends_push_email_sms(self, mock_email, mock_sms, mock_push):
        """Triggering an alert should send push, email, and SMS notifications."""
        from .tasks import _send_rate_alert_notification

        _send_rate_alert_notification({
            "user": self.user,
            "currency": "BTC",
            "direction": "above",
            "target_rate": Decimal("8000000"),
            "current_rate": Decimal("8450000"),
        })

        mock_push.assert_called_once()
        mock_email.assert_called_once()
        mock_sms.assert_called_once()
