import re

from rest_framework import serializers

from .models import User


class RegisterSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=15)
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    otp = serializers.CharField(max_length=6, write_only=True)
    full_name = serializers.CharField(max_length=150, required=False, default="")

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
    otp = serializers.CharField(max_length=6, required=False, write_only=True)
    totp_code = serializers.CharField(max_length=10, required=False, write_only=True)
    device_id = serializers.CharField(max_length=255, required=False, default="")
    device_name = serializers.CharField(max_length=255, required=False, default="")
    platform = serializers.CharField(max_length=50, required=False, default="")

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
            "os_version", "ip_address", "is_trusted", "last_seen", "created_at",
        )
        read_only_fields = fields


class ChangePINSerializer(serializers.Serializer):
    current_pin = serializers.CharField(max_length=6, write_only=True)
    new_pin = serializers.CharField(min_length=6, max_length=6, write_only=True)

    def validate_new_pin(self, value):
        if not value.isdigit():
            raise serializers.ValidationError("PIN must be 6 digits")
        return value


class KYCDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        from .models import KYCDocument

        model = KYCDocument
        fields = ("id", "document_type", "file_url", "status", "rejection_reason", "created_at")
        read_only_fields = ("id", "status", "rejection_reason", "created_at")


class KYCUploadSerializer(serializers.Serializer):
    document_type = serializers.ChoiceField(choices=[
        ("national_id", "National ID"),
        ("passport", "Passport"),
        ("selfie", "Selfie"),
        ("kra_pin", "KRA PIN"),
        ("proof_of_address", "Proof of Address"),
    ])
    # Accept either a direct file upload or a pre-signed URL
    file = serializers.FileField(required=False)
    file_url = serializers.URLField(max_length=500, required=False)

    def validate_file(self, value):
        if value:
            max_size = 10 * 1024 * 1024  # 10 MB
            if value.size > max_size:
                raise serializers.ValidationError("File must be under 10MB")
            allowed = ("image/jpeg", "image/png", "image/webp", "application/pdf")
            if value.content_type not in allowed:
                raise serializers.ValidationError(
                    "Allowed formats: JPEG, PNG, WebP, PDF"
                )
        return value

    def validate(self, data):
        if not data.get("file") and not data.get("file_url"):
            raise serializers.ValidationError(
                "Either 'file' or 'file_url' is required."
            )
        return data


class PushTokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)
    platform = serializers.ChoiceField(choices=[("ios", "iOS"), ("android", "Android")])


class UserSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id", "phone", "email", "full_name", "avatar_url",
            "kyc_tier", "kyc_status", "email_verified", "totp_enabled",
            "created_at",
        )
        read_only_fields = fields

    def get_avatar_url(self, obj):
        if obj.avatar:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.avatar.url)
            return obj.avatar.url
        return None


class ProfileUpdateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(required=False, allow_blank=True)

    def validate_email(self, value):
        if not value:
            return value
        user = self.context.get("user")
        if User.objects.filter(email=value).exclude(id=user.id).exists():
            raise serializers.ValidationError("Email already in use")
        return value


class EmailVerifySerializer(serializers.Serializer):
    """Verify email with token or 6-char code."""
    token = serializers.CharField(max_length=64)


class SetupTOTPSerializer(serializers.Serializer):
    """Verify initial TOTP code during setup."""
    code = serializers.CharField(max_length=10)


class VerifyTOTPSerializer(serializers.Serializer):
    """Verify TOTP code for login."""
    code = serializers.CharField(max_length=10)


class RecoveryEmailSerializer(serializers.Serializer):
    """Set recovery email and/or phone."""
    recovery_email = serializers.EmailField(required=False)
    recovery_phone = serializers.CharField(max_length=15, required=False, default="")
