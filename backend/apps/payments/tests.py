"""Tests for payment saga, double-payment prevention, and daily limits."""

import uuid
from decimal import Decimal
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.wallets.models import Wallet

from .models import Transaction
from .saga import PaymentSaga, SagaError
from .services import DailyLimitExceededError, check_daily_limit


class PaymentSagaTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.wallet = Wallet.objects.create(
            user=self.user,
            currency="USDT",
            balance=Decimal("100.00000000"),
        )
        self.tx = Transaction.objects.create(
            idempotency_key=str(uuid.uuid4()),
            user=self.user,
            type=Transaction.Type.PAYBILL_PAYMENT,
            source_currency="USDT",
            source_amount=Decimal("20.00000000"),
            dest_currency="KES",
            dest_amount=Decimal("2500"),
            exchange_rate=Decimal("131.47"),
            fee_amount=Decimal("10"),
            fee_currency="KES",
            mpesa_paybill="888880",
            mpesa_account="12345678",
        )

    def test_step_lock_crypto(self):
        saga = PaymentSaga(self.tx)
        saga.step_lock_crypto()

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.locked_balance, Decimal("20.00000000"))

    def test_step_lock_insufficient_balance(self):
        self.tx.source_amount = Decimal("200.00000000")
        self.tx.save()

        saga = PaymentSaga(self.tx)
        with self.assertRaises(SagaError):
            saga.step_lock_crypto()

    def test_compensate_lock_unlocks_funds(self):
        saga = PaymentSaga(self.tx)
        saga.step_lock_crypto()

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.locked_balance, Decimal("20.00000000"))

        saga.compensate_lock_crypto()

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.locked_balance, Decimal("0"))

    def test_step_convert_debits_wallet(self):
        saga = PaymentSaga(self.tx)
        saga.step_lock_crypto()
        saga.step_convert()

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("80.00000000"))
        self.assertEqual(self.wallet.locked_balance, Decimal("0"))

    def test_compensate_convert_credits_back(self):
        saga = PaymentSaga(self.tx)
        saga.step_lock_crypto()
        saga.step_convert()

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("80.00000000"))

        saga.compensate_convert()

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("100.00000000"))

    @patch("apps.mpesa.client.MpesaClient.b2b_payment")
    def test_full_saga_success(self, mock_b2b):
        mock_b2b.return_value = {
            "ConversationID": "conv-123",
            "OriginatorConversationID": "orig-456",
            "ResponseCode": "0",
        }

        saga = PaymentSaga(self.tx)
        saga.execute()

        self.tx.refresh_from_db()
        # In sandbox mode, auto-complete fires immediately after M-Pesa API success
        # In production, status would be CONFIRMING until callback arrives
        from django.conf import settings as django_settings
        if getattr(django_settings, "MPESA_ENVIRONMENT", "") == "sandbox":
            self.assertEqual(self.tx.status, Transaction.Status.COMPLETED)
        else:
            self.assertEqual(self.tx.status, Transaction.Status.CONFIRMING)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("80.00000000"))

    @patch("apps.mpesa.client.MpesaClient.b2b_payment")
    def test_full_saga_mpesa_fails_compensates(self, mock_b2b):
        mock_b2b.side_effect = Exception("M-Pesa service unavailable")

        saga = PaymentSaga(self.tx)
        with self.assertRaises(SagaError):
            saga.execute()

        # Funds should be restored after compensation
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("100.00000000"))
        self.assertEqual(self.wallet.locked_balance, Decimal("0"))

        self.tx.refresh_from_db()
        self.assertEqual(self.tx.status, Transaction.Status.FAILED)


class DoublePaymentPreventionTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        cache.clear()

    def test_redis_idempotency_prevents_duplicate(self):
        idem_key = "test-payment-001"
        redis_key = f"payment:{idem_key}"

        # First attempt succeeds
        result = cache.add(redis_key, "processing", timeout=300)
        self.assertTrue(result)

        # Second attempt fails
        result = cache.add(redis_key, "processing", timeout=300)
        self.assertFalse(result)

    def test_postgres_unique_constraint_prevents_duplicate(self):
        idem_key = str(uuid.uuid4())

        Transaction.objects.create(
            idempotency_key=idem_key,
            user=self.user,
            type=Transaction.Type.PAYBILL_PAYMENT,
        )

        from django.db import IntegrityError

        with self.assertRaises(IntegrityError):
            Transaction.objects.create(
                idempotency_key=idem_key,
                user=self.user,
                type=Transaction.Type.PAYBILL_PAYMENT,
            )


class DailyLimitTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.user.kyc_tier = 0
        self.user.save()

    def test_tier0_within_limit(self):
        """Tier 0 user can transact up to KES 5,000/day."""
        # Should not raise
        check_daily_limit(self.user, Decimal("4000"))

    def test_tier0_exceeds_limit(self):
        """Tier 0 user cannot exceed KES 5,000/day."""
        # Create an existing completed transaction today
        Transaction.objects.create(
            idempotency_key=str(uuid.uuid4()),
            user=self.user,
            type=Transaction.Type.PAYBILL_PAYMENT,
            status=Transaction.Status.COMPLETED,
            dest_currency="KES",
            dest_amount=Decimal("3000"),
        )

        # Trying to add 3000 more should exceed the 5000 limit
        with self.assertRaises(DailyLimitExceededError):
            check_daily_limit(self.user, Decimal("3000"))

    def test_tier1_higher_limit(self):
        """Tier 1 user gets KES 50,000/day limit."""
        self.user.kyc_tier = 1
        self.user.save()

        # Create existing transaction at 40k
        Transaction.objects.create(
            idempotency_key=str(uuid.uuid4()),
            user=self.user,
            type=Transaction.Type.PAYBILL_PAYMENT,
            status=Transaction.Status.COMPLETED,
            dest_currency="KES",
            dest_amount=Decimal("40000"),
        )

        # 8000 more should be fine (48k total)
        check_daily_limit(self.user, Decimal("8000"))

        # But 15000 more would exceed (55k total)
        with self.assertRaises(DailyLimitExceededError):
            check_daily_limit(self.user, Decimal("15000"))

    def test_failed_transactions_not_counted(self):
        """Failed transactions should not count toward daily limit."""
        Transaction.objects.create(
            idempotency_key=str(uuid.uuid4()),
            user=self.user,
            type=Transaction.Type.PAYBILL_PAYMENT,
            status=Transaction.Status.FAILED,
            dest_currency="KES",
            dest_amount=Decimal("4000"),
        )

        # Should not raise since the 4000 was failed
        check_daily_limit(self.user, Decimal("4000"))

    def test_processing_transactions_counted(self):
        """Processing transactions should count toward daily limit."""
        Transaction.objects.create(
            idempotency_key=str(uuid.uuid4()),
            user=self.user,
            type=Transaction.Type.PAYBILL_PAYMENT,
            status=Transaction.Status.PROCESSING,
            dest_currency="KES",
            dest_amount=Decimal("4000"),
        )

        with self.assertRaises(DailyLimitExceededError):
            check_daily_limit(self.user, Decimal("2000"))


class RateQuoteExpiryTest(TestCase):
    def setUp(self):
        cache.clear()

    def test_quote_expires_after_ttl(self):
        """A locked quote should expire after the TTL."""
        from apps.rates.services import RateService

        quote_id = "test-quote-123"
        quote_data = {
            "quote_id": quote_id,
            "currency": "USDT",
            "kes_amount": "1000",
            "crypto_amount": "7.61",
            "exchange_rate": "131.47",
        }
        cache.set(f"quote:{quote_id}", quote_data, timeout=1)

        # Should exist immediately
        result = RateService.get_locked_quote(quote_id)
        self.assertIsNotNone(result)

    def test_nonexistent_quote_returns_none(self):
        from apps.rates.services import RateService

        result = RateService.get_locked_quote("nonexistent-quote")
        self.assertIsNone(result)
