"""Tests for the wallet system, double-entry ledger, and rebalancing orchestrator."""

import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import User
from apps.blockchain.models import BlockchainDeposit
from apps.blockchain.services import generate_deposit_address

from .models import LedgerEntry, RebalanceOrder, SystemWallet, Wallet
from .rebalance import (
    MAX_REBALANCE_KES,
    MIN_REBALANCE_KES,
    REBALANCE_COOLDOWN_SECONDS,
    TARGET_FLOAT_KES,
    TRIGGER_FLOAT_KES,
    calculate_rebalance_amount,
    has_active_rebalance,
    is_in_cooldown,
)
from .services import InsufficientBalanceError, WalletService


class WalletServiceTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.wallet = Wallet.objects.create(
            user=self.user,
            currency="USDT",
            balance=Decimal("100.00000000"),
        )
        self.tx_id = uuid.uuid4()

    def test_credit_increases_balance(self):
        entry = WalletService.credit(self.wallet.id, Decimal("50"), self.tx_id, "Test credit")
        self.wallet.refresh_from_db()

        self.assertEqual(self.wallet.balance, Decimal("150.00000000"))
        self.assertEqual(entry.entry_type, LedgerEntry.EntryType.CREDIT)
        self.assertEqual(entry.amount, Decimal("50"))
        self.assertEqual(entry.balance_after, Decimal("150.00000000"))

    def test_debit_decreases_balance(self):
        entry = WalletService.debit(self.wallet.id, Decimal("30"), self.tx_id, "Test debit")
        self.wallet.refresh_from_db()

        self.assertEqual(self.wallet.balance, Decimal("70.00000000"))
        self.assertEqual(entry.entry_type, LedgerEntry.EntryType.DEBIT)

    def test_debit_insufficient_balance_raises(self):
        with self.assertRaises(InsufficientBalanceError):
            WalletService.debit(self.wallet.id, Decimal("200"), self.tx_id)

    def test_lock_and_unlock_funds(self):
        WalletService.lock_funds(self.wallet.id, Decimal("40"))
        self.wallet.refresh_from_db()

        self.assertEqual(self.wallet.locked_balance, Decimal("40"))
        self.assertEqual(self.wallet.available_balance, Decimal("60.00000000"))

        # Can't debit more than available (balance - locked)
        with self.assertRaises(InsufficientBalanceError):
            WalletService.debit(self.wallet.id, Decimal("80"), self.tx_id)

        WalletService.unlock_funds(self.wallet.id, Decimal("40"))
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.locked_balance, Decimal("0"))

    def test_lock_insufficient_raises(self):
        with self.assertRaises(InsufficientBalanceError):
            WalletService.lock_funds(self.wallet.id, Decimal("200"))

    def test_transfer_creates_balanced_entries(self):
        wallet2 = Wallet.objects.create(
            user=self.user,
            currency="KES",
            balance=Decimal("0"),
        )

        debit_entry, credit_entry = WalletService.transfer(
            self.wallet.id, wallet2.id, Decimal("25"), self.tx_id, "Test transfer"
        )

        self.wallet.refresh_from_db()
        wallet2.refresh_from_db()

        self.assertEqual(self.wallet.balance, Decimal("75.00000000"))
        self.assertEqual(wallet2.balance, Decimal("25.00000000"))
        self.assertEqual(debit_entry.amount, credit_entry.amount)

    def test_ledger_entries_are_balanced(self):
        """Every transaction should have equal debits and credits."""
        tx_id = uuid.uuid4()
        wallet2 = Wallet.objects.create(user=self.user, currency="KES", balance=Decimal("0"))

        WalletService.transfer(self.wallet.id, wallet2.id, Decimal("50"), tx_id)

        entries = LedgerEntry.objects.filter(transaction_id=tx_id)
        debits = sum(e.amount for e in entries if e.entry_type == LedgerEntry.EntryType.DEBIT)
        credits = sum(e.amount for e in entries if e.entry_type == LedgerEntry.EntryType.CREDIT)

        self.assertEqual(debits, credits)

    def test_create_user_wallets(self):
        user2 = User.objects.create_user(phone="+254700000000", pin="654321")
        wallets = WalletService.create_user_wallets(user2)

        self.assertEqual(len(wallets), 6)  # USDC, USDT, BTC, SOL, ETH, KES
        currencies = {w.currency for w in wallets}
        self.assertIn("USDC", currencies)
        self.assertIn("USDT", currencies)
        self.assertIn("BTC", currencies)
        self.assertIn("SOL", currencies)
        self.assertIn("ETH", currencies)
        self.assertIn("KES", currencies)


class AddressGenerationTest(TestCase):
    """Tests for deterministic deposit address generation."""

    def test_usdt_generates_tron_address(self):
        addr = generate_deposit_address("user1", "USDT", 0)
        self.assertTrue(addr.startswith("T"))
        self.assertGreater(len(addr), 30)

    def test_btc_generates_bitcoin_address(self):
        # Migrated to native SegWit (BIP-173 / P2WPKH) in 2026-04-17 session.
        # Addresses start with bc1q (mainnet) or tb1q (testnet) depending on
        # BTC_NETWORK. Both prefixes are valid here since the setting can
        # differ per environment.
        addr = generate_deposit_address("user1", "BTC", 0)
        self.assertTrue(
            addr.startswith("bc1q") or addr.startswith("tb1q"),
            f"expected bech32 P2WPKH address, got: {addr}",
        )

    def test_eth_generates_hex_address(self):
        addr = generate_deposit_address("user1", "ETH", 0)
        self.assertTrue(addr.startswith("0x"))
        self.assertEqual(len(addr), 42)  # 0x + 40 hex chars

    def test_sol_generates_base58_address(self):
        addr = generate_deposit_address("user1", "SOL", 0)
        self.assertGreater(len(addr), 20)

    def test_same_inputs_give_same_address(self):
        addr1 = generate_deposit_address("user1", "USDT", 0)
        addr2 = generate_deposit_address("user1", "USDT", 0)
        self.assertEqual(addr1, addr2)

    def test_different_users_give_different_addresses(self):
        addr1 = generate_deposit_address("user1", "USDT", 0)
        addr2 = generate_deposit_address("user2", "USDT", 0)
        self.assertNotEqual(addr1, addr2)

    def test_different_index_gives_different_address(self):
        addr1 = generate_deposit_address("user1", "USDT", 0)
        addr2 = generate_deposit_address("user1", "USDT", 1)
        self.assertNotEqual(addr1, addr2)


class GenerateDepositAddressAPITest(APITestCase):
    """Tests for the generate-address endpoint."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.wallet = Wallet.objects.create(user=self.user, currency="USDT")
        self.kes_wallet = Wallet.objects.create(user=self.user, currency="KES")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_generate_address_success(self):
        response = self.client.post(f"/api/v1/wallets/{self.wallet.id}/generate-address/")
        self.assertEqual(response.status_code, 201)
        self.assertIn("deposit_address", response.data)
        self.assertTrue(response.data["deposit_address"].startswith("T"))

    def test_generate_address_returns_existing(self):
        self.wallet.deposit_address = "TExistingAddress123"
        self.wallet.save()
        response = self.client.post(f"/api/v1/wallets/{self.wallet.id}/generate-address/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deposit_address"], "TExistingAddress123")

    def test_kes_wallet_rejects(self):
        response = self.client.post(f"/api/v1/wallets/{self.kes_wallet.id}/generate-address/")
        self.assertEqual(response.status_code, 400)

    def test_other_user_wallet_404(self):
        other_user = User.objects.create_user(phone="+254700000000", pin="654321")
        other_wallet = Wallet.objects.create(user=other_user, currency="BTC")
        response = self.client.post(f"/api/v1/wallets/{other_wallet.id}/generate-address/")
        self.assertEqual(response.status_code, 404)

    def test_unauthenticated_rejected(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(f"/api/v1/wallets/{self.wallet.id}/generate-address/")
        self.assertEqual(response.status_code, 401)


class DepositListAPITest(APITestCase):
    """Tests for the deposits list endpoint."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.wallet = Wallet.objects.create(
            user=self.user, currency="USDT", deposit_address="TTestAddr123"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_list_deposits_empty(self):
        response = self.client.get("/api/v1/wallets/deposits/")
        self.assertEqual(response.status_code, 200)

    def test_list_deposits_returns_user_deposits(self):
        BlockchainDeposit.objects.create(
            chain="tron",
            tx_hash="abc123",
            to_address="TTestAddr123",
            amount=Decimal("50.00"),
            currency="USDT",
            confirmations=19,
            required_confirmations=19,
            status="credited",
        )
        response = self.client.get("/api/v1/wallets/deposits/")
        self.assertEqual(response.status_code, 200)
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tx_hash"], "abc123")

    def test_does_not_return_other_user_deposits(self):
        other_user = User.objects.create_user(phone="+254700000000", pin="654321")
        Wallet.objects.create(user=other_user, currency="USDT", deposit_address="TOtherAddr456")
        BlockchainDeposit.objects.create(
            chain="tron",
            tx_hash="other123",
            to_address="TOtherAddr456",
            amount=Decimal("100.00"),
            currency="USDT",
            confirmations=0,
            required_confirmations=19,
        )
        response = self.client.get("/api/v1/wallets/deposits/")
        self.assertEqual(response.status_code, 200)
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 0)


# ── Rebalance Order Model Tests ──────────────────────────────────────────────


class RebalanceOrderModelTest(TestCase):
    """Tests for the RebalanceOrder model fields and properties."""

    def _create_order(self, **kwargs):
        defaults = dict(
            trigger=RebalanceOrder.TriggerType.AUTO,
            execution_mode=RebalanceOrder.ExecutionMode.MANUAL,
            status=RebalanceOrder.Status.PENDING,
            float_balance_at_trigger=Decimal("500000.00"),
            target_float_balance=Decimal("1500000.00"),
            sell_currency="USDT",
            sell_amount=Decimal("700.00000000"),
            expected_kes_amount=Decimal("1000000.00"),
            exchange_rate_at_quote=Decimal("142.85714286"),
        )
        defaults.update(kwargs)
        return RebalanceOrder.objects.create(**defaults)

    def test_create_order_with_all_fields(self):
        order = self._create_order(
            reason="Float low",
            admin_notes="Test note",
        )
        order.refresh_from_db()

        self.assertIsNotNone(order.id)
        self.assertEqual(order.trigger, "auto")
        self.assertEqual(order.sell_currency, "USDT")
        self.assertEqual(order.sell_amount, Decimal("700.00000000"))
        self.assertEqual(order.expected_kes_amount, Decimal("1000000.00"))
        self.assertEqual(order.status, "pending")
        self.assertEqual(order.reason, "Float low")

    def test_is_active_for_active_states(self):
        for active_status in (
            RebalanceOrder.Status.PENDING,
            RebalanceOrder.Status.SUBMITTED,
            RebalanceOrder.Status.SETTLING,
        ):
            order = self._create_order(status=active_status)
            self.assertTrue(order.is_active, f"Expected is_active=True for {active_status}")

    def test_is_active_false_for_terminal_states(self):
        for terminal_status in (
            RebalanceOrder.Status.COMPLETED,
            RebalanceOrder.Status.FAILED,
            RebalanceOrder.Status.CANCELLED,
        ):
            order = self._create_order(status=terminal_status)
            self.assertFalse(order.is_active, f"Expected is_active=False for {terminal_status}")

    def test_slippage_kes_property(self):
        order = self._create_order(expected_kes_amount=Decimal("1000000.00"))

        # Before settlement, slippage is None
        self.assertIsNone(order.slippage_kes)

        # After settlement, slippage = actual - expected
        order.actual_kes_received = Decimal("980000.00")
        order.save()
        self.assertEqual(order.slippage_kes, Decimal("-20000.00"))

        # Positive slippage (received more than expected)
        order.actual_kes_received = Decimal("1010000.00")
        order.save()
        self.assertEqual(order.slippage_kes, Decimal("10000.00"))

    def test_age_minutes_property(self):
        order = self._create_order()
        # Freshly created order should be less than 1 minute old
        self.assertLess(order.age_minutes, 1.0)
        self.assertGreaterEqual(order.age_minutes, 0.0)


# ── Rebalance Orchestrator Logic Tests ───────────────────────────────────────


class RebalanceOrchestratorTest(TestCase):
    """Tests for the rebalance orchestrator helper functions."""

    def test_calculate_rebalance_amount_returns_deficit(self):
        """When float is below target, returns the deficit."""
        current = TARGET_FLOAT_KES - Decimal("200000")
        result = calculate_rebalance_amount(current)
        self.assertEqual(result, Decimal("200000"))

    def test_calculate_rebalance_amount_zero_below_minimum(self):
        """When deficit is below MIN_REBALANCE_KES, returns 0."""
        # Set current float just slightly below target, so deficit < min
        current = TARGET_FLOAT_KES - (MIN_REBALANCE_KES - Decimal("1"))
        result = calculate_rebalance_amount(current)
        self.assertEqual(result, Decimal("0"))

    def test_calculate_rebalance_amount_zero_when_at_target(self):
        """When float is at or above target, returns 0."""
        result = calculate_rebalance_amount(TARGET_FLOAT_KES)
        self.assertEqual(result, Decimal("0"))

        result = calculate_rebalance_amount(TARGET_FLOAT_KES + Decimal("100000"))
        self.assertEqual(result, Decimal("0"))

    def test_calculate_rebalance_amount_clamped_to_max(self):
        """When deficit exceeds MAX_REBALANCE_KES, clamp to max."""
        # Float at 0 means deficit = target, which could exceed max
        current = Decimal("0")
        result = calculate_rebalance_amount(current)
        self.assertLessEqual(result, MAX_REBALANCE_KES)

        # Explicitly test with a very low float
        current = TARGET_FLOAT_KES - MAX_REBALANCE_KES - Decimal("500000")
        result = calculate_rebalance_amount(current)
        self.assertEqual(result, MAX_REBALANCE_KES)

    def test_has_active_rebalance_true_when_pending_order_exists(self):
        """Returns True when there is a pending/submitted/settling order."""
        RebalanceOrder.objects.create(
            trigger=RebalanceOrder.TriggerType.MANUAL,
            status=RebalanceOrder.Status.SUBMITTED,
            float_balance_at_trigger=Decimal("500000"),
            sell_currency="USDT",
            sell_amount=Decimal("100"),
            expected_kes_amount=Decimal("100000"),
            exchange_rate_at_quote=Decimal("140"),
        )
        self.assertTrue(has_active_rebalance())

    def test_has_active_rebalance_false_when_no_active_orders(self):
        """Returns False when all orders are in terminal states."""
        RebalanceOrder.objects.create(
            trigger=RebalanceOrder.TriggerType.MANUAL,
            status=RebalanceOrder.Status.COMPLETED,
            float_balance_at_trigger=Decimal("500000"),
            sell_currency="USDT",
            sell_amount=Decimal("100"),
            expected_kes_amount=Decimal("100000"),
            exchange_rate_at_quote=Decimal("140"),
        )
        self.assertFalse(has_active_rebalance())

    def test_is_in_cooldown_during_cooldown(self):
        """Returns True when last order was created within cooldown window."""
        RebalanceOrder.objects.create(
            trigger=RebalanceOrder.TriggerType.AUTO,
            status=RebalanceOrder.Status.COMPLETED,
            float_balance_at_trigger=Decimal("500000"),
            sell_currency="USDT",
            sell_amount=Decimal("100"),
            expected_kes_amount=Decimal("100000"),
            exchange_rate_at_quote=Decimal("140"),
        )
        # Just created, so we should be in cooldown
        self.assertTrue(is_in_cooldown())

    def test_is_in_cooldown_after_cooldown_expires(self):
        """Returns False when last order is older than cooldown period."""
        order = RebalanceOrder.objects.create(
            trigger=RebalanceOrder.TriggerType.AUTO,
            status=RebalanceOrder.Status.COMPLETED,
            float_balance_at_trigger=Decimal("500000"),
            sell_currency="USDT",
            sell_amount=Decimal("100"),
            expected_kes_amount=Decimal("100000"),
            exchange_rate_at_quote=Decimal("140"),
        )
        # Move created_at back beyond cooldown
        old_time = timezone.now() - timedelta(seconds=REBALANCE_COOLDOWN_SECONDS + 60)
        RebalanceOrder.objects.filter(id=order.id).update(created_at=old_time)

        self.assertFalse(is_in_cooldown())

    def test_is_in_cooldown_false_when_no_orders(self):
        """Returns False when no rebalance orders exist at all."""
        self.assertFalse(is_in_cooldown())


# ── Rebalance API Tests ──────────────────────────────────────────────────────


class RebalanceAPITest(APITestCase):
    """Tests for the admin rebalance API endpoints."""

    BASE = "/api/v1/wallets/admin/rebalance"

    def setUp(self):
        self.admin = User.objects.create_superuser(
            phone="+254700000099", is_staff=True,
        )
        self.regular_user = User.objects.create_user(
            phone="+254700000001", pin="1234",
        )
        self.client = APIClient()

        # Create a float SystemWallet so status endpoint has data
        SystemWallet.objects.create(
            wallet_type="float", currency="KES", balance=Decimal("600000"),
        )

    def test_status_endpoint_returns_correct_structure(self):
        """GET /admin/rebalance/status/ returns expected keys for admin."""
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(f"{self.BASE}/status/")
        self.assertEqual(response.status_code, 200)

        data = response.data
        expected_keys = {
            "current_float_kes",
            "target_float_kes",
            "trigger_threshold_kes",
            "needs_rebalance",
            "execution_mode",
            "active_orders",
            "recent_completed",
            "is_in_cooldown",
        }
        self.assertTrue(expected_keys.issubset(set(data.keys())))

    def test_non_admin_gets_403_on_status(self):
        """Regular users cannot access admin rebalance endpoints."""
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.get(f"{self.BASE}/status/")
        self.assertEqual(response.status_code, 403)

    def test_non_admin_gets_403_on_trigger(self):
        """Regular users cannot trigger rebalance."""
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.post(f"{self.BASE}/trigger/", {"force": True})
        self.assertEqual(response.status_code, 403)

    @patch("apps.wallets.rebalance.get_current_float_kes")
    @patch("apps.wallets.rebalance.ManualExchangeProvider.get_sell_quote")
    @patch("apps.wallets.rebalance.ManualExchangeProvider.execute_sell")
    def test_trigger_endpoint_creates_order(self, mock_execute, mock_quote, mock_float):
        """POST /admin/rebalance/trigger/ creates a new rebalance order."""
        mock_float.return_value = Decimal("400000")
        mock_quote.return_value = {
            "rate": Decimal("140"),
            "kes_amount": Decimal("1000000"),
            "fee_kes": Decimal("10000"),
            "quote_id": "test_quote",
            "expires_at": timezone.now() + timedelta(minutes=15),
        }
        mock_execute.return_value = {
            "exchange_order_id": "manual_test",
            "status": "submitted",
            "message": "Admin notified",
        }

        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            f"{self.BASE}/trigger/",
            {"sell_currency": "USDT", "force": True, "reason": "Test trigger"},
        )
        self.assertEqual(response.status_code, 201)
        self.assertIn("id", response.data)
        self.assertEqual(response.data["sell_currency"], "USDT")

        # Verify order was persisted
        self.assertTrue(
            RebalanceOrder.objects.filter(id=response.data["id"]).exists()
        )

    def test_confirm_endpoint_completes_order(self):
        """POST /admin/rebalance/{id}/confirm/ transitions order to completed."""
        order = RebalanceOrder.objects.create(
            trigger=RebalanceOrder.TriggerType.MANUAL,
            status=RebalanceOrder.Status.SUBMITTED,
            float_balance_at_trigger=Decimal("500000"),
            sell_currency="USDT",
            sell_amount=Decimal("700"),
            expected_kes_amount=Decimal("1000000"),
            exchange_rate_at_quote=Decimal("142.857"),
        )

        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            f"{self.BASE}/{order.id}/confirm/",
            {
                "kes_received": "980000.00",
                "actual_rate": "140.00",
                "fee_kes": "5000.00",
                "exchange_reference": "YC-REF-123",
                "admin_notes": "Confirmed manually",
            },
        )
        self.assertEqual(response.status_code, 200)

        order.refresh_from_db()
        self.assertEqual(order.status, RebalanceOrder.Status.COMPLETED)
        self.assertEqual(order.actual_kes_received, Decimal("980000.00"))
        self.assertIsNotNone(order.completed_at)

    def test_unauthenticated_gets_401(self):
        """Unauthenticated requests are rejected with 401."""
        response = self.client.get(f"{self.BASE}/status/")
        self.assertEqual(response.status_code, 401)
