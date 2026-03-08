from decimal import Decimal, InvalidOperation

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import RateService


class RateView(APIView):
    """Get current crypto/KES rate."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        currency = request.query_params.get("currency", "USDT").upper()
        try:
            rate_info = RateService.get_crypto_kes_rate(currency)
            return Response(rate_info)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response(
                {"error": "Rate unavailable. Please try again."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )


class QuoteView(APIView):
    """Lock a rate and get a payment quote."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        currency = request.data.get("currency", "USDT").upper()
        kes_amount = request.data.get("kes_amount")

        if not kes_amount:
            return Response({"error": "kes_amount is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            kes_amount = Decimal(str(kes_amount))
            if kes_amount <= 0:
                raise InvalidOperation
        except (InvalidOperation, TypeError):
            return Response({"error": "Invalid kes_amount"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            quote = RateService.lock_rate(currency, kes_amount)
            return Response(quote)
        except Exception:
            return Response(
                {"error": "Unable to generate quote. Please try again."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
