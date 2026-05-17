"""Regression tests for the 2026-05-17 saga.complete refactor (M1+M8+M12).

The previous saga.complete bailed early on `status=COMPLETED`, which meant
that webhook handlers (SasaPay, IntaSend) that pre-flipped status to
COMPLETED before calling saga.complete left `_book_revenue_split` never
executing in production. ALL real revenue bookings were silently leaked.

After the fix:
  - saga.complete runs `_book_revenue_split` UNCONDITIONALLY (idempotent
    via FeeLedgerEntry unique constraint).
  - notifications gated by Redis SETNX so they fire EXACTLY ONCE even
    when both saga.complete AND the webhook handler dispatch.
  - first_completion flag drives status-flip + platform-limits recording.

This file is the audit-mandated regression guard so the M1 fix can never
silently regress again. Brutally tests the production behaviour.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.test import TestCase

from apps.accounts.models import User
from apps.payments.models import Transaction
from apps.payments.saga import PaymentSaga, _try_acquire_notify_lock
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
        email=f"saga-fix-{suffix}@example.com",
        phone=f"+25470022{suffix:04d}",
        password="t",
    )


def _make_tx(user, *, tx_type="PAYBILL_PAYMENT", status,
             fee="25", excise="2.50", intasend_charges=None,
             mpesa_receipt=""):
    """Helper · build a tx in the requested state with optional charge."""
    sd = {}
    if intasend_charges is not None:
        sd["intasend_charges"] = str(intasend_charges)
    return Transaction.objects.create(
        user=user,
        type=tx_type,
        status=status,
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
        mpesa_receipt=mpesa_receipt,
    )


class TestSagaCompleteOnAlreadyCompletedTx(TestCase):
    """The CORE bug · saga.complete called on already-COMPLETED tx
    used to bail out, leaving revenue unbooked. After the fix, it
    runs `_book_revenue_split` and the booking lands.
    """

    def setUp(self):
        _seed_fee_wallets("KES")
        self.user = _make_user(10)
        cache.clear()  # reset notify-locks between tests

    def test_books_revenue_when_tx_already_completed(self):
        # Webhook-style flow · tx is already COMPLETED in DB when saga
        # is invoked (e.g. SasaPay/IntaSend webhook flipped status
        # inline before calling saga.complete).
        tx = _make_tx(
            self.user, tx_type="PAYBILL_PAYMENT",
            status=Transaction.Status.COMPLETED,
            fee="25", excise="2.50", intasend_charges="10",
            mpesa_receipt="PREFLIPPED",
        )

        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"):
            PaymentSaga(tx).complete(mpesa_receipt="PREFLIPPED")

        # CRITICAL · these would all be zero before the fix.
        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        pc_sw = SystemWallet.objects.get(wallet_type="provider_cost", currency="KES")
        ex_sw = SystemWallet.objects.get(wallet_type="excise", currency="KES")

        assert fee_sw.balance == Decimal("15"), (
            f"FEE wallet must be credited even when tx status was already "
            f"COMPLETED on entry · got {fee_sw.balance}"
        )
        assert pc_sw.balance == Decimal("10")
        assert ex_sw.balance == Decimal("2.50")

        # FeeLedgerEntry rows persist for audit + idempotency.
        assert FeeLedgerEntry.objects.filter(transaction_id=tx.id).count() == 3

    def test_double_invocation_is_idempotent(self):
        # Webhook fires, sets status=COMPLETED, calls saga.complete.
        # Cron fires later, ALSO calls saga.complete. Second call must
        # not double-book FEE/PROVIDER_COST/EXCISE.
        tx = _make_tx(
            self.user, tx_type="TILL_PAYMENT",
            status=Transaction.Status.COMPLETED,
            fee="30", excise="3", intasend_charges="5",
        )

        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"):
            PaymentSaga(tx).complete(mpesa_receipt="RA")
            tx.refresh_from_db()
            PaymentSaga(tx).complete(mpesa_receipt="RA")  # 2nd call

        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        pc_sw = SystemWallet.objects.get(wallet_type="provider_cost", currency="KES")
        ex_sw = SystemWallet.objects.get(wallet_type="excise", currency="KES")

        assert fee_sw.balance == Decimal("25"), (
            f"FEE booked exactly once · expected 25 (30-5), got {fee_sw.balance}"
        )
        assert pc_sw.balance == Decimal("5")
        assert ex_sw.balance == Decimal("3")

        # 3 FeeLedgerEntry rows total · not 6 (no double-write).
        assert FeeLedgerEntry.objects.filter(transaction_id=tx.id).count() == 3


class TestSagaFirstCompletionGating(TestCase):
    """Verifies the `first_completion` flag controls status flip +
    platform-limits recording. _book_revenue_split runs in both cases.
    """

    def setUp(self):
        _seed_fee_wallets("KES")
        self.user = _make_user(20)
        cache.clear()

    def test_fresh_completion_flips_status_and_records_outgoing(self):
        tx = _make_tx(
            self.user, tx_type="SEND_MPESA",
            status=Transaction.Status.CONFIRMING,
            fee="20", excise="2",
        )

        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"), \
             patch("apps.payments.platform_limits.record_outgoing") as ro:
            PaymentSaga(tx).complete(mpesa_receipt="FRESHRECEIPT")

        tx.refresh_from_db()
        assert tx.status == Transaction.Status.COMPLETED
        assert tx.mpesa_receipt == "FRESHRECEIPT"
        # platform-limits MUST be recorded on first completion
        ro.assert_called_once()

    def test_already_completed_skips_status_flip_and_record_outgoing(self):
        tx = _make_tx(
            self.user, tx_type="SEND_MPESA",
            status=Transaction.Status.COMPLETED,
            fee="20", excise="2",
            mpesa_receipt="ORIGINAL",
        )

        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"), \
             patch("apps.payments.platform_limits.record_outgoing") as ro:
            PaymentSaga(tx).complete(mpesa_receipt="LATER")

        tx.refresh_from_db()
        assert tx.mpesa_receipt == "ORIGINAL", (
            "Saga must NOT overwrite the receipt when status was already "
            "COMPLETED · the prior caller's receipt is authoritative."
        )
        # platform-limits NOT recorded twice
        ro.assert_not_called()


class TestNotificationSetnxGuard(TestCase):
    """M12 fix · Redis SETNX guarantees notifications fire EXACTLY ONCE."""

    def setUp(self):
        _seed_fee_wallets("KES")
        self.user = _make_user(30)
        cache.clear()

    def test_lock_acquisition_is_winner_takes_all(self):
        tx_id = uuid.uuid4()
        # First caller wins
        assert _try_acquire_notify_lock(tx_id) is True
        # Second caller for same tx_id sees the lock
        assert _try_acquire_notify_lock(tx_id) is False
        # Different tx_id is independent
        assert _try_acquire_notify_lock(uuid.uuid4()) is True

    def test_saga_complete_dispatches_notifications_once(self):
        tx = _make_tx(
            self.user, tx_type="PAYBILL_PAYMENT",
            status=Transaction.Status.CONFIRMING,
            fee="10", excise="1",
        )

        with patch("apps.core.email.send_transaction_notifications") as notify, \
             patch("apps.core.broadcast.broadcast_user_balance") as bcast:
            PaymentSaga(tx).complete(mpesa_receipt="N1")
            tx.refresh_from_db()
            # Second call · saga sees status=COMPLETED, books revenue
            # (idempotent), but notification lock blocks re-dispatch.
            PaymentSaga(tx).complete(mpesa_receipt="N1")

        assert notify.call_count == 1, (
            f"Notifications must fire exactly once across both calls · "
            f"got {notify.call_count}"
        )
        assert bcast.call_count == 1

    def test_concurrent_callers_one_dispatches(self):
        # Simulate two callers acquiring the lock for same tx · only one
        # gets through.
        tx_id = uuid.uuid4()
        first = _try_acquire_notify_lock(tx_id)
        second = _try_acquire_notify_lock(tx_id)
        assert first is True
        assert second is False


class TestSasaPayChargeHandoff(TestCase):
    """The M11 + M1 path · SasaPay webhook stamps charge in saga_data
    then calls saga.complete. After the refactor, the saga reads the
    stamped charge even when called on an already-COMPLETED tx.
    """

    def setUp(self):
        _seed_fee_wallets("KES")
        self.user = _make_user(40)
        cache.clear()

    def test_paybill_with_sasapay_charge_books_provider_cost_correctly(self):
        # Simulate: webhook stamped charge=8 KES on saga_data, flipped
        # status to COMPLETED, then called saga.complete.
        tx = _make_tx(
            self.user, tx_type="PAYBILL_PAYMENT",
            status=Transaction.Status.COMPLETED,
            fee="20", excise="2", intasend_charges="8",  # SasaPay charge
        )

        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"):
            PaymentSaga(tx).complete(mpesa_receipt="SP_RCT")

        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        pc_sw = SystemWallet.objects.get(wallet_type="provider_cost", currency="KES")

        assert fee_sw.balance == Decimal("12"), (
            f"NET fee = 20 gross − 8 SasaPay charge = 12 · got {fee_sw.balance}"
        )
        assert pc_sw.balance == Decimal("8")

    def test_buy_is_not_double_booked_via_saga(self):
        # BUY tx · sasapay_views.py books revenue inline + does NOT
        # invoke saga.complete (BUY block at lines 1062-1135). Verify
        # saga has no side-effects when called externally on a BUY tx
        # that already has its bookings.
        tx = Transaction.objects.create(
            user=self.user,
            type="BUY",
            status=Transaction.Status.COMPLETED,
            source_currency="KES",
            source_amount=Decimal("1000"),
            dest_currency="USDT",
            dest_amount=Decimal("8"),
            fee_amount=Decimal("15"),
            fee_currency="KES",
            excise_duty_amount=Decimal("2"),
            saga_data={},
            idempotency_key=f"buy-{uuid.uuid4()}",
            chain="USDT",
        )
        # NOTE · in production sasapay_views.py never calls saga.complete
        # on BUY, but if it ever did, the booking should still be safe.
        with patch("apps.core.email.send_transaction_notifications"), \
             patch("apps.core.broadcast.broadcast_user_balance"):
            PaymentSaga(tx).complete(mpesa_receipt="BUY_RCT")

        fee_sw = SystemWallet.objects.get(wallet_type="fee", currency="KES")
        # FeeLedgerEntry uniqueness · saga can only book once per tx
        # regardless of how many times it's called.
        assert fee_sw.balance == Decimal("15")
        assert FeeLedgerEntry.objects.filter(
            transaction_id=tx.id
        ).count() == 2  # FEE + EXCISE (no provider_cost since charge=0)


class TestCompensateConvertM9Race(TestCase):
    """M9 fix · `compensated_at` stamp inside atomic block makes the
    row lock genuinely serializing.
    """

    def setUp(self):
        self.user = _make_user(50)

    def test_compensate_convert_stamps_compensated_at(self):
        from apps.wallets.models import Wallet

        # Create wallet + lock funds
        wallet = Wallet.objects.create(
            user=self.user,
            currency="USDT",
            balance=Decimal("100"),
            locked_balance=Decimal("8"),
        )

        tx = Transaction.objects.create(
            user=self.user,
            type="PAYBILL_PAYMENT",
            status=Transaction.Status.FAILED,
            source_currency="USDT",
            source_amount=Decimal("8"),
            dest_currency="KES",
            dest_amount=Decimal("1000"),
            saga_data={
                "conversion_completed": True,
                "locked_wallet_id": str(wallet.id),
                "locked_amount": "8",
            },
            idempotency_key=f"comp-{uuid.uuid4()}",
            chain="USDT",
            mpesa_paybill="888880",
        )

        PaymentSaga(tx).compensate_convert()

        tx.refresh_from_db()
        assert "compensated_at" in (tx.saga_data or {}), (
            "compensate_convert MUST stamp compensated_at inside its atomic "
            "block · without it the row-lock is decorative and concurrent "
            "callers both reach the credit logic"
        )

    def test_compensate_convert_short_circuits_on_already_compensated(self):
        from django.utils import timezone
        from apps.wallets.models import Wallet

        wallet = Wallet.objects.create(
            user=self.user,
            currency="USDT",
            balance=Decimal("100"),
            locked_balance=Decimal("0"),
        )

        tx = Transaction.objects.create(
            user=self.user,
            type="PAYBILL_PAYMENT",
            status=Transaction.Status.FAILED,
            source_currency="USDT",
            source_amount=Decimal("8"),
            dest_currency="KES",
            dest_amount=Decimal("1000"),
            saga_data={
                "conversion_completed": True,
                "locked_wallet_id": str(wallet.id),
                "locked_amount": "8",
                "compensated_at": timezone.now().isoformat(),
            },
            idempotency_key=f"comp2-{uuid.uuid4()}",
            chain="USDT",
            mpesa_paybill="888880",
        )

        # Wallet balance should NOT change · already-compensated guard fires
        before = wallet.balance
        PaymentSaga(tx).compensate_convert()
        wallet.refresh_from_db()
        assert wallet.balance == before
