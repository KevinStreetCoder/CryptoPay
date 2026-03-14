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

from .circuit_breaker import PaymentCircuitBreaker, PaymentsPaused
from .models import Transaction
from .saga import PaymentSaga, SagaError
from .serializers import BuyCryptoSerializer, DepositQuoteSerializer, PayBillSerializer, PayTillSerializer, SendMpesaSerializer, TransactionSerializer
from .services import DailyLimitExceededError, check_daily_limit

logger = logging.getLogger(__name__)


class IsNotSuspended(IsAuthenticated):
    """Block suspended users from making transactions."""

    message = "Your account is suspended. Contact support for assistance."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return not getattr(request.user, "is_suspended", False)


class PayBillView(APIView):
    """Pay a Paybill number with crypto."""

    permission_classes = [IsNotSuspended]

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

        # Peek at the locked quote (don't consume yet — validate first)
        from apps.rates.services import RateService

        quote = RateService.get_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            cache.delete(redis_key)
            return Response(
                {"error": "Quote expired or invalid. Please request a new quote."},
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

        # Circuit breaker — block payments if float is critically low
        try:
            PaymentCircuitBreaker.check_payment_allowed(Decimal(quote["kes_amount"]))
        except PaymentsPaused as e:
            cache.delete(redis_key)
            return Response(
                {"error": e.reason, "circuit_breaker": True},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Now consume the quote (validation passed)
        quote = RateService.consume_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            cache.delete(redis_key)
            return Response(
                {"error": "Quote expired or was already used. Please request a new quote."},
                status=status.HTTP_400_BAD_REQUEST,
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
                excise_duty_amount=Decimal(quote.get("excise_duty_kes", "0")),
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
        return request.META.get("REMOTE_ADDR", "0.0.0.0")


class PayTillView(APIView):
    """Pay a Till number with crypto."""

    permission_classes = [IsNotSuspended]

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

        quote = RateService.get_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            cache.delete(redis_key)
            return Response({"error": "Quote expired or invalid"}, status=status.HTTP_400_BAD_REQUEST)

        # Check daily transaction limit based on KYC tier
        try:
            check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        # Circuit breaker — block payments if float is critically low
        try:
            PaymentCircuitBreaker.check_payment_allowed(Decimal(quote["kes_amount"]))
        except PaymentsPaused as e:
            cache.delete(redis_key)
            return Response(
                {"error": e.reason, "circuit_breaker": True},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Now consume the quote (validation passed)
        quote = RateService.consume_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            cache.delete(redis_key)
            return Response({"error": "Quote expired or was already used"}, status=status.HTTP_400_BAD_REQUEST)

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
                excise_duty_amount=Decimal(quote.get("excise_duty_kes", "0")),
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
        return request.META.get("REMOTE_ADDR", "0.0.0.0")


class SendMpesaView(APIView):
    """Send crypto to an M-Pesa phone number (B2C)."""

    permission_classes = [IsNotSuspended]

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

        quote = RateService.get_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            cache.delete(redis_key)
            return Response({"error": "Quote expired or invalid"}, status=status.HTTP_400_BAD_REQUEST)

        # Check daily transaction limit based on KYC tier
        try:
            check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        # Circuit breaker — block payments if float is critically low
        try:
            PaymentCircuitBreaker.check_payment_allowed(Decimal(quote["kes_amount"]))
        except PaymentsPaused as e:
            cache.delete(redis_key)
            return Response(
                {"error": e.reason, "circuit_breaker": True},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Now consume the quote (validation passed)
        quote = RateService.consume_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            cache.delete(redis_key)
            return Response({"error": "Quote expired or was already used"}, status=status.HTTP_400_BAD_REQUEST)

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
                excise_duty_amount=Decimal(quote.get("excise_duty_kes", "0")),
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
        return request.META.get("REMOTE_ADDR", "0.0.0.0")


class BuyCryptoView(APIView):
    """Buy crypto with M-Pesa (STK Push deposit)."""

    permission_classes = [IsNotSuspended]

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

        # Peek at the locked quote (validate before consuming)
        from apps.rates.services import RateService

        quote = RateService.get_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            cache.delete(redis_key)
            return Response({"error": "Quote expired or invalid"}, status=status.HTTP_400_BAD_REQUEST)

        # Check daily limit
        try:
            check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        # Now consume the quote (validation passed)
        quote = RateService.consume_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            cache.delete(redis_key)
            return Response({"error": "Quote expired or was already used"}, status=status.HTTP_400_BAD_REQUEST)

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
                excise_duty_amount=Decimal(quote.get("excise_duty_kes", "0")),
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
        return request.META.get("REMOTE_ADDR", "0.0.0.0")


class DepositQuoteView(APIView):
    """Get a rate-locked quote for KES → crypto deposit."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = DepositQuoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        kes_amount = data["kes_amount"]
        dest_currency = data["dest_currency"]

        # Check daily limit
        try:
            check_daily_limit(request.user, kes_amount)
        except DailyLimitExceededError as e:
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        # Get rate-locked quote (reuse existing lock_rate infrastructure)
        from apps.rates.services import RateService

        try:
            quote = RateService.lock_rate(
                dest_currency, kes_amount, user_id=str(request.user.id)
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Add deposit-specific fields
        from django.conf import settings as app_settings

        fee_pct = Decimal(str(app_settings.DEPOSIT_FEE_PERCENTAGE))
        deposit_fee = (kes_amount * fee_pct / Decimal("100")).quantize(Decimal("0.01"))

        quote["deposit_fee_kes"] = str(deposit_fee)
        quote["deposit_fee_percent"] = str(fee_pct)
        quote["valid_seconds"] = app_settings.DEPOSIT_QUOTE_TTL_SECONDS

        return Response(quote, status=status.HTTP_200_OK)


class DepositStatusView(APIView):
    """Check the status of a deposit transaction."""

    permission_classes = [IsAuthenticated]

    def get(self, request, transaction_id):
        try:
            tx = Transaction.objects.get(id=transaction_id, user=request.user)
        except Transaction.DoesNotExist:
            return Response(
                {"error": "Transaction not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = TransactionSerializer(tx).data

        # Add human-readable summary for deposits
        if tx.type in (Transaction.Type.BUY, Transaction.Type.KES_DEPOSIT, Transaction.Type.KES_DEPOSIT_C2B):
            if tx.status == Transaction.Status.COMPLETED:
                data["summary"] = f"Deposited KES {tx.source_amount:,.0f} → {tx.dest_amount} {tx.dest_currency}"
            elif tx.status == Transaction.Status.PROCESSING:
                data["summary"] = "Waiting for M-Pesa payment confirmation..."
            elif tx.status == Transaction.Status.FAILED:
                data["summary"] = tx.failure_reason or "Deposit failed"

        return Response(data)


class C2BInstructionsView(APIView):
    """Return M-Pesa C2B deposit instructions for the authenticated user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.conf import settings as app_settings

        user = request.user
        phone = user.phone.replace("+", "") if user.phone else ""

        return Response({
            "paybill": app_settings.MPESA_SHORTCODE,
            "account_formats": [
                {
                    "currency": "USDT",
                    "account_number": f"USDT-{phone}",
                    "description": "Deposit and receive USDT (Tether)",
                },
                {
                    "currency": "BTC",
                    "account_number": f"BTC-{phone}",
                    "description": "Deposit and receive Bitcoin",
                },
                {
                    "currency": "ETH",
                    "account_number": f"ETH-{phone}",
                    "description": "Deposit and receive Ethereum",
                },
                {
                    "currency": "SOL",
                    "account_number": f"SOL-{phone}",
                    "description": "Deposit and receive Solana",
                },
            ],
            "min_amount": app_settings.DEPOSIT_MIN_KES,
            "max_amount": app_settings.DEPOSIT_MAX_KES,
            "fee_percent": app_settings.DEPOSIT_FEE_PERCENTAGE,
            "instructions": [
                "Open M-Pesa on your phone",
                "Select Lipa Na M-Pesa → Pay Bill",
                f"Enter Business Number: {app_settings.MPESA_SHORTCODE}",
                "Enter Account Number using format above (e.g., USDT-0712345678)",
                "Enter the KES amount you want to deposit",
                "Enter your M-Pesa PIN to confirm",
                "Your crypto will be credited at the current market rate",
            ],
        })


class TransactionHistoryView(ListAPIView):
    """User's transaction history."""

    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Transaction.objects.filter(user=self.request.user)


class TransactionReceiptView(APIView):
    """Download PDF receipt for a completed transaction.

    Supports two auth methods:
    1. Standard Authorization header (native apps)
    2. ?token=<jwt> query parameter (web — bypasses IDM browser extension
       which intercepts fetch/XHR and breaks CORS on file downloads)
    """

    permission_classes = [IsAuthenticated]

    def get_authenticators(self):
        """Allow JWT token in query parameter as fallback."""
        authenticators = super().get_authenticators()
        return authenticators

    def initial(self, request, *args, **kwargs):
        """Inject Authorization header from query param if present."""
        token = request.query_params.get("token")
        if token and "HTTP_AUTHORIZATION" not in request.META:
            request.META["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        super().initial(request, *args, **kwargs)

    def get(self, request, transaction_id):
        import os
        from django.http import FileResponse, HttpResponse
        from django.conf import settings as _settings

        try:
            tx = Transaction.objects.get(id=transaction_id, user=request.user)
        except Transaction.DoesNotExist:
            return Response(
                {"error": "Transaction not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check if PDF already exists
        receipt_filename = f"receipt_{str(tx.id)[:8]}_{tx.created_at.strftime('%Y%m%d')}.pdf"
        receipt_path = os.path.join(_settings.MEDIA_ROOT, "receipts", receipt_filename)

        if not os.path.exists(receipt_path):
            # Generate on demand
            from apps.core.pdf_receipt import generate_receipt_pdf

            receipt_path = generate_receipt_pdf(tx)

        if receipt_path and os.path.exists(receipt_path):
            response = FileResponse(
                open(receipt_path, "rb"),
                content_type="application/pdf",
                as_attachment=True,
                filename=receipt_filename,
            )
            # Ensure CORS headers are present (FileResponse may bypass middleware)
            origin = request.META.get("HTTP_ORIGIN", "")
            if origin:
                response["Access-Control-Allow-Origin"] = origin
                response["Access-Control-Allow-Credentials"] = "true"
            return response

        return Response(
            {"error": "Receipt generation failed. Please try again."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


class CircuitBreakerStatusView(APIView):
    """
    GET  — View current circuit breaker state (admin only).
    POST — Manually pause or resume payments.

    POST body:
      {"action": "pause", "reason": "Manual pause for maintenance"}
      {"action": "resume"}
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not request.user.is_staff:
            return Response({"error": "Admin access required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(PaymentCircuitBreaker.get_status_dict())

    def post(self, request):
        if not request.user.is_staff:
            return Response({"error": "Admin access required"}, status=status.HTTP_403_FORBIDDEN)

        action = request.data.get("action")
        if action == "pause":
            reason = request.data.get("reason", "Manual pause by admin")
            PaymentCircuitBreaker.force_pause(reason)
            AuditLog.objects.create(
                user=request.user,
                action="CIRCUIT_BREAKER_MANUAL_PAUSE",
                entity_type="system",
                entity_id="payment_circuit_breaker",
                details={"reason": reason},
                ip_address=self._get_client_ip(request),
            )
            return Response({"status": "paused", "reason": reason})

        elif action == "resume":
            PaymentCircuitBreaker.force_resume(str(request.user))
            AuditLog.objects.create(
                user=request.user,
                action="CIRCUIT_BREAKER_MANUAL_RESUME",
                entity_type="system",
                entity_id="payment_circuit_breaker",
                details={},
                ip_address=self._get_client_ip(request),
            )
            return Response({"status": "resumed"})

        return Response(
            {"error": "Invalid action. Use 'pause' or 'resume'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "0.0.0.0")
