from rest_framework import serializers

from .models import RateAlert


class RateAlertSerializer(serializers.ModelSerializer):
    """Serializer for rate alerts — supports create and update."""

    class Meta:
        model = RateAlert
        fields = (
            "id", "currency", "target_rate", "direction", "is_active",
            "triggered_at", "trigger_count", "last_triggered_at",
            "expires_at", "cooldown_minutes",
            "schedule_type", "schedule_hour", "schedule_day", "last_scheduled_at",
            "created_at",
        )
        read_only_fields = (
            "id", "is_active", "triggered_at", "trigger_count", "last_triggered_at",
            "last_scheduled_at", "created_at",
        )

    def validate_target_rate(self, value):
        if value <= 0:
            raise serializers.ValidationError("Target rate must be positive.")
        return value

    def validate_schedule_hour(self, value):
        if value is not None and (value < 0 or value > 23):
            raise serializers.ValidationError("Hour must be 0-23.")
        return value

    def validate_schedule_day(self, value):
        if value is not None and (value < 0 or value > 31):
            raise serializers.ValidationError("Day must be 0-31.")
        return value

    def validate(self, data):
        request = self.context.get("request")
        if not request:
            return data

        user = request.user

        # For creation only: check active alert limit
        if self.instance is None:
            active_count = RateAlert.objects.filter(user=user, is_active=True).count()
            if active_count >= 20:
                raise serializers.ValidationError("Maximum of 20 active rate alerts allowed.")

        # Validate schedule fields
        schedule_type = data.get("schedule_type", getattr(self.instance, "schedule_type", ""))
        if schedule_type == "weekly":
            day = data.get("schedule_day", getattr(self.instance, "schedule_day", None))
            if day is None or day > 6:
                raise serializers.ValidationError("Weekly alerts need schedule_day 0-6 (Mon-Sun).")
        elif schedule_type == "monthly":
            day = data.get("schedule_day", getattr(self.instance, "schedule_day", None))
            if day is None or day < 1 or day > 28:
                raise serializers.ValidationError("Monthly alerts need schedule_day 1-28.")

        return data
