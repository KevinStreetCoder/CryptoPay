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
    """
    Per-invite row shown in `Settings → Refer → Invite history` on mobile.

    Field naming contract (pinned 2026-04-23 — do NOT rename without
    sweeping `mobile/app/settings/referrals.tsx` first):
      - `referee_masked_name` / `referee_masked_phone` — mobile reads
        either in priority order to render the row label.
      - `status` — raw enum value ("rewarded" etc.)
      - `status_display` — human-readable label shown under the name.
      - `reward_amount_kes` — decimal string, mobile parses with
        `parseFloat().toFixed(0)` to print `+KES 50`.

    Legacy fields (`referee_display`, `reward_kes`) are kept as aliases
    so older mobile builds keep working during the rollout window.
    """
    referee_masked_name = serializers.SerializerMethodField()
    referee_masked_phone = serializers.SerializerMethodField()
    referee_display = serializers.SerializerMethodField()  # legacy alias
    status_display = serializers.SerializerMethodField()
    reward_amount_kes = serializers.SerializerMethodField()
    reward_kes = serializers.SerializerMethodField()  # legacy alias

    class Meta:
        model = Referral
        fields = [
            "id",
            "referee_masked_name",
            "referee_masked_phone",
            "referee_display",
            "status",
            "status_display",
            "attributed_at",
            "qualified_at",
            "rewarded_at",
            "reward_amount_kes",
            "reward_kes",
        ]
        read_only_fields = fields

    # ── Referee identity (masked) ───────────────────────────────────
    def get_referee_masked_name(self, obj) -> str:
        name = getattr(obj.referee, "full_name", "") or ""
        return _mask_name(name) if name else ""

    def get_referee_masked_phone(self, obj) -> str:
        phone = getattr(obj.referee, "phone", "") or ""
        return _mask_phone(phone) if phone else ""

    def get_referee_display(self, obj) -> str:
        """Legacy combined field — prefer masked_name, fall back to phone."""
        return self.get_referee_masked_name(obj) or self.get_referee_masked_phone(obj)

    # ── Status ──────────────────────────────────────────────────────
    _STATUS_LABELS = {
        "pending": "Joined · hasn't paid a bill yet",
        "qualified": "Paid their first bill · reward processing",
        "rewarded": "Reward paid",
        "rejected": "Rejected (flagged as suspicious)",
        "expired": "Expired (60-day attribution window passed)",
    }

    def get_status_display(self, obj) -> str:
        return self._STATUS_LABELS.get(obj.status, obj.status.replace("_", " ").title())

    # ── Reward amount ───────────────────────────────────────────────
    def _reward_total(self, obj) -> Decimal:
        """Sum of positive ledger rows tied to this referral for the
        referrer specifically."""
        from django.db.models import Sum
        agg = RewardLedger.objects.filter(
            referral=obj, user=obj.referrer, amount_kes__gt=0
        ).aggregate(total=Sum("amount_kes"))
        return agg["total"] or Decimal("0.00")

    def get_reward_amount_kes(self, obj) -> str:
        return str(self._reward_total(obj))

    def get_reward_kes(self, obj) -> str:  # legacy alias
        return self.get_reward_amount_kes(obj)


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
