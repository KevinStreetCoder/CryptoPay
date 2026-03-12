"""
M-Pesa Daraja callback endpoints.

These receive async results from Safaricom after STK Push, B2C, B2B operations.
They must be publicly accessible HTTPS endpoints.

Security: IP whitelist (middleware) + per-transaction HMAC tokens (URL path) +
replay prevention (one-time token consumption via Redis).
"""

import logging
from decimal import Decimal

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.payments.models import Transaction

from .middleware import verify_callback_token
from .models import MpesaCallback

logger = logging.getLogger(__name__)


def _verify_token_if_present(kwargs: dict) -> bool:
    """
    Verify the callback token from the URL path if present.

    If no token in the URL (static path), allow through — IP whitelist
    is the primary defense for static paths.
    If token is present, verify and consume it (one-time use).
    """
    token = kwargs.get("token")
    if not token:
        return True  # Static callback path — IP whitelist handles security

    is_valid, tx_id = verify_callback_token(token)
    if not is_valid:
        logger.warning(f"Invalid/expired callback token: {token[:16]}...")
    return is_valid


class STKCallbackView(APIView):
    """Handle STK Push (Lipa Na M-Pesa) callbacks — user buying crypto."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        # Verify token if present in URL
        if token and not _verify_token_if_present({"token": token}):
            return Response(
                {"ResultCode": 1, "ResultDesc": "Invalid token"},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data
        logger.info(f"STK callback received: {payload}")

        body = payload.get("Body", {}).get("stkCallback", {})
        merchant_request_id = body.get("MerchantRequestID", "")
        checkout_request_id = body.get("CheckoutRequestID", "")
        result_code = body.get("ResultCode")
        result_desc = body.get("ResultDesc", "")

        # Extract callback metadata
        mpesa_receipt = ""
        amount = None
        phone = ""

        if result_code == 0 and body.get("CallbackMetadata"):
            items = body["CallbackMetadata"].get("Item", [])
            for item in items:
                name = item.get("Name", "")
                value = item.get("Value")
                if name == "MpesaReceiptNumber":
                    mpesa_receipt = str(value)
                elif name == "Amount":
                    amount = value
                elif name == "PhoneNumber":
                    phone = str(value)

        # Save callback record
        callback = MpesaCallback.objects.create(
            merchant_request_id=merchant_request_id,
            checkout_request_id=checkout_request_id,
            result_code=result_code,
            result_desc=result_desc,
            mpesa_receipt=mpesa_receipt,
            phone=phone,
            amount=amount,
            raw_payload=payload,
        )

        # Link to transaction and update status
        tx = Transaction.objects.filter(
            saga_data__mpesa_checkout_request_id=checkout_request_id,
        ).first()

        if tx:
            callback.transaction = tx
            callback.save(update_fields=["transaction"])

            if result_code == 0:
                tx.mpesa_receipt = mpesa_receipt
                tx.status = Transaction.Status.COMPLETED
                tx.completed_at = timezone.now()
                tx.save(update_fields=["mpesa_receipt", "status", "completed_at", "updated_at"])
            else:
                tx.failure_reason = result_desc
                tx.status = Transaction.Status.FAILED
                tx.save(update_fields=["failure_reason", "status", "updated_at"])

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)


class B2BCallbackView(APIView):
    """Handle B2B (Paybill/Till payment) callbacks — core crypto-to-bill flow."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        if token and not _verify_token_if_present({"token": token}):
            return Response(
                {"ResultCode": 1, "ResultDesc": "Invalid token"},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data
        logger.info(f"B2B callback received: {payload}")

        result = payload.get("Result", {})
        result_code = result.get("ResultCode")
        result_desc = result.get("ResultDesc", "")
        conversation_id = result.get("ConversationID", "")
        originator_id = result.get("OriginatorConversationID", "")

        # Extract receipt from result parameters
        mpesa_receipt = ""
        if result_code == 0 and result.get("ResultParameters"):
            params = result["ResultParameters"].get("ResultParameter", [])
            for param in params:
                if param.get("Key") == "TransactionReceipt":
                    mpesa_receipt = str(param.get("Value", ""))

        callback = MpesaCallback.objects.create(
            result_code=result_code,
            result_desc=result_desc,
            mpesa_receipt=mpesa_receipt,
            raw_payload=payload,
        )

        # Find the transaction by conversation ID stored in saga_data
        tx = Transaction.objects.filter(
            saga_data__mpesa_conversation_id=conversation_id,
        ).first() or Transaction.objects.filter(
            saga_data__mpesa_originator_id=originator_id,
        ).first()

        if tx:
            callback.transaction = tx
            callback.save(update_fields=["transaction"])

            if result_code == 0:
                from apps.payments.saga import PaymentSaga
                saga = PaymentSaga(tx)
                saga.complete(mpesa_receipt)
            else:
                tx.failure_reason = result_desc
                tx.status = Transaction.Status.FAILED
                tx.save(update_fields=["failure_reason", "status", "updated_at"])
                # Trigger compensation
                from apps.payments.saga import PaymentSaga
                saga = PaymentSaga(tx)
                saga.compensate_convert()

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)


class B2CCallbackView(APIView):
    """Handle B2C callbacks — user selling crypto, receiving M-Pesa."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        if token and not _verify_token_if_present({"token": token}):
            return Response(
                {"ResultCode": 1, "ResultDesc": "Invalid token"},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data
        logger.info(f"B2C callback received: {payload}")

        result = payload.get("Result", {})
        result_code = result.get("ResultCode")
        result_desc = result.get("ResultDesc", "")
        conversation_id = result.get("ConversationID", "")

        mpesa_receipt = ""
        if result_code == 0 and result.get("ResultParameters"):
            params = result["ResultParameters"].get("ResultParameter", [])
            for param in params:
                if param.get("Key") == "TransactionReceipt":
                    mpesa_receipt = str(param.get("Value", ""))

        MpesaCallback.objects.create(
            result_code=result_code,
            result_desc=result_desc,
            mpesa_receipt=mpesa_receipt,
            raw_payload=payload,
        )

        tx = Transaction.objects.filter(
            saga_data__mpesa_conversation_id=conversation_id,
        ).first()

        if tx:
            if result_code == 0:
                tx.mpesa_receipt = mpesa_receipt
                tx.status = Transaction.Status.COMPLETED
                tx.completed_at = timezone.now()
            else:
                tx.failure_reason = result_desc
                tx.status = Transaction.Status.FAILED
            tx.save(update_fields=["mpesa_receipt", "failure_reason", "status", "completed_at", "updated_at"])

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)


class BalanceCallbackView(APIView):
    """
    Handle M-Pesa Account Balance API callback.

    Parses the balance from the M-Pesa response and updates the payment
    circuit breaker state. The balance result contains a multi-line string
    like: "Working Account|KES|2000000.00|2000000.00|0.00|0.00"
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        logger.info(f"Balance callback received: {request.data}")

        MpesaCallback.objects.create(
            result_code=0,
            result_desc="Balance callback",
            raw_payload=request.data,
        )

        try:
            result = request.data.get("Result", {})
            result_code = result.get("ResultCode", -1)

            if result_code != 0:
                logger.error(f"Balance query failed: {result.get('ResultDesc', 'Unknown')}")
                return Response({"ResultCode": 0, "ResultDesc": "Accepted"})

            # Parse balance from ResultParameters
            params = result.get("ResultParameters", {}).get("ResultParameter", [])
            balance_str = None
            for param in params:
                if param.get("Key") == "AccountBalance":
                    balance_str = param.get("Value", "")
                    break

            if balance_str:
                # Format: "Working Account|KES|available|actual|reserved|uncleared"
                # Can have multiple accounts separated by "&"
                total_available = Decimal("0")
                for account in balance_str.split("&"):
                    parts = account.split("|")
                    if len(parts) >= 3 and parts[1].strip() == "KES":
                        try:
                            total_available += Decimal(parts[2].strip())
                        except Exception:
                            pass

                if total_available > 0:
                    # Feed into circuit breaker via async task
                    from .tasks import process_balance_result

                    process_balance_result.delay(str(total_available))
                    logger.info(f"M-Pesa float balance: KES {total_available:,.0f}")
                else:
                    logger.warning(f"Could not parse balance from: {balance_str}")
            else:
                logger.warning("No AccountBalance parameter in balance callback")

        except Exception as e:
            logger.error(f"Error processing balance callback: {e}")

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)


class TimeoutCallbackView(APIView):
    """Generic timeout handler for any M-Pesa queue timeout."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        logger.warning(f"M-Pesa timeout callback: {request.data}")
        MpesaCallback.objects.create(
            result_code=-1,
            result_desc="Queue timeout",
            raw_payload=request.data,
        )
        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)
