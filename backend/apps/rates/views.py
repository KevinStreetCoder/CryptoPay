import logging
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db.models import Avg
from django.db.models.functions import TruncDay, TruncHour
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ExchangeRate, RateAlert
from .serializers import RateAlertSerializer
from .services import RateService

logger = logging.getLogger(__name__)


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
        except Exception as e:
            logger.warning(f"Rate fetch failed for {currency}: {e}", exc_info=True)
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
            user_id = str(request.user.id) if request.user.is_authenticated else ""
            quote = RateService.lock_rate(currency, kes_amount, user_id=user_id)
            return Response(quote)
        except Exception as e:
            logger.warning(f"Quote generation failed for {currency}/{kes_amount}: {e}", exc_info=True)
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
        except Exception as e:
            logger.warning(f"Market chart fetch failed for {currency}/{period}: {e}", exc_info=True)
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


# ═══════════════════════════════════════════════════════════════════════════════
# Rate Alerts
# ═══════════════════════════════════════════════════════════════════════════════


class RateAlertListCreateView(APIView):
    """
    GET  — List user's rate alerts.
    POST — Create a new rate alert.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        alerts = RateAlert.objects.filter(user=request.user)
        serializer = RateAlertSerializer(alerts, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = RateAlertSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        alert = RateAlert.objects.create(
            user=request.user,
            **serializer.validated_data,
        )
        return Response(RateAlertSerializer(alert).data, status=status.HTTP_201_CREATED)


class RateAlertDetailView(APIView):
    """
    PATCH  — Edit an alert (target_rate, direction, duration, cooldown, schedule).
    DELETE — Remove a rate alert.
    POST   — Reactivate a triggered/expired alert with updated settings.
    """

    permission_classes = [IsAuthenticated]

    def _get_alert(self, request, pk):
        try:
            return RateAlert.objects.get(id=pk, user=request.user)
        except RateAlert.DoesNotExist:
            return None

    def patch(self, request, pk):
        alert = self._get_alert(request, pk)
        if not alert:
            return Response({"error": "Alert not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = RateAlertSerializer(alert, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(RateAlertSerializer(alert).data)

    def post(self, request, pk):
        """Reactivate a triggered or expired alert — optionally update settings."""
        alert = self._get_alert(request, pk)
        if not alert:
            return Response({"error": "Alert not found."}, status=status.HTTP_404_NOT_FOUND)

        # Apply any updated fields
        updatable = ["target_rate", "direction", "expires_at", "cooldown_minutes",
                     "schedule_type", "schedule_hour", "schedule_day"]
        for field in updatable:
            if field in request.data:
                setattr(alert, field, request.data[field])

        # Reactivate
        alert.is_active = True
        alert.triggered_at = None
        alert.last_triggered_at = None
        alert.trigger_count = 0
        alert.last_scheduled_at = None

        # Reset expiry if new duration provided
        if "expires_at" in request.data and request.data["expires_at"]:
            alert.expires_at = request.data["expires_at"]
        elif "expires_at" in request.data and not request.data["expires_at"]:
            alert.expires_at = None  # forever

        alert.save()
        return Response(RateAlertSerializer(alert).data)

    def delete(self, request, pk):
        alert = self._get_alert(request, pk)
        if not alert:
            return Response({"error": "Alert not found."}, status=status.HTTP_404_NOT_FOUND)

        alert.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
