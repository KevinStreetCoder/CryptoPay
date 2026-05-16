"""Tests for /admin/revenue/ · the revenue dashboard.

2026-05-17 · ops asked "how much have we made so far?". The endpoint
sums Transaction.fee_amount + excise_duty_amount across completed
txs and surfaces:
  - lifetime totals per currency
  - rolling 24h / 7d / 30d windows
  - breakdown by tx type
  - "earned vs booked" reconciliation (Transaction record vs
    SystemWallet(FEE) balance) · the gap exposes the known issue that
    paybill/till/B2C/buy paths calculate the fee but don't move it
    into the fee wallet
  - a headline `lifetime_kes_equivalent` figure

Contract pins (don't break without a deliberate ops review):
  - failed / pending txs MUST NOT contribute to revenue
  - excise_duty is reported separately (it's a tax we remit to KRA,
    not our revenue)
  - the kes_equivalent sum is fail-soft when rates are down
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.test import TestCase, Client
from django.utils import timezone

from apps.accounts.models import User
from apps.payments.models import Transaction
from apps.wallets.models import SystemWallet


pytestmark = pytest.mark.django_db


def _make_admin():
    u = User.objects.create_user(
        email="rev-admin@example.com",
        phone="+254700001000",
        password="t",
    )
    u.is_staff = True
    u.save(update_fields=["is_staff"])
    return u


def _make_user(suffix):
    return User.objects.create_user(
        email=f"rev-u{suffix}@example.com",
        phone=f"+25470000{suffix:04d}",
        password="t",
    )


def _make_tx(user, *, tx_type, fee, excise=0, fee_currency="KES",
             status="completed", dest_amount=0, dest_currency="KES",
             completed_at=None):
    return Transaction.objects.create(
        user=user,
        type=tx_type,
        status=status,
        source_currency="USDT",
        source_amount=Decimal("1"),
        dest_currency=dest_currency,
        dest_amount=Decimal(str(dest_amount)),
        fee_amount=Decimal(str(fee)),
        fee_currency=fee_currency,
        excise_duty_amount=Decimal(str(excise)),
        completed_at=completed_at or timezone.now(),
        idempotency_key=f"rev-{user.id}-{tx_type}-{fee}",
        chain="USDT",
    )


class TestAdminRevenueDashboard(TestCase):
    """staff_member_required (Django, not DRF) checks Django session ·
    use the Django test client + force_login, not DRF APIClient."""

    def setUp(self):
        self.admin = _make_admin()
        self.client = Client()
        self.client.force_login(self.admin)

    def test_requires_staff(self):
        # Non-staff get redirected to admin login.
        u = _make_user(99)
        c = Client()
        c.force_login(u)
        r = c.get("/admin/revenue/")
        assert r.status_code in (302, 403)

    @patch(
        "apps.rates.services.RateService.get_crypto_kes_rate",
        side_effect=lambda c: {"final_rate": "130.00" if c == "USDT" else "0"},
    )
    def test_lifetime_totals_per_currency(self, _rates):
        u = _make_user(1)
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="10.00", excise="1.00", dest_amount=500)
        _make_tx(u, tx_type="TILL_PAYMENT", fee="15.50", excise="1.55", dest_amount=200)
        # Different fee_currency: SWAP fees in USDT.
        _make_tx(u, tx_type="SWAP", fee="0.05", excise="0", fee_currency="USDT")

        r = self.client.get("/admin/revenue/")
        assert r.status_code == 200, r.content
        data = r.json()

        # Lifetime block split per currency.
        kes = data["lifetime"]["KES"]
        assert Decimal(kes["fee"]) == Decimal("25.50")
        assert Decimal(kes["excise"]) == Decimal("2.55")
        assert kes["tx_count"] == 2

        usdt = data["lifetime"]["USDT"]
        assert Decimal(usdt["fee"]) == Decimal("0.05")
        assert usdt["tx_count"] == 1

        # Headline KES equivalent: 25.50 KES + (0.05 USDT × 130) = 32.00
        assert Decimal(data["lifetime_kes_equivalent"]) == Decimal("32.00")

    def test_failed_and_pending_txs_excluded(self):
        u = _make_user(2)
        # 10 KES fee on completed.
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="10.00")
        # 999 KES fee on FAILED · MUST NOT contribute (it never paid).
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="999.00", status="failed")
        # 888 on PENDING · MUST NOT contribute.
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="888.00", status="pending")

        r = self.client.get("/admin/revenue/")
        data = r.json()
        kes = data["lifetime"]["KES"]
        assert Decimal(kes["fee"]) == Decimal("10.00"), (
            f"failed/pending txs leaked into lifetime revenue: {kes}"
        )

    def test_rolling_periods(self):
        u = _make_user(3)
        now = timezone.now()
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="50.00",
                 completed_at=now - timedelta(hours=1))   # 24h + 7d + 30d
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="30.00",
                 completed_at=now - timedelta(days=3))     # 7d + 30d only
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="20.00",
                 completed_at=now - timedelta(days=20))    # 30d only
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="10.00",
                 completed_at=now - timedelta(days=60))    # none

        r = self.client.get("/admin/revenue/")
        data = r.json()

        last_24h = data["periods"]["last_24h"]["KES"]
        last_7d  = data["periods"]["last_7d"]["KES"]
        last_30d = data["periods"]["last_30d"]["KES"]

        assert Decimal(last_24h["fee"]) == Decimal("50.00")
        assert Decimal(last_7d["fee"])  == Decimal("80.00"), last_7d
        assert Decimal(last_30d["fee"]) == Decimal("100.00"), last_30d

    def test_by_type_breakdown(self):
        u = _make_user(4)
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="10")
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="15")
        _make_tx(u, tx_type="TILL_PAYMENT",    fee="20")
        _make_tx(u, tx_type="SEND_MPESA",      fee="5")

        r = self.client.get("/admin/revenue/")
        data = r.json()
        by_type = {row["tx_type"]: row for row in data["by_type"]}
        # Paybill: 25, Till: 20, SendM: 5
        assert Decimal(by_type["PAYBILL_PAYMENT"]["fee"]) == Decimal("25")
        assert by_type["PAYBILL_PAYMENT"]["tx_count"] == 2
        assert Decimal(by_type["TILL_PAYMENT"]["fee"]) == Decimal("20")
        assert Decimal(by_type["SEND_MPESA"]["fee"]) == Decimal("5")

    def test_earned_vs_booked_reconciliation_gap_visible(self):
        # 20 KES earned across two paybill txs · NOT moved to fee wallet.
        u = _make_user(5)
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="12")
        _make_tx(u, tx_type="TILL_PAYMENT",    fee="8")
        # Seed an empty KES fee wallet to mirror prod.
        SystemWallet.objects.create(
            wallet_type=SystemWallet.WalletType.FEE,
            currency="KES",
            balance=Decimal("0"),
            chain="",
        )

        r = self.client.get("/admin/revenue/")
        data = r.json()
        kes_recon = next(
            x for x in data["reconciliation"] if x["currency"] == "KES"
        )
        # Earned 20 KES, booked 0 KES → gap = 20.
        assert Decimal(kes_recon["earned_per_tx_records"]) == Decimal("20")
        assert Decimal(kes_recon["booked_in_fee_wallet"]) == Decimal("0")
        assert Decimal(kes_recon["gap"]) == Decimal("20"), (
            "the earned-vs-booked gap MUST be exposed to ops · this is "
            "the headline signal that paybill/till revenue isn't moving "
            "into the fee SystemWallet yet"
        )

    def test_excise_separated_from_revenue(self):
        # Excise is a tax we remit to KRA · MUST be reported separately
        # so ops doesn't double-count it as our income.
        u = _make_user(6)
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="10", excise="3")

        r = self.client.get("/admin/revenue/")
        data = r.json()
        kes = data["lifetime"]["KES"]
        assert Decimal(kes["fee"]) == Decimal("10")
        assert Decimal(kes["excise"]) == Decimal("3")
        # "total" tracks the gross (fee + excise) for ops who want to
        # see total money flowing, but the headline kes_equivalent
        # uses ONLY fee · excise belongs to KRA.
        assert Decimal(kes["total"]) == Decimal("13")
        # Headline ignores excise.
        assert Decimal(data["lifetime_kes_equivalent"]) == Decimal("10.00")

    @patch(
        "apps.rates.services.RateService.get_crypto_kes_rate",
        side_effect=RuntimeError("rates provider down"),
    )
    def test_kes_equivalent_fail_soft(self, _rates):
        # Provider down · crypto fees contribute 0 to KES equivalent,
        # KES fees still count (rate=1 hardcoded path).
        u = _make_user(7)
        _make_tx(u, tx_type="PAYBILL_PAYMENT", fee="50", fee_currency="KES")
        _make_tx(u, tx_type="SWAP",            fee="0.1", fee_currency="USDT")

        r = self.client.get("/admin/revenue/")
        assert r.status_code == 200
        data = r.json()
        # 50 KES + 0 (USDT can't be converted) = 50.00
        assert Decimal(data["lifetime_kes_equivalent"]) == Decimal("50.00")
