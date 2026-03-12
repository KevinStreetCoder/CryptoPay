"""Tests for the wallet system and double-entry ledger."""

import uuid
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import User
from apps.blockchain.models import BlockchainDeposit
from apps.blockchain.services import generate_deposit_address

from .models import LedgerEntry, Wallet
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
        addr = generate_deposit_address("user1", "BTC", 0)
        self.assertTrue(addr.startswith("1") or addr.startswith("3"))

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
