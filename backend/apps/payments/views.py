"""
Payment API endpoints.

The core flow:
1. User gets a quote (rates app) — locks the rate for 30s
2. User submits payment with quote_id + Paybill/Till + PIN
3. Backend verifies PIN, checks idempotency, runs the payment saga
"""

import csv
import io
import logging
from decimal import Decimal

from django.conf import settings as app_settings
from django.core.cache import cache
from django.db import IntegrityError
from django.http import HttpResponse
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView


class PaymentRateThrottle(UserRateThrottle):
    """Limit payment transactions to 10 per hour per user."""
    scope = "payment"
    rate = "10/hour"

from django.utils import timezone

from apps.accounts.models import AuditLog

from .circuit_breaker import PaymentCircuitBreaker, PaymentsPaused
from .models import SavedPaybill, Transaction
from .saga import PaymentSaga, SagaError
from .serializers import BuyCryptoSerializer, DepositQuoteSerializer, PayBillSerializer, PayTillSerializer, SavedPaybillSerializer, SendMpesaSerializer, SwapSerializer, TransactionSerializer, WithdrawSerializer
from .services import DailyLimitExceededError, check_daily_limit

logger = logging.getLogger(__name__)


def _verify_pin_with_lockout(user, pin: str):
    """Verify PIN with progressive lockout tracking. Returns None on success, or a Response on failure.

    B17: on success, reset ONLY `pin_attempts`. Never flip
    `otp_challenge_required` back to False from a payment endpoint ·
    that flag is an authentication-layer concern; only a successful
    login + OTP verification path may clear it.
    """
    if user.pin_locked_until and user.pin_locked_until > timezone.now():
        return Response(
            {"error": "Account temporarily locked. Try again later."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not user.check_pin(pin):
        user.pin_attempts += 1
        lockout_thresholds = {5: 60, 10: 300, 15: 3600}
        lockout_seconds = lockout_thresholds.get(user.pin_attempts)
        if lockout_seconds:
            from datetime import timedelta
            user.pin_locked_until = timezone.now() + timedelta(seconds=lockout_seconds)
        if user.pin_attempts >= 3 and not user.otp_challenge_required:
            user.otp_challenge_required = True
        user.save(update_fields=["pin_attempts", "pin_locked_until", "otp_challenge_required"])
        return Response({"error": "Invalid PIN"}, status=status.HTTP_401_UNAUTHORIZED)

    # Success · reset attempts counter only; leave otp_challenge_required alone.
    if user.pin_attempts > 0:
        user.pin_attempts = 0
        user.save(update_fields=["pin_attempts"])

    return None


def _apply_referral_credit(tx) -> Decimal:
    """Consume available referral credit against the tx fee.

    Reduces tx.fee_amount, writes a consumed ledger row (via
    apps.referrals.services). Returns the amount applied (Decimal).
    Idempotent per tx.id. Silent no-op on failure — never fails payments.
    """
    try:
        from apps.referrals.services import apply_credit_to_fee
        if tx.fee_amount and tx.fee_amount > 0:
            reduced_fee, applied = apply_credit_to_fee(tx, Decimal(tx.fee_amount))
            if applied > 0:
                tx.fee_amount = reduced_fee
                tx.save(update_fields=["fee_amount"])
            return applied
    except Exception as e:
        logger.warning(f"Referral credit application failed for tx {tx.id}: {e}")
    return Decimal("0.00")


def _check_rate_slippage(quote: dict) -> str | None:
    """
    Compare the quote's locked rate against the current live rate.
    Returns an error message when the payment should be rejected.

    B5: on any exception in the rate lookup, FAIL CLOSED and return a
    non-None string so the caller rejects the payment. Returning None
    previously allowed unlimited slippage during rate-provider outages.

    B14: if the rate cache has the stale flag set, also reject.

    B20: compare raw_rate to raw_rate so admin-adjustable PLATFORM_SPREAD
    changes between lock + verify can't register as "slippage".
    """
    from apps.rates.services import RateService

    try:
        if cache.get("rate:stale"):
            return (
                "Rate feed temporarily unavailable · please request a fresh "
                "quote in a moment."
            )
        currency = quote["currency"]
        live_info = RateService.get_crypto_kes_rate(currency)
        # B20: prefer raw_rate when both sides have it; fall back to final_rate.
        quote_raw = Decimal(str(quote.get("raw_rate") or quote["exchange_rate"]))
        live_raw = Decimal(str(live_info.get("raw_rate") or live_info.get("final_rate", "0")))
        if quote_raw <= 0:
            return "Quote contains an invalid rate · please request a fresh quote."
        slippage_pct = abs(live_raw - quote_raw) / quote_raw * Decimal("100")
        tolerance = Decimal(str(app_settings.DEPOSIT_SLIPPAGE_TOLERANCE))
        if slippage_pct > tolerance:
            return (
                f"Rate moved {slippage_pct:.1f}% since quote was locked "
                f"(max {tolerance}%). Please request a new quote."
            )
    except Exception as e:
        logger.error(f"Slippage check failed · failing closed: {e}")
        return "Rate verification unavailable · please request a fresh quote."
    return None


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
    throttle_classes = [PaymentRateThrottle]

    def post(self, request):
        serializer = PayBillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        data = serializer.validated_data

        # Verify PIN with lockout tracking
        pin_error = _verify_pin_with_lockout(user, data["pin"])
        if pin_error:
            return pin_error

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

        # B4: hold daily-limit lock past Transaction.create so concurrent
        # callers can't race past the check on stale state.
        try:
            daily_lock = check_daily_limit(user, Decimal(quote["kes_amount"]))
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
            daily_lock.release()
            cache.delete(redis_key)
            return Response(
                {"error": e.reason, "circuit_breaker": True},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Now consume the quote (validation passed)
        quote = RateService.consume_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            daily_lock.release()
            cache.delete(redis_key)
            return Response(
                {"error": "Quote expired or was already used. Please request a new quote."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check rate slippage against live rate
        slippage_err = _check_rate_slippage(quote)
        if slippage_err:
            daily_lock.release()
            cache.delete(redis_key)
            return Response({"error": slippage_err}, status=status.HTTP_409_CONFLICT)

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
            daily_lock.release()
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response(
                {"error": "Duplicate payment detected"},
                status=status.HTTP_409_CONFLICT,
            )
        finally:
            # B4: lock released now that the Transaction exists in the DB ·
            # subsequent concurrent calls will see it in their spent-today sum.
            daily_lock.release()

        # Run the payment saga. B6: referral credit is applied AFTER the
        # saga succeeds so a failed payment never consumes credit.
        try:
            saga = PaymentSaga(tx)
            saga.execute()
        except SagaError as e:
            logger.error(f"Payment saga failed: {e}")
            return Response(
                {"error": "Payment failed. Your funds have been returned.", "transaction": TransactionSerializer(tx).data},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        # B6: only applied on successful saga execution.
        _apply_referral_credit(tx)

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

        # Auto-save paybill for quick reuse (if not already saved)
        try:
            SavedPaybill.objects.get_or_create(
                user=user,
                paybill_number=data["paybill"],
                account_number=data["account"],
                defaults={"last_used_at": timezone.now()},
            )
        except Exception:
            pass  # Non-critical — don't fail the payment response

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
    throttle_classes = [PaymentRateThrottle]

    def post(self, request):
        serializer = PayTillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        data = serializer.validated_data

        pin_error = _verify_pin_with_lockout(user, data["pin"])
        if pin_error:
            return pin_error

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

        # B4: hold daily-limit lock past Transaction.create.
        try:
            daily_lock = check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        try:
            PaymentCircuitBreaker.check_payment_allowed(Decimal(quote["kes_amount"]))
        except PaymentsPaused as e:
            daily_lock.release()
            cache.delete(redis_key)
            return Response(
                {"error": e.reason, "circuit_breaker": True},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        quote = RateService.consume_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            daily_lock.release()
            cache.delete(redis_key)
            return Response({"error": "Quote expired or was already used"}, status=status.HTTP_400_BAD_REQUEST)

        slippage_err = _check_rate_slippage(quote)
        if slippage_err:
            daily_lock.release()
            cache.delete(redis_key)
            return Response({"error": slippage_err}, status=status.HTTP_409_CONFLICT)

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
            daily_lock.release()
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response({"error": "Duplicate payment"}, status=status.HTTP_409_CONFLICT)
        finally:
            daily_lock.release()

        # B6: credit applied AFTER saga success.
        try:
            saga = PaymentSaga(tx)
            saga.execute()
        except SagaError:
            return Response(
                {"error": "Payment failed. Funds returned.", "transaction": TransactionSerializer(tx).data},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        _apply_referral_credit(tx)

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

        pin_error = _verify_pin_with_lockout(user, data["pin"])
        if pin_error:
            return pin_error

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

        # B4: hold daily-limit lock past Transaction.create.
        try:
            daily_lock = check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        try:
            PaymentCircuitBreaker.check_payment_allowed(Decimal(quote["kes_amount"]))
        except PaymentsPaused as e:
            daily_lock.release()
            cache.delete(redis_key)
            return Response(
                {"error": e.reason, "circuit_breaker": True},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        quote = RateService.consume_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            daily_lock.release()
            cache.delete(redis_key)
            return Response({"error": "Quote expired or was already used"}, status=status.HTTP_400_BAD_REQUEST)

        slippage_err = _check_rate_slippage(quote)
        if slippage_err:
            daily_lock.release()
            cache.delete(redis_key)
            return Response({"error": slippage_err}, status=status.HTTP_409_CONFLICT)

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
            daily_lock.release()
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response({"error": "Duplicate payment"}, status=status.HTTP_409_CONFLICT)
        finally:
            daily_lock.release()

        # B6: credit applied AFTER saga success.
        try:
            saga = PaymentSaga(tx)
            saga.execute()
        except SagaError:
            return Response(
                {"error": "Payment failed. Funds returned.", "transaction": TransactionSerializer(tx).data},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        _apply_referral_credit(tx)

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

        pin_error = _verify_pin_with_lockout(user, data["pin"])
        if pin_error:
            return pin_error

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

        # B4: hold daily-limit lock past Transaction.create.
        try:
            daily_lock = check_daily_limit(user, Decimal(quote["kes_amount"]))
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

        quote = RateService.consume_locked_quote(data["quote_id"], user_id=str(user.id))
        if not quote:
            daily_lock.release()
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
            daily_lock.release()
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response({"error": "Duplicate payment"}, status=status.HTTP_409_CONFLICT)
        finally:
            daily_lock.release()

        # Initiate M-Pesa STK Push (via Daraja or SasaPay)
        from apps.mpesa.provider import get_payment_client
        from apps.mpesa.client import MpesaError

        try:
            client = get_payment_client()
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
            try:
                from apps.core.tasks import send_failed_transaction_alert_task
                send_failed_transaction_alert_task.delay(transaction_id=str(tx.id))
            except Exception:
                pass
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
            try:
                from apps.core.tasks import send_failed_transaction_alert_task
                send_failed_transaction_alert_task.delay(transaction_id=str(tx.id))
            except Exception:
                pass
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


class SwapRateThrottle(UserRateThrottle):
    """Limit swap transactions to 10 per hour per user."""
    scope = "swap"
    rate = "10/hour"


class SwapView(APIView):
    """Swap between two crypto currencies in the user's wallet.

    POST /api/v1/payments/swap/
    Body: { from_currency, to_currency, amount, pin }

    Uses the rate engine to derive a cross-rate via KES:
      from_rate = get_crypto_kes_rate(from_currency)
      to_rate   = get_crypto_kes_rate(to_currency)
      cross_rate = from_kes / to_kes

    A 0.5 % swap fee is deducted from the source amount before conversion.
    The operation is fully atomic: lock → debit source → credit dest → record Transaction.
    """

    permission_classes = [IsNotSuspended]
    throttle_classes = [SwapRateThrottle]

    SWAP_FEE_PERCENT = Decimal(str(getattr(app_settings, "SWAP_FEE_PERCENT", 0.5)))

    def post(self, request):
        serializer = SwapSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        data = serializer.validated_data

        # Verify PIN with lockout tracking
        pin_error = _verify_pin_with_lockout(user, data["pin"])
        if pin_error:
            return pin_error

        from_currency = data["from_currency"]
        to_currency = data["to_currency"]
        source_amount = data["amount"]

        # Look up wallets
        try:
            from_wallet = user.wallets.get(currency=from_currency)
        except Exception:
            return Response(
                {"error": f"No {from_currency} wallet found."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            to_wallet = user.wallets.get(currency=to_currency)
        except Exception:
            return Response(
                {"error": f"No {to_currency} wallet found."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get cross-rate via KES intermediary (BEFORE atomic block — read-only)
        from apps.rates.services import RateService

        try:
            from_rate_info = RateService.get_crypto_kes_rate(from_currency)
            to_rate_info = RateService.get_crypto_kes_rate(to_currency)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        from_kes_rate = Decimal(from_rate_info["final_rate"])  # 1 FROM = X KES
        to_kes_rate = Decimal(to_rate_info["final_rate"])      # 1 TO = Y KES

        # cross_rate: how many TO tokens per 1 FROM token
        cross_rate = (from_kes_rate / to_kes_rate).quantize(Decimal("0.00000001"))

        # Calculate fee (deducted from source side)
        fee_amount = (source_amount * self.SWAP_FEE_PERCENT / Decimal("100")).quantize(Decimal("0.00000001"))
        net_source = source_amount - fee_amount  # amount that actually converts

        # Destination amount
        dest_amount = (net_source * cross_rate).quantize(Decimal("0.00000001"))

        if dest_amount <= 0:
            return Response(
                {"error": "Swap amount too small after fees."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ═══════════════════════════════════════════════════════════
        # ATOMIC EXECUTION — all balance checks and mutations inside
        # the atomic block with select_for_update() to prevent races.
        # ═══════════════════════════════════════════════════════════
        from django.db import transaction as db_transaction
        from apps.wallets.services import InsufficientBalanceError, WalletService
        from apps.wallets.models import Wallet

        try:
            with db_transaction.atomic():
                # Lock BOTH wallets inside atomic block (prevents race conditions)
                locked_from = Wallet.objects.select_for_update().get(id=from_wallet.id)
                locked_to = Wallet.objects.select_for_update().get(id=to_wallet.id)

                # Balance check INSIDE lock (prevents concurrent overdraw)
                if locked_from.available_balance < source_amount:
                    return Response(
                        {"error": f"Insufficient {from_currency} balance. "
                                  f"Available: {locked_from.available_balance}"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # B13: idempotency key sourced from the client (UUIDv4 typical).
                # Falls back to a server-generated UUID if the client didn't
                # pass one, so a genuine client bug still produces a unique key.
                import uuid as _uuid_swap
                client_key = (ser.validated_data.get("idempotency_key") or "").strip()
                if not client_key:
                    client_key = str(_uuid_swap.uuid4())
                swap_idem = f"swap-{user.id}-{client_key}"
                # Create the transaction record (for idempotent ledger entries)
                tx = Transaction.objects.create(
                    idempotency_key=swap_idem,
                    user=user,
                    type=Transaction.Type.SWAP,
                    source_currency=from_currency,
                    source_amount=source_amount,
                    dest_currency=to_currency,
                    dest_amount=dest_amount,
                    exchange_rate=cross_rate,
                    # FIX: store fee in source currency (not KES) for correct ledger
                    fee_amount=fee_amount,
                    fee_currency=from_currency,
                    status=Transaction.Status.PROCESSING,
                    ip_address=self._get_client_ip(request),
                    saga_data={
                        "from_kes_rate": str(from_kes_rate),
                        "to_kes_rate": str(to_kes_rate),
                        "cross_rate": str(cross_rate),
                        "fee_percent": str(self.SWAP_FEE_PERCENT),
                        "fee_source_amount": str(fee_amount),
                        "fee_kes": str((fee_amount * from_kes_rate).quantize(Decimal("0.01"))),
                        "net_source_amount": str(net_source),
                    },
                )

                # Debit FULL source amount from user (includes fee)
                WalletService.debit(
                    locked_from.id,
                    source_amount,
                    tx.id,
                    f"Swap {source_amount} {from_currency} → {to_currency}",
                )

                # Credit destination wallet (converted amount, fee excluded)
                WalletService.credit(
                    locked_to.id,
                    dest_amount,
                    tx.id,
                    f"Swap receive {dest_amount} {to_currency} from {from_currency}",
                )

                # Collect swap fee into system/admin wallet
                # The fee was already deducted from user (source_amount = net + fee)
                # Credit it to system wallet for proper accounting
                if fee_amount > 0:
                    try:
                        system_fee_wallet = Wallet.objects.select_for_update().filter(
                            user__is_superuser=True,
                            currency=from_currency,
                        ).first()
                        if system_fee_wallet:
                            system_fee_wallet.balance += fee_amount
                            system_fee_wallet.save(update_fields=["balance"])
                        else:
                            logger.warning(
                                f"No system wallet for {from_currency}. "
                                f"Swap fee {fee_amount} {from_currency} not collected."
                            )
                    except Exception as e:
                        logger.error(f"Swap fee collection failed for tx {tx.id}: {e}")

                # Mark completed
                tx.status = Transaction.Status.COMPLETED
                tx.completed_at = timezone.now()
                tx.save(update_fields=["status", "completed_at", "updated_at"])

        except InsufficientBalanceError:
            return Response(
                {"error": "Insufficient balance. Funds may be locked by another transaction."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Audit log
        AuditLog.objects.create(
            user=user,
            action="SWAP",
            entity_type="transaction",
            entity_id=str(tx.id),
            details={
                "from_currency": from_currency,
                "to_currency": to_currency,
                "source_amount": str(source_amount),
                "dest_amount": str(dest_amount),
                "cross_rate": str(cross_rate),
                "fee_percent": str(self.SWAP_FEE_PERCENT),
            },
            ip_address=self._get_client_ip(request),
        )

        # Send notifications (non-critical)
        try:
            from apps.core.email import send_transaction_notifications
            send_transaction_notifications(user, tx)
        except Exception as e:
            logger.warning(f"Swap notification failed for tx {tx.id}: {e}")

        # Broadcast updated wallet balance via WebSocket
        try:
            from apps.core.broadcast import broadcast_user_balance
            broadcast_user_balance(user.id)
        except Exception as e:
            logger.warning(f"Balance broadcast failed for swap tx {tx.id}: {e}")

        return Response(
            TransactionSerializer(tx).data,
            status=status.HTTP_201_CREATED,
        )

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

        # Check daily limit. Quote generation alone does not commit a
        # transaction, so we release the lock immediately after the check.
        try:
            _dq_lock = check_daily_limit(request.user, kes_amount)
            _dq_lock.release()
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
                    "currency": "USDC",
                    "account_number": f"USDC-{phone}",
                    "description": "Deposit and receive USDC (USD Coin)",
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


class UnifiedActivityView(APIView):
    """Unified activity feed merging Transaction + BlockchainDeposit records.

    GET /api/v1/payments/activity/?type=deposit&status=completed&date_from=2024-01-01&date_to=2024-12-31&page=1
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.blockchain.models import BlockchainDeposit
        from apps.wallets.models import Wallet

        user = request.user
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 20))
        type_filter = request.query_params.get("type", "")
        status_filter = request.query_params.get("status", "")
        date_from = request.query_params.get("date_from", "")
        date_to = request.query_params.get("date_to", "")

        # Clamp page_size
        page_size = min(max(page_size, 1), 50)

        # ── Build Transaction queryset ──
        tx_qs = Transaction.objects.filter(user=user)
        if type_filter:
            type_map = {
                "deposit": ["DEPOSIT", "KES_DEPOSIT", "KES_DEPOSIT_C2B"],
                "paybill": ["PAYBILL_PAYMENT"],
                "till": ["TILL_PAYMENT"],
                "send": ["SEND_MPESA"],
                "buy": ["BUY"],
                "withdrawal": ["WITHDRAWAL"],
                "swap": ["SWAP"],
            }
            allowed_types = type_map.get(type_filter, [type_filter.upper()])
            tx_qs = tx_qs.filter(type__in=allowed_types)
        if status_filter:
            tx_qs = tx_qs.filter(status=status_filter)
        if date_from:
            tx_qs = tx_qs.filter(created_at__date__gte=date_from)
        if date_to:
            tx_qs = tx_qs.filter(created_at__date__lte=date_to)

        # ── Build BlockchainDeposit queryset ──
        user_addresses = list(
            Wallet.objects.filter(user=user, deposit_address__gt="")
            .values_list("deposit_address", flat=True)
        )
        include_blockchain = (
            not type_filter or type_filter in ("deposit", "crypto_deposit", "")
        )

        blockchain_items = []
        if user_addresses and include_blockchain:
            bd_qs = BlockchainDeposit.objects.filter(to_address__in=user_addresses)
            if status_filter:
                # Map unified statuses to BlockchainDeposit statuses
                bd_status_map = {
                    "completed": ["credited", "confirmed"],
                    "confirming": ["confirming", "detecting"],
                    "pending": ["detecting"],
                }
                bd_statuses = bd_status_map.get(status_filter, [status_filter])
                bd_qs = bd_qs.filter(status__in=bd_statuses)
            if date_from:
                bd_qs = bd_qs.filter(created_at__date__gte=date_from)
            if date_to:
                bd_qs = bd_qs.filter(created_at__date__lte=date_to)

            # Get KES rates for conversion
            from django.core.cache import cache as django_cache

            for bd in bd_qs:
                # Map BD status to unified status
                status_map = {
                    "detecting": "pending",
                    "confirming": "confirming",
                    "confirmed": "confirming",
                    "credited": "completed",
                }
                unified_status = status_map.get(bd.status, bd.status)

                # Calculate KES equivalent
                kes_equivalent = "0"
                usd_rate = django_cache.get(f"rate:crypto:{bd.currency}:usd")
                usd_kes = django_cache.get("rate:forex:usd:kes")
                if usd_rate and usd_kes:
                    from decimal import Decimal as D
                    kes_val = bd.amount * D(str(usd_rate)) * D(str(usd_kes))
                    kes_equivalent = str(kes_val.quantize(D("0.01")))

                blockchain_items.append({
                    "id": f"bd-{bd.id}",
                    "type": "CRYPTO_DEPOSIT",
                    "status": unified_status,
                    "source_currency": bd.currency,
                    "source_amount": str(bd.amount),
                    "dest_currency": "KES",
                    "dest_amount": kes_equivalent,
                    "exchange_rate": None,
                    "fee_amount": "0",
                    "fee_currency": "",
                    "excise_duty_amount": "0",
                    "mpesa_paybill": "",
                    "mpesa_till": "",
                    "mpesa_account": "",
                    "mpesa_phone": "",
                    "mpesa_receipt": "",
                    "chain": bd.chain,
                    "tx_hash": bd.tx_hash,
                    "confirmations": bd.confirmations,
                    "required_confirmations": bd.required_confirmations,
                    "block_number": bd.block_number,
                    "from_address": bd.from_address,
                    "to_address": bd.to_address,
                    "destination_address": "",
                    "failure_reason": "",
                    "created_at": bd.created_at.isoformat(),
                    "completed_at": bd.credited_at.isoformat() if bd.credited_at else None,
                })

        # ── Serialize Transaction records ──
        tx_items = []
        for tx in tx_qs:
            tx_items.append({
                "id": str(tx.id),
                "type": tx.type,
                "status": tx.status,
                "source_currency": tx.source_currency,
                "source_amount": str(tx.source_amount) if tx.source_amount else "0",
                "dest_currency": tx.dest_currency,
                "dest_amount": str(tx.dest_amount) if tx.dest_amount else "0",
                "exchange_rate": str(tx.exchange_rate) if tx.exchange_rate else None,
                "fee_amount": str(tx.fee_amount),
                "fee_currency": tx.fee_currency,
                "excise_duty_amount": str(tx.excise_duty_amount),
                "mpesa_paybill": tx.mpesa_paybill,
                "mpesa_till": tx.mpesa_till,
                "mpesa_account": tx.mpesa_account,
                "mpesa_phone": tx.mpesa_phone,
                "mpesa_receipt": tx.mpesa_receipt,
                "chain": tx.chain,
                "tx_hash": tx.tx_hash,
                "confirmations": tx.confirmations,
                "required_confirmations": 0,
                "block_number": None,
                "from_address": "",
                "to_address": "",
                "destination_address": tx.saga_data.get("destination_address", "") if tx.saga_data else "",
                "failure_reason": tx.failure_reason,
                "created_at": tx.created_at.isoformat(),
                "completed_at": tx.completed_at.isoformat() if tx.completed_at else None,
            })

        # ── Merge and sort by created_at descending ──
        all_items = tx_items + blockchain_items
        all_items.sort(key=lambda x: x["created_at"], reverse=True)

        # ── Paginate ──
        total = len(all_items)
        start = (page - 1) * page_size
        end = start + page_size
        page_items = all_items[start:end]

        return Response({
            "count": total,
            "page": page,
            "page_size": page_size,
            "results": page_items,
        })


_RECEIPT_SIGNER_SALT = "cpay-receipt-url"
_RECEIPT_SIG_MAX_AGE_SEC = 60  # one-shot link valid for 60 seconds


def _sign_receipt_url(user_id: str, transaction_id: str) -> str:
    """B18: returns an HMAC-signed, timestamped, single-use path suffix for
    this (user, tx) pair. The signature is validated by the view's
    `initial()` hook so the JWT access token never has to ride in the URL."""
    from django.core.signing import TimestampSigner
    signer = TimestampSigner(salt=_RECEIPT_SIGNER_SALT)
    return signer.sign(f"{user_id}:{transaction_id}")


class TransactionReceiptSignView(APIView):
    """B18: mint a short-lived signed URL for downloading a receipt.
    Native + web clients POST here (authenticated), then open/share the
    returned URL. The URL contains no bearer token."""

    permission_classes = [IsAuthenticated]

    def post(self, request, transaction_id):
        try:
            tx = Transaction.objects.get(id=transaction_id, user=request.user)
        except Transaction.DoesNotExist:
            return Response(
                {"error": "Transaction not found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        sig = _sign_receipt_url(str(request.user.id), str(tx.id))
        return Response({
            "url": f"/api/v1/payments/{tx.id}/receipt/?sig={sig}",
            "expires_in_seconds": _RECEIPT_SIG_MAX_AGE_SEC,
        })


class TransactionReceiptView(APIView):
    """Download PDF receipt for a completed transaction.

    Primary auth: Authorization header (native apps).
    Alternative:  ?sig=<HMAC> (from TransactionReceiptSignView). The
    signature encodes (user_id, tx_id) and expires in 60 seconds. We
    no longer accept a bearer token via ?token= because the token ends up
    in access logs, referrers, and browser history.
    """

    permission_classes = [IsAuthenticated]

    def get_authenticators(self):
        authenticators = super().get_authenticators()
        return authenticators

    def initial(self, request, *args, **kwargs):
        """B18: validate a receipt signature from the query string. If valid,
        set request.user to the owner encoded in the signature · this
        bypasses the bearer-token requirement for this specific tx only."""
        from django.core.signing import TimestampSigner, BadSignature, SignatureExpired
        sig = request.query_params.get("sig")
        if sig:
            try:
                signer = TimestampSigner(salt=_RECEIPT_SIGNER_SALT)
                payload = signer.unsign(sig, max_age=_RECEIPT_SIG_MAX_AGE_SEC)
                user_id, tx_id = payload.split(":", 1)
                requested_tx = str(kwargs.get("transaction_id", ""))
                if tx_id == requested_tx:
                    from apps.accounts.models import User
                    try:
                        request.user = User.objects.get(pk=user_id)
                    except User.DoesNotExist:
                        pass
            except (BadSignature, SignatureExpired, ValueError, Exception):
                # Fall through to normal auth; unsigned requests still need a Bearer token.
                pass
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
            # If send_email param is set, email the PDF to the user
            send_email = request.query_params.get("send_email") == "true"
            if send_email and request.user.email:
                try:
                    from django.core.mail import EmailMessage

                    email = EmailMessage(
                        subject=f"CryptoPay Receipt — {tx.type.replace('_', ' ').title()} ({str(tx.id)[:8].upper()})",
                        body=f"Hi {request.user.full_name or 'there'},\n\nPlease find your transaction receipt attached.\n\nTransaction: {tx.type.replace('_', ' ').title()}\nDate: {tx.created_at.strftime('%d %B %Y, %H:%M')}\nRef: {str(tx.id)[:8].upper()}\n\nThank you for using CryptoPay.\n\n— CryptoPay Team",
                        from_email=None,  # uses DEFAULT_FROM_EMAIL
                        to=[request.user.email],
                    )
                    email.attach_file(receipt_path, "application/pdf")
                    email.send(fail_silently=False)
                    return Response({"message": f"Receipt sent to {request.user.email}"})
                except Exception as e:
                    logger.warning(f"Failed to email receipt: {e}")
                    return Response(
                        {"error": "Could not send receipt email. Try again."},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )

            response = FileResponse(
                open(receipt_path, "rb"),
                content_type="application/pdf",
                as_attachment=True,
                filename=receipt_filename,
            )
            # Ensure CORS headers are present (FileResponse may bypass middleware)
            origin = request.META.get("HTTP_ORIGIN", "")
            if origin:
                from django.conf import settings as _cors_settings
                allowed = getattr(_cors_settings, "CORS_ALLOWED_ORIGINS", [])
                if origin in allowed or getattr(_cors_settings, "CORS_ALLOW_ALL_ORIGINS", False):
                    response["Access-Control-Allow-Origin"] = origin
                    response["Access-Control-Allow-Credentials"] = "true"
            return response

        return Response(
            {"error": "Receipt generation failed. Please try again."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


class WithdrawView(APIView):
    """Withdraw crypto to an external blockchain address."""

    permission_classes = [IsNotSuspended]
    throttle_classes = [PaymentRateThrottle]

    def post(self, request):
        serializer = WithdrawSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        data = serializer.validated_data

        # Verify PIN with lockout tracking
        pin_error = _verify_pin_with_lockout(user, data["pin"])
        if pin_error:
            return pin_error

        # Check idempotency — Layer 2 (Redis)
        idem_key = data["idempotency_key"]
        redis_key = f"withdrawal:{idem_key}"
        if not cache.add(redis_key, "processing", timeout=300):
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(
                    TransactionSerializer(existing).data,
                    status=status.HTTP_200_OK,
                )
            return Response(
                {"error": "Withdrawal already in progress"},
                status=status.HTTP_409_CONFLICT,
            )

        # Calculate network fee
        network_fees = getattr(app_settings, "WITHDRAWAL_NETWORK_FEES", {
            "tron": {"USDT": "1.00"},
            "ethereum": {"USDT": "5.00", "USDC": "5.00", "ETH": "0.003"},
            "polygon": {"USDT": "0.50", "USDC": "0.50"},
            "bitcoin": {"BTC": "0.00005"},
            "solana": {"SOL": "0.01"},
        })
        fee_str = network_fees.get(data["network"], {}).get(data["currency"], "0")
        fee_amount = Decimal(fee_str)
        total_deduct = data["amount"] + fee_amount

        # Check sufficient balance
        try:
            wallet = user.wallets.get(currency=data["currency"])
        except Exception:
            cache.delete(redis_key)
            return Response(
                {"error": f"No {data['currency']} wallet found."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if wallet.available_balance < total_deduct:
            cache.delete(redis_key)
            return Response(
                {"error": f"Insufficient balance. Available: {wallet.available_balance}, "
                          f"required: {data['amount']} + {fee_amount} fee = {total_deduct}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check daily transaction limit. B4: hold the lock through tx create
        # on the happy path; release in every early-return / exception branch.
        wd_daily_lock = None
        try:
            from apps.rates.services import RateService
            rate_info = RateService.get_crypto_kes_rate(data["currency"])
            kes_estimate = data["amount"] * Decimal(str(rate_info["final_rate"]))
            wd_daily_lock = check_daily_limit(user, kes_estimate)
        except DailyLimitExceededError as e:
            cache.delete(redis_key)
            return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except Exception as e:
            logger.warning(f"Daily limit check skipped for withdrawal (rate fetch failed): {e}")

        # Create the transaction — Layer 3 (PostgreSQL unique constraint)
        try:
            tx = Transaction.objects.create(
                idempotency_key=idem_key,
                user=user,
                type=Transaction.Type.WITHDRAWAL,
                source_currency=data["currency"],
                source_amount=data["amount"],
                dest_currency=data["currency"],
                dest_amount=data["amount"],
                fee_amount=fee_amount,
                fee_currency=data["currency"],
                chain=data["network"],
                ip_address=self._get_client_ip(request),
                saga_data={
                    "destination_address": data["destination_address"],
                    "network": data["network"],
                },
            )
        except IntegrityError:
            if wd_daily_lock:
                wd_daily_lock.release()
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(TransactionSerializer(existing).data)
            return Response(
                {"error": "Duplicate withdrawal detected"},
                status=status.HTTP_409_CONFLICT,
            )
        finally:
            if wd_daily_lock:
                wd_daily_lock.release()

        # Lock funds (amount + fee) in the wallet
        from apps.wallets.services import InsufficientBalanceError, WalletService

        try:
            WalletService.lock_funds(wallet.id, total_deduct)
            tx.saga_data["locked_wallet_id"] = str(wallet.id)
            tx.saga_data["locked_amount"] = str(total_deduct)
            tx.status = Transaction.Status.PROCESSING
            tx.save(update_fields=["saga_data", "status", "updated_at"])
        except InsufficientBalanceError:
            tx.status = Transaction.Status.FAILED
            tx.failure_reason = "Insufficient balance to lock funds"
            tx.save(update_fields=["status", "failure_reason", "updated_at"])
            cache.delete(redis_key)
            return Response(
                {"error": "Insufficient balance. Funds may be locked by another transaction."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Queue blockchain broadcast via Celery
        from apps.blockchain.tasks import broadcast_withdrawal_task

        broadcast_withdrawal_task.delay(str(tx.id))

        AuditLog.objects.create(
            user=user,
            action="WITHDRAWAL",
            entity_type="transaction",
            entity_id=str(tx.id),
            details={
                "currency": data["currency"],
                "amount": str(data["amount"]),
                "network": data["network"],
                "destination_address": data["destination_address"][:20] + "...",
                "fee": str(fee_amount),
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


class WithdrawStatusView(APIView):
    """Check withdrawal status, tx_hash, and confirmations."""

    permission_classes = [IsAuthenticated]

    def get(self, request, transaction_id):
        try:
            tx = Transaction.objects.get(
                id=transaction_id,
                user=request.user,
                type=Transaction.Type.WITHDRAWAL,
            )
        except Transaction.DoesNotExist:
            return Response(
                {"error": "Withdrawal not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = TransactionSerializer(tx).data

        # Add human-readable summary
        if tx.status == Transaction.Status.COMPLETED:
            data["summary"] = f"Sent {tx.source_amount} {tx.source_currency} to {tx.saga_data.get('destination_address', 'external address')[:16]}..."
        elif tx.status == Transaction.Status.PROCESSING:
            data["summary"] = "Broadcasting transaction to the blockchain..."
        elif tx.status == Transaction.Status.CONFIRMING:
            data["summary"] = f"Waiting for confirmations ({tx.confirmations})..."
        elif tx.status == Transaction.Status.FAILED:
            data["summary"] = tx.failure_reason or "Withdrawal failed"

        return Response(data)


class WithdrawFeeView(APIView):
    """Get estimated withdrawal network fee for a currency+network."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        currency = request.query_params.get("currency", "USDT")
        network = request.query_params.get("network", "tron")

        network_fees = getattr(app_settings, "WITHDRAWAL_NETWORK_FEES", {
            "tron": {"USDT": "1.00"},
            "ethereum": {"USDT": "5.00", "USDC": "5.00", "ETH": "0.003"},
            "polygon": {"USDT": "0.50", "USDC": "0.50"},
            "bitcoin": {"BTC": "0.00005"},
            "solana": {"SOL": "0.01"},
        })

        min_amounts = getattr(app_settings, "MINIMUM_WITHDRAWAL_AMOUNTS", {
            "USDT": "2.00",
            "USDC": "2.00",
            "BTC": "0.0001",
            "ETH": "0.005",
            "SOL": "0.1",
        })

        fee = network_fees.get(network, {}).get(currency, "0")
        min_amount = min_amounts.get(currency, "0")

        return Response({
            "currency": currency,
            "network": network,
            "fee": fee,
            "fee_currency": currency,
            "minimum_amount": min_amount,
        })


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


# ═══════════════════════════════════════════════════════════════════════════════
# Transaction CSV Export
# ═══════════════════════════════════════════════════════════════════════════════


class ExportRateThrottle(UserRateThrottle):
    """Limit CSV exports to 5 per hour per user."""
    scope = "export"
    rate = "5/hour"


class TransactionExportView(APIView):
    """Export user transactions as a CSV file.

    GET /api/v1/payments/transactions/export/?date_from=2025-01-01&date_to=2025-12-31&type=paybill
    Max 1000 rows per export.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExportRateThrottle]

    def get(self, request):
        user = request.user
        date_from = request.query_params.get("date_from", "")
        date_to = request.query_params.get("date_to", "")
        type_filter = request.query_params.get("type", "")

        qs = Transaction.objects.filter(user=user)

        if type_filter:
            type_map = {
                "deposit": ["DEPOSIT", "KES_DEPOSIT", "KES_DEPOSIT_C2B"],
                "paybill": ["PAYBILL_PAYMENT"],
                "till": ["TILL_PAYMENT"],
                "send": ["SEND_MPESA"],
                "buy": ["BUY"],
                "withdrawal": ["WITHDRAWAL"],
                "swap": ["SWAP"],
            }
            allowed_types = type_map.get(type_filter, [type_filter.upper()])
            qs = qs.filter(type__in=allowed_types)
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        qs = qs.order_by("-created_at")[:1000]

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Date",
            "Type",
            "Status",
            "From Currency",
            "From Amount",
            "To Currency",
            "To Amount",
            "Rate",
            "Fee",
            "M-Pesa Receipt",
            "Reference",
        ])

        type_labels = {
            "PAYBILL_PAYMENT": "Pay Bill",
            "TILL_PAYMENT": "Buy Goods",
            "SEND_MPESA": "Send M-Pesa",
            "DEPOSIT": "Deposit",
            "KES_DEPOSIT": "KES Deposit",
            "KES_DEPOSIT_C2B": "KES Deposit (C2B)",
            "WITHDRAWAL": "Withdrawal",
            "BUY": "Buy Crypto",
            "SELL": "Sell Crypto",
            "FEE": "Fee",
            "SWAP": "Swap",
            "INTERNAL_TRANSFER": "Internal Transfer",
        }

        for tx in qs:
            reference = tx.mpesa_paybill or tx.mpesa_till or tx.mpesa_phone or tx.tx_hash or ""
            writer.writerow([
                tx.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                type_labels.get(tx.type, tx.type),
                tx.status.capitalize(),
                tx.source_currency,
                str(tx.source_amount or "0"),
                tx.dest_currency,
                str(tx.dest_amount or "0"),
                str(tx.exchange_rate or ""),
                str(tx.fee_amount),
                tx.mpesa_receipt,
                reference,
            ])

        response = HttpResponse(
            output.getvalue(),
            content_type="text/csv",
        )
        response["Content-Disposition"] = 'attachment; filename="cryptopay_transactions.csv"'

        # Ensure CORS headers are present for web downloads
        origin = request.META.get("HTTP_ORIGIN", "")
        if origin:
            from django.conf import settings as _cors_settings
            allowed = getattr(_cors_settings, "CORS_ALLOWED_ORIGINS", [])
            if origin in allowed or getattr(_cors_settings, "CORS_ALLOW_ALL_ORIGINS", False):
                response["Access-Control-Allow-Origin"] = origin
                response["Access-Control-Allow-Credentials"] = "true"

        return response


# ═══════════════════════════════════════════════════════════════════════════════
# Saved Paybills
# ═══════════════════════════════════════════════════════════════════════════════


class SavedPaybillListCreateView(APIView):
    """
    GET  — List user's saved paybills.
    POST — Save a new paybill.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        paybills = SavedPaybill.objects.filter(user=request.user)
        serializer = SavedPaybillSerializer(paybills, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = SavedPaybillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Check if already saved
        existing = SavedPaybill.objects.filter(
            user=request.user,
            paybill_number=serializer.validated_data["paybill_number"],
            account_number=serializer.validated_data["account_number"],
        ).first()

        if existing:
            # Update label and last_used_at if already exists
            if serializer.validated_data.get("label"):
                existing.label = serializer.validated_data["label"]
            existing.last_used_at = timezone.now()
            existing.save(update_fields=["label", "last_used_at"])
            return Response(SavedPaybillSerializer(existing).data, status=status.HTTP_200_OK)

        saved = SavedPaybill.objects.create(
            user=request.user,
            **serializer.validated_data,
        )
        return Response(SavedPaybillSerializer(saved).data, status=status.HTTP_201_CREATED)


class SavedPaybillDeleteView(APIView):
    """DELETE — Remove a saved paybill."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            paybill = SavedPaybill.objects.get(id=pk, user=request.user)
        except SavedPaybill.DoesNotExist:
            return Response({"error": "Saved paybill not found."}, status=status.HTTP_404_NOT_FOUND)

        paybill.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
