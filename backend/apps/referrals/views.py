"""
Referrals REST API views.
"""
from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .constants import (
    is_enabled,
    referee_bonus_kes,
    referrer_bonus_kes,
    referrer_lifetime_cap,
    referrer_monthly_cap,
)
from .models import Referral, ReferralCode, ReferralEvent, RewardLedger
from .serializers import (
    AdminReferralSerializer,
    PublicReferrerSerializer,
    ReferralHistoryItemSerializer,
    ShareEventSerializer,
    ValidateCodeSerializer,
)


def _base_share_url() -> str:
    return getattr(settings, "REFERRAL_BASE_URL", "https://cpay.co.ke")


def _share_message_en(code: str) -> str:
    return (
        f"I pay M-Pesa bills directly from my crypto with Cpay. Use my "
        f"code {code} on signup to get KES {referee_bonus_kes():.0f} off "
        f"your first payment: {_base_share_url()}/r/{code}"
    )


def _share_message_sw(code: str) -> str:
    return (
        f"Ninatumia Cpay kulipa M-Pesa kupitia crypto. Jisajili na code "
        f"yangu {code} upate KES {referee_bonus_kes():.0f} bila malipo "
        f"kwa malipo yako ya kwanza: {_base_share_url()}/r/{code}"
    )


class MyReferralView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_enabled():
            return Response(
                {"detail": "Referral program temporarily disabled."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        rc = ReferralCode.get_or_create_for_user(request.user)

        total_earned = RewardLedger.total_earned_for(request.user)
        available = RewardLedger.available_credit_for(request.user)
        pending = RewardLedger.pending_credit_for(request.user)

        invited_sent = rc.total_invites_sent
        signed_up_count = Referral.objects.filter(referrer=request.user).count()
        qualified_count = Referral.objects.filter(
            referrer=request.user,
            status__in=[Referral.Status.QUALIFIED, Referral.Status.REWARDED],
        ).count()

        # Can this user invite more? Gated by monthly + lifetime cap.
        now_month_count = Referral.objects.filter(
            referrer=request.user,
            status=Referral.Status.REWARDED,
            rewarded_at__month__gte=1,  # crude proxy; kept simple
        ).count()
        lifetime_rewarded = Referral.objects.filter(
            referrer=request.user, status=Referral.Status.REWARDED
        ).count()
        can_invite_more = (
            now_month_count < referrer_monthly_cap()
            and lifetime_rewarded < referrer_lifetime_cap()
        )

        return Response({
            "code": rc.code,
            "share_url": f"{_base_share_url()}/r/{rc.code}",
            "share_message_en": _share_message_en(rc.code),
            "share_message_sw": _share_message_sw(rc.code),
            "totals": {
                "invited_sent": invited_sent,
                "signed_up": signed_up_count,
                "qualified": qualified_count,
                "total_earned_kes": str(total_earned),
                "available_credit_kes": str(available),
                "pending_credit_kes": str(pending),
            },
            "bonus_per_referral_kes": str(referrer_bonus_kes()),
            "referee_bonus_kes": str(referee_bonus_kes()),
            "can_invite_more": can_invite_more,
        })


class ReferralHistoryPagination(PageNumberPagination):
    page_size = 20
    max_page_size = 50


class ReferralHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = (
            Referral.objects.filter(referrer=request.user)
            .select_related("referee")
            .order_by("-attributed_at")
        )
        paginator = ReferralHistoryPagination()
        page = paginator.paginate_queryset(qs, request)
        serializer = ReferralHistoryItemSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class ShareEventView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = ShareEventSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        rc, _ = ReferralCode.objects.get_or_create(user=request.user, defaults={"code": ""})
        if not rc.code:
            rc.code = ReferralCode.get_or_create_for_user(request.user).code
            rc.save(update_fields=["code"])
        rc.total_invites_sent = rc.total_invites_sent + 1
        rc.save(update_fields=["total_invites_sent"])
        ReferralEvent.objects.create(
            event_type=ReferralEvent.EventType.CODE_SHARED,
            user=request.user,
            payload={"channel": ser.validated_data["channel"]},
        )
        return Response({"ok": True})


class ValidateCodeView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ser = ValidateCodeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        code = ser.validated_data["code"].strip().upper()
        try:
            rc = ReferralCode.objects.select_related("user").get(
                code__iexact=code, is_active=True
            )
        except ReferralCode.DoesNotExist:
            return Response({"valid": False}, status=status.HTTP_404_NOT_FOUND)
        first_name = getattr(rc.user, "full_name", "").split(" ")[0] if rc.user.full_name else "A friend"
        return Response({
            "valid": True,
            "referrer_first_name": first_name,
            "reward_preview_kes": str(referee_bonus_kes()),
        })


class PublicReferrerLandingThrottle(AnonRateThrottle):
    rate = "30/minute"


class PublicReferrerLandingView(APIView):
    """GET /r/{code}/public/ — served for the share-preview page.
    Aggressively cached + rate-limited since it's unauthenticated."""

    permission_classes = [AllowAny]
    throttle_classes = [PublicReferrerLandingThrottle]

    def get(self, request, code: str):
        code = code.strip().upper()
        cache_key = f"referral_public:{code}"
        cached = cache.get(cache_key)
        if cached:
            return Response(cached)
        try:
            rc = ReferralCode.objects.select_related("user").get(
                code__iexact=code, is_active=True
            )
        except ReferralCode.DoesNotExist:
            return Response(
                {"is_valid": False},
                status=status.HTTP_404_NOT_FOUND,
            )
        first_name = (
            getattr(rc.user, "full_name", "").split(" ")[0]
            if rc.user.full_name
            else "A friend"
        )
        payload = {
            "is_valid": True,
            "first_name": first_name,
            "reward_preview_kes": str(referee_bonus_kes()),
        }
        cache.set(cache_key, payload, timeout=300)  # 5 min
        # Log the view (fire-and-forget).
        try:
            ReferralEvent.objects.create(
                event_type=ReferralEvent.EventType.LINK_CLICKED,
                user=rc.user,
                payload={"code": code},
                ip_address=request.META.get("REMOTE_ADDR"),
                user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
            )
        except Exception:
            pass
        return Response(payload)


class AdminReferralListView(APIView):
    """Admin-only. Flat list with filtering by status."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        qs = Referral.objects.select_related("referrer", "referee").order_by("-attributed_at")
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        paginator = ReferralHistoryPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(AdminReferralSerializer(page, many=True).data)


class AdminClawbackView(APIView):
    permission_classes = [IsAdminUser]

    def post(self, request, referral_id: str):
        reason = request.data.get("reason", "admin_clawback")
        from . import tasks
        tasks.claw_back_reward.delay(referral_id, reason=reason)
        return Response({"ok": True, "queued": True})
