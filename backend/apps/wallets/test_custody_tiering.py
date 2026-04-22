"""
Tests for Hot/Warm/Cold custody tiering — scheduled sweep + admin confirm.

Covers the real on-chain sweep wired in 2026-04-22:
  - `initiate_hot_to_cold_transfer` broadcasts on-chain then debits
  - `check_rebalance_needed` prefers hot→cold when COLD env is set
  - `check_custody_thresholds` Celery task dispatches hot→cold
  - `confirm_cold_transfer` admin-confirm endpoint
  - `init_custody_tiers` management command is idempotent
"""

from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.wallets.custody import CustodyService, get_custody_config
from apps.wallets.models import CustodyTransfer, SystemWallet, WalletTier


COLD_TRON = "TColdTronAddress000000000000000000"
COLD_POLY = "0xColdPolygonAddress00000000000000000000000"


class CustodyHotToColdTest(TestCase):
    """Real on-chain broadcast for the new hot→cold sweep path."""

    def setUp(self):
        self.service = CustodyService()
        # Seed hot + cold wallets so get_tier_balances sees them
        self.hot = SystemWallet.objects.create(
            wallet_type="hot",
            currency="USDT",
            chain="tron",
            tier=WalletTier.HOT,
            address="THotTronAddress0000000000000000000",
            balance=Decimal("6000"),  # Over 5000 max threshold
            is_active=True,
        )
        self.cold = SystemWallet.objects.create(
            wallet_type="cold",
            currency="USDT",
            chain="tron",
            tier=WalletTier.COLD,
            address="",  # Will be resolved from env
            balance=Decimal("0"),
            is_active=True,
        )

    @override_settings(COLD_WALLET_TRON=COLD_TRON)
    def test_check_rebalance_prefers_hot_to_cold_when_cold_configured(self):
        rebalance = self.service.check_rebalance_needed("USDT")
        self.assertIsNotNone(rebalance)
        self.assertEqual(rebalance["direction"], "hot_to_cold")
        # Hot balance is 6000, target is 5% of 6000 = 300 → excess ≈ 5500
        # But max_single_withdrawal for USDT is 2000, so it must be capped.
        config = get_custody_config("USDT")
        self.assertLessEqual(rebalance["amount"], config.max_single_withdrawal)

    def test_check_rebalance_falls_back_to_warm_without_cold_env(self):
        # Explicitly unset to prove the fallback path
        with self.settings(COLD_WALLET_TRON=""):
            rebalance = self.service.check_rebalance_needed("USDT")
        self.assertIsNotNone(rebalance)
        self.assertEqual(rebalance["direction"], "hot_to_warm")

    @override_settings(COLD_WALLET_TRON=COLD_TRON, DEBUG=False)
    def test_initiate_hot_to_cold_broadcasts_then_debits(self):
        """Broadcast succeeds → hot is debited, cold is credited, tx_hash saved."""
        with patch(
            "apps.blockchain.tasks._broadcast_to_chain",
            return_value="0xAbCdEf1234567890",
        ) as broadcast:
            transfer = self.service.initiate_hot_to_cold_transfer(
                currency="USDT",
                amount=Decimal("1500"),
                initiated_by="test",
                reason="test sweep",
            )

        broadcast.assert_called_once()
        call_kwargs = broadcast.call_args.kwargs
        self.assertEqual(call_kwargs["network"], "tron")
        self.assertEqual(call_kwargs["currency"], "USDT")
        self.assertEqual(call_kwargs["destination_address"], COLD_TRON)
        self.assertEqual(call_kwargs["amount"], Decimal("1500"))

        self.hot.refresh_from_db()
        self.cold.refresh_from_db()
        self.assertEqual(self.hot.balance, Decimal("4500"))  # 6000 − 1500
        self.assertEqual(self.cold.balance, Decimal("1500"))  # Credited

        self.assertEqual(transfer.tx_hash, "0xAbCdEf1234567890")
        self.assertEqual(transfer.status, CustodyTransfer.Status.SUBMITTED)
        self.assertEqual(transfer.to_address, COLD_TRON)
        self.assertEqual(transfer.from_tier, WalletTier.HOT)
        self.assertEqual(transfer.to_tier, WalletTier.COLD)

    @override_settings(COLD_WALLET_TRON=COLD_TRON, DEBUG=False)
    def test_initiate_hot_to_cold_does_not_debit_on_broadcast_failure(self):
        """Broadcast raises → hot balance stays intact, transfer marked FAILED."""
        hot_before = self.hot.balance
        cold_before = self.cold.balance

        with patch(
            "apps.blockchain.tasks._broadcast_to_chain",
            side_effect=RuntimeError("network timeout"),
        ):
            with self.assertRaises(RuntimeError):
                self.service.initiate_hot_to_cold_transfer(
                    currency="USDT",
                    amount=Decimal("1500"),
                    initiated_by="test",
                )

        self.hot.refresh_from_db()
        self.cold.refresh_from_db()
        self.assertEqual(self.hot.balance, hot_before)  # unchanged
        self.assertEqual(self.cold.balance, cold_before)

        failed = CustodyTransfer.objects.filter(
            from_tier=WalletTier.HOT,
            to_tier=WalletTier.COLD,
            status=CustodyTransfer.Status.FAILED,
        ).first()
        self.assertIsNotNone(failed)
        self.assertIn("network timeout", failed.error_message)

    def test_initiate_hot_to_cold_rejects_without_cold_address(self):
        with self.settings(COLD_WALLET_TRON=""):
            self.cold.address = ""
            self.cold.save()
            with self.assertRaises(ValueError) as ctx:
                self.service.initiate_hot_to_cold_transfer(
                    currency="USDT",
                    amount=Decimal("500"),
                )
            self.assertIn("COLD_WALLET_TRON", str(ctx.exception))

    @override_settings(COLD_WALLET_TRON=COLD_TRON)
    def test_initiate_hot_to_cold_rejects_insufficient_balance(self):
        with self.assertRaises(ValueError):
            self.service.initiate_hot_to_cold_transfer(
                currency="USDT",
                amount=Decimal("999999"),
            )

    @override_settings(COLD_WALLET_TRON=COLD_TRON)
    def test_initiate_hot_to_cold_enforces_rate_limits(self):
        config = get_custody_config("USDT")
        with self.assertRaises(ValueError) as ctx:
            self.service.initiate_hot_to_cold_transfer(
                currency="USDT",
                amount=config.max_single_withdrawal + Decimal("1"),
            )
        self.assertIn("exceeds max single withdrawal", str(ctx.exception))


class CustodyCurrencyChainMappingTest(TestCase):
    def test_all_supported_currencies_have_a_chain(self):
        """No silent fall-through to 'tron' for non-USDT currencies."""
        service = CustodyService()
        self.assertEqual(service._currency_to_chain("USDT"), "tron")
        self.assertEqual(service._currency_to_chain("USDC"), "polygon")
        self.assertEqual(service._currency_to_chain("ETH"), "ethereum")
        self.assertEqual(service._currency_to_chain("BTC"), "bitcoin")
        self.assertEqual(service._currency_to_chain("SOL"), "solana")

    @override_settings(COLD_WALLET_POLYGON=COLD_POLY)
    def test_resolve_cold_address_prefers_env_over_db(self):
        wallet = SystemWallet.objects.create(
            wallet_type="cold",
            currency="USDC",
            chain="polygon",
            tier=WalletTier.COLD,
            address="0xDbStoredAddressWouldBeWrong00000000000000",
            balance=Decimal("0"),
            is_active=True,
        )
        service = CustodyService()
        resolved = service._resolve_cold_address("USDC", wallet)
        self.assertEqual(resolved, COLD_POLY)

    def test_resolve_cold_address_falls_back_to_db(self):
        wallet = SystemWallet.objects.create(
            wallet_type="cold",
            currency="USDC",
            chain="polygon",
            tier=WalletTier.COLD,
            address="0xStoredInDb000000000000000000000000000000",
            balance=Decimal("0"),
            is_active=True,
        )
        service = CustodyService()
        with self.settings(COLD_WALLET_POLYGON=""):
            resolved = service._resolve_cold_address("USDC", wallet)
        self.assertEqual(resolved, "0xStoredInDb000000000000000000000000000000")


class InitCustodyTiersCommandTest(TestCase):
    @override_settings(
        COLD_WALLET_TRON=COLD_TRON,
        COLD_WALLET_POLYGON=COLD_POLY,
    )
    def test_command_creates_all_tiers_idempotently(self):
        out = StringIO()
        call_command("init_custody_tiers", stdout=out)

        # Should have hot/warm/cold for all 5 supported currencies (15 rows)
        self.assertEqual(SystemWallet.objects.count(), 15)
        self.assertEqual(
            SystemWallet.objects.filter(wallet_type="cold").count(),
            5,
        )

        # USDT cold address pulled from COLD_WALLET_TRON
        usdt_cold = SystemWallet.objects.get(
            wallet_type="cold", currency="USDT",
        )
        self.assertEqual(usdt_cold.address, COLD_TRON)

        # USDC cold address pulled from COLD_WALLET_POLYGON
        usdc_cold = SystemWallet.objects.get(
            wallet_type="cold", currency="USDC",
        )
        self.assertEqual(usdc_cold.address, COLD_POLY)

        # Re-running should NOT duplicate rows
        call_command("init_custody_tiers", stdout=StringIO())
        self.assertEqual(SystemWallet.objects.count(), 15)


class CustodyConfirmColdTransferViewTest(TestCase):
    """Admin endpoint: POST /wallets/custody/transfers/<id>/confirm/"""

    def setUp(self):
        self.admin = User.objects.create_user(
            phone="+254711000001",
            pin="123456",
            is_staff=True,
            is_superuser=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        # Seed warm + cold wallets
        self.warm = SystemWallet.objects.create(
            wallet_type="warm",
            currency="USDT",
            chain="tron",
            tier=WalletTier.WARM,
            address="TWarmAddress000000000000000000000",
            balance=Decimal("0"),  # Already debited when pending was created
            is_active=True,
        )
        self.cold = SystemWallet.objects.create(
            wallet_type="cold",
            currency="USDT",
            chain="tron",
            tier=WalletTier.COLD,
            address=COLD_TRON,
            balance=Decimal("0"),
            is_active=True,
        )

        self.pending = CustodyTransfer.objects.create(
            from_tier=WalletTier.WARM,
            to_tier=WalletTier.COLD,
            currency="USDT",
            amount=Decimal("5000"),
            status=CustodyTransfer.Status.PENDING,
            from_address=self.warm.address,
            to_address=self.cold.address,
            initiated_by="system",
            reason="warm balance exceeded threshold",
        )

    def test_confirm_requires_tx_hash(self):
        url = f"/api/v1/wallets/custody/transfers/{self.pending.id}/confirm/"
        resp = self.client.post(url, {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("tx_hash", resp.json()["error"])

    def test_confirm_rejects_malformed_tx_hash(self):
        url = f"/api/v1/wallets/custody/transfers/{self.pending.id}/confirm/"
        resp = self.client.post(url, {"tx_hash": "tooShort"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_confirm_credits_destination_and_marks_completed(self):
        url = f"/api/v1/wallets/custody/transfers/{self.pending.id}/confirm/"
        resp = self.client.post(
            url,
            {
                "tx_hash": "0xConfirmedHashAfterColdBroadcast123456",
                "admin_notes": "signed on air-gapped ledger",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)

        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, CustodyTransfer.Status.COMPLETED)
        self.assertEqual(
            self.pending.tx_hash,
            "0xConfirmedHashAfterColdBroadcast123456",
        )
        self.assertIsNotNone(self.pending.completed_at)

        self.cold.refresh_from_db()
        self.assertEqual(self.cold.balance, Decimal("5000"))

    def test_non_admin_cannot_confirm(self):
        user = User.objects.create_user(phone="+254711000002", pin="123456")
        client = APIClient()
        client.force_authenticate(user=user)
        url = f"/api/v1/wallets/custody/transfers/{self.pending.id}/confirm/"
        resp = client.post(
            url,
            {"tx_hash": "0xConfirmedHashThatIsLongEnough12345"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)


class CheckCustodyThresholdsTaskTest(TestCase):
    """Celery task dispatches the new hot→cold direction correctly."""

    def setUp(self):
        self.hot = SystemWallet.objects.create(
            wallet_type="hot",
            currency="USDT",
            chain="tron",
            tier=WalletTier.HOT,
            address="THotAddress0000000000000000000000",
            balance=Decimal("6000"),
            is_active=True,
        )
        SystemWallet.objects.create(
            wallet_type="cold",
            currency="USDT",
            chain="tron",
            tier=WalletTier.COLD,
            address=COLD_TRON,
            balance=Decimal("0"),
            is_active=True,
        )

    @override_settings(COLD_WALLET_TRON=COLD_TRON, DEBUG=False)
    def test_task_dispatches_hot_to_cold(self):
        """Beat task picks hot→cold when COLD env is set + hot over max."""
        from apps.wallets.tasks import check_custody_thresholds

        with patch(
            "apps.blockchain.tasks._broadcast_to_chain",
            return_value="0xTaskBroadcastedHash0000",
        ):
            result = check_custody_thresholds.apply().result

        self.assertIn("hot→cold", result)
        self.assertTrue(
            CustodyTransfer.objects.filter(
                from_tier=WalletTier.HOT,
                to_tier=WalletTier.COLD,
                currency="USDT",
                status=CustodyTransfer.Status.SUBMITTED,
            ).exists()
        )
