"""SasaPay → IntaSend auto-fallback · 2026-05-10.

When SasaPay returns an M-Pesa rail-denial code (SP01002 / SP01003 /
2028) against an outgoing payment, the failure callback path is
expected to retry the SAME logical payment through IntaSend before
marking the tx FAILED. This module brutally exercises every branch of
that decision tree:

  1. SP01002 + paybill → IntaSend.pay_paybill called, tx stays
     CONFIRMING, saga_data carries intasend_tracking_id + audit row.
  2. 2028 + till → IntaSend.pay_till called.
  3. SP01003 + phone → IntaSend.send_to_mobile called.
  4. Non-rail-denial code (e.g. 1032 user-cancelled) → no fallback,
     tx goes FAILED + compensate fires.
  5. Rail-denial code BUT IntaSend not configured → no fallback, tx
     goes FAILED + compensate fires.
  6. Rail-denial code BUT IntaSend raises → fall through to FAILED +
     compensate (user must not be left with locked crypto).
  7. Rail-denial code on a deposit/swap (no mpesa rail) → no fallback,
     tx goes FAILED.
  8. Locked crypto is unlocked exactly when fallback does NOT take
     over (compensation path). When fallback succeeds the lock stays
     in place pending the IntaSend callback.

The tests deliberately do NOT mock `_process_failed_payment` itself ·
they stub only the IntaSend HTTP layer and the wallet-unlock service
so they cover the real branching logic.
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings

from apps.accounts.models import User
from apps.mpesa.sasapay_views import (
    _extract_failure_reason,
    _process_failed_payment,
)
from apps.payments.models import Transaction


pytestmark = pytest.mark.django_db


def _make_user(phone="+254712345678"):
    return User.objects.create_user(phone=phone, pin="123456")


def _make_paybill_tx(user, **overrides):
    """A CONFIRMING outgoing-paybill tx with locked crypto recorded
    in saga_data (mirrors what PaymentSaga.lock_crypto would set up
    in production)."""
    defaults = dict(
        user=user,
        type=Transaction.Type.PAYBILL_PAYMENT,
        status=Transaction.Status.CONFIRMING,
        source_currency="USDT",
        source_amount=Decimal("1.00"),
        dest_currency="KES",
        dest_amount=Decimal("100"),
        mpesa_paybill="888880",
        mpesa_account="123456789",
        idempotency_key="idem-key-1",
        saga_data={
            "locked_wallet_id": "00000000-0000-0000-0000-000000000aaa",
            "locked_amount": "1.00",
        },
    )
    defaults.update(overrides)
    return Transaction.objects.create(**defaults)


def _failure_payload(tx, code="SP01002", desc="Not permitted"):
    return {
        "ResultCode": code,
        "ResultDesc": desc,
        "MerchantTransactionReference": str(tx.id),
        "TransactionAmount": str(tx.dest_amount or 0),
    }


# ── 1. Rail-denial + paybill triggers IntaSend.pay_paybill ───────────


@override_settings(INTASEND_API_SECRET="ISSecretKey_test_xxx")
class TestRailDenialPaybillFallback(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.tx = _make_paybill_tx(self.user)

    @patch("apps.mpesa.intasend_client.IntaSendClient.pay_paybill")
    @patch("apps.wallets.services.WalletService.unlock_funds")
    def test_sp01002_paybill_retries_via_intasend(
        self, mock_unlock, mock_pay_paybill,
    ):
        mock_pay_paybill.return_value = {
            "ConversationID": "INTASEND_TRACK_001",
            "OriginatorConversationID": f"sasapay-fb-{self.tx.id}",
            "ResponseCode": "0",
            "ResponseDescription": "QUEUED",
        }

        _process_failed_payment(
            data=_failure_payload(self.tx, code="SP01002"),
            ref=str(self.tx.id),
            reason="Not permitted",
            result_code="SP01002",
        )

        # IntaSend got the call with the right rail data
        mock_pay_paybill.assert_called_once()
        call_kwargs = mock_pay_paybill.call_args.kwargs
        assert call_kwargs["paybill"] == "888880"
        assert call_kwargs["account"] == "123456789"
        assert call_kwargs["reference"] == f"sasapay-fb-{self.tx.id}"
        assert int(call_kwargs["amount"]) == 100

        # Tx stays CONFIRMING · NOT FAILED
        self.tx.refresh_from_db()
        assert self.tx.status == Transaction.Status.CONFIRMING
        assert self.tx.saga_data["intasend_tracking_id"] == "INTASEND_TRACK_001"
        assert self.tx.saga_data["intasend_api_ref"] == f"sasapay-fb-{self.tx.id}"
        assert self.tx.saga_data["fallback_provider"] == "intasend"
        history = self.tx.saga_data["fallback_history"]
        assert len(history) == 1
        assert history[0]["from"] == "sasapay"
        assert history[0]["to"] == "intasend"
        assert history[0]["reason_code"] == "SP01002"
        assert history[0]["tracking_id"] == "INTASEND_TRACK_001"

        # Crypto MUST stay locked while IntaSend works on it
        mock_unlock.assert_not_called()


# ── 2. Rail-denial + till triggers IntaSend.pay_till ─────────────────


@override_settings(INTASEND_API_SECRET="ISSecretKey_test_xxx")
class TestRailDenialTillFallback(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.tx = _make_paybill_tx(
            self.user,
            type=Transaction.Type.TILL_PAYMENT,
            mpesa_paybill="",
            mpesa_account="",
            mpesa_till="5500000",
        )

    @patch("apps.mpesa.intasend_client.IntaSendClient.pay_till")
    def test_2028_till_retries_via_intasend(self, mock_pay_till):
        mock_pay_till.return_value = {
            "ConversationID": "INTASEND_TILL_001",
            "ResponseCode": "0",
        }

        _process_failed_payment(
            data=_failure_payload(self.tx, code="2028"),
            ref=str(self.tx.id),
            reason="Receiver not assigned to product",
            result_code="2028",
        )

        mock_pay_till.assert_called_once()
        kwargs = mock_pay_till.call_args.kwargs
        assert kwargs["till"] == "5500000"
        assert kwargs["reference"] == f"sasapay-fb-{self.tx.id}"

        self.tx.refresh_from_db()
        assert self.tx.status == Transaction.Status.CONFIRMING


# ── 3. Rail-denial + send-mobile triggers send_to_mobile ─────────────


@override_settings(INTASEND_API_SECRET="ISSecretKey_test_xxx")
class TestRailDenialSendMobileFallback(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.tx = _make_paybill_tx(
            self.user,
            type=Transaction.Type.SEND_MPESA,
            mpesa_paybill="",
            mpesa_account="",
            mpesa_phone="+254700000000",
        )

    @patch("apps.mpesa.intasend_client.IntaSendClient.send_to_mobile")
    def test_sp01003_phone_retries_via_intasend(self, mock_b2c):
        mock_b2c.return_value = {
            "ConversationID": "INTASEND_B2C_001",
            "ResponseCode": "0",
        }

        _process_failed_payment(
            data=_failure_payload(self.tx, code="SP01003"),
            ref=str(self.tx.id),
            reason="Insufficient receiver",
            result_code="SP01003",
        )

        mock_b2c.assert_called_once()
        kwargs = mock_b2c.call_args.kwargs
        assert kwargs["phone"] == "+254700000000"
        assert kwargs["reference"] == f"sasapay-fb-{self.tx.id}"

        self.tx.refresh_from_db()
        assert self.tx.status == Transaction.Status.CONFIRMING


# ── 4. Non-rail-denial code does NOT fall back ───────────────────────


@override_settings(INTASEND_API_SECRET="ISSecretKey_test_xxx")
class TestNonRailDenialNoFallback(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.tx = _make_paybill_tx(self.user)

    @patch("apps.mpesa.intasend_client.IntaSendClient.pay_paybill")
    @patch("apps.wallets.services.WalletService.unlock_funds")
    def test_user_cancel_does_not_fall_back(
        self, mock_unlock, mock_pay_paybill,
    ):
        # 1032 = user cancelled · not a rail-permission denial. We
        # MUST NOT silently retry on IntaSend (that would charge twice).
        _process_failed_payment(
            data=_failure_payload(self.tx, code="1032", desc="User cancelled"),
            ref=str(self.tx.id),
            reason="User cancelled",
            result_code="1032",
        )

        mock_pay_paybill.assert_not_called()
        self.tx.refresh_from_db()
        assert self.tx.status == Transaction.Status.FAILED
        # And the user gets their crypto back.
        mock_unlock.assert_called_once()


# ── 5. IntaSend not configured → no fallback ─────────────────────────


@override_settings(INTASEND_API_SECRET="")
class TestIntaSendNotConfiguredNoFallback(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.tx = _make_paybill_tx(self.user)

    @patch("apps.mpesa.intasend_client.IntaSendClient.pay_paybill")
    @patch("apps.wallets.services.WalletService.unlock_funds")
    def test_missing_secret_falls_through_to_failed(
        self, mock_unlock, mock_pay_paybill,
    ):
        _process_failed_payment(
            data=_failure_payload(self.tx, code="SP01002"),
            ref=str(self.tx.id),
            reason="Not permitted",
            result_code="SP01002",
        )

        mock_pay_paybill.assert_not_called()
        self.tx.refresh_from_db()
        assert self.tx.status == Transaction.Status.FAILED
        mock_unlock.assert_called_once()


# ── 6. IntaSend raises → fall through to FAILED + compensate ─────────


@override_settings(INTASEND_API_SECRET="ISSecretKey_test_xxx")
class TestIntaSendErrorFallsThrough(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.tx = _make_paybill_tx(self.user)

    @patch("apps.mpesa.intasend_client.IntaSendClient.pay_paybill")
    @patch("apps.wallets.services.WalletService.unlock_funds")
    def test_intasend_api_error_does_not_strand_user(
        self, mock_unlock, mock_pay_paybill,
    ):
        from apps.mpesa.intasend_client import IntaSendError
        mock_pay_paybill.side_effect = IntaSendError("503 upstream timeout")

        _process_failed_payment(
            data=_failure_payload(self.tx, code="SP01002"),
            ref=str(self.tx.id),
            reason="Not permitted",
            result_code="SP01002",
        )

        # IntaSend was tried · then the original FAILED + refund path ran
        mock_pay_paybill.assert_called_once()
        self.tx.refresh_from_db()
        assert self.tx.status == Transaction.Status.FAILED
        mock_unlock.assert_called_once_with(
            wallet_id="00000000-0000-0000-0000-000000000aaa",
            amount=Decimal("1.00"),
            transaction_id=self.tx.id,
        )

    @patch("apps.mpesa.intasend_client.IntaSendClient.pay_paybill")
    @patch("apps.wallets.services.WalletService.unlock_funds")
    def test_intasend_returns_non_zero_response_code(
        self, mock_unlock, mock_pay_paybill,
    ):
        # IntaSend accepted the HTTP call but returned a non-success
        # code · still treated as fallback-failed so we refund.
        mock_pay_paybill.return_value = {
            "ConversationID": "",
            "ResponseCode": "1",
            "ResponseDescription": "ROUTE_DOWN",
        }

        _process_failed_payment(
            data=_failure_payload(self.tx, code="SP01002"),
            ref=str(self.tx.id),
            reason="Not permitted",
            result_code="SP01002",
        )

        mock_pay_paybill.assert_called_once()
        self.tx.refresh_from_db()
        assert self.tx.status == Transaction.Status.FAILED
        mock_unlock.assert_called_once()


# ── 7b. Failure-reason multi-field parser ────────────────────────────


class TestFailureReasonExtractor(TestCase):
    """Ensure `_extract_failure_reason` produces actionable output for
    every SasaPay response shape we've seen in production · prevents
    the regression where Kevin Kareithi tx 9291FB4E (2026-05-09 STK
    timeout) recorded `failure_reason='SasaPay: Unknown'`."""

    def test_pulls_resultdesc(self):
        raw, with_code = _extract_failure_reason(
            {"ResultDesc": "DS Timeout user cannot be reached"},
            "1037",
        )
        assert raw == "DS Timeout user cannot be reached"
        assert with_code == "[1037] DS Timeout user cannot be reached"

    def test_pulls_camelcase_resultdesc(self):
        raw, with_code = _extract_failure_reason(
            {"resultDesc": "User cancelled"}, "1032",
        )
        assert raw == "User cancelled"
        assert with_code == "[1032] User cancelled"

    def test_pulls_responsedescription(self):
        raw, _ = _extract_failure_reason(
            {"ResponseDescription": "Insufficient balance"}, "1",
        )
        assert raw == "Insufficient balance"

    def test_pulls_message(self):
        raw, _ = _extract_failure_reason(
            {"message": "Service temporarily unavailable"}, "503",
        )
        assert raw == "Service temporarily unavailable"

    def test_pulls_detail(self):
        raw, _ = _extract_failure_reason(
            {"detail": "Provide a valid serviceCode"}, "400",
        )
        assert raw == "Provide a valid serviceCode"

    def test_blank_payload_uses_placeholder_with_code(self):
        # The exact bug behind the Kevin Kareithi alert · no description
        # field at all. Old behaviour: failure_reason = "SasaPay: Unknown".
        # New behaviour: "SasaPay: [1037] no description".
        raw, with_code = _extract_failure_reason({}, "1037")
        assert raw == "no description"
        assert with_code == "[1037] no description"

    def test_blank_payload_no_code_returns_placeholder(self):
        raw, with_code = _extract_failure_reason({}, "")
        assert raw == "no description"
        assert with_code == "no description"

    def test_priority_order_resultdesc_wins_over_message(self):
        raw, _ = _extract_failure_reason(
            {"ResultDesc": "AAA", "message": "BBB"}, "1",
        )
        assert raw == "AAA"

    def test_whitespace_only_field_skipped(self):
        # SasaPay sometimes sends an empty-string ResultDesc; we should
        # fall through to the next field, not return whitespace.
        raw, _ = _extract_failure_reason(
            {"ResultDesc": "   ", "message": "Real reason"}, "1",
        )
        assert raw == "Real reason"


# ── 7. Tx without mpesa rail data → no fallback ──────────────────────


@override_settings(INTASEND_API_SECRET="ISSecretKey_test_xxx")
class TestNoMpesaRailNoFallback(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.tx = _make_paybill_tx(
            self.user,
            type=Transaction.Type.SWAP,
            mpesa_paybill="",
            mpesa_till="",
            mpesa_phone="",
        )

    @patch("apps.mpesa.intasend_client.IntaSendClient.pay_paybill")
    def test_swap_does_not_route_to_intasend(self, mock_pay_paybill):
        # Even SP01002 on a non-rail tx should not call IntaSend ·
        # there's nothing to pay.
        _process_failed_payment(
            data=_failure_payload(self.tx, code="SP01002"),
            ref=str(self.tx.id),
            reason="Not permitted",
            result_code="SP01002",
        )

        mock_pay_paybill.assert_not_called()
        self.tx.refresh_from_db()
        assert self.tx.status == Transaction.Status.FAILED
