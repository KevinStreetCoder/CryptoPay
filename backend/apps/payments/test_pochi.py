"""Pochi la Biashara labelling tests · Cluster 2 of the 2026-04-25 work.

Pochi la Biashara is the same Daraja BusinessSendMoney rail; the only
difference is product surface: a friendlier UX entry point and a
"Business" label in the user's history. These tests pin:

  - SendMpesaSerializer accepts the optional `context=pochi` field
  - The created Transaction tags `saga_data['recipient_kind'] = 'pochi'`
  - Default (no context) leaves saga_data clean
  - TransactionSerializer surfaces `recipient_kind` to the API
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


def _make_user_with_wallet(phone="+254700030001", balance="500.00000000", kyc_tier=3):
    """Default kyc_tier=3 so the daily-limit gate (5k KES at tier 0)
    doesn't reject the test transaction."""
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


def _seed_quote(user, kes_amount="1000", crypto_amount="7.61", currency="USDT"):
    """Populate Redis with a locked quote that mirrors what RateService
    would mint, so the view's `get_locked_quote` / `consume_locked_quote`
    succeed without touching the rate feed."""
    from apps.rates.services import RateService  # ensure module is importable

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


def _b2b_mock_payload():
    return {
        "ConversationID": "conv-pochi-1",
        "OriginatorConversationID": "orig-pochi-1",
        "ResponseCode": "0",
    }


@patch("apps.payments.views._check_rate_slippage", return_value=None)
@patch("apps.mpesa.client.MpesaClient.b2c_payment", return_value=_b2b_mock_payload())
@patch("apps.mpesa.client.MpesaClient.b2b_payment", return_value=_b2b_mock_payload())
class TestPochiLabelling(TestCase):
    def test_send_money_with_pochi_context_labels_transaction(self, _b2b, _b2c, _slip):
        user = _make_user_with_wallet(phone="+254700030101")
        client = _authed(user)
        quote_id, _ = _seed_quote(user)

        resp = client.post(
            "/api/v1/payments/send-mpesa/",
            {
                "phone": "+254700111222",
                "amount_kes": "1000",
                "crypto_currency": "USDT",
                "pin": "123456",
                "idempotency_key": str(uuid4()),
                "quote_id": quote_id,
                "context": "pochi",
            },
            format="json",
        )
        # The saga may reach 201 (success) or 422 (mpesa downstream
        # failure). Either way, the Transaction was created with the
        # label · check the DB.
        from apps.payments.models import Transaction

        tx = Transaction.objects.filter(user=user).order_by("-created_at").first()
        assert tx is not None, f"No tx created · response was {resp.status_code} {resp.data}"
        assert tx.saga_data.get("recipient_kind") == "pochi"

    def test_send_money_default_context_no_label(self, _b2b, _b2c, _slip):
        user = _make_user_with_wallet(phone="+254700030102")
        client = _authed(user)
        quote_id, _ = _seed_quote(user)

        resp = client.post(
            "/api/v1/payments/send-mpesa/",
            {
                "phone": "+254700111222",
                "amount_kes": "1000",
                "crypto_currency": "USDT",
                "pin": "123456",
                "idempotency_key": str(uuid4()),
                "quote_id": quote_id,
                # NO context
            },
            format="json",
        )
        from apps.payments.models import Transaction

        tx = Transaction.objects.filter(user=user).order_by("-created_at").first()
        assert tx is not None
        # The serializer normalises absence to "personal" and our view
        # writes nothing into saga_data when the context is "personal".
        assert "recipient_kind" not in tx.saga_data

    def test_serializer_surfaces_recipient_kind(self, _b2b, _b2c, _slip):
        from apps.payments.models import Transaction
        from apps.payments.serializers import TransactionSerializer

        user = _make_user_with_wallet(phone="+254700030103")
        tx = Transaction.objects.create(
            idempotency_key=str(uuid4()),
            user=user,
            type=Transaction.Type.SEND_MPESA,
            source_currency="USDT",
            source_amount=Decimal("7.61"),
            dest_currency="KES",
            dest_amount=Decimal("1000"),
            exchange_rate=Decimal("131.40"),
            fee_amount=Decimal("10"),
            fee_currency="KES",
            mpesa_phone="+254700111222",
            saga_data={"recipient_kind": "pochi"},
        )
        data = TransactionSerializer(tx).data
        assert data["recipient_kind"] == "pochi"

    def test_serializer_returns_blank_for_unlabelled_tx(self, _b2b, _b2c, _slip):
        from apps.payments.models import Transaction
        from apps.payments.serializers import TransactionSerializer

        user = _make_user_with_wallet(phone="+254700030104")
        tx = Transaction.objects.create(
            idempotency_key=str(uuid4()),
            user=user,
            type=Transaction.Type.SEND_MPESA,
            source_currency="USDT",
            source_amount=Decimal("7.61"),
            dest_currency="KES",
            dest_amount=Decimal("1000"),
            exchange_rate=Decimal("131.40"),
            fee_amount=Decimal("10"),
            fee_currency="KES",
            mpesa_phone="+254700111222",
        )
        data = TransactionSerializer(tx).data
        assert data["recipient_kind"] == ""
