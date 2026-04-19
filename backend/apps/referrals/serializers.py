"""
DRF serializers for the referrals API.
"""
from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers

from .models import Referral, ReferralCode, RewardLedger


def _mask_phone(phone: str) -> str:
    """+254712345678 -> +254•••••678"""
    if not phone:
        return ""
    if len(phone) < 6:
        return phone
    return phone[:4] + "•" * (len(phone) - 7) + phone[-3:]


def _mask_name(name: str) -> str:
    """'Kevin Kariuki' -> 'K••••n K.'"""
    if not name:
        return "User"
    parts = name.split()
    first = parts[0]
    masked_first = first[0] + "•" * max(0, len(first) - 2) + first[-1] if len(first) > 2 else first[0] + "•"
    last_initial = parts[-1][0] + "." if len(parts) > 1 else ""
    return f"{masked_first} {last_initial}".strip()


class MyReferralSerializer(serializers.Serializer):
    code = serializers.CharField()
    share_url = serializers.CharField()
    share_message_en = serializers.CharField()
    share_message_sw = serializers.CharField()
    totals = serializers.DictField()
    can_invite_more = serializers.BooleanField()


class ReferralHistoryItemSerializer(serializers.ModelSerializer):
    referee_display = serializers.SerializerMethodField()
    reward_kes = serializers.SerializerMethodField()

    class Meta:
        model = Referral
        fields = [
            "id",
            "referee_display",
            "status",
            "attributed_at",
            "qualified_at",
            "rewarded_at",
            "reward_kes",
        ]
        read_only_fields = fields

    def get_referee_display(self, obj) -> str:
        name = getattr(obj.referee, "full_name", "") or ""
        phone = getattr(obj.referee, "phone", "") or ""
        if name:
            return _mask_name(name)
        return _mask_phone(phone)

    def get_reward_kes(self, obj) -> str:
        # Sum of positive ledger rows tied to this referral for the
        # referrer specifically.
        from django.db.models import Sum
        agg = RewardLedger.objects.filter(
            referral=obj, user=obj.referrer, amount_kes__gt=0
        ).aggregate(total=Sum("amount_kes"))
        return str(agg["total"] or Decimal("0.00"))


class PublicReferrerSerializer(serializers.Serializer):
    """Info shown on the public /r/{code} landing page.

    Deliberately narrow — no phone, no email, just first name +
    avatar. Anonymised enough that the public URL can't be used to
    enumerate the user base."""

    first_name = serializers.CharField()
    reward_preview_kes = serializers.CharField()
    is_valid = serializers.BooleanField()


class ShareEventSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=["whatsapp", "sms", "copy_link", "native_share", "email"])


class ValidateCodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=8)


class AdminReferralSerializer(serializers.ModelSerializer):
    referrer_phone = serializers.CharField(source="referrer.phone", read_only=True)
    referee_phone = serializers.CharField(source="referee.phone", read_only=True)

    class Meta:
        model = Referral
        fields = [
            "id",
            "referrer_id",
            "referrer_phone",
            "referee_id",
            "referee_phone",
            "code_used",
            "status",
            "signup_ip",
            "signup_device_id",
            "signup_country",
            "attributed_at",
            "qualified_at",
            "rewarded_at",
            "fraud_reason",
        ]
        read_only_fields = fields
