"""Tests for the wallet system and double-entry ledger."""

import uuid
from decimal import Decimal

from django.test import TestCase

from apps.accounts.models import User

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

        self.assertEqual(len(wallets), 4)  # USDT, BTC, ETH, KES
        currencies = {w.currency for w in wallets}
        self.assertIn("USDT", currencies)
        self.assertIn("KES", currencies)
