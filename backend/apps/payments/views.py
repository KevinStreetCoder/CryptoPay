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
from .serializers import PayBillSerializer, PayTillSerializer, TransactionSerializer
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


class TransactionHistoryView(ListAPIView):
    """User's transaction history."""

    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Transaction.objects.filter(user=self.request.user)
