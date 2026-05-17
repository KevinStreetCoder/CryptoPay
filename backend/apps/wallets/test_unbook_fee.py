"""Tests for the SystemWallet unbook helpers (2026-05-17 · N2 fix).

`WalletService.unbook_fee` / `unbook_provider_cost` / `unbook_excise`
/ `unbook_gas_reserve` reverse a prior credit by creating a balancing
DEBIT FeeLedgerEntry + decrementing the SystemWallet balance.

Contract:
  - calling unbook on a tx that wasn't booked is a SAFE no-op
  - calling unbook on a tx that was booked creates exactly ONE
    DEBIT entry + decrements the SystemWallet balance
  - calling unbook TWICE on the same tx is idempotent (returns the
    existing DEBIT without re-debiting)
  - net balance after credit + debit is 0
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from django.test import TestCase

from apps.wallets.models import FeeLedgerEntry, SystemWallet
from apps.wallets.services import WalletService


pytestmark = pytest.mark.django_db


def _seed(wallet_type: str, currency: str) -> SystemWallet:
    sw, _ = SystemWallet.objects.get_or_create(
        wallet_type=wallet_type,
        currency=currency,
        defaults={"is_active": True},
    )
    return sw


class TestUnbookFee(TestCase):
    def test_unbook_with_no_prior_credit_is_noop(self):
        _seed("fee", "KES")
        result = WalletService.unbook_fee("KES", uuid.uuid4())
        assert result is None, (
            "unbook without a prior credit must return None, not raise"
        )

    def test_unbook_reverses_prior_credit(self):
        _seed("fee", "KES")
        tx_id = uuid.uuid4()
        WalletService.book_fee("KES", Decimal("50"), tx_id, "test credit")
        sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        assert sw.balance == Decimal("50")

        # Unbook · should debit 50 + decrement wallet to 0.
        debit = WalletService.unbook_fee("KES", tx_id, "compensate")
        assert debit is not None
        assert debit.entry_type == FeeLedgerEntry.EntryType.DEBIT
        assert debit.amount == Decimal("50")
        sw.refresh_from_db()
        assert sw.balance == Decimal("0")

    def test_unbook_is_idempotent(self):
        _seed("fee", "KES")
        tx_id = uuid.uuid4()
        WalletService.book_fee("KES", Decimal("100"), tx_id)
        d1 = WalletService.unbook_fee("KES", tx_id)
        d2 = WalletService.unbook_fee("KES", tx_id)
        d3 = WalletService.unbook_fee("KES", tx_id)
        # Same DEBIT entry returned · no further wallet decrements.
        assert d1.pk == d2.pk == d3.pk
        sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        assert sw.balance == Decimal("0"), (
            f"double-unbook decremented twice · balance {sw.balance}"
        )

    def test_unbook_creates_balanced_audit_trail(self):
        _seed("fee", "KES")
        tx_id = uuid.uuid4()
        WalletService.book_fee("KES", Decimal("30"), tx_id)
        WalletService.unbook_fee("KES", tx_id)
        entries = list(FeeLedgerEntry.objects.filter(transaction_id=tx_id))
        # Two entries · CREDIT + DEBIT, both for 30 KES.
        assert len(entries) == 2
        types = {e.entry_type for e in entries}
        assert types == {
            FeeLedgerEntry.EntryType.CREDIT,
            FeeLedgerEntry.EntryType.DEBIT,
        }
        for e in entries:
            assert e.amount == Decimal("30")

    def test_unbook_each_bucket_independently(self):
        for wt in ("fee", "provider_cost", "excise"):
            _seed(wt, "KES")
        tx_id = uuid.uuid4()
        WalletService.book_fee("KES", Decimal("10"), tx_id)
        WalletService.book_provider_cost("KES", Decimal("3"), tx_id)
        WalletService.book_excise("KES", Decimal("1"), tx_id)

        # Unbook all three.
        WalletService.unbook_fee("KES", tx_id)
        WalletService.unbook_provider_cost("KES", tx_id)
        WalletService.unbook_excise("KES", tx_id)

        for wt in ("fee", "provider_cost", "excise"):
            sw = SystemWallet.objects.get(wallet_type=wt, currency="KES")
            assert sw.balance == Decimal("0"), (
                f"{wt}/KES not zero after unbook · {sw.balance}"
            )
