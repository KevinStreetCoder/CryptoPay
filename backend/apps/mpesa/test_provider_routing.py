"""Tests for the per-method provider routing in apps.mpesa.provider.

The adapter resolves the provider name per-method (paybill / till / b2c /
stk) from PAYMENT_PROVIDER_{METHOD} env vars, falling back to the
legacy single-knob PAYMENT_PROVIDER. Production-routing as of beta
launch (2026-05-15):

    paybill : intasend  (B2B works without per-paybill pre-approval)
    till    : intasend  (same)
    B2C     : sasapay   (float lives on SasaPay merchant account)
    STK     : sasapay   (same)

These tests pin the routing matrix · if anyone re-points a method
without updating both the env config and the docstring, CI fails.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from django.test import TestCase, override_settings

from apps.mpesa.provider import PaymentProviderAdapter, _resolve_provider


class TestResolveProvider(TestCase):
    @override_settings(PAYMENT_PROVIDER="sasapay")
    def test_legacy_only_routes_every_method_to_legacy(self):
        for method in ("paybill", "till", "b2c", "stk"):
            assert _resolve_provider(method) == "sasapay"

    @override_settings(
        PAYMENT_PROVIDER="sasapay",
        PAYMENT_PROVIDER_PAYBILL="intasend",
        PAYMENT_PROVIDER_TILL="intasend",
    )
    def test_beta_routing_paybill_till_intasend_rest_sasapay(self):
        """Production routing as of 2026-05-15 beta launch."""
        assert _resolve_provider("paybill") == "intasend"
        assert _resolve_provider("till") == "intasend"
        assert _resolve_provider("b2c") == "sasapay"
        assert _resolve_provider("stk") == "sasapay"

    @override_settings(PAYMENT_PROVIDER="intasend")
    def test_all_intasend(self):
        for method in ("paybill", "till", "b2c", "stk"):
            assert _resolve_provider(method) == "intasend"

    @override_settings(
        PAYMENT_PROVIDER="daraja",
        PAYMENT_PROVIDER_PAYBILL="intasend",
        PAYMENT_PROVIDER_STK="sasapay",
    )
    def test_mixed_three_providers(self):
        assert _resolve_provider("paybill") == "intasend"
        assert _resolve_provider("till") == "daraja"
        assert _resolve_provider("b2c") == "daraja"
        assert _resolve_provider("stk") == "sasapay"

    @override_settings()
    def test_no_env_defaults_to_daraja(self):
        # Clearing the setting via override_settings(PAYMENT_PROVIDER="")
        # triggers the empty-string branch · should land on daraja.
        with override_settings(PAYMENT_PROVIDER=""):
            assert _resolve_provider("paybill") == "daraja"

    @override_settings(
        PAYMENT_PROVIDER="sasapay",
        PAYMENT_PROVIDER_PAYBILL="INTASEND",  # uppercase
    )
    def test_case_insensitive(self):
        assert _resolve_provider("paybill") == "intasend"


class TestPaymentProviderAdapter(TestCase):
    """Adapter-level integration · confirms the right backend is reached
    for each method without actually hitting the network."""

    @override_settings(
        PAYMENT_PROVIDER="sasapay",
        PAYMENT_PROVIDER_PAYBILL="intasend",
        PAYMENT_PROVIDER_TILL="intasend",
        SASAPAY_CLIENT_ID="x", SASAPAY_CLIENT_SECRET="y",
        SASAPAY_ENVIRONMENT="sandbox",
        INTASEND_API_SECRET="ISSecretKey_test_" + "x" * 64,
        INTASEND_ENVIRONMENT="sandbox",
    )
    def test_beta_routing_paybill_via_intasend_b2c_via_sasapay(self):
        adapter = PaymentProviderAdapter()
        assert adapter.routing_for("paybill") == "intasend"
        assert adapter.routing_for("till") == "intasend"
        assert adapter.routing_for("b2c") == "sasapay"
        assert adapter.routing_for("stk") == "sasapay"

        # Pin: legacy `provider_name` still returns the single-knob name,
        # so metrics labels don't change shape.
        assert adapter.provider_name == "sasapay"

    @override_settings(
        PAYMENT_PROVIDER="sasapay",
        PAYMENT_PROVIDER_PAYBILL="intasend",
        SASAPAY_CLIENT_ID="x", SASAPAY_CLIENT_SECRET="y",
        INTASEND_API_SECRET="ISSecretKey_" + "x" * 64,
    )
    def test_paybill_dispatches_to_intasend_client(self):
        """b2b_payment should call IntaSendClient.pay_paybill, not SasaPay."""
        from apps.mpesa.intasend_client import IntaSendClient

        adapter = PaymentProviderAdapter()
        with patch.object(
            IntaSendClient, "pay_paybill",
            return_value={
                "ConversationID": "is-conv-1",
                "ResponseCode": "0",
                "ResponseDescription": "OK",
            },
        ) as mock:
            out = adapter.b2b_payment(
                paybill="123456", account="ABC", amount=100, reference="ref-1",
            )
        mock.assert_called_once()
        assert out["ConversationID"] == "is-conv-1"
        assert out["ResponseCode"] == "0"

    @override_settings(
        PAYMENT_PROVIDER="sasapay",
        PAYMENT_PROVIDER_PAYBILL="intasend",
        PAYMENT_PROVIDER_TILL="intasend",
        SASAPAY_CLIENT_ID="x", SASAPAY_CLIENT_SECRET="y",
        SASAPAY_ENVIRONMENT="sandbox",
        INTASEND_API_SECRET="ISSecretKey_" + "x" * 64,
    )
    def test_till_dispatches_to_intasend_client(self):
        from apps.mpesa.intasend_client import IntaSendClient

        adapter = PaymentProviderAdapter()
        with patch.object(
            IntaSendClient, "pay_till",
            return_value={
                "ConversationID": "is-conv-2",
                "ResponseCode": "0",
            },
        ) as mock:
            adapter.buy_goods(till="654321", amount=100, reference="ref-2")
        mock.assert_called_once()

    @override_settings(
        PAYMENT_PROVIDER="sasapay",
        PAYMENT_PROVIDER_PAYBILL="intasend",
        SASAPAY_CLIENT_ID="x", SASAPAY_CLIENT_SECRET="y",
        SASAPAY_ENVIRONMENT="sandbox",
        INTASEND_API_SECRET="ISSecretKey_" + "x" * 64,
    )
    def test_b2c_still_routes_to_sasapay(self):
        """B2C must stay on SasaPay even when paybill is flipped to IntaSend."""
        from apps.mpesa.sasapay_client import SasaPayClient

        adapter = PaymentProviderAdapter()
        with patch.object(
            SasaPayClient, "send_to_mobile",
            return_value={"B2CRequestID": "sp-b2c-1", "ResponseCode": "0"},
        ) as mock:
            adapter.b2c_payment(
                phone="+254712345678", amount=100, transaction_id="tx-1",
            )
        mock.assert_called_once()

    @override_settings(
        PAYMENT_PROVIDER="sasapay",
        PAYMENT_PROVIDER_PAYBILL="intasend",
        SASAPAY_CLIENT_ID="x", SASAPAY_CLIENT_SECRET="y",
        SASAPAY_ENVIRONMENT="sandbox",
        INTASEND_API_SECRET="ISSecretKey_" + "x" * 64,
    )
    def test_stk_still_routes_to_sasapay(self):
        """STK Push (C2B deposit) stays on SasaPay regardless of paybill swap."""
        from apps.mpesa.sasapay_client import SasaPayClient

        adapter = PaymentProviderAdapter()
        with patch.object(
            SasaPayClient, "stk_push",
            return_value={
                "CheckoutRequestID": "sp-co-1",
                "MerchantRequestID": "sp-mr-1",
                "ResponseCode": "0",
            },
        ) as mock:
            adapter.stk_push(phone="+254712345678", amount=100)
        mock.assert_called_once()

    @override_settings(
        PAYMENT_PROVIDER="sasapay",
        PAYMENT_PROVIDER_PAYBILL="intasend",
        SASAPAY_CLIENT_ID="x", SASAPAY_CLIENT_SECRET="y",
        SASAPAY_ENVIRONMENT="sandbox",
        INTASEND_API_SECRET="ISSecretKey_" + "x" * 64,
    )
    def test_clients_are_cached_per_method_provider(self):
        """Same provider used for multiple methods → single client instance."""
        adapter = PaymentProviderAdapter()
        # paybill + till both → intasend → same client object
        c1 = adapter._client_for("paybill")
        c2 = adapter._client_for("till")
        assert c1 is c2, "expected cached IntaSendClient instance"
        # b2c + stk both → sasapay → same client object
        c3 = adapter._client_for("b2c")
        c4 = adapter._client_for("stk")
        assert c3 is c4, "expected cached SasaPayClient instance"
        # different providers → different instances
        assert c1 is not c3
