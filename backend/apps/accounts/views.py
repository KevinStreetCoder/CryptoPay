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

from .models import AuditLog, Device, EmailVerificationToken, KYCDocument, PushToken, User
from rest_framework.parsers import MultiPartParser, FormParser

from .serializers import (
    ChangePINSerializer,
    DeviceModelSerializer,
    DeviceSerializer,
    EmailVerifySerializer,
    GoogleLoginSerializer,
    KYCDocumentSerializer,
    KYCUploadSerializer,
    LoginSerializer,
    ProfileUpdateSerializer,
    PushTokenSerializer,
    RecoveryEmailSerializer,
    RegisterSerializer,
    RequestOTPSerializer,
    SetupTOTPSerializer,
    UserSerializer,
    VerifyTOTPSerializer,
)
from .social_auth import GoogleAuthError, verify_google_token
from .totp import (
    generate_backup_codes,
    generate_totp_secret,
    get_totp_uri,
    hash_backup_codes,
    verify_backup_code,
    verify_totp,
)

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

        # In DEBUG mode, include OTP in response for easy development testing
        response_data = {"message": "OTP sent successfully"}
        if settings.DEBUG:
            response_data["dev_otp"] = otp
        return Response(response_data)


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

        full_name = serializer.validated_data.get("full_name", "")

        # Create user
        user = User.objects.create_user(phone=phone, pin=pin, full_name=full_name)
        cache.delete(f"otp:{phone}")

        # Create default wallets
        WalletService.create_user_wallets(user)

        # Register device if provided
        device_id = request.data.get("device_id", "")
        device_name = request.data.get("device_name", "")
        platform = request.data.get("platform", "")
        if device_id:
            Device.objects.update_or_create(
                user=user,
                device_id=device_id,
                defaults={
                    "device_name": device_name,
                    "platform": platform,
                    "is_trusted": True,
                    "ip_address": self._get_client_ip(request),
                },
            )

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
    """Authenticate with phone + PIN. Requires OTP after 3 consecutive wrong PINs."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        phone = serializer.validated_data["phone"]
        pin = serializer.validated_data["pin"]
        otp = serializer.validated_data.get("otp")

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

        # OTP challenge required after 3 wrong PINs
        if user.otp_challenge_required:
            if not otp:
                return Response(
                    {
                        "error": "OTP verification required",
                        "otp_required": True,
                        "message": "Too many failed attempts. Enter the OTP sent to your phone.",
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            # Verify the OTP
            stored_otp = cache.get(f"otp:{phone}")
            if not stored_otp or stored_otp != otp:
                return Response(
                    {"error": "Invalid or expired OTP", "otp_required": True},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # OTP verified — clear the challenge flag
            cache.delete(f"otp:{phone}")

        if not user.check_pin(pin):
            user.pin_attempts += 1

            # After 3 failed attempts, require OTP challenge
            if user.pin_attempts >= 3 and not user.otp_challenge_required:
                user.otp_challenge_required = True
                # Auto-send OTP for the challenge
                self._send_otp_challenge(phone)

            # Progressive lockout: 5 attempts → 1min, 10 → 5min, 15 → 1hr
            lockout_thresholds = {5: 60, 10: 300, 15: 3600}
            lockout_seconds = lockout_thresholds.get(user.pin_attempts)
            if lockout_seconds:
                from datetime import timedelta
                user.pin_locked_until = timezone.now() + timedelta(seconds=lockout_seconds)

            user.save(update_fields=["pin_attempts", "pin_locked_until", "otp_challenge_required"])

            AuditLog.objects.create(
                user=user,
                action="LOGIN_FAILED",
                details={"attempts": user.pin_attempts, "otp_challenge": user.otp_challenge_required},
                ip_address=self._get_client_ip(request),
            )

            response_data = {"error": "Invalid credentials"}
            if user.otp_challenge_required:
                response_data["otp_required"] = True
                response_data["message"] = "Too many failed attempts. An OTP has been sent to your phone."
                if settings.DEBUG and hasattr(self, "_last_challenge_otp"):
                    response_data["dev_otp"] = self._last_challenge_otp

            return Response(response_data, status=status.HTTP_401_UNAUTHORIZED)

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

        # Reset PIN attempts and OTP challenge on successful login
        user.pin_attempts = 0
        user.pin_locked_until = None
        user.otp_challenge_required = False
        user.save(update_fields=["pin_attempts", "pin_locked_until", "otp_challenge_required"])

        # --- Device / IP change detection ---
        client_ip = self._get_client_ip(request)
        device_id = serializer.validated_data.get("device_id", "")
        device_name = serializer.validated_data.get("device_name", "")
        platform = serializer.validated_data.get("platform", "")

        security_challenge = False
        challenge_reasons = []

        # Check for new/unknown device
        if device_id:
            known_device = Device.objects.filter(user=user, device_id=device_id).exists()
            if not known_device:
                security_challenge = True
                challenge_reasons.append("new_device")

        # Check for IP change
        if client_ip and user.last_login_ip and client_ip != user.last_login_ip:
            security_challenge = True
            challenge_reasons.append("ip_changed")

        # First-time login tracking (no previous IP stored) — skip challenge
        if not user.last_login_ip:
            security_challenge = False
            challenge_reasons = []

        if security_challenge:
            if not otp:
                # Send OTP and require verification
                self._send_otp_challenge(phone)
                AuditLog.objects.create(
                    user=user,
                    action="SECURITY_CHALLENGE",
                    details={"reasons": challenge_reasons, "ip": client_ip, "device_id": device_id},
                    ip_address=client_ip,
                )
                return Response(
                    {
                        "error": "Security verification required",
                        "otp_required": True,
                        "security_challenge": True,
                        "message": "New device or location detected. Enter the OTP sent to your phone.",
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            # Verify the OTP for security challenge
            stored_otp = cache.get(f"otp:{phone}")
            if not stored_otp or stored_otp != otp:
                return Response(
                    {"error": "Invalid or expired OTP", "otp_required": True, "security_challenge": True},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            cache.delete(f"otp:{phone}")

        # Check TOTP if user has authenticator enabled
        if user.totp_enabled:
            totp_code = request.data.get("totp_code")
            if not totp_code:
                return Response(
                    {
                        "error": "Authenticator code required",
                        "totp_required": True,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            if not self._verify_totp(user, totp_code):
                return Response(
                    {"error": "Invalid authenticator code", "totp_required": True},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

        # Update login tracking
        update_fields = ["last_login_ip"]
        user.last_login_ip = client_ip
        user.save(update_fields=update_fields)

        # Register device if provided
        if device_id:
            Device.objects.update_or_create(
                user=user,
                device_id=device_id,
                defaults={
                    "device_name": device_name,
                    "platform": platform,
                    "is_trusted": True,
                    "ip_address": client_ip,
                },
            )

        refresh = RefreshToken.for_user(user)

        AuditLog.objects.create(
            user=user,
            action="LOGIN",
            details={"device_id": device_id, "ip": client_ip},
            ip_address=client_ip,
        )

        return Response({
            "user": UserSerializer(user).data,
            "tokens": {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
            },
        })

    def _send_otp_challenge(self, phone):
        """Auto-send an OTP when challenge is triggered."""
        otp = f"{random.randint(100000, 999999)}"
        cache.set(f"otp:{phone}", otp, timeout=300)
        # Store on instance so the view can include it in dev responses
        self._last_challenge_otp = otp

        if settings.AT_API_KEY:
            try:
                import africastalking

                africastalking.initialize(settings.AT_USERNAME, settings.AT_API_KEY)
                sms = africastalking.SMS
                sms.send(
                    f"CryptoPay security: Your verification code is {otp}. "
                    f"If you did not attempt to login, please change your PIN immediately.",
                    [phone],
                    sender_id=settings.AT_SENDER_ID,
                )
            except Exception as e:
                logger.error(f"OTP challenge SMS failed: {e}")
        else:
            logger.info(f"[DEV] OTP challenge for {phone}: {otp}")

    def _verify_totp(self, user, code):
        """Verify TOTP code or backup code using the TOTP service."""
        if verify_totp(user.totp_secret, code):
            return True
        return verify_backup_code(user, code)

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class ProfileView(APIView):
    """Get or update current user profile."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        return Response(UserSerializer(request.user, context={"request": request}).data)

    def patch(self, request):
        user = request.user

        # Handle avatar upload
        if "avatar" in request.FILES:
            avatar = request.FILES["avatar"]
            if avatar.size > 5 * 1024 * 1024:  # 5MB limit
                return Response(
                    {"error": "Avatar must be under 5MB"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not avatar.content_type.startswith("image/"):
                return Response(
                    {"error": "File must be an image"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Delete old avatar if exists
            if user.avatar:
                user.avatar.delete(save=False)
            user.avatar = avatar

        # Handle text fields
        serializer = ProfileUpdateSerializer(
            data=request.data,
            context={"user": user},
        )
        serializer.is_valid(raise_exception=True)

        update_fields = []
        if "full_name" in serializer.validated_data:
            user.full_name = serializer.validated_data["full_name"]
            update_fields.append("full_name")
        if "email" in serializer.validated_data:
            user.email = serializer.validated_data["email"] or None
            update_fields.append("email")
        if "avatar" in request.FILES:
            update_fields.append("avatar")

        if update_fields:
            user.save(update_fields=update_fields)
            AuditLog.objects.create(
                user=user,
                action="PROFILE_UPDATE",
                entity_type="user",
                entity_id=str(user.id),
                details={"fields": update_fields},
            )

        return Response(UserSerializer(user, context={"request": request}).data)


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

        # Register device if provided
        device_id = request.data.get("device_id", "")
        device_name = request.data.get("device_name", "")
        platform = request.data.get("platform", "")
        if device_id:
            Device.objects.update_or_create(
                user=user,
                device_id=device_id,
                defaults={
                    "device_name": device_name,
                    "platform": platform,
                    "is_trusted": True,
                    "ip_address": self._get_client_ip(request),
                },
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


class DeviceDeleteView(APIView):
    """Delete a specific device by its UUID (primary key)."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, device_id):
        try:
            device = Device.objects.get(id=device_id, user=request.user)
        except Device.DoesNotExist:
            return Response(
                {"error": "Device not found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        device.delete()

        # Audit log
        AuditLog.objects.create(
            user=request.user,
            action="device_removed",
            entity_type="device",
            entity_id=str(device_id),
            details={"device_name": device.device_name, "platform": device.platform},
            ip_address=self._get_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
        )

        return Response({"message": "Device removed"}, status=status.HTTP_200_OK)

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class ChangePINView(APIView):
    """Change the authenticated user's transaction PIN."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePINSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        current_pin = serializer.validated_data["current_pin"]
        new_pin = serializer.validated_data["new_pin"]

        if not user.check_pin(current_pin):
            return Response(
                {"error": "Current PIN is incorrect"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_pin(new_pin)
        user.save(update_fields=["pin_hash"])

        AuditLog.objects.create(
            user=user,
            action="CHANGE_PIN",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=self._get_client_ip(request),
        )

        return Response({"message": "PIN changed successfully"})

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class KYCDocumentListView(APIView):
    """List and upload KYC documents for identity verification."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        docs = KYCDocument.objects.filter(user=request.user).order_by("-created_at")
        return Response(KYCDocumentSerializer(docs, many=True).data)

    def post(self, request):
        serializer = KYCUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        doc_type = serializer.validated_data["document_type"]
        file_url = serializer.validated_data["file_url"]

        # Check if a document of this type already exists and is pending/approved
        existing = KYCDocument.objects.filter(
            user=request.user,
            document_type=doc_type,
            status__in=["pending", "approved"],
        ).first()

        if existing:
            if existing.status == "approved":
                return Response(
                    {"error": f"{doc_type} already approved"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Replace pending document
            existing.file_url = file_url
            existing.save(update_fields=["file_url"])
            doc = existing
        else:
            doc = KYCDocument.objects.create(
                user=request.user,
                document_type=doc_type,
                file_url=file_url,
            )

        AuditLog.objects.create(
            user=request.user,
            action="KYC_UPLOAD",
            entity_type="kyc_document",
            entity_id=str(doc.id),
            details={"document_type": doc_type},
            ip_address=self._get_client_ip(request),
        )

        return Response(
            KYCDocumentSerializer(doc).data,
            status=status.HTTP_201_CREATED,
        )

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class RegisterPushTokenView(APIView):
    """Register or update an Expo push notification token for the authenticated user."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PushTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        token = serializer.validated_data["token"]
        platform = serializer.validated_data["platform"]

        push_token, created = PushToken.objects.update_or_create(
            user=request.user,
            token=token,
            defaults={"platform": platform},
        )

        logger.info(
            f"Push token {'registered' if created else 'updated'} "
            f"for user {request.user.phone} ({platform})"
        )

        return Response(
            {"message": "Push token registered", "created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class SendEmailVerificationView(APIView):
    """Send a verification link to the user's email address."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        email = request.data.get("email")
        if not email:
            # Use existing email
            email = request.user.email
        if not email:
            return Response(
                {"error": "No email address provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Rate limit: max 3 verification emails per user per hour
        rate_key = f"email_verify_rate:{request.user.id}"
        attempts = cache.get(rate_key, 0)
        if attempts >= 3:
            return Response(
                {"error": "Too many verification requests. Try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Create verification token
        token_obj = EmailVerificationToken.create_for_user(request.user, email)

        # Send verification email
        from apps.core.tasks import send_email_task

        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token_obj.token}"
        from django.template.loader import render_to_string

        html_content = render_to_string("email/email_verification.html", {
            "full_name": request.user.full_name or request.user.phone,
            "verify_url": verify_url,
            "verification_code": token_obj.token[:6].upper(),
        })
        send_email_task.delay(
            subject="CryptoPay — Verify Your Email",
            html_content=html_content,
            recipient_email=email,
        )

        cache.set(rate_key, attempts + 1, timeout=3600)

        AuditLog.objects.create(
            user=request.user,
            action="EMAIL_VERIFY_SENT",
            entity_type="email",
            details={"email": email},
            ip_address=self._get_client_ip(request),
        )

        return Response({"message": "Verification email sent", "verification_code": token_obj.token[:6].upper()})

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class ConfirmEmailVerificationView(APIView):
    """Confirm email verification with token or code."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = EmailVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        token = serializer.validated_data["token"]

        # Try full token first, then code (first 6 chars)
        token_obj = EmailVerificationToken.objects.filter(
            token=token, is_used=False
        ).first()

        if not token_obj:
            # Try matching by first 6 chars (code-based verification)
            token_obj = EmailVerificationToken.objects.filter(
                token__istartswith=token[:6], is_used=False
            ).first()

        if not token_obj:
            return Response(
                {"error": "Invalid or expired verification token"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if token_obj.is_expired:
            return Response(
                {"error": "Verification token has expired. Request a new one."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Mark token as used
        token_obj.is_used = True
        token_obj.save(update_fields=["is_used"])

        # Update user's email and verification status
        user = token_obj.user
        user.email = token_obj.email
        user.email_verified = True
        user.save(update_fields=["email", "email_verified"])

        AuditLog.objects.create(
            user=user,
            action="EMAIL_VERIFIED",
            entity_type="email",
            details={"email": token_obj.email},
        )

        return Response({"message": "Email verified successfully"})


class SetupTOTPView(APIView):
    """Set up TOTP authenticator app (Google Authenticator / Authy).

    Legacy endpoint that combines GET (setup) and POST (confirm) for
    backward compatibility. New clients should use TOTPSetupView and
    TOTPConfirmView separately.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Generate a new TOTP secret and return QR code provisioning URI."""
        user = request.user
        secret = generate_totp_secret()

        # Store temporarily in cache (user must verify before we save)
        cache.set(f"totp_setup:{user.id}", secret, timeout=600)

        uri = get_totp_uri(secret, user.phone)

        return Response({
            "secret": secret,
            "provisioning_uri": uri,
            "already_enabled": user.totp_enabled,
        })

    def post(self, request):
        """Verify TOTP code and enable authenticator."""
        serializer = SetupTOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        code = serializer.validated_data["code"]

        # Get the pending secret from cache
        secret = cache.get(f"totp_setup:{user.id}")
        if not secret:
            return Response(
                {"error": "Setup expired. Please start again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not verify_totp(secret, code):
            return Response(
                {"error": "Invalid code. Please try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Generate backup codes
        raw_backup_codes = generate_backup_codes(count=10)
        hashed_codes = hash_backup_codes(raw_backup_codes)

        # Save TOTP
        user.totp_secret = secret
        user.totp_enabled = True
        user.totp_backup_codes = hashed_codes
        user.save(update_fields=["totp_secret", "totp_enabled", "totp_backup_codes"])

        cache.delete(f"totp_setup:{user.id}")

        AuditLog.objects.create(
            user=user,
            action="TOTP_ENABLED",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=self._get_client_ip(request),
        )

        return Response({
            "message": "Authenticator enabled successfully",
            "backup_codes": raw_backup_codes,
        })

    def delete(self, request):
        """Disable TOTP (requires PIN verification)."""
        pin = request.data.get("pin")
        if not pin or not request.user.check_pin(pin):
            return Response(
                {"error": "Invalid PIN"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user = request.user
        user.totp_secret = ""
        user.totp_enabled = False
        user.totp_backup_codes = []
        user.save(update_fields=["totp_secret", "totp_enabled", "totp_backup_codes"])

        AuditLog.objects.create(
            user=user,
            action="TOTP_DISABLED",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=self._get_client_ip(request),
        )

        return Response({"message": "Authenticator disabled"})

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class TOTPSetupView(APIView):
    """POST /api/v1/auth/totp/setup/ — Generate TOTP secret for authenticator setup.

    Requires authentication. Returns the secret, otpauth URI, and QR data.
    The secret is stored temporarily in cache until confirmed.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        secret = generate_totp_secret()

        # Store in cache for 10 minutes; user must confirm with a valid code
        cache.set(f"totp_setup:{user.id}", secret, timeout=600)

        uri = get_totp_uri(secret, user.phone)

        return Response({
            "secret": secret,
            "uri": uri,
            "qr_data": uri,  # The URI itself is the QR code payload
            "already_enabled": user.totp_enabled,
        })

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class TOTPConfirmView(APIView):
    """POST /api/v1/auth/totp/confirm/ — Confirm TOTP setup with a valid code.

    Requires authentication. Accepts { code } and verifies it against the
    secret stored during setup. On success, enables TOTP and returns backup codes.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = SetupTOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        code = serializer.validated_data["code"]

        # Get the pending secret from cache
        secret = cache.get(f"totp_setup:{user.id}")
        if not secret:
            return Response(
                {"error": "Setup expired. Please start TOTP setup again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not verify_totp(secret, code):
            return Response(
                {"error": "Invalid code. Please try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Generate and hash backup codes
        raw_backup_codes = generate_backup_codes(count=8)
        hashed_codes = hash_backup_codes(raw_backup_codes)

        # Enable TOTP on the user
        user.totp_secret = secret
        user.totp_enabled = True
        user.totp_backup_codes = hashed_codes
        user.save(update_fields=["totp_secret", "totp_enabled", "totp_backup_codes"])

        cache.delete(f"totp_setup:{user.id}")

        AuditLog.objects.create(
            user=user,
            action="TOTP_ENABLED",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=self._get_client_ip(request),
        )

        return Response({
            "enabled": True,
            "backup_codes": raw_backup_codes,
        })

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class TOTPDisableView(APIView):
    """POST /api/v1/auth/totp/disable/ — Disable TOTP authenticator.

    Requires authentication. Accepts { pin } to confirm identity before
    disabling TOTP. Clears the secret, backup codes, and sets totp_enabled=False.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        pin = request.data.get("pin")
        if not pin or not request.user.check_pin(pin):
            return Response(
                {"error": "Invalid PIN. PIN is required to disable authenticator."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user = request.user

        if not user.totp_enabled:
            return Response(
                {"error": "TOTP is not enabled."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.totp_secret = ""
        user.totp_enabled = False
        user.totp_backup_codes = []
        user.save(update_fields=["totp_secret", "totp_enabled", "totp_backup_codes"])

        AuditLog.objects.create(
            user=user,
            action="TOTP_DISABLED",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=self._get_client_ip(request),
        )

        return Response({"message": "Authenticator disabled successfully"})

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class TOTPVerifyView(APIView):
    """POST /api/v1/auth/totp/verify/ — Verify TOTP code during login.

    No authentication required (used as the second step in login flow).
    Accepts { phone, code } and returns JWT tokens if the code is valid.
    Supports both TOTP codes and backup codes.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        phone = request.data.get("phone", "").strip().replace(" ", "")
        code = request.data.get("code", "").strip()

        if not phone or not code:
            return Response(
                {"error": "Phone and code are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Normalize Kenyan phone number
        if phone.startswith("0"):
            phone = "+254" + phone[1:]
        elif phone.startswith("254"):
            phone = "+" + phone
        elif not phone.startswith("+"):
            phone = "+254" + phone

        try:
            user = User.objects.get(phone=phone)
        except User.DoesNotExist:
            return Response(
                {"error": "Invalid credentials"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not user.totp_enabled or not user.totp_secret:
            return Response(
                {"error": "TOTP is not enabled for this account."},
                status=status.HTTP_400_BAD_REQUEST,
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

        # Rate limit TOTP verification attempts
        rate_key = f"totp_verify_rate:{user.id}"
        attempts = cache.get(rate_key, 0)
        if attempts >= 5:
            return Response(
                {"error": "Too many verification attempts. Try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Verify TOTP code or backup code
        is_valid = verify_totp(user.totp_secret, code) or verify_backup_code(user, code)

        if not is_valid:
            cache.set(rate_key, attempts + 1, timeout=300)
            return Response(
                {"error": "Invalid authenticator code"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Clear rate limit on success
        cache.delete(rate_key)

        # Issue JWT tokens
        refresh = RefreshToken.for_user(user)

        AuditLog.objects.create(
            user=user,
            action="TOTP_LOGIN_VERIFIED",
            entity_type="user",
            entity_id=str(user.id),
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


class RecoveryEmailView(APIView):
    """Set or update recovery email address."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Get current recovery settings."""
        user = request.user
        return Response({
            "recovery_email": user.recovery_email,
            "recovery_email_verified": user.recovery_email_verified,
            "recovery_phone": user.recovery_phone,
            "email_verified": user.email_verified,
            "totp_enabled": user.totp_enabled,
        })

    def post(self, request):
        """Set recovery email and send verification."""
        serializer = RecoveryEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        recovery_email = serializer.validated_data.get("recovery_email")
        recovery_phone = serializer.validated_data.get("recovery_phone", "")

        update_fields = []
        if recovery_email:
            user.recovery_email = recovery_email
            user.recovery_email_verified = False
            update_fields.extend(["recovery_email", "recovery_email_verified"])

            # Send verification to recovery email
            token_obj = EmailVerificationToken.create_for_user(user, recovery_email)
            from apps.core.tasks import send_email_task
            from django.template.loader import render_to_string

            html_content = render_to_string("email/email_verification.html", {
                "full_name": user.full_name or user.phone,
                "verify_url": f"{settings.FRONTEND_URL}/verify-email?token={token_obj.token}&type=recovery",
                "verification_code": token_obj.token[:6].upper(),
            })
            send_email_task.delay(
                subject="CryptoPay — Verify Recovery Email",
                html_content=html_content,
                recipient_email=recovery_email,
            )

        if recovery_phone:
            user.recovery_phone = recovery_phone
            update_fields.append("recovery_phone")

        if update_fields:
            user.save(update_fields=update_fields)

            AuditLog.objects.create(
                user=user,
                action="RECOVERY_UPDATED",
                entity_type="user",
                entity_id=str(user.id),
                details={"fields": update_fields},
                ip_address=self._get_client_ip(request),
            )

        return Response({"message": "Recovery settings updated"})

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class SecuritySettingsView(APIView):
    """Get all security settings for the current user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response({
            "email": user.email,
            "email_verified": user.email_verified,
            "recovery_email": user.recovery_email,
            "recovery_email_verified": user.recovery_email_verified,
            "recovery_phone": user.recovery_phone,
            "totp_enabled": user.totp_enabled,
            "totp_backup_codes_remaining": len(user.totp_backup_codes) if user.totp_enabled else 0,
            "devices_count": Device.objects.filter(user=user).count(),
        })


class KYCCallbackView(APIView):
    """
    Handle Smile Identity webhook callbacks for KYC verification results.

    This endpoint is called by Smile Identity servers when a verification
    job completes.  It is unauthenticated (no JWT) but protected by
    HMAC-SHA256 signature verification.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        from .kyc_service import SmileIdentityService

        payload = request.data

        service = SmileIdentityService()

        # Verify the callback signature to ensure it came from Smile Identity
        if not service.verify_callback_signature(payload):
            logger.warning(
                "KYC callback with invalid signature from %s",
                self._get_client_ip(request),
            )
            return Response(
                {"error": "Invalid signature"},
                status=status.HTTP_403_FORBIDDEN,
            )

        result = service.handle_callback(payload)

        logger.info("KYC callback processed: %s", result)

        return Response(result, status=status.HTTP_200_OK)

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")
