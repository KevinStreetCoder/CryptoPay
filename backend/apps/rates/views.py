from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db.models import Avg
from django.db.models.functions import TruncDay, TruncHour
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ExchangeRate
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


class RateHistoryView(APIView):
    """Get real historical market price data for charts.
    Fetches actual market prices from CoinGecko/CryptoCompare,
    not our internal exchange rates. Heavily cached."""

    permission_classes = [AllowAny]

    VALID_CURRENCIES = {"USDC", "USDT", "BTC", "ETH", "SOL"}
    PERIOD_DAYS = {
        "1d": 1,
        "7d": 7,
        "30d": 30,
        "90d": 90,
    }

    def get(self, request):
        currency = request.query_params.get("currency", "").upper()
        period = request.query_params.get("period", "7d")

        if not currency:
            return Response(
                {"error": "currency parameter is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if currency not in self.VALID_CURRENCIES:
            return Response(
                {"error": f"Invalid currency. Must be one of: {', '.join(sorted(self.VALID_CURRENCIES))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if period not in self.PERIOD_DAYS:
            return Response(
                {"error": f"Invalid period. Must be one of: {', '.join(self.PERIOD_DAYS.keys())}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        days = self.PERIOD_DAYS[period]

        try:
            data = RateService.get_market_chart(currency, days)
        except Exception:
            data = []

        # If external APIs failed, fall back to our internal rate history
        if not data:
            since = timezone.now() - timedelta(days=days)
            qs = ExchangeRate.objects.filter(
                pair=f"{currency}/USD",
                created_at__gte=since,
            ).order_by("created_at")

            if days <= 7:
                qs_data = qs.annotate(bucket=TruncHour("created_at")).values("bucket").annotate(avg_rate=Avg("rate")).order_by("bucket")
                data = [{"timestamp": row["bucket"].isoformat(), "rate": float(row["avg_rate"])} for row in qs_data]
            else:
                qs_data = qs.annotate(bucket=TruncDay("created_at")).values("bucket").annotate(avg_rate=Avg("rate")).order_by("bucket")
                data = [{"timestamp": row["bucket"].isoformat(), "rate": float(row["avg_rate"])} for row in qs_data]

        return Response({"currency": currency, "period": period, "data": data})
