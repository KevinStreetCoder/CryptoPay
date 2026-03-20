from rest_framework import serializers

from .models import RateAlert


class RateAlertSerializer(serializers.ModelSerializer):
    """Serializer for rate alerts."""

    class Meta:
        model = RateAlert
        fields = (
            "id", "currency", "target_rate", "direction", "is_active",
            "triggered_at", "trigger_count", "last_triggered_at",
            "expires_at", "cooldown_minutes", "created_at",
        )
        read_only_fields = ("id", "is_active", "triggered_at", "trigger_count", "last_triggered_at", "created_at")

    def validate_target_rate(self, value):
        if value <= 0:
            raise serializers.ValidationError("Target rate must be positive.")
        return value

    def validate(self, data):
        user = self.context["request"].user
        # Limit active alerts per user to prevent abuse
        active_count = RateAlert.objects.filter(user=user, is_active=True).count()
        if active_count >= 20:
            raise serializers.ValidationError("Maximum of 20 active rate alerts allowed.")
        return data
