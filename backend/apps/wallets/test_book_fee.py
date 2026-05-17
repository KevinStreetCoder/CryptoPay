"""Tests for the SystemWallet booking helpers (2026-05-17).

`WalletService.book_fee / book_provider_cost / book_excise /
book_gas_reserve` are the single canonical entry points for crediting
the platform SystemWallets. Before this work, only the SWAP path
mutated `SystemWallet.balance` directly · no audit trail, no
idempotency guard. The /admin/revenue/ dashboard exposed the gap.

These tests pin the contracts the rest of the codebase depends on:
  - idempotency (same tx booking same wallet twice returns one entry)
  - FeeLedgerEntry is created with correct balance_after
  - FeeWalletMissingError raised when no active SystemWallet exists
  - amount must be positive
  - splits across types route to the right SystemWallet rows
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from django.test import TestCase

from apps.wallets.models import FeeLedgerEntry, SystemWallet
from apps.wallets.services import WalletService, FeeWalletMissingError


pytestmark = pytest.mark.django_db


def _seed(wallet_type: str, currency: str, chain: str = "") -> SystemWallet:
    """Get-or-create a SystemWallet row for the test · idempotent."""
    sw, _ = SystemWallet.objects.get_or_create(
        wallet_type=wallet_type,
        currency=currency,
        defaults={"chain": chain, "is_active": True},
    )
    return sw


class TestBookFee(TestCase):
    def test_creates_fee_ledger_entry(self):
        _seed("fee", "KES")
        tx_id = uuid.uuid4()
        entry = WalletService.book_fee("KES", Decimal("25.00"), tx_id, "test")
        assert entry.entry_type == FeeLedgerEntry.EntryType.CREDIT
        assert entry.amount == Decimal("25.00")
        assert entry.balance_after == Decimal("25.00")
        assert entry.system_wallet.wallet_type == "fee"
        assert entry.system_wallet.currency == "KES"

    def test_idempotent_same_tx_returns_same_entry(self):
        _seed("fee", "KES")
        tx_id = uuid.uuid4()
        e1 = WalletService.book_fee("KES", Decimal("10"), tx_id, "first")
        e2 = WalletService.book_fee("KES", Decimal("999"), tx_id, "second")
        # Same primary key · the second call is a no-op return.
        assert e1.pk == e2.pk
        assert e2.amount == Decimal("10"), (
            "second call must NOT update the amount · idempotency means "
            "the first booking wins; second is silently a no-op"
        )

    def test_idempotency_does_not_double_credit_wallet(self):
        _seed("fee", "KES")
        tx_id = uuid.uuid4()
        WalletService.book_fee("KES", Decimal("50"), tx_id)
        WalletService.book_fee("KES", Decimal("50"), tx_id)
        WalletService.book_fee("KES", Decimal("50"), tx_id)
        sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        # Three identical calls but only ONE 50-KES credit landed.
        assert sw.balance == Decimal("50"), (
            f"wallet was double-credited · balance {sw.balance} != 50"
        )

    def test_different_tx_books_independently(self):
        _seed("fee", "KES")
        WalletService.book_fee("KES", Decimal("10"), uuid.uuid4())
        WalletService.book_fee("KES", Decimal("20"), uuid.uuid4())
        WalletService.book_fee("KES", Decimal("30"), uuid.uuid4())
        sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        assert sw.balance == Decimal("60")
        # Three distinct ledger entries.
        assert FeeLedgerEntry.objects.filter(system_wallet=sw).count() == 3

    def test_balance_after_is_running_total(self):
        _seed("fee", "KES")
        e1 = WalletService.book_fee("KES", Decimal("10"), uuid.uuid4())
        e2 = WalletService.book_fee("KES", Decimal("20"), uuid.uuid4())
        e3 = WalletService.book_fee("KES", Decimal("30"), uuid.uuid4())
        assert e1.balance_after == Decimal("10")
        assert e2.balance_after == Decimal("30")
        assert e3.balance_after == Decimal("60")

    def test_missing_wallet_raises(self):
        # Delete the fee/USDT row so the helper has nothing to credit.
        SystemWallet.objects.filter(
            wallet_type="fee", currency="USDT",
        ).delete()
        with pytest.raises(FeeWalletMissingError):
            WalletService.book_fee("USDT", Decimal("1"), uuid.uuid4())

    def test_inactive_wallet_is_skipped(self):
        sw = _seed("fee", "USDC")
        sw.is_active = False
        sw.save(update_fields=["is_active"])
        with pytest.raises(FeeWalletMissingError):
            WalletService.book_fee("USDC", Decimal("1"), uuid.uuid4())

    def test_zero_or_negative_amount_rejected(self):
        _seed("fee", "KES")
        with pytest.raises(ValueError):
            WalletService.book_fee("KES", Decimal("0"), uuid.uuid4())
        with pytest.raises(ValueError):
            WalletService.book_fee("KES", Decimal("-1"), uuid.uuid4())


class TestBookProviderCostAndExcise(TestCase):
    """The other three helpers share the same internal path · we just
    pin that they target the right SystemWallet rows."""

    def test_provider_cost_targets_provider_cost_wallet(self):
        _seed("provider_cost", "KES")
        WalletService.book_provider_cost("KES", Decimal("10"), uuid.uuid4())
        sw = SystemWallet.objects.get(wallet_type="provider_cost", currency="KES")
        assert sw.balance == Decimal("10")

    def test_excise_targets_excise_wallet(self):
        _seed("excise", "KES")
        WalletService.book_excise("KES", Decimal("2.50"), uuid.uuid4())
        sw = SystemWallet.objects.get(wallet_type="excise", currency="KES")
        assert sw.balance == Decimal("2.50")

    def test_gas_reserve_targets_gas_reserve_wallet(self):
        _seed("gas_reserve", "TRX")
        # gas_reserve uses chain= optionally · empty matches the seed.
        WalletService.book_gas_reserve("TRX", Decimal("0.5"), uuid.uuid4())
        sw = SystemWallet.objects.get(wallet_type="gas_reserve", currency="TRX")
        assert sw.balance == Decimal("0.5")

    def test_independence_three_buckets_one_tx(self):
        # A single source tx books to FEE + PROVIDER_COST + EXCISE.
        # All three must persist · the unique constraint is
        # (tx, system_wallet, type) so different system_wallets for
        # the same tx are independent rows.
        _seed("fee", "KES")
        _seed("provider_cost", "KES")
        _seed("excise", "KES")
        tx_id = uuid.uuid4()
        WalletService.book_fee("KES", Decimal("15"), tx_id)
        WalletService.book_provider_cost("KES", Decimal("10"), tx_id)
        WalletService.book_excise("KES", Decimal("2.50"), tx_id)
        # 3 entries · one per system_wallet.
        assert FeeLedgerEntry.objects.filter(transaction_id=tx_id).count() == 3
        # Per-wallet balances correct.
        assert SystemWallet.objects.get(
            wallet_type="fee", currency="KES"
        ).balance == Decimal("15")
        assert SystemWallet.objects.get(
            wallet_type="provider_cost", currency="KES"
        ).balance == Decimal("10")
        assert SystemWallet.objects.get(
            wallet_type="excise", currency="KES"
        ).balance == Decimal("2.50")
