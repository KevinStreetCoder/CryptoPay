"""SasaPay C2B deposit · production-grade test coverage · 2026-05-08.

The SasaPay paybill (756756) + merchant-code-prefixed account format
(`1334777-<CRYPTO>-<phone>`) is the primary deposit rail going to
public beta. Two paths through the IPN handler:

  Auto-buy path · account encodes a supported crypto · we credit
  crypto wallet at the live KES→crypto rate (with the same fee +
  excise structure as the BUY flow). Default for app-driven deposits.

  KES-credit fallback · account is just the merchant code or the
  encoded crypto is unsupported · we credit KES wallet as before.

Tests cover:
  - Account parser · all 6 documented formats (3 valid, 3 fallback)
  - Phone normaliser · 4 Kenyan formats + invalid input
  - Auto-buy success · crypto credited, COMPLETED Transaction created
  - Auto-buy idempotency · replay of same TransID is a no-op
  - KES fallback when account is bare merchant code
  - KES fallback when crypto is unsupported
  - Amount-after-fees · platform fee + excise duty applied correctly
  - Account-encoded phone overrides MSISDN (parent-pays-for-child)
  - C2BInstructionsView returns SasaPay format under PAYMENT_PROVIDER=sasapay
  - C2BInstructionsView returns Daraja format under PAYMENT_PROVIDER=daraja
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.mpesa.sasapay_views import (
    _normalise_phone_e164,
    _parse_c2b_account,
    _process_c2b_deposit,
)
from apps.payments.models import Transaction
from apps.wallets.models import Wallet


pytestmark = pytest.mark.django_db


_RATE_INFO_USDT = {
    "final_rate": "130.00",  # 1 USDT = 130 KES
    "flat_fee_kes": "10",
    "rate_freshness": "live",
}


def _make_user(phone="+254712345678", pin="123456"):
    return User.objects.create_user(phone=phone, pin=pin)


# ── Phone normalisation ───────────────────────────────────────────


class TestNormalisePhone(TestCase):
    def test_local_zero_prefix(self):
        assert _normalise_phone_e164("0712345678") == "+254712345678"

    def test_country_code_no_plus(self):
        assert _normalise_phone_e164("254712345678") == "+254712345678"

    def test_e164_passthrough(self):
        assert _normalise_phone_e164("+254712345678") == "+254712345678"

    def test_short_form(self):
        assert _normalise_phone_e164("712345678") == "+254712345678"

    def test_safaricom_01_prefix(self):
        assert _normalise_phone_e164("0112345678") == "+254112345678"

    def test_garbage_returns_empty(self):
        # Unlike the IntaSend client, the SasaPay IPN can't raise · the
        # webhook caller has no way to recover. We return empty so the
        # caller knows to fall back to MSISDN.
        assert _normalise_phone_e164("not-a-phone") == ""
        assert _normalise_phone_e164("") == ""


# ── Account parser ─────────────────────────────────────────────────


@override_settings(SASAPAY_MERCHANT_CODE="1334777")
class TestAccountParser(TestCase):
    def test_full_format_with_dash(self):
        currency, phone = _parse_c2b_account("1334777-USDT-254712345678")
        assert currency == "USDT"
        assert phone == "+254712345678"

    def test_full_format_with_asterisk(self):
        currency, phone = _parse_c2b_account("1334777*USDT*254712345678")
        assert currency == "USDT"
        assert phone == "+254712345678"

    def test_legacy_no_merchant_prefix(self):
        currency, phone = _parse_c2b_account("USDT-254712345678")
        assert currency == "USDT"
        assert phone == "+254712345678"

    def test_currency_alone_without_phone(self):
        # Currency present, no phone · caller falls back to MSISDN.
        currency, phone = _parse_c2b_account("1334777-USDT")
        assert currency == "USDT"
        assert phone is None

    def test_merchant_code_alone(self):
        currency, phone = _parse_c2b_account("1334777")
        assert currency is None
        assert phone is None

    def test_unsupported_crypto_returns_none(self):
        currency, phone = _parse_c2b_account("1334777-DOGE-254712345678")
        assert currency is None
        assert phone is None

    def test_empty_account(self):
        assert _parse_c2b_account("") == (None, None)
        assert _parse_c2b_account(None) == (None, None)

    def test_lowercase_crypto_normalised(self):
        currency, _ = _parse_c2b_account("1334777-usdt-254712345678")
        assert currency == "USDT"


# ── Auto-buy success path ──────────────────────────────────────────


@override_settings(
    SASAPAY_MERCHANT_CODE="1334777",
    PLATFORM_SPREAD_PERCENT=1.5,
    EXCISE_DUTY_PERCENT=10,
)
class TestC2BAutoBuy(TestCase):
    def setUp(self):
        self.user = _make_user("+254712345678")

    def _payload(self, account, amount="1000", trans_id="TX001"):
        return {
            "TransactionType": "C2B",
            "TransID": trans_id,
            "TransAmount": amount,
            "MSISDN": "254712345678",
            "FullName": "Test User",
            "BillRefNumber": account,
        }

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_credits_crypto_wallet_on_success(self, mock_rate):
        mock_rate.return_value = _RATE_INFO_USDT
        _process_c2b_deposit(self._payload("1334777-USDT-254712345678", "1000"))

        # USDT wallet credited
        wallet = Wallet.objects.filter(user=self.user, currency="USDT").first()
        assert wallet is not None
        assert wallet.balance > Decimal("0")

        # COMPLETED type=BUY Transaction
        tx = Transaction.objects.filter(user=self.user, mpesa_receipt="TX001").first()
        assert tx is not None
        assert tx.type == Transaction.Type.BUY
        assert tx.status == Transaction.Status.COMPLETED
        assert tx.source_currency == "KES"
        assert tx.dest_currency == "USDT"
        assert tx.source_amount == Decimal("1000")
        assert tx.exchange_rate == Decimal("130.00")
        assert tx.fee_currency == "KES"

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_fee_and_excise_applied(self, mock_rate):
        mock_rate.return_value = _RATE_INFO_USDT
        _process_c2b_deposit(self._payload("1334777-USDT-254712345678", "1000"))

        tx = Transaction.objects.filter(user=self.user, mpesa_receipt="TX001").first()
        # 1.5% spread on 1000 = 15 KES, plus flat 10 KES = 25 KES platform fee
        assert tx.fee_amount == Decimal("25.00")
        # 10% excise on 25 = 2.50
        assert tx.excise_duty_amount == Decimal("2.50")
        # Net for crypto = 1000 - 10 - 2.50 = 987.50 (spread baked into rate)
        # 987.50 / 130.00 = 7.59615384...
        assert Decimal("7.5") < tx.dest_amount < Decimal("7.7")

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_replay_of_same_transid_is_noop(self, mock_rate):
        mock_rate.return_value = _RATE_INFO_USDT

        _process_c2b_deposit(self._payload("1334777-USDT-254712345678", "1000"))
        before = Transaction.objects.filter(user=self.user).count()

        # Replay
        _process_c2b_deposit(self._payload("1334777-USDT-254712345678", "1000"))
        after = Transaction.objects.filter(user=self.user).count()
        assert before == after  # idempotent

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_account_phone_overrides_msisdn(self, mock_rate):
        # Parent (MSISDN 254700070000) deposits for a child (account
        # 254712345678 → self.user). Auto-buy must credit the child.
        mock_rate.return_value = _RATE_INFO_USDT
        payload = {
            "TransactionType": "C2B",
            "TransID": "TX002",
            "TransAmount": "500",
            "MSISDN": "254700070000",  # parent's phone
            "FullName": "Parent User",
            "BillRefNumber": "1334777-USDT-254712345678",  # child's phone
        }
        _process_c2b_deposit(payload)

        # The child got the crypto, not the parent (parent isn't even a user)
        tx = Transaction.objects.filter(mpesa_receipt="TX002").first()
        assert tx is not None
        assert tx.user_id == self.user.id


# ── Fallback paths ────────────────────────────────────────────────


@override_settings(SASAPAY_MERCHANT_CODE="1334777")
class TestC2BKesFallback(TestCase):
    def setUp(self):
        self.user = _make_user("+254712345678")

    def _payload(self, account, amount="500", trans_id="TX_KES_001"):
        return {
            "TransactionType": "C2B",
            "TransID": trans_id,
            "TransAmount": amount,
            "MSISDN": "254712345678",
            "FullName": "Test User",
            "BillRefNumber": account,
        }

    def test_bare_merchant_code_credits_kes_wallet(self):
        _process_c2b_deposit(self._payload("1334777", "500"))

        wallet = Wallet.objects.filter(user=self.user, currency="KES").first()
        assert wallet is not None
        assert wallet.balance == Decimal("500")

        tx = Transaction.objects.filter(
            user=self.user, mpesa_receipt="TX_KES_001",
        ).first()
        assert tx is not None
        assert tx.type == Transaction.Type.DEPOSIT
        assert tx.status == Transaction.Status.COMPLETED
        assert tx.source_currency == "KES"
        assert tx.dest_currency == "KES"

    def test_unsupported_crypto_falls_back_to_kes(self):
        _process_c2b_deposit(self._payload("1334777-XRP-254712345678", "500"))

        # No XRP wallet should exist · we don't support it
        assert not Wallet.objects.filter(user=self.user, currency="XRP").exists()

        # KES wallet credited instead
        wallet = Wallet.objects.filter(user=self.user, currency="KES").first()
        assert wallet is not None
        assert wallet.balance == Decimal("500")

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_rate_engine_failure_falls_back_to_kes(self, mock_rate):
        # Rate engine crashed mid-flight. The deposit must NOT be lost ·
        # we credit KES so the user can retry the conversion later.
        mock_rate.side_effect = Exception("rate engine unreachable")
        _process_c2b_deposit(
            self._payload("1334777-USDT-254712345678", "500", "TX_KES_002"),
        )

        # KES wallet credited (USDT auto-buy failed gracefully)
        kes_wallet = Wallet.objects.filter(user=self.user, currency="KES").first()
        assert kes_wallet is not None
        assert kes_wallet.balance == Decimal("500")

    def test_unknown_user_dropped(self):
        # MSISDN doesn't match any user, account doesn't have a phone we
        # can resolve · the IPN MUST drop silently rather than 500.
        payload = {
            "TransactionType": "C2B",
            "TransID": "TX_UNKNOWN",
            "TransAmount": "100",
            "MSISDN": "254799999999",  # no user
            "BillRefNumber": "1334777",
        }
        _process_c2b_deposit(payload)

        # No transaction created
        assert not Transaction.objects.filter(mpesa_receipt="TX_UNKNOWN").exists()


# ── C2BInstructionsView ───────────────────────────────────────────


class TestC2BInstructionsView(TestCase):
    def setUp(self):
        self.user = _make_user("+254712345678")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(
        PAYMENT_PROVIDER="sasapay",
        SASAPAY_C2B_PAYBILL="756756",
        SASAPAY_MERCHANT_CODE="1334777",
    )
    def test_sasapay_provider_returns_aggregator_paybill(self):
        resp = self.client.get(reverse("payments:c2b-instructions"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["paybill"] == "756756"
        assert data["provider"] == "sasapay"
        assert data["provider_label"] == "SasaPay"
        assert data["merchant_account"] == "1334777"
        # Account format embeds merchant + crypto + phone
        usdt = next(f for f in data["account_formats"] if f["currency"] == "USDT")
        assert usdt["account_number"] == "1334777-USDT-254712345678"

    @override_settings(PAYMENT_PROVIDER="daraja", MPESA_SHORTCODE="174379")
    def test_daraja_provider_returns_legacy_format(self):
        resp = self.client.get(reverse("payments:c2b-instructions"))
        data = resp.json()
        assert data["paybill"] == "174379"
        assert data["provider"] == "daraja"
        assert data["merchant_account"] == ""
        usdt = next(f for f in data["account_formats"] if f["currency"] == "USDT")
        assert usdt["account_number"] == "USDT-254712345678"

    @override_settings(PAYMENT_PROVIDER="sasapay")
    def test_unauthenticated_blocked(self):
        client = APIClient()  # no auth
        resp = client.get(reverse("payments:c2b-instructions"))
        assert resp.status_code in (401, 403)
