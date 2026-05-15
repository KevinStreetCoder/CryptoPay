"""Status-query cron · per-tx-type provider routing.

2026-05-15 · regression test for the beta-launch bug:

  check_pending_mpesa_payments previously resolved the provider via the
  legacy single-knob `PAYMENT_PROVIDER` setting. After per-method routing
  landed (`PAYMENT_PROVIDER_PAYBILL`, `_TILL`, `_B2C`, `_STK`), the cron
  silently kept reading the legacy knob · for our beta deploy that's
  "sasapay", so paybills that actually went through IntaSend were
  status-queried against SasaPay. SasaPay didn't know about the IntaSend
  tracking_id, returned HTTP 404, and the saga set:

      failure_reason = "SasaPay: [404] no description"

  even though the IntaSend rail had separately processed the payment.

These tests verify that the cron now picks the resolver from the
PER-TX-TYPE provider override · paybill → intasend, b2c → sasapay,
etc · regardless of what the legacy single-knob says.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.payments.models import Transaction


pytestmark = pytest.mark.django_db


def _make_stale_tx(user, *, tx_type, conv_id="conv-1"):
    """Build a CONFIRMING/PROCESSING tx with an updated_at older than
    the 60-second freshness cutoff used by check_pending_mpesa_payments."""
    stale_at = timezone.now() - timedelta(seconds=120)
    tx = Transaction.objects.create(
        user=user,
        idempotency_key=str(uuid4()),
        type=tx_type,
        status=(
            Transaction.Status.PROCESSING
            if tx_type in (Transaction.Type.BUY, Transaction.Type.DEPOSIT)
            else Transaction.Status.CONFIRMING
        ),
        source_currency="USDT",
        source_amount=Decimal("0.10"),
        dest_currency="KES",
        dest_amount=Decimal("10"),
        fee_amount=Decimal("0"),
        fee_currency="KES",
        mpesa_paybill="888880" if tx_type == Transaction.Type.PAYBILL_PAYMENT else "",
        mpesa_till="123456" if tx_type == Transaction.Type.TILL_PAYMENT else "",
        mpesa_phone="254712345678" if tx_type == Transaction.Type.SEND_MPESA else "",
        saga_data={"mpesa_conversation_id": conv_id},
    )
    # Bypass auto_now=True to backdate updated_at.
    Transaction.objects.filter(id=tx.id).update(updated_at=stale_at)
    tx.refresh_from_db()
    return tx


@override_settings(
    # Legacy knob says SasaPay · per-method override puts paybill on IntaSend.
    PAYMENT_PROVIDER="sasapay",
    PAYMENT_PROVIDER_PAYBILL="intasend",
    PAYMENT_PROVIDER_TILL="intasend",
    PAYMENT_PROVIDER_B2C="sasapay",
    PAYMENT_PROVIDER_STK="sasapay",
)
class TestStatusQueryPerTxTypeRouting(TestCase):
    """The smoking gun: a paybill stuck in CONFIRMING with the legacy
    knob set to "sasapay" but the paybill override set to "intasend"
    MUST be polled against IntaSend, never SasaPay."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            email="status-query-test@example.com",
            phone="+254700111222",
            password="testing12345",
        )

    @patch("apps.payments.tasks._resolve_via_intasend_status")
    @patch("apps.payments.tasks._resolve_via_sasapay_status")
    def test_paybill_tx_polls_intasend_not_sasapay(self, sasapay_mock, intasend_mock):
        tx = _make_stale_tx(
            self.user,
            tx_type=Transaction.Type.PAYBILL_PAYMENT,
            conv_id="intasend-tracking-id-abc",
        )

        from apps.payments.tasks import check_pending_mpesa_payments
        check_pending_mpesa_payments()

        intasend_mock.assert_called_once()
        sasapay_mock.assert_not_called()
        # Confirm the right tracking_id was forwarded.
        called_tx, called_id = intasend_mock.call_args.args
        assert called_tx.id == tx.id
        assert called_id == "intasend-tracking-id-abc"

    @patch("apps.payments.tasks._resolve_via_intasend_status")
    @patch("apps.payments.tasks._resolve_via_sasapay_status")
    def test_till_tx_polls_intasend_not_sasapay(self, sasapay_mock, intasend_mock):
        _make_stale_tx(
            self.user,
            tx_type=Transaction.Type.TILL_PAYMENT,
            conv_id="intasend-till-tracking-id",
        )

        from apps.payments.tasks import check_pending_mpesa_payments
        check_pending_mpesa_payments()

        intasend_mock.assert_called_once()
        sasapay_mock.assert_not_called()

    @patch("apps.payments.tasks._resolve_via_intasend_status")
    @patch("apps.payments.tasks._resolve_via_sasapay_status")
    def test_b2c_tx_polls_sasapay_not_intasend(self, sasapay_mock, intasend_mock):
        # B2C stays on SasaPay (float lives there) · the cron MUST
        # NOT regress this path.
        _make_stale_tx(
            self.user,
            tx_type=Transaction.Type.SEND_MPESA,
            conv_id="sasapay-b2c-conv",
        )

        from apps.payments.tasks import check_pending_mpesa_payments
        check_pending_mpesa_payments()

        sasapay_mock.assert_called_once()
        intasend_mock.assert_not_called()


@override_settings(
    PAYMENT_PROVIDER="daraja",
    PAYMENT_PROVIDER_PAYBILL="",  # blank → falls back to legacy "daraja"
    PAYMENT_PROVIDER_TILL="",
    PAYMENT_PROVIDER_B2C="",
    PAYMENT_PROVIDER_STK="",
)
class TestStatusQueryDarajaFallback(TestCase):
    """When per-method overrides are blank, fall back to the legacy
    PAYMENT_PROVIDER. Preserves backwards-compatibility for deploys
    that never set per-method env vars."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            email="status-query-daraja@example.com",
            phone="+254700333444",
            password="testing12345",
        )

    @patch("apps.payments.tasks._resolve_via_intasend_status")
    @patch("apps.payments.tasks._resolve_via_sasapay_status")
    @patch("apps.mpesa.client.MpesaClient")
    def test_daraja_paybill_status_query(
        self, mpesa_client_cls, sasapay_mock, intasend_mock,
    ):
        _make_stale_tx(
            self.user,
            tx_type=Transaction.Type.PAYBILL_PAYMENT,
            conv_id="daraja-conv",
        )
        mpesa_client_cls.return_value.transaction_status.return_value = {
            "ResponseCode": "0",
        }

        from apps.payments.tasks import check_pending_mpesa_payments
        check_pending_mpesa_payments()

        mpesa_client_cls.return_value.transaction_status.assert_called_once_with(
            "daraja-conv",
        )
        sasapay_mock.assert_not_called()
        intasend_mock.assert_not_called()
