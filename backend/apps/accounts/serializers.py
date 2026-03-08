import re

from rest_framework import serializers

from .models import User


class RegisterSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=15)
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    otp = serializers.CharField(max_length=6, write_only=True)

    def validate_phone(self, value):
        # Normalize Kenyan phone: 07XX → +2547XX
        value = value.strip().replace(" ", "")
        if value.startswith("0"):
            value = "+254" + value[1:]
        elif value.startswith("254"):
            value = "+" + value
        elif not value.startswith("+"):
            value = "+254" + value

        if not re.match(r"^\+254[17]\d{8}$", value):
            raise serializers.ValidationError("Invalid Kenyan phone number")

        if User.objects.filter(phone=value).exists():
            raise serializers.ValidationError("Phone number already registered")

        return value

    def validate_pin(self, value):
        if not value.isdigit():
            raise serializers.ValidationError("PIN must be 6 digits")
        return value


class LoginSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=15)
    pin = serializers.CharField(max_length=6, write_only=True)

    def validate_phone(self, value):
        value = value.strip().replace(" ", "")
        if value.startswith("0"):
            value = "+254" + value[1:]
        elif value.startswith("254"):
            value = "+" + value
        elif not value.startswith("+"):
            value = "+254" + value
        return value


class RequestOTPSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=15)

    def validate_phone(self, value):
        value = value.strip().replace(" ", "")
        if value.startswith("0"):
            value = "+254" + value[1:]
        elif value.startswith("254"):
            value = "+" + value
        elif not value.startswith("+"):
            value = "+254" + value
        return value


class GoogleLoginSerializer(serializers.Serializer):
    """Google OAuth login — receives the idToken from the mobile client."""

    id_token = serializers.CharField()


class DeviceSerializer(serializers.Serializer):
    """Device info submitted on login / registration."""

    device_id = serializers.CharField(max_length=255)
    device_name = serializers.CharField(max_length=255, required=False, default="")
    platform = serializers.CharField(max_length=50, required=False, default="")
    os_version = serializers.CharField(max_length=50, required=False, default="")


class DeviceModelSerializer(serializers.ModelSerializer):
    """Read-only serializer for the Device model."""

    class Meta:
        from .models import Device

        model = Device
        fields = (
            "id", "device_id", "device_name", "platform",
            "os_version", "is_trusted", "last_seen", "created_at",
        )
        read_only_fields = fields


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "phone", "email", "kyc_tier", "kyc_status", "created_at")
        read_only_fields = fields
