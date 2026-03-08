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
    """Get historical exchange rate data for charts."""

    permission_classes = [AllowAny]

    VALID_CURRENCIES = {"USDT", "BTC", "ETH", "SOL"}
    PERIOD_CONFIG = {
        "1d": {"days": 1, "aggregate": None},
        "7d": {"days": 7, "aggregate": "hour"},
        "30d": {"days": 30, "aggregate": "6hour"},
        "90d": {"days": 90, "aggregate": "day"},
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

        if period not in self.PERIOD_CONFIG:
            return Response(
                {"error": f"Invalid period. Must be one of: {', '.join(self.PERIOD_CONFIG.keys())}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        config = self.PERIOD_CONFIG[period]
        since = timezone.now() - timedelta(days=config["days"])

        qs = ExchangeRate.objects.filter(
            pair__startswith=f"{currency}/",
            created_at__gte=since,
        )

        aggregate = config["aggregate"]

        if aggregate is None:
            # 1d: return every record
            data = list(
                qs.order_by("created_at").values_list("created_at", "rate")
            )
            result = [
                {"timestamp": ts.isoformat(), "rate": str(rate)}
                for ts, rate in data
            ]
        elif aggregate == "hour":
            # 7d: hourly averages
            data = (
                qs.annotate(bucket=TruncHour("created_at"))
                .values("bucket")
                .annotate(avg_rate=Avg("rate"))
                .order_by("bucket")
            )
            result = [
                {"timestamp": row["bucket"].isoformat(), "rate": str(round(row["avg_rate"], 8))}
                for row in data
            ]
        elif aggregate == "6hour":
            # 30d: 6-hour averages using raw SQL bucketing for Postgres
            data = (
                qs.extra(
                    select={
                        "bucket": "date_trunc('hour', created_at) - "
                                  "interval '1 hour' * (extract(hour from created_at)::int %% 6)"
                    }
                )
                .values("bucket")
                .annotate(avg_rate=Avg("rate"))
                .order_by("bucket")
            )
            result = [
                {"timestamp": row["bucket"].isoformat(), "rate": str(round(row["avg_rate"], 8))}
                for row in data
            ]
        elif aggregate == "day":
            # 90d: daily averages
            data = (
                qs.annotate(bucket=TruncDay("created_at"))
                .values("bucket")
                .annotate(avg_rate=Avg("rate"))
                .order_by("bucket")
            )
            result = [
                {"timestamp": row["bucket"].isoformat(), "rate": str(round(row["avg_rate"], 8))}
                for row in data
            ]
        else:
            result = []

        return Response({"currency": currency, "period": period, "data": result})
