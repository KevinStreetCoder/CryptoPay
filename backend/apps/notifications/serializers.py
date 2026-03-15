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
