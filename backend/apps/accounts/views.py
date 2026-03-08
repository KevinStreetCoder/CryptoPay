import logging
import random

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from apps.wallets.services import WalletService

from .models import AuditLog, Device, User
from .serializers import (
    DeviceModelSerializer,
    DeviceSerializer,
    GoogleLoginSerializer,
    LoginSerializer,
    RegisterSerializer,
    RequestOTPSerializer,
    UserSerializer,
)
from .social_auth import GoogleAuthError, verify_google_token

logger = logging.getLogger(__name__)


class RequestOTPView(APIView):
    """Send a 6-digit OTP to the user's phone via Africa's Talking SMS."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RequestOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        phone = serializer.validated_data["phone"]

        # Rate limit: max 3 OTP requests per phone per 10 minutes
        rate_key = f"otp_rate:{phone}"
        attempts = cache.get(rate_key, 0)
        if attempts >= 3:
            return Response(
                {"error": "Too many OTP requests. Wait 10 minutes."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Generate 6-digit OTP
        otp = f"{random.randint(100000, 999999)}"
        cache.set(f"otp:{phone}", otp, timeout=300)  # Valid for 5 minutes
        cache.set(rate_key, attempts + 1, timeout=600)

        # Send via Africa's Talking
        if settings.AT_API_KEY:
            try:
                import africastalking

                africastalking.initialize(settings.AT_USERNAME, settings.AT_API_KEY)
                sms = africastalking.SMS
                sms.send(
                    f"Your CryptoPay verification code is: {otp}",
                    [phone],
                    sender_id=settings.AT_SENDER_ID,
                )
            except Exception as e:
                logger.error(f"SMS send failed: {e}")
                # In sandbox/dev, log the OTP
                if settings.DEBUG:
                    logger.info(f"OTP for {phone}: {otp}")
        else:
            # Dev mode — log OTP to console
            logger.info(f"[DEV] OTP for {phone}: {otp}")

        return Response({"message": "OTP sent successfully"})


class RegisterView(APIView):
    """Register a new user with phone + PIN + OTP verification."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        phone = serializer.validated_data["phone"]
        pin = serializer.validated_data["pin"]
        otp = serializer.validated_data["otp"]

        # Verify OTP
        stored_otp = cache.get(f"otp:{phone}")
        if not stored_otp or stored_otp != otp:
            return Response(
                {"error": "Invalid or expired OTP"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create user
        user = User.objects.create_user(phone=phone, pin=pin)
        cache.delete(f"otp:{phone}")

        # Create default wallets
        WalletService.create_user_wallets(user)

        # Generate JWT tokens
        refresh = RefreshToken.for_user(user)

        AuditLog.objects.create(
            user=user,
            action="REGISTER",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=self._get_client_ip(request),
        )

        return Response(
            {
                "user": UserSerializer(user).data,
                "tokens": {
                    "refresh": str(refresh),
                    "access": str(refresh.access_token),
                },
            },
            status=status.HTTP_201_CREATED,
        )

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class LoginView(APIView):
    """Authenticate with phone + PIN."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        phone = serializer.validated_data["phone"]
        pin = serializer.validated_data["pin"]

        try:
            user = User.objects.get(phone=phone)
        except User.DoesNotExist:
            return Response(
                {"error": "Invalid credentials"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Check if PIN is locked
        if user.pin_locked_until and user.pin_locked_until > timezone.now():
            return Response(
                {"error": "Account temporarily locked. Try again later."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not user.check_pin(pin):
            user.pin_attempts += 1

            # Progressive lockout: 5 attempts → 1min, 10 → 5min, 15 → 1hr
            lockout_thresholds = {5: 60, 10: 300, 15: 3600}
            lockout_seconds = lockout_thresholds.get(user.pin_attempts)
            if lockout_seconds:
                from datetime import timedelta
                user.pin_locked_until = timezone.now() + timedelta(seconds=lockout_seconds)

            user.save(update_fields=["pin_attempts", "pin_locked_until"])

            AuditLog.objects.create(
                user=user,
                action="LOGIN_FAILED",
                details={"attempts": user.pin_attempts},
                ip_address=self._get_client_ip(request),
            )

            return Response(
                {"error": "Invalid credentials"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not user.is_active:
            return Response(
                {"error": "Account deactivated"},
                status=status.HTTP_403_FORBIDDEN,
            )

        if user.is_suspended:
            return Response(
                {"error": "Account suspended. Contact support."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Reset PIN attempts on successful login
        user.pin_attempts = 0
        user.pin_locked_until = None
        user.save(update_fields=["pin_attempts", "pin_locked_until"])

        refresh = RefreshToken.for_user(user)

        AuditLog.objects.create(
            user=user,
            action="LOGIN",
            ip_address=self._get_client_ip(request),
        )

        return Response({
            "user": UserSerializer(user).data,
            "tokens": {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
            },
        })

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class ProfileView(APIView):
    """Get current user profile."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


def _register_device(user, device_data: dict, ip_address: str) -> tuple[Device, bool]:
    """
    Register or update a device for a user.
    Returns (device, is_new) — caller should require OTP if is_new is True.
    """
    device, created = Device.objects.update_or_create(
        user=user,
        device_id=device_data.get("device_id", ""),
        defaults={
            "device_name": device_data.get("device_name", ""),
            "platform": device_data.get("platform", ""),
            "os_version": device_data.get("os_version", ""),
        },
    )
    if created:
        AuditLog.objects.create(
            user=user,
            action="NEW_DEVICE",
            entity_type="device",
            entity_id=str(device.id),
            details=device_data,
            ip_address=ip_address,
        )
    return device, created


class GoogleLoginView(APIView):
    """
    Authenticate via Google OAuth.
    Mobile client sends the Google idToken; backend verifies, creates/finds user, returns JWT.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = GoogleLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            google_info = verify_google_token(serializer.validated_data["id_token"])
        except GoogleAuthError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        email = google_info["email"]

        # Find or create user
        user = User.objects.filter(email=email).first()
        created = False
        if not user:
            user = User.objects.create_user(
                phone="",  # Google users may not have a phone yet
                email=email,
            )
            # Create default wallets
            WalletService.create_user_wallets(user)
            created = True

        if not user.is_active:
            return Response(
                {"error": "Account deactivated"},
                status=status.HTTP_403_FORBIDDEN,
            )

        if user.is_suspended:
            return Response(
                {"error": "Account suspended. Contact support."},
                status=status.HTTP_403_FORBIDDEN,
            )

        refresh = RefreshToken.for_user(user)

        AuditLog.objects.create(
            user=user,
            action="GOOGLE_LOGIN" if not created else "GOOGLE_REGISTER",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=self._get_client_ip(request),
        )

        return Response(
            {
                "user": UserSerializer(user).data,
                "tokens": {
                    "refresh": str(refresh),
                    "access": str(refresh.access_token),
                },
                "created": created,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class DeviceListView(APIView):
    """List and manage the authenticated user's registered devices."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        devices = Device.objects.filter(user=request.user).order_by("-last_seen")
        return Response(DeviceModelSerializer(devices, many=True).data)

    def delete(self, request):
        """Remove a device by device_id (passed as query param)."""
        device_id = request.query_params.get("device_id")
        if not device_id:
            return Response(
                {"error": "device_id query parameter required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        deleted, _ = Device.objects.filter(user=request.user, device_id=device_id).delete()
        if not deleted:
            return Response(
                {"error": "Device not found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"message": "Device removed"}, status=status.HTTP_200_OK)
