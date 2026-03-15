from rest_framework import serializers

from .models import AdminNotification, UserNotification


class BroadcastSerializer(serializers.Serializer):
    """Validate admin broadcast request."""

    title = serializers.CharField(max_length=200)
    body = serializers.CharField()
    category = serializers.ChoiceField(
        choices=AdminNotification.Category.choices,
        default="update",
    )
    priority = serializers.ChoiceField(
        choices=AdminNotification.Priority.choices,
        default="normal",
    )
    channels = serializers.ListField(
        child=serializers.ChoiceField(choices=["email", "sms", "in_app", "push"]),
        default=["in_app"],
    )
    target = serializers.ChoiceField(
        choices=["all", "kyc_verified", "kyc_pending", "specific"],
        default="all",
    )
    target_user_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
    )


class AdminNotificationSerializer(serializers.ModelSerializer):
    """Read-only serializer for admin notification metadata."""

    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AdminNotification
        fields = [
            "id",
            "title",
            "body",
            "category",
            "priority",
            "channels",
            "target",
            "recipient_count",
            "created_by_name",
            "created_at",
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.full_name or obj.created_by.phone
        return "System"


class AdminNotificationDetailSerializer(serializers.ModelSerializer):
    """Read-only serializer with delivery/read stats for admin list."""

    created_by_name = serializers.SerializerMethodField()
    total_recipients = serializers.IntegerField(read_only=True)
    read_count = serializers.IntegerField(read_only=True)
    read_percentage = serializers.SerializerMethodField()
    channel_breakdown = serializers.SerializerMethodField()

    class Meta:
        model = AdminNotification
        fields = [
            "id",
            "title",
            "body",
            "category",
            "priority",
            "channels",
            "target",
            "recipient_count",
            "total_recipients",
            "read_count",
            "read_percentage",
            "channel_breakdown",
            "created_by_name",
            "created_at",
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.full_name or obj.created_by.phone
        return "System"

    def get_read_percentage(self, obj):
        total = getattr(obj, "total_recipients", 0) or 0
        read = getattr(obj, "read_count", 0) or 0
        if total == 0:
            return 0
        return round(read / total * 100, 1)

    def get_channel_breakdown(self, obj):
        """Return channel counts from the channels JSON field + recipient_count."""
        channels = obj.channels or []
        # Approximate: recipient_count is the total users targeted.
        # Each channel in the list was sent to roughly that many users.
        count = obj.recipient_count or 0
        return {ch: count for ch in channels}


class UserNotificationSerializer(serializers.ModelSerializer):
    """Serializer for user-facing notification list."""

    title = serializers.CharField(source="notification.title", read_only=True)
    body = serializers.CharField(source="notification.body", read_only=True)
    category = serializers.CharField(source="notification.category", read_only=True)
    priority = serializers.CharField(source="notification.priority", read_only=True)

    class Meta:
        model = UserNotification
        fields = [
            "id",
            "title",
            "body",
            "category",
            "priority",
            "read",
            "read_at",
            "delivered_via",
            "created_at",
        ]
