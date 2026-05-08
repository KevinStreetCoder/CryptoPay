"""DepositIntent · short-code-keyed deposit reservation · 2026-05-08.

Built to sidestep an open question in SasaPay's docs: whether the
customer-entered Account Number for an aggregator paybill is
forwarded verbatim in `BillRefNumber` or parsed by SasaPay first.
The example value `PR52` in their docs strongly suggests SasaPay
generates its own short ref · we cannot rely on the long
`1334777-USDT-254712345678` format reaching our IPN intact.

These tests cover:
  - Code generation · 6-char Crockford-base32, no I/O/L/U
  - TTL · expired intents are not active
  - Currency validation · only USDT/USDC/BTC/ETH/SOL/KES accepted
  - Lookup · OPEN+active matches; consumed/expired/cancelled don't
  - Self-healing · OPEN-but-past-TTL intent gets marked EXPIRED on read
  - Consume · marks CONSUMED, links transaction, idempotent on same tx
  - Consume re-use · refuses to re-consume an intent for a different tx
  - Sweep · daily cron marks OPEN-past-TTL as EXPIRED
  - C2BInstructionsView ?currency=USDT mints an intent
  - POST /deposit/intent/ creates an intent (sasapay only)
  - SasaPay IPN · intent code in BillRefNumber routes to intent's user
  - SasaPay IPN · long-format still works as fallback when no intent
  - SasaPay IPN · expired intent falls through to legacy parser
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.payments import deposit_intent as intent_service
from apps.payments.models import DepositIntent, Transaction
from apps.payments.deposit_intent import _CROCKFORD


pytestmark = pytest.mark.django_db


_RATE_INFO_USDT = {
    "final_rate": "130.00",
    "flat_fee_kes": "10",
    "rate_freshness": "live",
}


def _make_user(phone="+254712345678"):
    return User.objects.create_user(phone=phone, pin="123456")


# ── Code generation + Crockford alphabet ─────────────────────────────


class TestCodeGeneration(TestCase):
    def test_code_is_six_chars_crockford(self):
        u = _make_user()
        intent = intent_service.create_intent(u, "USDT")
        assert len(intent.code) == 6
        # Every char must be in the Crockford alphabet (no I/O/L/U).
        for ch in intent.code:
            assert ch in _CROCKFORD, f"non-Crockford char {ch!r} in {intent.code}"
        # Specifically reject the ambiguous chars · they should never
        # appear because they're not in _CROCKFORD.
        for forbidden in ("I", "L", "O", "U"):
            assert forbidden not in intent.code

    def test_codes_are_unique_across_many_intents(self):
        u = _make_user()
        codes = {
            intent_service.create_intent(u, "USDT").code
            for _ in range(50)
        }
        assert len(codes) == 50  # zero collisions in 50 mints


# ── Currency validation ──────────────────────────────────────────────


class TestCurrencyValidation(TestCase):
    def test_supported_currencies_pass(self):
        u = _make_user()
        for c in ("USDT", "USDC", "BTC", "ETH", "SOL", "KES"):
            i = intent_service.create_intent(u, c)
            assert i.currency == c

    def test_lowercase_normalised(self):
        u = _make_user()
        i = intent_service.create_intent(u, "usdt")
        assert i.currency == "USDT"

    def test_unsupported_rejected(self):
        u = _make_user()
        with self.assertRaises(ValueError):
            intent_service.create_intent(u, "DOGE")
        with self.assertRaises(ValueError):
            intent_service.create_intent(u, "")


# ── TTL + active flag ────────────────────────────────────────────────


class TestActiveAndExpiry(TestCase):
    def test_fresh_intent_is_active(self):
        u = _make_user()
        i = intent_service.create_intent(u, "USDT")
        assert i.is_active

    def test_expired_intent_not_active(self):
        u = _make_user()
        i = intent_service.create_intent(u, "USDT")
        i.expires_at = timezone.now() - timedelta(seconds=1)
        i.save(update_fields=["expires_at"])
        assert not i.is_active

    def test_consumed_intent_not_active(self):
        u = _make_user()
        i = intent_service.create_intent(u, "USDT")
        i.status = DepositIntent.Status.CONSUMED
        i.save(update_fields=["status"])
        assert not i.is_active


# ── Lookup ────────────────────────────────────────────────────────────


class TestLookup(TestCase):
    def test_active_intent_returned(self):
        u = _make_user()
        i = intent_service.create_intent(u, "USDT")
        found = intent_service.lookup_active(i.code)
        assert found is not None
        assert found.id == i.id

    def test_lookup_case_insensitive(self):
        u = _make_user()
        i = intent_service.create_intent(u, "USDT")
        found = intent_service.lookup_active(i.code.lower())
        assert found is not None

    def test_unknown_code_returns_none(self):
        assert intent_service.lookup_active("ZZZZZZ") is None
        assert intent_service.lookup_active("") is None
        assert intent_service.lookup_active(None) is None

    def test_expired_intent_self_heals_to_expired(self):
        u = _make_user()
        i = intent_service.create_intent(u, "USDT")
        i.expires_at = timezone.now() - timedelta(seconds=1)
        i.save(update_fields=["expires_at"])

        found = intent_service.lookup_active(i.code)
        assert found is None
        i.refresh_from_db()
        assert i.status == DepositIntent.Status.EXPIRED

    def test_consumed_code_not_found(self):
        u = _make_user()
        i = intent_service.create_intent(u, "USDT")
        i.status = DepositIntent.Status.CONSUMED
        i.save(update_fields=["status"])
        assert intent_service.lookup_active(i.code) is None


# ── Consume + idempotency ────────────────────────────────────────────


class TestConsume(TestCase):
    def test_consume_marks_consumed_links_tx(self):
        u = _make_user()
        intent = intent_service.create_intent(u, "USDT")
        tx = Transaction.objects.create(
            user=u,
            idempotency_key="t1",
            type=Transaction.Type.BUY,
            status=Transaction.Status.COMPLETED,
            source_currency="KES",
            source_amount=Decimal("100"),
            dest_currency="USDT",
            dest_amount=Decimal("0.7"),
        )
        intent_service.consume(intent, tx)
        intent.refresh_from_db()
        assert intent.status == DepositIntent.Status.CONSUMED
        assert intent.transaction_id == tx.id
        assert intent.consumed_at is not None

    def test_consume_idempotent_with_same_tx(self):
        u = _make_user()
        intent = intent_service.create_intent(u, "USDT")
        tx = Transaction.objects.create(
            user=u, idempotency_key="t2",
            type=Transaction.Type.BUY,
            status=Transaction.Status.COMPLETED,
            source_currency="KES", source_amount=Decimal("100"),
            dest_currency="USDT", dest_amount=Decimal("0.7"),
        )
        intent_service.consume(intent, tx)
        intent_service.consume(intent, tx)  # no raise

    def test_consume_refuses_different_tx(self):
        u = _make_user()
        intent = intent_service.create_intent(u, "USDT")
        tx_a = Transaction.objects.create(
            user=u, idempotency_key="ta",
            type=Transaction.Type.BUY,
            status=Transaction.Status.COMPLETED,
            source_currency="KES", source_amount=Decimal("100"),
            dest_currency="USDT", dest_amount=Decimal("0.7"),
        )
        tx_b = Transaction.objects.create(
            user=u, idempotency_key="tb",
            type=Transaction.Type.BUY,
            status=Transaction.Status.COMPLETED,
            source_currency="KES", source_amount=Decimal("100"),
            dest_currency="USDT", dest_amount=Decimal("0.7"),
        )
        intent_service.consume(intent, tx_a)
        with self.assertRaises(ValueError):
            intent_service.consume(intent, tx_b)


# ── Sweep ────────────────────────────────────────────────────────────


class TestSweep(TestCase):
    def test_sweep_marks_expired_open(self):
        u = _make_user()
        old = intent_service.create_intent(u, "USDT")
        old.expires_at = timezone.now() - timedelta(minutes=1)
        old.save(update_fields=["expires_at"])

        fresh = intent_service.create_intent(u, "USDT")  # not expired

        n = intent_service.sweep_expired()
        assert n == 1

        old.refresh_from_db()
        fresh.refresh_from_db()
        assert old.status == DepositIntent.Status.EXPIRED
        assert fresh.status == DepositIntent.Status.OPEN


# ── C2BInstructionsView · ?currency mints intent ─────────────────────


@override_settings(
    PAYMENT_PROVIDER="sasapay",
    SASAPAY_C2B_PAYBILL="756756",
    SASAPAY_MERCHANT_CODE="1334777",
)
class TestC2BInstructionsIntent(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_no_currency_param_no_intent(self):
        resp = self.client.get(reverse("payments:c2b-instructions"))
        assert resp.status_code == 200
        assert resp.json()["intent"] is None

    def test_currency_usdt_mints_intent(self):
        resp = self.client.get(
            reverse("payments:c2b-instructions"),
            {"currency": "USDT"},
        )
        assert resp.status_code == 200
        intent = resp.json()["intent"]
        assert intent is not None
        assert intent["currency"] == "USDT"
        assert len(intent["code"]) == 6
        assert intent["expires_in_seconds"] > 1700  # ~30 min

        # Intent persisted
        assert DepositIntent.objects.filter(
            code=intent["code"], user=self.user, currency="USDT",
        ).exists()

    def test_currency_invalid_returns_400(self):
        resp = self.client.get(
            reverse("payments:c2b-instructions"),
            {"currency": "DOGE"},
        )
        assert resp.status_code == 400


# ── POST /deposit/intent/ ────────────────────────────────────────────


@override_settings(
    PAYMENT_PROVIDER="sasapay",
    SASAPAY_C2B_PAYBILL="756756",
    SASAPAY_MERCHANT_CODE="1334777",
)
class TestDepositIntentEndpoint(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = reverse("payments:deposit-intent")

    def test_create_intent(self):
        resp = self.client.post(self.url, {"currency": "USDT"}, format="json")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["code"]) == 6
        assert body["currency"] == "USDT"
        assert body["paybill"] == "756756"
        # Instructions should reference paybill + the code
        assert any("756756" in s for s in body["instructions"])
        assert any(body["code"] in s for s in body["instructions"])

    def test_missing_currency_returns_400(self):
        resp = self.client.post(self.url, {}, format="json")
        assert resp.status_code == 400

    @override_settings(PAYMENT_PROVIDER="daraja")
    def test_non_sasapay_provider_rejected(self):
        resp = self.client.post(self.url, {"currency": "USDT"}, format="json")
        assert resp.status_code == 400
        assert "SasaPay-only" in resp.json()["error"]

    def test_unauth_blocked(self):
        c = APIClient()
        resp = c.post(self.url, {"currency": "USDT"}, format="json")
        assert resp.status_code in (401, 403)


# ── IPN integration · intent-first lookup ────────────────────────────


@override_settings(
    PAYMENT_PROVIDER="sasapay",
    SASAPAY_MERCHANT_CODE="1334777",
)
class TestIPNIntentRouting(TestCase):
    def setUp(self):
        self.user = _make_user()

    def _payload(self, account, amount="500", trans_id=None):
        return {
            "TransactionType": "C2B",
            "TransID": trans_id or f"TX-{account}",
            "TransAmount": amount,
            "MSISDN": "254712345678",
            "FullName": "Test User",
            "BillRefNumber": account,
        }

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_intent_code_routes_to_intent_user_currency(self, mock_rate):
        from apps.mpesa.sasapay_views import _process_c2b_deposit
        from apps.wallets.models import Wallet

        mock_rate.return_value = _RATE_INFO_USDT
        intent = intent_service.create_intent(self.user, "USDT")

        _process_c2b_deposit(self._payload(intent.code, "1000"))

        # USDT credited to the intent's user
        wallet = Wallet.objects.filter(user=self.user, currency="USDT").first()
        assert wallet is not None
        assert wallet.balance > Decimal("0")

        # Intent marked CONSUMED + linked to a tx
        intent.refresh_from_db()
        assert intent.status == DepositIntent.Status.CONSUMED
        assert intent.transaction is not None
        assert intent.transaction.dest_currency == "USDT"

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_intent_overrides_msisdn_lookup(self, mock_rate):
        """A parent (MSISDN 254700070000) pays for a child (intent.user
        is the child). The intent's user is authoritative · we credit
        the child even though the parent's number was on M-Pesa."""
        from apps.mpesa.sasapay_views import _process_c2b_deposit

        mock_rate.return_value = _RATE_INFO_USDT
        child = self.user
        parent_msisdn = "254700070000"

        intent = intent_service.create_intent(child, "USDT")
        payload = {
            "TransactionType": "C2B",
            "TransID": "TX-PARENT-1",
            "TransAmount": "1000",
            "MSISDN": parent_msisdn,
            "BillRefNumber": intent.code,
        }
        _process_c2b_deposit(payload)

        intent.refresh_from_db()
        assert intent.status == DepositIntent.Status.CONSUMED
        # Tx user is the child (intent.user), not the parent
        assert intent.transaction.user_id == child.id

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_expired_intent_falls_through_to_legacy(self, mock_rate):
        """Expired intent must NOT credit. Account also doesn't match
        the legacy `1334777-USDT-phone` shape, so we fall to KES credit
        via MSISDN."""
        from apps.mpesa.sasapay_views import _process_c2b_deposit
        from apps.wallets.models import Wallet

        mock_rate.return_value = _RATE_INFO_USDT
        intent = intent_service.create_intent(self.user, "USDT")
        intent.expires_at = timezone.now() - timedelta(seconds=1)
        intent.save(update_fields=["expires_at"])

        _process_c2b_deposit(self._payload(intent.code, "300"))

        # No USDT credit (intent expired)
        usdt = Wallet.objects.filter(user=self.user, currency="USDT").first()
        assert usdt is None or usdt.balance == Decimal("0")

        # KES credit landed instead (legacy fallback via MSISDN)
        kes = Wallet.objects.filter(user=self.user, currency="KES").first()
        assert kes is not None
        assert kes.balance == Decimal("300")

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_legacy_long_format_still_works(self, mock_rate):
        """Belt-and-braces · the long `1334777-USDT-<phone>` format
        keeps working alongside the new intent-code path. Customers
        who learned the long format aren't broken."""
        from apps.mpesa.sasapay_views import _process_c2b_deposit
        from apps.wallets.models import Wallet

        mock_rate.return_value = _RATE_INFO_USDT
        # No intent created · just the legacy long account string.
        _process_c2b_deposit(self._payload(
            "1334777-USDT-254712345678", "500", trans_id="TX-LEGACY-1",
        ))

        wallet = Wallet.objects.filter(user=self.user, currency="USDT").first()
        assert wallet is not None
        assert wallet.balance > Decimal("0")

    def test_unknown_short_code_falls_through(self):
        """A 6-char string that doesn't match any DepositIntent must
        not credit · falls through to legacy parser, then KES MSISDN
        fallback if no other match."""
        from apps.mpesa.sasapay_views import _process_c2b_deposit
        from apps.wallets.models import Wallet

        # Random 6-char Crockford code · no intent exists.
        _process_c2b_deposit(self._payload("ABC123", "100"))

        # Should fall through to KES credit via MSISDN since "ABC123"
        # also doesn't match the legacy `<MERCHANT>-<CRYPTO>-<phone>`
        # shape · the user's KES wallet should be credited.
        kes = Wallet.objects.filter(user=self.user, currency="KES").first()
        assert kes is not None
        assert kes.balance == Decimal("100")

    @patch("apps.rates.services.RateService.get_crypto_kes_rate")
    def test_intent_with_kes_currency_credits_kes_wallet(self, mock_rate):
        """An intent for currency='KES' credits the KES wallet (no
        auto-buy). User can convert later via swap."""
        from apps.mpesa.sasapay_views import _process_c2b_deposit
        from apps.wallets.models import Wallet

        intent = intent_service.create_intent(self.user, "KES")
        _process_c2b_deposit(self._payload(intent.code, "1000"))

        kes = Wallet.objects.filter(user=self.user, currency="KES").first()
        assert kes is not None
        assert kes.balance == Decimal("1000")

        intent.refresh_from_db()
        assert intent.status == DepositIntent.Status.CONSUMED
