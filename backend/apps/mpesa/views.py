"""
M-Pesa Daraja callback endpoints.

These receive async results from Safaricom after STK Push, B2C, B2B operations.
They must be publicly accessible HTTPS endpoints.
"""

import logging

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.payments.models import Transaction

from .models import MpesaCallback

logger = logging.getLogger(__name__)


class STKCallbackView(APIView):
    """Handle STK Push (Lipa Na M-Pesa) callbacks — user buying crypto."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
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

    def post(self, request):
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

    def post(self, request):
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


class TimeoutCallbackView(APIView):
    """Generic timeout handler for any M-Pesa queue timeout."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        logger.warning(f"M-Pesa timeout callback: {request.data}")
        MpesaCallback.objects.create(
            result_code=-1,
            result_desc="Queue timeout",
            raw_payload=request.data,
        )
        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)
