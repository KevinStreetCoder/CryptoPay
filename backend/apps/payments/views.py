"""
Payment API endpoints.

The core flow:
1. User gets a quote (rates app) — locks the rate for 30s
2. User submits payment with quote_id + Paybill/Till + PIN
3. Backend verifies PIN, checks idempotency, runs the payment saga
"""

import logging
from decimal import Decimal

from django.core.cache import cache
from django.db import IntegrityError
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AuditLog

from .models import Transaction
from .saga import PaymentSaga, SagaError
from .serializers import BuyCryptoSerializer, PayBillSerializer, PayTillSerializer, SendMpesaSerializer, TransactionSerializer
from .services import DailyLimitExceededError, check_daily_limit

logger = logging.getLogger(__name__)


class PayBillView(APIView):
    """Pay a Paybill number with crypto."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PayBillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        data = serializer.validated_data

        # Verify PIN
        if not user.check_pin(data["pin"]):
            return Response({"error": "Invalid PIN"}, status=status.HTTP_401_UNAUTHORIZED)

        # Check idempotency — Layer 2 (Redis)
        idem_key = data["idempotency_key"]
        redis_key = f"payment:{idem_key}"
        if not cache.add(redis_key, "processing", timeout=300):
            # Already exists — check if we have a transaction
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(
                    TransactionSerializer(existing).data,
                    status=status.HTTP_200_OK,
                )
            return Response(
                {"error": "Payment already in progress"},
                status=status.HTTP_409_CONFLICT,
            )

        # Get the locked quote
        from apps.rates.services import RateService

        quote = RateService.get_locked_quote(data["quote_id"])
        if not quote:
            cache.delete(redis_key)
            return Response(
                {"error": "Quote expired. Please request a new quote."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check daily transaction limit based on KYC tier
        try:
            check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response(
                {"error": str(e)},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Create the transaction — Layer 3 (PostgreSQL unique constraint)
        try:
            tx = Transaction.objects.create(
                idempotency_key=idem_key,
                user=user,
                type=Transaction.Type.PAYBILL_PAYMENT,
                source_currency=quote["currency"],
                source_amount=Decimal(quote["crypto_amount"]),
                dest_currency="KES",
                dest_amount=Decimal(quote["kes_amount"]),
                exchange_rate=Decimal(quote["exchange_rate"]),
                fee_amount=Decimal(quote["fee_kes"]),
                fee_currency="KES",
                mpesa_paybill=data["paybill"],
                mpesa_account=data["account"],
                ip_address=self._get_client_ip(request),
            )
        except IntegrityError:
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response(
                {"error": "Duplicate payment detected"},
                status=status.HTTP_409_CONFLICT,
            )

        # Run the payment saga
        try:
            saga = PaymentSaga(tx)
            saga.execute()
        except SagaError as e:
            logger.error(f"Payment saga failed: {e}")
            return Response(
                {"error": "Payment failed. Your funds have been returned.", "transaction": TransactionSerializer(tx).data},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        AuditLog.objects.create(
            user=user,
            action="PAYBILL_PAYMENT",
            entity_type="transaction",
            entity_id=str(tx.id),
            details={
                "paybill": data["paybill"],
                "account": data["account"],
                "kes_amount": str(quote["kes_amount"]),
                "crypto_amount": str(quote["crypto_amount"]),
                "currency": quote["currency"],
            },
            ip_address=self._get_client_ip(request),
        )

        return Response(
            TransactionSerializer(tx).data,
            status=status.HTTP_201_CREATED,
        )

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class PayTillView(APIView):
    """Pay a Till number with crypto."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PayTillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        data = serializer.validated_data

        if not user.check_pin(data["pin"]):
            return Response({"error": "Invalid PIN"}, status=status.HTTP_401_UNAUTHORIZED)

        idem_key = data["idempotency_key"]
        redis_key = f"payment:{idem_key}"
        if not cache.add(redis_key, "processing", timeout=300):
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response({"error": "Payment already in progress"}, status=status.HTTP_409_CONFLICT)

        from apps.rates.services import RateService

        quote = RateService.get_locked_quote(data["quote_id"])
        if not quote:
            cache.delete(redis_key)
            return Response({"error": "Quote expired"}, status=status.HTTP_400_BAD_REQUEST)

        # Check daily transaction limit based on KYC tier
        try:
            check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        try:
            tx = Transaction.objects.create(
                idempotency_key=idem_key,
                user=user,
                type=Transaction.Type.TILL_PAYMENT,
                source_currency=quote["currency"],
                source_amount=Decimal(quote["crypto_amount"]),
                dest_currency="KES",
                dest_amount=Decimal(quote["kes_amount"]),
                exchange_rate=Decimal(quote["exchange_rate"]),
                fee_amount=Decimal(quote["fee_kes"]),
                fee_currency="KES",
                mpesa_till=data["till"],
                ip_address=self._get_client_ip(request),
            )
        except IntegrityError:
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response({"error": "Duplicate payment"}, status=status.HTTP_409_CONFLICT)

        try:
            saga = PaymentSaga(tx)
            saga.execute()
        except SagaError:
            return Response(
                {"error": "Payment failed. Funds returned.", "transaction": TransactionSerializer(tx).data},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response(TransactionSerializer(tx).data, status=status.HTTP_201_CREATED)

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class SendMpesaView(APIView):
    """Send crypto to an M-Pesa phone number (B2C)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = SendMpesaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        data = serializer.validated_data

        if not user.check_pin(data["pin"]):
            return Response({"error": "Invalid PIN"}, status=status.HTTP_401_UNAUTHORIZED)

        idem_key = data["idempotency_key"]
        redis_key = f"payment:{idem_key}"
        if not cache.add(redis_key, "processing", timeout=300):
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response({"error": "Payment already in progress"}, status=status.HTTP_409_CONFLICT)

        from apps.rates.services import RateService

        quote = RateService.get_locked_quote(data["quote_id"])
        if not quote:
            cache.delete(redis_key)
            return Response({"error": "Quote expired"}, status=status.HTTP_400_BAD_REQUEST)

        # Check daily transaction limit based on KYC tier
        try:
            check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        try:
            tx = Transaction.objects.create(
                idempotency_key=idem_key,
                user=user,
                type=Transaction.Type.SEND_MPESA,
                source_currency=quote["currency"],
                source_amount=Decimal(quote["crypto_amount"]),
                dest_currency="KES",
                dest_amount=Decimal(quote["kes_amount"]),
                exchange_rate=Decimal(quote["exchange_rate"]),
                fee_amount=Decimal(quote["fee_kes"]),
                fee_currency="KES",
                mpesa_phone=data["phone"],
                ip_address=self._get_client_ip(request),
            )
        except IntegrityError:
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response({"error": "Duplicate payment"}, status=status.HTTP_409_CONFLICT)

        try:
            saga = PaymentSaga(tx)
            saga.execute()
        except SagaError:
            return Response(
                {"error": "Payment failed. Funds returned.", "transaction": TransactionSerializer(tx).data},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        AuditLog.objects.create(
            user=user,
            action="SEND_MPESA",
            entity_type="transaction",
            entity_id=str(tx.id),
            details={
                "phone": data["phone"],
                "kes_amount": str(quote["kes_amount"]),
                "crypto_amount": str(quote["crypto_amount"]),
                "currency": quote["currency"],
            },
            ip_address=self._get_client_ip(request),
        )

        return Response(TransactionSerializer(tx).data, status=status.HTTP_201_CREATED)

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class BuyCryptoView(APIView):
    """Buy crypto with M-Pesa (STK Push deposit)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = BuyCryptoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        data = serializer.validated_data

        if not user.check_pin(data["pin"]):
            return Response({"error": "Invalid PIN"}, status=status.HTTP_401_UNAUTHORIZED)

        # Idempotency check
        idem_key = data["idempotency_key"]
        redis_key = f"payment:{idem_key}"
        if not cache.add(redis_key, "processing", timeout=300):
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response({"error": "Payment already in progress"}, status=status.HTTP_409_CONFLICT)

        # Get the locked quote
        from apps.rates.services import RateService

        quote = RateService.get_locked_quote(data["quote_id"])
        if not quote:
            cache.delete(redis_key)
            return Response({"error": "Quote expired"}, status=status.HTTP_400_BAD_REQUEST)

        # Check daily limit
        try:
            check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        # Create the buy transaction
        try:
            tx = Transaction.objects.create(
                idempotency_key=idem_key,
                user=user,
                type=Transaction.Type.BUY,
                source_currency="KES",
                source_amount=Decimal(quote["total_kes"]),
                dest_currency=quote["currency"],
                dest_amount=Decimal(quote["crypto_amount"]),
                exchange_rate=Decimal(quote["exchange_rate"]),
                fee_amount=Decimal(quote["fee_kes"]),
                fee_currency="KES",
                mpesa_phone=data["phone"],
                ip_address=self._get_client_ip(request),
            )
        except IntegrityError:
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response({"error": "Duplicate payment"}, status=status.HTTP_409_CONFLICT)

        # Initiate M-Pesa STK Push
        from apps.mpesa.client import MpesaClient, MpesaError

        try:
            client = MpesaClient()
            kes_amount = int(Decimal(quote["total_kes"]).quantize(Decimal("1")))
            mpesa_phone = data["phone"].replace("+", "")

            stk_result = client.stk_push(
                phone=mpesa_phone,
                amount=kes_amount,
                account_ref=f"BUY-{str(tx.id)[:8].upper()}",
                description=f"Buy {quote['crypto_amount']} {quote['currency']}",
            )

            # Store STK Push tracking info
            tx.status = Transaction.Status.PROCESSING
            tx.saga_data = {
                "mpesa_checkout_request_id": stk_result.get("CheckoutRequestID", ""),
                "mpesa_merchant_request_id": stk_result.get("MerchantRequestID", ""),
                "quote": quote,
            }
            tx.save(update_fields=["status", "saga_data", "updated_at"])

            # Schedule status poll as fallback (60s later)
            from apps.mpesa.tasks import poll_stk_status

            poll_stk_status.apply_async(
                args=[stk_result.get("CheckoutRequestID", ""), str(tx.id)],
                countdown=60,
            )

        except MpesaError as e:
            tx.failure_reason = str(e)
            tx.status = Transaction.Status.FAILED
            tx.save(update_fields=["failure_reason", "status", "updated_at"])
            cache.delete(redis_key)
            return Response(
                {"error": "M-Pesa payment initiation failed. Please try again.", "transaction": TransactionSerializer(tx).data},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except Exception as e:
            logger.error(f"STK Push error: {e}")
            tx.failure_reason = "Internal error initiating M-Pesa payment"
            tx.status = Transaction.Status.FAILED
            tx.save(update_fields=["failure_reason", "status", "updated_at"])
            cache.delete(redis_key)
            return Response(
                {"error": "Payment initiation failed. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        AuditLog.objects.create(
            user=user,
            action="BUY_CRYPTO",
            entity_type="transaction",
            entity_id=str(tx.id),
            details={
                "phone": data["phone"],
                "kes_amount": str(quote["total_kes"]),
                "crypto_amount": str(quote["crypto_amount"]),
                "currency": quote["currency"],
            },
            ip_address=self._get_client_ip(request),
        )

        return Response(TransactionSerializer(tx).data, status=status.HTTP_201_CREATED)

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class TransactionHistoryView(ListAPIView):
    """User's transaction history."""

    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Transaction.objects.filter(user=self.request.user)
