"""B-series security audit regression tests (payments + rates).

Covers B4, B5, B6, B13, B14, B17, B18, B19, B20, B23, B26, B30.
"""
from __future__ import annotations

import threading
from decimal import Decimal
from unittest.mock import patch, MagicMock

import pytest
from django.conf import settings
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def _make_user(phone="+254700000010", kyc_tier=1):
    from apps.accounts.models import User
    u = User.objects.create(phone=phone, kyc_tier=kyc_tier)
    u.set_pin("123456")
    u.save()
    return u


# -------------------------- B4 -------------------------- #

class TestB4DailyLimitLockHandle(TestCase):
    def setUp(self):
        cache.clear()
        self.user = _make_user(phone="+254700000011", kyc_tier=1)

    def test_check_daily_limit_returns_releasable_lock(self):
        from apps.payments.services import check_daily_limit, DailyLimitLock
        lock = check_daily_limit(self.user, Decimal("1000"))
        assert isinstance(lock, DailyLimitLock)
        lock.release()
        # Releasing twice is a no-op.
        lock.release()

    def test_concurrent_callers_serialize(self):
        from apps.payments.services import check_daily_limit, DailyLimitExceededError
        lock = check_daily_limit(self.user, Decimal("100"))
        # Second caller without releasing first should be blocked.
        with pytest.raises(DailyLimitExceededError):
            check_daily_limit(self.user, Decimal("100"))
        lock.release()
        # Now the third call succeeds.
        lock2 = check_daily_limit(self.user, Decimal("100"))
        lock2.release()


# -------------------------- B5 + B14 + B20 -------------------------- #

class TestB5SlippageFailClosed:
    def test_exception_returns_error_string(self):
        from apps.payments.views import _check_rate_slippage
        with patch("apps.rates.services.RateService.get_crypto_kes_rate",
                   side_effect=RuntimeError("provider down")):
            err = _check_rate_slippage({
                "currency": "USDT",
                "exchange_rate": "130",
                "raw_rate": "130",
            })
            assert err is not None
            assert "fresh quote" in err.lower()


class TestB14StaleFlagRejectsQuote:
    def test_lock_rate_returns_503_when_stale(self):
        cache.set("rate:stale", True, timeout=60)
        try:
            from django.contrib.auth import get_user_model
            User = get_user_model()
            user = User.objects.create(phone="+254700000012")
            user.set_pin("123456")
            user.save()
            client = APIClient()
            client.force_authenticate(user=user)
            resp = client.post("/api/v1/rates/quote/", {
                "currency": "USDT",
                "kes_amount": "1000",
            }, format="json")
            assert resp.status_code == 503
        finally:
            cache.delete("rate:stale")


class TestB20SlippageUsesRawRate:
    def test_spread_change_does_not_trigger_slippage(self):
        """Changing PLATFORM_SPREAD_PERCENT between quote + verify should not
        trigger a slippage error if the underlying raw rate is unchanged."""
        from apps.payments.views import _check_rate_slippage
        live_info = {"raw_rate": "130", "final_rate": "125"}  # bigger spread now
        quote = {"currency": "USDT", "raw_rate": "130", "exchange_rate": "128"}  # old spread
        with patch("apps.rates.services.RateService.get_crypto_kes_rate", return_value=live_info):
            err = _check_rate_slippage(quote)
            # Raw rates identical · no slippage should fire.
            assert err is None


# -------------------------- B13 -------------------------- #

class TestB13SwapAcceptsClientIdempotencyKey(TestCase):
    def test_swap_serializer_has_idempotency_field(self):
        from apps.payments.serializers import SwapSerializer
        ser = SwapSerializer(data={
            "from_currency": "USDT",
            "to_currency": "BTC",
            "amount": "1",
            "pin": "123456",
            "idempotency_key": "deadbeef-cafe-dead-beef-deadcafebeef",
        })
        assert ser.is_valid(), ser.errors
        assert ser.validated_data["idempotency_key"].startswith("deadbeef")


# -------------------------- B17 -------------------------- #

class TestB17PinVerifyDoesNotClearOtpChallenge(TestCase):
    def test_success_pin_does_not_clear_otp_challenge_required(self):
        from apps.payments.views import _verify_pin_with_lockout
        user = _make_user(phone="+254700000013", kyc_tier=0)
        user.otp_challenge_required = True
        user.pin_attempts = 0
        user.save()
        result = _verify_pin_with_lockout(user, "123456")
        assert result is None  # success
        user.refresh_from_db()
        assert user.otp_challenge_required is True


# -------------------------- B18 -------------------------- #

class TestB18ReceiptSignedUrl(TestCase):
    def test_sign_view_issues_signature(self):
        from apps.payments.models import Transaction
        user = _make_user(phone="+254700000014")
        tx = Transaction.objects.create(
            idempotency_key="b18-test",
            user=user,
            type=Transaction.Type.BUY,
            source_currency="KES",
            source_amount=Decimal("1000"),
            dest_currency="USDT",
            dest_amount=Decimal("7.69"),
            exchange_rate=Decimal("130"),
            status=Transaction.Status.COMPLETED,
        )
        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.post(f"/api/v1/payments/{tx.id}/receipt/sign/")
        assert resp.status_code == 200
        assert "url" in resp.data
        assert "sig=" in resp.data["url"]
        assert resp.data["expires_in_seconds"] == 60


# -------------------------- B19 -------------------------- #

class TestB19SasapayCompensateRaises(TestCase):
    def test_not_implemented_reversal_raises_saga_error(self):
        from apps.payments.models import Transaction
        from apps.payments.saga import PaymentSaga, SagaError

        user = _make_user(phone="+254700000015")
        tx = Transaction.objects.create(
            idempotency_key="b19-test",
            user=user,
            type=Transaction.Type.PAYBILL_PAYMENT,
            source_currency="USDT",
            source_amount=Decimal("1"),
            dest_currency="KES",
            dest_amount=Decimal("100"),
            exchange_rate=Decimal("130"),
            mpesa_receipt="RECEIPT123",
            status=Transaction.Status.PROCESSING,
        )
        saga = PaymentSaga(tx)

        class _FakeClient:
            def reversal(self, **kwargs):
                raise NotImplementedError("sasapay")

        with patch("apps.mpesa.provider.get_payment_client", return_value=_FakeClient()):
            with pytest.raises(SagaError):
                saga.compensate_mpesa()


# -------------------------- B23 -------------------------- #

class TestB23LateSuccessAfterCompensation(TestCase):
    def test_complete_on_compensated_failed_tx_pages_ops(self):
        """When status=FAILED + saga_data.compensated_at, a late success
        callback must log critical and NOT flip status."""
        from apps.payments.models import Transaction
        from apps.payments.saga import PaymentSaga
        from django.utils import timezone

        user = _make_user(phone="+254700000016")
        tx = Transaction.objects.create(
            idempotency_key="b23-test",
            user=user,
            type=Transaction.Type.PAYBILL_PAYMENT,
            source_currency="USDT",
            source_amount=Decimal("1"),
            dest_currency="KES",
            dest_amount=Decimal("100"),
            exchange_rate=Decimal("130"),
            status=Transaction.Status.FAILED,
            saga_data={"compensated_at": timezone.now().isoformat()},
        )
        saga = PaymentSaga(tx)
        # Should return without raising, and without flipping status.
        saga.complete("LATE_RECEIPT_777")
        tx.refresh_from_db()
        assert tx.status == Transaction.Status.FAILED


# -------------------------- B26 -------------------------- #

class TestB26ConsumeLockedQuoteRequiresUserId:
    def test_quote_bound_to_user_rejects_empty_caller(self):
        from django.core.cache import cache as _cache
        from apps.rates.services import RateService

        quote_id = "B26-test-quote"
        _cache.set(f"quote:{quote_id}", {
            "quote_id": quote_id,
            "user_id": "owner-uuid",
            "currency": "USDT",
            "exchange_rate": "130",
        }, timeout=60)

        # Empty user_id: must NOT return the quote.
        q = RateService.consume_locked_quote(quote_id, user_id="")
        assert q is None

        # Re-seed (consume_locked_quote deleted it even though check failed? it does delete claim key but re-test):
        _cache.set(f"quote:{quote_id}", {
            "quote_id": quote_id,
            "user_id": "owner-uuid",
            "currency": "USDT",
            "exchange_rate": "130",
        }, timeout=60)
        _cache.delete(f"quote_claimed:{quote_id}")

        # Wrong user_id: must NOT return the quote.
        q2 = RateService.consume_locked_quote(quote_id, user_id="intruder-uuid")
        assert q2 is None


# -------------------------- B30 -------------------------- #

class TestB30RejectZeroOrNegativeRates:
    def test_refresh_does_not_cache_zero_rate(self):
        """Simulate a broken provider response and assert no zero rate
        lands in the rate cache."""
        from apps.rates.services import RateService
        fake_response = MagicMock(
            status_code=200,
            json=MagicMock(return_value={
                "tether": {"usd": 0, "usd_24h_change": 0.0},
                "bitcoin": {"usd": 50000, "usd_24h_change": 1.5},
            }),
        )
        fake_response.raise_for_status = lambda: None
        cache.delete("rate:batch:lock")
        cache.delete("rate:crypto:USDT:usd")
        cache.delete("rate:crypto:BTC:usd")
        with patch("apps.rates.services.requests.get", return_value=fake_response):
            RateService.refresh_all_crypto_rates()
        assert cache.get("rate:crypto:USDT:usd") in (None, "")
        assert cache.get("rate:crypto:BTC:usd") == "50000"
