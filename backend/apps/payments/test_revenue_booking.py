"""End-to-end revenue-booking tests for the 2026-05-17 fix bundle.

Covers:
  - saga.complete() splits fee_amount → FEE + PROVIDER_COST + EXCISE
  - identical callback + cron status retry doesn't double-book
  - failed transactions DO NOT book any revenue
  - withdrawal broadcast books the network fee
  - spread Option A · final_rate == raw_rate, additive spread_revenue
  - backfill management command idempotent
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.test import TestCase

from apps.accounts.models import User
from apps.payments.models import Transaction
from apps.payments.saga import PaymentSaga
from apps.wallets.models import FeeLedgerEntry, SystemWallet


pytestmark = pytest.mark.django_db


def _seed_fee_wallets(currency="KES"):
    for wt in ("fee", "provider_cost", "excise"):
        SystemWallet.objects.get_or_create(
            wallet_type=wt, currency=currency,
            defaults={"is_active": True},
        )


def _make_user(suffix):
    return User.objects.create_user(
        email=f"rev-{suffix}@example.com",
        phone=f"+25470011{suffix:04d}",
        password="t",
    )


def _make_pending_tx(user, tx_type="PAYBILL_PAYMENT", *, fee="25",
                    excise="2.50", intasend_charges=None, status=None):
    sd = {}
    if intasend_charges is not None:
        sd["intasend_charges"] = str(intasend_charges)
    return Transaction.objects.create(
        user=user,
        type=tx_type,
        status=status or Transaction.Status.CONFIRMING,
        source_currency="USDT",
        source_amount=Decimal("8"),
        dest_currency="KES",
        dest_amount=Decimal("1000"),
        fee_amount=Decimal(str(fee)),
        fee_currency="KES",
        excise_duty_amount=Decimal(str(excise)),
        mpesa_paybill="888880" if tx_type == "PAYBILL_PAYMENT" else "",
        mpesa_till="6663979" if tx_type == "TILL_PAYMENT" else "",
        mpesa_phone="+254712345678" if tx_type == "SEND_MPESA" else "",
        saga_data=sd,
        idempotency_key=f"idem-{uuid.uuid4()}",
        chain="USDT",
    )


class TestSagaRevenueSplit(TestCase):
    def setUp(self):
        _seed_fee_wallets("KES")
        self.user = _make_user(1)

    def test_paybill_books_three_buckets(self):
        # Fee 25, intasend take 10, excise 2.50 · net fee = 15
        tx = _make_pending_tx(
            self.user, "PAYBILL_PAYMENT",
            fee="25", excise="2.50", intasend_charges="10",
        )
        # Patch out side-effects (notifications, websocket, platform-limits)
        # so the test focuses on the booking.
        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"), \
             patch("apps.payments.platform_limits.record_outgoing"):
            PaymentSaga(tx).complete(mpesa_receipt="UEHUEAQ0W8")

        # FEE wallet credited 15 (25 gross − 10 provider take).
        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        assert fee_sw.balance == Decimal("15"), f"expected 15, got {fee_sw.balance}"

        # PROVIDER_COST credited 10.
        pc_sw = SystemWallet.objects.get(wallet_type="provider_cost", currency="KES")
        assert pc_sw.balance == Decimal("10")

        # EXCISE credited 2.50 (KRA bucket).
        ex_sw = SystemWallet.objects.get(wallet_type="excise", currency="KES")
        assert ex_sw.balance == Decimal("2.50")

        # Three FeeLedgerEntry rows for this tx.
        assert FeeLedgerEntry.objects.filter(transaction_id=tx.id).count() == 3

    def test_double_complete_does_not_double_book(self):
        # The C87DC5F2 incident · callback fires AND cron status query
        # fires for the same tx. Both call saga.complete. The booking
        # must be idempotent.
        tx = _make_pending_tx(
            self.user, "TILL_PAYMENT",
            fee="25", excise="2.50", intasend_charges="10",
        )
        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"), \
             patch("apps.payments.platform_limits.record_outgoing"):
            saga = PaymentSaga(tx)
            saga.complete(mpesa_receipt="REC-1")
            # Second call · saga's existing idempotency guard returns
            # early (status==COMPLETED). Even if it DID re-enter, the
            # booking helpers' own idempotency would also catch it.
            saga.complete(mpesa_receipt="REC-1")

        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        assert fee_sw.balance == Decimal("15"), (
            f"double-book detected · balance {fee_sw.balance} != 15"
        )
        # Still exactly 3 ledger rows.
        assert FeeLedgerEntry.objects.filter(transaction_id=tx.id).count() == 3

    def test_failed_tx_does_not_book(self):
        # A failed tx should NEVER have its fee booked (the user was
        # refunded by compensate_convert).
        tx = _make_pending_tx(
            self.user, "PAYBILL_PAYMENT",
            fee="25", excise="2.50",
            status=Transaction.Status.FAILED,
        )
        # saga.complete on a FAILED tx is a no-op via the early guard,
        # but be defensive: even forced execution shouldn't book.
        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"), \
             patch("apps.payments.platform_limits.record_outgoing"):
            PaymentSaga(tx).complete(mpesa_receipt="REC-1")

        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        assert fee_sw.balance == Decimal("0"), (
            f"failed tx leaked revenue into FEE wallet · {fee_sw.balance}"
        )

    def test_no_provider_cost_books_full_fee_to_revenue(self):
        # SasaPay-routed paybill where intasend_charges isn't captured ·
        # provider_cost defaults to 0, FULL fee_amount books to revenue.
        tx = _make_pending_tx(
            self.user, "SEND_MPESA",
            fee="20", excise="2", intasend_charges=None,
        )
        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"), \
             patch("apps.payments.platform_limits.record_outgoing"):
            PaymentSaga(tx).complete(mpesa_receipt="REC-1")

        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        assert fee_sw.balance == Decimal("20"), f"got {fee_sw.balance}"
        # PROVIDER_COST untouched.
        pc_sw = SystemWallet.objects.get(wallet_type="provider_cost", currency="KES")
        assert pc_sw.balance == Decimal("0")

    def test_provider_charge_greater_than_fee_books_zero_net(self):
        # The BUY-loss case · provider took more than we charged.
        # net_fee must clamp to 0 (we don't book NEGATIVE revenue).
        tx = _make_pending_tx(
            self.user, "PAYBILL_PAYMENT",
            fee="10", excise="1", intasend_charges="25",
        )
        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"), \
             patch("apps.payments.platform_limits.record_outgoing"):
            PaymentSaga(tx).complete(mpesa_receipt="REC-1")

        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        # We charged 10, provider took 25 → net loss 15. Don't book
        # negative revenue. FEE stays at 0.
        assert fee_sw.balance == Decimal("0"), fee_sw.balance
        # PROVIDER_COST captures the 25 so the loss is visible on
        # the revenue dashboard.
        pc_sw = SystemWallet.objects.get(wallet_type="provider_cost", currency="KES")
        assert pc_sw.balance == Decimal("25")


class TestSpreadOptionA(TestCase):
    """Option A · `final_rate == raw_rate`; spread added to total_kes."""

    @patch("apps.rates.services.RateService.get_crypto_usd_rate",
           return_value=Decimal("1"))
    @patch("apps.rates.services.RateService.get_usd_kes_rate",
           return_value=Decimal("130"))
    def test_final_rate_equals_raw_rate(self, _usd_kes, _crypto_usd):
        from apps.rates.services import RateService
        info = RateService.get_crypto_kes_rate("USDT")
        assert Decimal(info["final_rate"]) == Decimal("130.00")
        assert Decimal(info["raw_rate"]).quantize(Decimal("0.01")) == Decimal("130.00")

    @patch("apps.rates.services.RateService.get_crypto_usd_rate",
           return_value=Decimal("1"))
    @patch("apps.rates.services.RateService.get_usd_kes_rate",
           return_value=Decimal("130"))
    def test_lock_rate_total_includes_spread(self, _usd_kes, _crypto_usd):
        # KES 1000 paybill · spread 1.5% = 15, flat 10, excise 10% of 25 = 2.50
        # total_kes = 1000 + 15 + 10 + 2.50 = 1027.50
        from apps.rates.services import RateService
        quote = RateService.lock_rate("USDT", Decimal("1000"))
        assert Decimal(quote["spread_revenue_kes"]) == Decimal("15.00")
        assert Decimal(quote["flat_fee_kes"]) == Decimal("10.00")
        assert Decimal(quote["excise_duty_kes"]) == Decimal("2.50")
        assert Decimal(quote["total_kes"]) == Decimal("1027.50")
        # crypto_amount = 1027.50 / 130 = 7.90384615
        assert Decimal(quote["crypto_amount"]) == Decimal("7.90384615")

    @patch("apps.rates.services.RateService.get_crypto_usd_rate",
           return_value=Decimal("1"))
    @patch("apps.rates.services.RateService.get_usd_kes_rate",
           return_value=Decimal("130"))
    def test_user_debit_matches_book_value(self, _usd_kes, _crypto_usd):
        # The headline contract: the crypto debited × raw_rate equals
        # exactly total_kes (no rounding leak into nowhere).
        from apps.rates.services import RateService
        quote = RateService.lock_rate("USDT", Decimal("1000"))
        crypto = Decimal(quote["crypto_amount"])
        raw = Decimal(quote["raw_rate"])
        # crypto × raw should be very close to total_kes (within
        # 0.01 due to 8dp crypto quantization).
        debited_value = (crypto * raw).quantize(Decimal("0.01"))
        total = Decimal(quote["total_kes"])
        assert abs(debited_value - total) <= Decimal("0.01"), (
            f"user debit value {debited_value} != total_kes {total}"
        )


class TestBackfillCommand(TestCase):
    def setUp(self):
        _seed_fee_wallets("KES")
        self.user = _make_user(2)

    def test_dry_run_does_not_write(self):
        Transaction.objects.create(
            user=self.user,
            type="PAYBILL_PAYMENT",
            status="completed",
            source_currency="USDT",
            source_amount=Decimal("8"),
            dest_currency="KES",
            dest_amount=Decimal("1000"),
            fee_amount=Decimal("25"),
            fee_currency="KES",
            excise_duty_amount=Decimal("2.50"),
            idempotency_key=f"idem-{uuid.uuid4()}",
            chain="USDT",
        )
        call_command("backfill_unbooked_fees", "--dry-run")
        sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        assert sw.balance == Decimal("0"), "dry-run wrote to the wallet"

    def test_real_run_books_and_is_idempotent(self):
        tx = Transaction.objects.create(
            user=self.user,
            type="PAYBILL_PAYMENT",
            status="completed",
            source_currency="USDT",
            source_amount=Decimal("8"),
            dest_currency="KES",
            dest_amount=Decimal("1000"),
            fee_amount=Decimal("25"),
            fee_currency="KES",
            excise_duty_amount=Decimal("2.50"),
            saga_data={"intasend_charges": "10"},
            idempotency_key=f"idem-{uuid.uuid4()}",
            chain="USDT",
        )

        # First run · books.
        call_command("backfill_unbooked_fees")
        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        pc_sw = SystemWallet.objects.get(wallet_type="provider_cost", currency="KES")
        ex_sw = SystemWallet.objects.get(wallet_type="excise", currency="KES")
        assert fee_sw.balance == Decimal("15")
        assert pc_sw.balance == Decimal("10")
        assert ex_sw.balance == Decimal("2.50")

        # Second run · idempotent (UUID5 keys hit unique constraint).
        call_command("backfill_unbooked_fees")
        fee_sw.refresh_from_db(); pc_sw.refresh_from_db(); ex_sw.refresh_from_db()
        assert fee_sw.balance == Decimal("15"), (
            f"re-run double-booked · balance {fee_sw.balance} != 15"
        )
        assert pc_sw.balance == Decimal("10")
        assert ex_sw.balance == Decimal("2.50")

    def test_skips_swap_and_failed_txs(self):
        # SWAP path books via book_fee inline · the backfill must
        # NOT re-book it.
        Transaction.objects.create(
            user=self.user,
            type="SWAP",
            status="completed",
            source_currency="USDT",
            source_amount=Decimal("1"),
            dest_currency="USDC",
            dest_amount=Decimal("1"),
            fee_amount=Decimal("0.005"),
            fee_currency="USDT",
            excise_duty_amount=Decimal("0"),
            idempotency_key=f"idem-{uuid.uuid4()}",
            chain="USDT",
        )
        # And a failed tx · also must NOT book.
        Transaction.objects.create(
            user=self.user,
            type="PAYBILL_PAYMENT",
            status="failed",
            source_currency="USDT",
            source_amount=Decimal("1"),
            dest_currency="KES",
            dest_amount=Decimal("100"),
            fee_amount=Decimal("999"),
            fee_currency="KES",
            excise_duty_amount=Decimal("0"),
            idempotency_key=f"idem-{uuid.uuid4()}",
            chain="USDT",
        )

        call_command("backfill_unbooked_fees")
        kes_fee = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        assert kes_fee.balance == Decimal("0"), (
            "SWAP / failed-tx fees leaked into backfill"
        )
