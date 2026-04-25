"""Send-to-Bank tests · Cluster 3 of the 2026-04-25 work.

Verifies:

  - The bank registry validates against a simple integrity check
  - GET /payments/banks/ returns the registry
  - GET /payments/banks/ requires authentication
  - POST /payments/send-to-bank/ routes through the existing PayBill
    rail with the right paybill substituted
  - Unknown bank slugs are rejected with 400
  - Account numbers must be digits-only
  - Amounts above the email-verification threshold are blocked when
    the user's email isn't verified
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient


pytestmark = pytest.mark.django_db


def _make_user_with_wallet(phone="+254700040001", balance="1000.00000000", kyc_tier=3):
    """Default kyc_tier=3 so the daily-limit gate (5k KES at tier 0)
    doesn't fire on the high-amount tests. Lower-tier coverage lives
    in the dedicated daily-limit tests."""
    from apps.accounts.models import User
    from apps.wallets.models import Wallet

    user = User.objects.create_user(phone=phone, pin="123456")
    user.kyc_tier = kyc_tier
    user.save(update_fields=["kyc_tier"])
    Wallet.objects.create(
        user=user,
        currency="USDT",
        balance=Decimal(balance),
    )
    return user


def _seed_quote(user, kes_amount="2500", crypto_amount="19.02", currency="USDT"):
    quote_id = str(uuid4())
    quote = {
        "quote_id": quote_id,
        "currency": currency,
        "exchange_rate": "131.40",
        "fee_kes": "10.00",
        "platform_fee_kes": "10.00",
        "flat_fee_kes": "10.00",
        "spread_revenue_kes": "0.00",
        "excise_duty_kes": "0.00",
        "crypto_amount": crypto_amount,
        "kes_amount": kes_amount,
        "total_kes": kes_amount,
        "user_id": str(user.id),
    }
    cache.set(f"quote:{quote_id}", quote, timeout=300)
    return quote_id, quote


def _authed(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# ------------------------------------------------------------------
# Registry · static integrity
# ------------------------------------------------------------------
class TestBankRegistry(TestCase):
    def test_get_bank_returns_known_slug(self):
        from apps.payments.banks import get_bank
        equity = get_bank("equity")
        assert equity is not None
        assert equity["paybill"] == "247247"
        assert equity["name"] == "Equity Bank"

    def test_get_bank_unknown_returns_none(self):
        from apps.payments.banks import get_bank
        assert get_bank("nonexistent") is None
        assert get_bank("") is None

    def test_get_bank_is_case_insensitive(self):
        from apps.payments.banks import get_bank
        assert get_bank("Equity") is not None
        assert get_bank("KCB") is not None

    def test_list_banks_alphabetical(self):
        from apps.payments.banks import list_banks
        banks = list_banks()
        names = [b["name"] for b in banks]
        assert names == sorted(names, key=lambda n: n.lower())

    def test_list_banks_returns_15(self):
        # The research doc commits to 15 entries · pin that count so
        # we don't accidentally drop one in a refactor.
        from apps.payments.banks import list_banks
        banks = list_banks()
        assert len(banks) == 15

    def test_every_paybill_is_six_digits(self):
        from apps.payments.banks import list_banks
        for bank in list_banks():
            assert bank["paybill"].isdigit(), bank
            assert len(bank["paybill"]) == 6, bank


# ------------------------------------------------------------------
# /payments/banks/
# ------------------------------------------------------------------
class TestBankListEndpoint(TestCase):
    def test_unauthenticated_returns_401(self):
        client = APIClient()
        resp = client.get("/api/v1/payments/banks/")
        assert resp.status_code == 401

    def test_authenticated_returns_15_banks(self):
        user = _make_user_with_wallet(phone="+254700040201")
        client = _authed(user)
        resp = client.get("/api/v1/payments/banks/")
        assert resp.status_code == 200, resp.data
        body = resp.data
        assert "banks" in body
        assert len(body["banks"]) == 15
        # Every entry has the expected shape.
        for bank in body["banks"]:
            assert {"slug", "name", "paybill", "logo_url", "account_format_hint"} <= set(bank.keys())


# ------------------------------------------------------------------
# /payments/send-to-bank/
# ------------------------------------------------------------------
def _b2b_mock_payload():
    return {
        "ConversationID": "conv-bank-1",
        "OriginatorConversationID": "orig-bank-1",
        "ResponseCode": "0",
    }


@patch("apps.payments.views._check_rate_slippage", return_value=None)
@patch("apps.mpesa.client.MpesaClient.b2b_payment", return_value=_b2b_mock_payload())
class TestSendToBank(TestCase):
    def test_routes_through_paybill_with_correct_paybill(self, mock_b2b, _slip):
        from apps.payments.models import Transaction

        user = _make_user_with_wallet(phone="+254700040301")
        client = _authed(user)
        quote_id, _ = _seed_quote(user)

        resp = client.post(
            "/api/v1/payments/send-to-bank/",
            {
                "quote_id": quote_id,
                "bank_slug": "equity",
                "account_number": "1234567890123",
                "pin": "123456",
                "idempotency_key": str(uuid4()),
            },
            format="json",
        )
        # Either 201 (saga ran) or 422 (downstream M-Pesa failure) ·
        # in both cases the Transaction was created with the bank's
        # paybill in `mpesa_paybill`.
        tx = Transaction.objects.filter(user=user).order_by("-created_at").first()
        assert tx is not None, f"No tx created: {resp.status_code} {resp.data}"
        assert tx.mpesa_paybill == "247247"
        assert tx.mpesa_account == "1234567890123"
        assert tx.saga_data.get("recipient_kind") == "bank"
        assert tx.saga_data.get("bank", {}).get("slug") == "equity"

    def test_unknown_bank_returns_400(self, _mock_b2b, _slip):
        user = _make_user_with_wallet(phone="+254700040302")
        client = _authed(user)
        quote_id, _ = _seed_quote(user)

        resp = client.post(
            "/api/v1/payments/send-to-bank/",
            {
                "quote_id": quote_id,
                "bank_slug": "atlantis",
                "account_number": "1234567890",
                "pin": "123456",
                "idempotency_key": str(uuid4()),
            },
            format="json",
        )
        assert resp.status_code == 400, resp.data

    def test_invalid_account_number_returns_400(self, _mock_b2b, _slip):
        user = _make_user_with_wallet(phone="+254700040303")
        client = _authed(user)
        quote_id, _ = _seed_quote(user)

        resp = client.post(
            "/api/v1/payments/send-to-bank/",
            {
                "quote_id": quote_id,
                "bank_slug": "kcb",
                "account_number": "abc-with-letters",
                "pin": "123456",
                "idempotency_key": str(uuid4()),
            },
            format="json",
        )
        assert resp.status_code == 400, resp.data
        assert "account_number" in resp.data

    def test_too_short_account_number_returns_400(self, _mock_b2b, _slip):
        user = _make_user_with_wallet(phone="+254700040304")
        client = _authed(user)
        quote_id, _ = _seed_quote(user)

        resp = client.post(
            "/api/v1/payments/send-to-bank/",
            {
                "quote_id": quote_id,
                "bank_slug": "kcb",
                "account_number": "1",
                "pin": "123456",
                "idempotency_key": str(uuid4()),
            },
            format="json",
        )
        assert resp.status_code == 400, resp.data

    def test_email_required_for_amounts_over_threshold(self, _mock_b2b, _slip):
        from apps.payments.models import Transaction

        user = _make_user_with_wallet(phone="+254700040305")
        # Default is email_verified=False
        assert user.email_verified is False
        client = _authed(user)
        # 75 000 KES > 50 000 threshold.
        quote_id, _ = _seed_quote(user, kes_amount="75000", crypto_amount="570.78")

        resp = client.post(
            "/api/v1/payments/send-to-bank/",
            {
                "quote_id": quote_id,
                "bank_slug": "kcb",
                "account_number": "1234567890",
                "pin": "123456",
                "idempotency_key": str(uuid4()),
            },
            format="json",
        )
        assert resp.status_code == 403, resp.data
        assert resp.data.get("error_code") == "email_verification_required"

        # And no Transaction was created · the gate fired before tx.create.
        assert not Transaction.objects.filter(user=user).exists()

    def test_email_gate_passes_when_verified(self, _mock_b2b, _slip):
        from apps.payments.models import Transaction

        user = _make_user_with_wallet(phone="+254700040306")
        user.email = "real@example.com"
        user.email_verified = True
        user.save(update_fields=["email", "email_verified"])
        client = _authed(user)
        quote_id, _ = _seed_quote(user, kes_amount="75000", crypto_amount="570.78")

        resp = client.post(
            "/api/v1/payments/send-to-bank/",
            {
                "quote_id": quote_id,
                "bank_slug": "kcb",
                "account_number": "1234567890",
                "pin": "123456",
                "idempotency_key": str(uuid4()),
            },
            format="json",
        )
        # Either 201 success or 422 saga / m-pesa failure · the email
        # gate didn't block.
        assert resp.status_code in (201, 422), resp.data
        assert Transaction.objects.filter(user=user).exists()

    def test_low_amount_does_not_require_email(self, _mock_b2b, _slip):
        from apps.payments.models import Transaction

        user = _make_user_with_wallet(phone="+254700040307")
        assert user.email_verified is False
        client = _authed(user)
        quote_id, _ = _seed_quote(user, kes_amount="2500", crypto_amount="19.02")

        resp = client.post(
            "/api/v1/payments/send-to-bank/",
            {
                "quote_id": quote_id,
                "bank_slug": "kcb",
                "account_number": "1234567890",
                "pin": "123456",
                "idempotency_key": str(uuid4()),
            },
            format="json",
        )
        # 201 / 422 are both fine · we just want to confirm the email
        # gate didn't fire (which would have been 403).
        assert resp.status_code != 403, resp.data
        assert Transaction.objects.filter(user=user).exists()
