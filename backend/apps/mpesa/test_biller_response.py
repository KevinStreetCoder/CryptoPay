"""Tests for the biller-response capture path in `_process_successful_payment`.

Covers four real-world callback shapes we see in production:

  1. KPLC prepaid · ResultDesc carries the literal token SMS verbatim.
  2. Generic SasaPay success · ResultDesc says "Transaction processed
     successfully" · we synthesise a Cpay-formatted receipt line so
     the user always gets useful text.
  3. Daraja-shape nested ResultParameters[] · we extract token / units
     / receipt keys.
  4. B2C send-money · we capture (so receipts have it) but DO NOT
     forward an SMS to the sender (the recipient already got their
     M-Pesa SMS direct from Safaricom).

These tests assert real production behaviour · DO NOT relax to make
the suite pass.
"""
from __future__ import annotations

from decimal import Decimal
from unittest import mock

import pytest
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import User
from apps.mpesa.sasapay_views import _process_successful_payment
from apps.payments.models import Transaction


@pytest.mark.django_db
class BillerResponseCaptureTests(TestCase):
    """Verify the biller_response capture + SMS-relay logic per rail."""

    def setUp(self):
        self.user = User.objects.create_user(
            phone="+254712345678",
            email="kplc-tester@example.com",
        )

    def _make_tx(self, **kwargs):
        defaults = dict(
            user=self.user,
            type=Transaction.Type.PAYBILL_PAYMENT,
            source_currency="USDT",
            source_amount=Decimal("0.79"),
            dest_currency="KES",
            dest_amount=Decimal("100.00"),
            mpesa_paybill="888880",
            mpesa_account="37123456789",
            status=Transaction.Status.PROCESSING,
            idempotency_key=f"key-{timezone.now().timestamp()}",
        )
        defaults.update(kwargs)
        return Transaction.objects.create(**defaults)

    @mock.patch("apps.mpesa.sasapay_views._verify_via_status_api", return_value=True)
    @mock.patch("apps.core.email.send_sms")
    def test_kplc_prepaid_token_captured_verbatim(self, send_sms_mock, _):
        """KPLC ResultDesc carries the prepaid token · we keep it as-is."""
        tx = self._make_tx()
        token_text = (
            "Confirmed. KSH 100.00 sent to KPLC PREPAID for account "
            "37123456789. Token: 1234 5678 9012 3456 7890. Units: 5.20 KWh."
        )
        callback = {
            "ResultCode": "0",
            "ResultDesc": token_text,
            "MerchantTransactionReference": str(tx.id),
            "SasaPayTransactionCode": "SWEJ7RDEBTHT0XY",
            "ThirdPartyTransactionCode": "UE9C03JV6G",
            "RecipientName": "KPLC PREPAID",
            "TransactionAmount": "100.00",
        }
        _process_successful_payment(
            callback, str(tx.id), "SWEJ7RDEBTHT0XY", "100.00",
        )

        tx.refresh_from_db()
        assert tx.status == Transaction.Status.COMPLETED
        assert "Token:" in tx.biller_response
        assert "1234 5678 9012 3456 7890" in tx.biller_response
        assert "5.20 KWh" in tx.biller_response

        # SMS should have been forwarded to the user's phone with the
        # token preserved in the body.
        assert send_sms_mock.called
        called_phone, called_body = send_sms_mock.call_args[0][:2]
        assert called_phone == self.user.phone
        assert "1234 5678 9012 3456 7890" in called_body

    @mock.patch("apps.mpesa.sasapay_views._verify_via_status_api", return_value=True)
    @mock.patch("apps.core.email.send_sms")
    def test_generic_success_synthesises_receipt(self, send_sms_mock, _):
        """When ResultDesc is the generic placeholder, we build our own
        useful summary from the flat callback fields · so postpaid bills
        / DSTV / Buy-Goods all produce a readable confirmation."""
        tx = self._make_tx(
            mpesa_paybill="",
            mpesa_account="",
            mpesa_till="5500000",
            type=Transaction.Type.TILL_PAYMENT,
            merchant_name="NAIVAS LIMITED",
        )
        callback = {
            "ResultCode": "0",
            "ResultDesc": "Transaction processed successfully",
            "MerchantTransactionReference": str(tx.id),
            "SasaPayTransactionCode": "SWXX",
            "ThirdPartyTransactionCode": "UE9C03JV6G",
            "RecipientName": "NAIVAS LIMITED",
            "TransactionAmount": "100.00",
        }
        _process_successful_payment(callback, str(tx.id), "SWXX", "100.00")

        tx.refresh_from_db()
        assert tx.biller_response, "expected a synthesised receipt line"
        assert "100.00" in tx.biller_response
        assert "NAIVAS LIMITED" in tx.biller_response
        assert "Till 5500000" in tx.biller_response
        assert "UE9C03JV6G" in tx.biller_response  # M-Pesa receipt code surfaced

        # Till rail must still send the SMS · the user needs proof on phone.
        assert send_sms_mock.called

    @mock.patch("apps.mpesa.sasapay_views._verify_via_status_api", return_value=True)
    @mock.patch("apps.core.email.send_sms")
    def test_nested_result_parameters_extracted(self, send_sms_mock, _):
        """Daraja-shape nested ResultParameter[] · pull token / units."""
        tx = self._make_tx()
        callback = {
            "ResultCode": "0",
            "ResultDesc": "Transaction processed successfully",  # generic
            "MerchantTransactionReference": str(tx.id),
            "SasaPayTransactionCode": "SWXX",
            "ThirdPartyTransactionCode": "UE9C03JV6G",
            "RecipientName": "KPLC PREPAID",
            "TransactionAmount": "100.00",
            "ResultParameters": {
                "ResultParameter": [
                    {"Key": "TokenAmount", "Value": "5.20"},
                    {"Key": "TokenSerialNumber", "Value": "1234567890"},
                    {"Key": "ReceiptNumber", "Value": "RKPLC123"},
                ],
            },
        }
        _process_successful_payment(callback, str(tx.id), "SWXX", "100.00")

        tx.refresh_from_db()
        # Should have pulled the token-related keys.
        assert "TokenAmount: 5.20" in tx.biller_response
        assert "TokenSerialNumber: 1234567890" in tx.biller_response
        assert "ReceiptNumber: RKPLC123" in tx.biller_response

    @mock.patch("apps.mpesa.sasapay_views._verify_via_status_api", return_value=True)
    @mock.patch("apps.core.email.send_sms")
    def test_b2c_does_not_relay_sms_to_sender(self, send_sms_mock, _):
        """B2C send-money · the recipient gets M-Pesa SMS direct from
        Safaricom. We MUST NOT spam the sender with a relay too · they
        already see the in-app receipt + email."""
        tx = self._make_tx(
            mpesa_paybill="",
            mpesa_account="",
            mpesa_phone="254701961618",
            type=Transaction.Type.SEND_MPESA,
        )
        callback = {
            "ResultCode": "0",
            "ResultDesc": "Transaction processed successfully",
            "MerchantTransactionReference": str(tx.id),
            "SasaPayTransactionCode": "SWXX",
            "ThirdPartyTransactionCode": "UE9C03JV6G",
            "RecipientName": "Kevin Kareithi",
            "TransactionAmount": "100.00",
        }
        _process_successful_payment(callback, str(tx.id), "SWXX", "100.00")

        tx.refresh_from_db()
        # biller_response IS captured (so receipt + detail screen show
        # the synthesised confirmation), but no SMS to the sender.
        assert tx.biller_response  # captured for receipt
        assert not send_sms_mock.called  # no relay to sender

    @mock.patch("apps.mpesa.sasapay_views._verify_via_status_api", return_value=True)
    @mock.patch("apps.core.email.send_sms")
    def test_token_text_prefixed_with_generic_phrase_is_kept(self, send_sms_mock, _):
        """Some billers send 'Transaction processed successfully. Token: ...'
        — the substring "transaction processed successfully" must NOT
        cause us to discard the trailing token. Bug fixed 2026-05-09."""
        tx = self._make_tx()
        callback = {
            "ResultCode": "0",
            "ResultDesc": (
                "Transaction processed successfully. "
                "Token: 9999 8888 7777 6666 5555. Units: 12.40 KWh."
            ),
            "MerchantTransactionReference": str(tx.id),
            "SasaPayTransactionCode": "SWXX",
            "ThirdPartyTransactionCode": "UE9C03JV6G",
            "RecipientName": "KPLC PREPAID",
            "TransactionAmount": "200.00",
        }
        _process_successful_payment(callback, str(tx.id), "SWXX", "200.00")

        tx.refresh_from_db()
        assert "9999 8888 7777 6666 5555" in tx.biller_response
        assert "12.40 KWh" in tx.biller_response

    @mock.patch("apps.mpesa.sasapay_views._verify_via_status_api", return_value=True)
    @mock.patch("apps.core.email.send_sms")
    def test_id_lookup_strategy_finds_tx(self, send_sms_mock, _):
        """Strategy 1b · callback's MerchantTransactionReference equals
        the tx PK (our saga sends `reference=str(tx.id)`). The lookup
        must succeed and fire the merchant_name + biller_response writes."""
        tx = self._make_tx(merchant_name="")  # empty name to verify it gets set
        callback = {
            "ResultCode": "0",
            "ResultDesc": "Transaction processed successfully",
            "MerchantTransactionReference": str(tx.id),
            "SasaPayTransactionCode": "SWXX",
            "ThirdPartyTransactionCode": "UE9C03JV6G",
            "RecipientName": "KPLC PREPAID",
            "TransactionAmount": "100.00",
        }
        _process_successful_payment(callback, str(tx.id), "SWXX", "100.00")

        tx.refresh_from_db()
        assert tx.merchant_name == "KPLC PREPAID"
        assert tx.status == Transaction.Status.COMPLETED
