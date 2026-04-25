import logging
import secrets

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView as _SimpleJWTTokenRefreshView

from apps.wallets.services import WalletService

from .models import AuditLog, Device, EmailVerificationToken, KYCDocument, PINResetToken, PushToken, User
from rest_framework.parsers import MultiPartParser, FormParser

from .serializers import (
    ChangePINSerializer,
    DeviceModelSerializer,
    DeviceSerializer,
    EmailVerifySerializer,
    ForgotPINSerializer,
    GoogleCompleteProfileSerializer,
    GoogleLoginSerializer,
    KYCDocumentSerializer,
    KYCUploadSerializer,
    LoginSerializer,
    ProfileUpdateSerializer,
    PushTokenSerializer,
    RecoveryEmailSerializer,
    RegisterSerializer,
    RequestOTPSerializer,
    ResetPINSerializer,
    SetupTOTPSerializer,
    UserSerializer,
    VerifyPINResetOTPSerializer,
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

        # Rate limit: max 5 OTP requests per phone per 10 minutes
        rate_key = f"otp_rate:{phone}"
        attempts = cache.get(rate_key, 0)
        if attempts >= 5:
            return Response(
                {"error": "Too many OTP requests. Wait 10 minutes."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Generate 6-digit OTP
        otp = f"{secrets.randbelow(900000) + 100000}"
        cache.set(f"otp:{phone}", otp, timeout=300)  # Valid for 5 minutes
        cache.set(rate_key, attempts + 1, timeout=600)

        # Send OTP via SMS + email (dual delivery for reliability)
        from apps.core.email import send_sms, send_otp_to_email

        otp_message = f"Your CPay verification code is: {otp}. Expires in 5 minutes."
        sms_sent = send_sms(phone, otp_message)

        # Also send to email if provided or if user exists with email
        email = serializer.validated_data.get("email", "")
        email_sent = False
        if not email:
            # Check if existing user has an email on file
            try:
                existing_user = User.objects.get(phone=phone)
                if existing_user.email:
                    email = existing_user.email
            except User.DoesNotExist:
                pass

        if email:
            email_sent = send_otp_to_email(email, otp, phone)

        if not sms_sent and not email_sent:
            logger.error(f"All OTP delivery failed for {phone[:7]}***")
            return Response(
                {"error": "Failed to send verification code. Please try again."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Tell the client which channels succeeded.
        #
        # Audit cycle-2 MED 7: the response shape previously varied —
        # phone-that-exists-with-email-fallback sent an extra masked
        # email + `email_fallback: true` field; phone-that-doesn't-exist
        # got a plain message. That lets an attacker enumerate which
        # phones have an email on file. Kenyan Data Protection Act
        # flag. The response is now constant-shape: `{message, channels}`
        # and nothing else, regardless of which delivery path succeeded.
        channels = []
        if sms_sent:
            channels.append("sms")
        if email_sent:
            channels.append("email")

        return Response({
            "message": "OTP sent successfully",
            "channels": channels,
        })


class RegisterView(APIView):
    """Register a new user with phone + PIN + OTP verification."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        phone = serializer.validated_data["phone"]
        pin = serializer.validated_data["pin"]
        otp = serializer.validated_data["otp"]

        # Verify OTP with brute-force protection
        otp_attempt_key = f"otp_verify_attempts:{phone}"
        otp_attempts = cache.get(otp_attempt_key, 0)
        if otp_attempts >= 5:
            cache.delete(f"otp:{phone}")  # Invalidate OTP after too many attempts
            return Response(
                {"error": "Too many failed attempts. Request a new OTP."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        stored_otp = cache.get(f"otp:{phone}")
        if not stored_otp or stored_otp != otp:
            cache.set(otp_attempt_key, otp_attempts + 1, timeout=300)
            return Response(
                {"error": "Invalid or expired OTP"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cache.delete(otp_attempt_key)  # Clear attempts on success

        full_name = serializer.validated_data.get("full_name", "")
        email = serializer.validated_data.get("email", "")

        # Create user
        user = User.objects.create_user(phone=phone, pin=pin, full_name=full_name)

        # Set email if provided (mark as verified since OTP was sent to it)
        if email:
            user.email = email
            user.email_verified = True
            user.save(update_fields=["email", "email_verified"])
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

        # Send welcome email + welcome SMS + admin alert (non-blocking)
        try:
            from apps.core.email import send_welcome_email, send_welcome_sms, send_admin_new_user_alert
            send_welcome_email(user)
            send_welcome_sms(user)
            send_admin_new_user_alert(user)
        except Exception as e:
            logger.error(f"Post-registration notification dispatch failed for {user.phone}: {e}")

        # Referral attribution (non-blocking — never fail signup)
        referral_code = serializer.validated_data.get("referral_code", "")
        if referral_code:
            try:
                from apps.referrals.services import attribute_signup
                attribute_signup(
                    user=user,
                    code=referral_code,
                    request_meta={
                        "ip": self._get_client_ip(request),
                        "device_id": device_id,
                        "user_agent": request.META.get("HTTP_USER_AGENT", "")[:500],
                    },
                )
            except Exception as e:
                logger.warning(f"Referral attribution failed for {user.phone} (code={referral_code}): {e}")

        resp = Response(
            {
                "user": UserSerializer(user, context={"request": request}).data,
                "tokens": {
                    "refresh": str(refresh),
                    "access": str(refresh.access_token),
                },
            },
            status=status.HTTP_201_CREATED,
        )
        # C1: HttpOnly cookies for web clients · same header contract as login.
        if request.META.get("HTTP_X_CPAY_WEB") == "1":
            _set_auth_cookies(resp, str(refresh.access_token), str(refresh))
            # MEDIUM-9: web client gets cookies, NOT JSON tokens.
            _strip_tokens_for_web(resp, request)
        return resp

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

        # A20: only set to True after an explicit OTP comparison below.
        # The previous `bool(otp)` default let any non-empty string skip the
        # device/IP-change challenge further down.
        pin_otp_verified = False

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
            # Verify the OTP with brute-force protection
            otp_attempt_key = f"otp_verify_attempts:{phone}"
            otp_attempts = cache.get(otp_attempt_key, 0)
            if otp_attempts >= 5:
                cache.delete(f"otp:{phone}")
                return Response(
                    {"error": "Too many failed OTP attempts. Request a new OTP.", "otp_required": True},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )

            stored_otp = cache.get(f"otp:{phone}")
            if not stored_otp or stored_otp != otp:
                cache.set(otp_attempt_key, otp_attempts + 1, timeout=300)
                return Response(
                    {"error": "Invalid or expired OTP", "otp_required": True},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # OTP verified — clear the challenge flag and attempts
            cache.delete(f"otp:{phone}")
            cache.delete(otp_attempt_key)
            pin_otp_verified = True  # A20: only now does "already verified" become True

        if not user.check_pin(pin):
            user.pin_attempts += 1

            # After 3 failed attempts, require OTP challenge
            if user.pin_attempts >= 3 and not user.otp_challenge_required:
                user.otp_challenge_required = True
                # Auto-send OTP for the challenge
                self._send_otp_challenge(phone, user)

            # Progressive lockout: 5 attempts -> 1min, 10 -> 5min, 15 -> 1hr
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

        # A20: only skip device / IP-change detection if an OTP comparison
        # actually succeeded upstream. `bool(otp)` alone (any non-empty
        # string submitted by a caller) must NEVER skip the secondary
        # challenge · that was the bypass CVE.
        otp_already_verified = pin_otp_verified

        security_challenge = False
        challenge_reasons = []

        # Check for new/unknown device (skip if OTP already verified).
        # A device is only considered "known" if it exists AND is trusted — trust
        # is set on first successful login via update_or_create below.
        known_device = False
        if device_id and not otp_already_verified:
            known_device = Device.objects.filter(
                user=user, device_id=device_id, is_trusted=True
            ).exists()
            if not known_device:
                security_challenge = True
                challenge_reasons.append("new_device")

        # Check for IP change, but ONLY when the device is NOT already trusted.
        # Mobile IPs rotate constantly (WiFi <-> cellular, carrier NAT), so
        # challenging a trusted phone on every network change is pure false-
        # positive noise. Attackers using a stolen refresh token from a new
        # phone will still hit the new_device branch above.
        if (
            not known_device
            and client_ip
            and user.last_login_ip
            and client_ip != user.last_login_ip
            and not otp_already_verified
        ):
            security_challenge = True
            challenge_reasons.append("ip_changed")

        # First-time login tracking (no previous IP stored) — skip challenge
        if not user.last_login_ip:
            security_challenge = False
            challenge_reasons = []

        # In DEBUG mode, skip security challenges (no SMS provider configured)
        if settings.DEBUG:
            security_challenge = False

        if security_challenge:
            # Accept an approved push-challenge as proof instead of OTP
            challenge_id = request.data.get("challenge_id")
            if challenge_id:
                from .push_challenge import consume_if_approved

                if consume_if_approved(challenge_id, user):
                    # User approved on their trusted device — skip OTP path
                    otp_already_verified = True
                    security_challenge = False

        if security_challenge:
            if not otp:
                # Send OTP (SMS + email) AND create a push challenge if the
                # user has another trusted device that can approve. Both go
                # out so the user can tap-to-approve from their other phone
                # OR fall back to the SMS code — whichever arrives first.
                self._send_otp_challenge(phone, user)

                from .push_challenge import create_challenge as create_push_challenge

                push_challenge = create_push_challenge(
                    user=user,
                    requesting_ip=client_ip or "",
                    requesting_device_id=device_id or "",
                    requesting_device_name=(device_name or platform or "a device"),
                )

                AuditLog.objects.create(
                    user=user,
                    action="SECURITY_CHALLENGE",
                    details={
                        "reasons": challenge_reasons,
                        "ip": client_ip,
                        "device_id": device_id,
                        "push_challenge_sent": bool(push_challenge),
                    },
                    ip_address=client_ip,
                )
                # Build accurate user-facing message based on actual reason(s)
                if "new_device" in challenge_reasons:
                    msg = "New device detected. Approve on your other device or enter the OTP sent to your phone."
                elif "ip_changed" in challenge_reasons:
                    msg = "Sign-in from a new location. Approve on your other device or enter the OTP sent to your phone."
                else:
                    msg = "Security verification required. Approve on your other device or enter the OTP sent to your phone."
                response_data = {
                    "error": "Security verification required",
                    "otp_required": True,
                    "security_challenge": True,
                    "challenge_reasons": challenge_reasons,
                    "message": msg,
                }
                # Advertise push channel only when we actually created one
                if push_challenge:
                    response_data["push_challenge"] = {
                        "challenge_id": push_challenge.id,
                        "expires_in_seconds": 300,
                    }
                return Response(response_data, status=status.HTTP_403_FORBIDDEN)
            # Verify the OTP for security challenge with brute-force protection
            sec_attempt_key = f"otp_verify_attempts:sec:{phone}"
            sec_attempts = cache.get(sec_attempt_key, 0)
            if sec_attempts >= 5:
                cache.delete(f"otp:{phone}")
                return Response(
                    {"error": "Too many failed OTP attempts. Request a new OTP.", "otp_required": True, "security_challenge": True},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )

            stored_otp = cache.get(f"otp:{phone}")
            if not stored_otp or stored_otp != otp:
                cache.set(sec_attempt_key, sec_attempts + 1, timeout=300)
                return Response(
                    {"error": "Invalid or expired OTP", "otp_required": True, "security_challenge": True},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            cache.delete(f"otp:{phone}")
            cache.delete(sec_attempt_key)

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
        is_new_device = False
        if device_id:
            _, is_new_device = Device.objects.update_or_create(
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
            details={"device_id": device_id, "ip": client_ip, "new_device": is_new_device},
            ip_address=client_ip,
        )

        # Security alert: notify user of new device login
        if is_new_device:
            try:
                from apps.core.email import send_security_alert
                send_security_alert(
                    user, "new_device", client_ip,
                    device_name or device_id or "Unknown device",
                )
            except Exception as e:
                logger.error(f"New device security alert failed: {e}")

        response = Response({
            "user": UserSerializer(user, context={"request": request}).data,
            "tokens": {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
            },
        })
        # C1: when the caller is the web bundle (signalled via
        # `X-Cpay-Web: 1`), also set HttpOnly cookies so the JS side can
        # operate without ever reading the JWT strings. Native app clients
        # omit the header and keep using the JSON token payload.
        if request.META.get("HTTP_X_CPAY_WEB") == "1":
            _set_auth_cookies(response, str(refresh.access_token), str(refresh))
            # MEDIUM-9: web client gets cookies, NOT JSON tokens.
            _strip_tokens_for_web(response, request)
        return response

    def _send_otp_challenge(self, phone, user=None):
        """Auto-send an OTP when challenge is triggered (SMS + email)."""
        otp = f"{secrets.randbelow(900000) + 100000}"
        cache.set(f"otp:{phone}", otp, timeout=300)
        self._last_challenge_otp = otp

        from apps.core.email import send_sms, send_otp_to_email
        send_sms(
            phone,
            f"CPay security: Your verification code is {otp}. "
            f"If you did not attempt to login, please change your PIN immediately.",
        )
        # Also send via email if user has one
        if user and user.email:
            send_otp_to_email(user.email, otp, phone)

    def _verify_totp(self, user, code):
        """Verify TOTP code or backup code using the TOTP service."""
        if verify_totp(user.totp_secret_decrypted, code):
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

        if getattr(user, "is_suspended", False):
            return Response(
                {"detail": "Your account is suspended. Contact support for assistance."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # PIN verification required when changing name or email (not avatar-only)
        has_text_changes = "full_name" in request.data or "email" in request.data
        pin = request.data.get("pin", "")
        if has_text_changes:
            if not pin:
                return Response(
                    {"error": "PIN is required to update your profile"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not user.check_pin(pin):
                return Response(
                    {"error": "Incorrect PIN"},
                    status=status.HTTP_403_FORBIDDEN,
                )

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

        email_changed = False
        new_email = serializer.validated_data.get("email")
        if new_email is not None:
            old_email = user.email or ""
            if new_email and new_email != old_email:
                user.email = new_email
                user.email_verified = False
                update_fields.extend(["email", "email_verified"])
                email_changed = True
            elif not new_email and old_email:
                user.email = None
                user.email_verified = False
                update_fields.extend(["email", "email_verified"])

        # Preferences · language + notification channel opt-outs. Persisting
        # server-side means every backend-originated message (email, SMS,
        # push) honours the user's choice even when the client is offline.
        for pref in (
            "language",
            "notify_email_enabled",
            "notify_sms_enabled",
            "notify_push_enabled",
            "notify_marketing_enabled",
        ):
            if pref in serializer.validated_data:
                setattr(user, pref, serializer.validated_data[pref])
                update_fields.append(pref)

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
                ip_address=self._get_client_ip(request),
            )

        # Auto-send email verification if email changed
        verification_sent = False
        if email_changed and new_email:
            try:
                token_obj = EmailVerificationToken.create_for_user(user, new_email)
                from apps.core.tasks import send_email_task
                from django.template.loader import render_to_string

                verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token_obj.token}"
                html_content = render_to_string("email/email_verification.html", {
                    "full_name": user.full_name or user.phone,
                    "verify_url": verify_url,
                    "verification_code": token_obj.otp_code,
                })
                send_mail(
                    "CPay — Verify Your Email",
                    "",
                    settings.DEFAULT_FROM_EMAIL,
                    [new_email],
                    html_message=html_content,
                    fail_silently=False,
                )
                verification_sent = True
            except Exception:
                import logging
                logging.getLogger("accounts").exception("Failed to send verification email")

        response_data = UserSerializer(user, context={"request": request}).data
        if verification_sent:
            response_data["email_verification_sent"] = True
        return Response(response_data)

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")


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

        # A3: before any auto-link, refuse to sign into an existing
        # phone-registered account via Google alone. A phone + PIN user who
        # set their email is effectively identified by phone+PIN as their
        # credential pair; accepting Google-ID-alone bypasses that entirely
        # (any attacker with email control could drain the wallet). The
        # legitimate user MUST either (a) sign in with phone + PIN first and
        # link Google from settings, or (b) go through phone-OTP proof here
        # before we mint tokens.
        user = User.objects.filter(email__iexact=email).first()
        created = False
        if user:
            has_real_phone_already = bool(
                user.phone and not user.phone.startswith("+000")
            )
            has_pin_already = bool(getattr(user, "pin_hash", ""))
            if has_real_phone_already and has_pin_already:
                # A3: require the caller to prove control of the registered
                # phone before we'll auto-link. `otp` is consumed here, not
                # the PIN-challenge OTP path · so a different cache key is
                # used in `_send_google_link_otp` below.
                link_otp = (serializer.validated_data.get("otp") or "").strip()
                from django.core.cache import cache as _cache
                link_key = f"google_link_otp:{user.phone}"
                if not link_otp:
                    # Issue the OTP + reject this call · client must retry with `otp`.
                    self._send_google_link_otp(user.phone, user)
                    return Response(
                        {
                            "error": "phone_verification_required",
                            "message": (
                                "This email already belongs to a phone account. "
                                "We sent an OTP to your registered phone · submit "
                                "it with `otp` to confirm the link."
                            ),
                            "phone_masked": (
                                (user.phone[:6] + "****" + user.phone[-2:])
                                if len(user.phone) >= 8
                                else user.phone
                            ),
                            "otp_required": True,
                        },
                        status=status.HTTP_403_FORBIDDEN,
                    )
                stored_otp = _cache.get(link_key)
                if not stored_otp or stored_otp != link_otp:
                    return Response(
                        {
                            "error": "invalid_otp",
                            "message": "Incorrect or expired OTP · request a new one.",
                            "otp_required": True,
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                # OTP good · consume it, link proceeds
                _cache.delete(link_key)
                AuditLog.objects.create(
                    user=user,
                    action="GOOGLE_LINK_CONFIRMED",
                    entity_type="user",
                    entity_id=str(user.id),
                    ip_address=self._get_client_ip(request),
                )
        else:
            import uuid as _uuid
            # Generate a temporary placeholder phone (unique per user)
            temp_phone = f"+000{_uuid.uuid4().hex[:10]}"
            user = User.objects.create_user(
                phone=temp_phone,
                email=email,
                full_name=google_info.get("name", ""),
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

        # Check if user has a real phone number (not a placeholder +000...)
        has_real_phone = user.phone and not user.phone.startswith("+000")

        if not has_real_phone:
            # New Google user — needs to complete profile (phone + PIN)
            resp = Response(
                {
                    "user": UserSerializer(user, context={"request": request}).data,
                    "tokens": {
                        "refresh": str(refresh),
                        "access": str(refresh.access_token),
                    },
                    "created": created,
                    "phone_required": True,
                },
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            )
            if request.META.get("HTTP_X_CPAY_WEB") == "1":
                _set_auth_cookies(resp, str(refresh.access_token), str(refresh))
                _strip_tokens_for_web(resp, request)
            return resp

        resp = Response(
            {
                "user": UserSerializer(user, context={"request": request}).data,
                "tokens": {
                    "refresh": str(refresh),
                    "access": str(refresh.access_token),
                },
                "created": created,
                "pin_required": not bool(user.pin_hash),
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
        if request.META.get("HTTP_X_CPAY_WEB") == "1":
            _set_auth_cookies(resp, str(refresh.access_token), str(refresh))
            _strip_tokens_for_web(resp, request)
        return resp

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")

    def _send_google_link_otp(self, phone: str, user):
        """A3: issue an SMS OTP on a dedicated cache key so it can't be
        replayed via the normal login OTP channel. 5-minute TTL, 6-digit."""
        from django.core.cache import cache as _cache
        import secrets as _secrets

        otp = f"{_secrets.randbelow(900000) + 100000}"
        _cache.set(f"google_link_otp:{phone}", otp, timeout=300)
        try:
            from apps.core.tasks import send_sms_task
            send_sms_task.delay(
                phone,
                f"Cpay: confirm Google sign-in with code {otp}. "
                "If you didn't request this, ignore.",
            )
        except Exception:
            logger.exception("Failed to dispatch Google link OTP SMS")
        try:
            AuditLog.objects.create(
                user=user,
                action="GOOGLE_LINK_OTP_SENT",
                entity_type="user",
                entity_id=str(user.id),
            )
        except Exception:
            pass


class GoogleCompleteProfileView(APIView):
    """
    POST /api/v1/auth/google/complete-profile/
    Complete profile for Google OAuth users who need to set phone + PIN.
    No auth required — uses email to find the user (avoids token expiry issues).
    Accepts: {email, phone, otp, pin, full_name}
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = GoogleCompleteProfileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        phone = serializer.validated_data["phone"]
        otp = serializer.validated_data["otp"]
        pin = serializer.validated_data["pin"]
        full_name = serializer.validated_data.get("full_name", "")
        email = request.data.get("email", "").strip().lower()

        if not email:
            return Response({"error": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Find user by email (created during Google login)
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return Response({"error": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        # Ensure user actually needs profile completion (has placeholder phone)
        if user.phone and not user.phone.startswith("+000"):
            return Response(
                {"error": "Profile already completed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verify OTP
        cached_otp = cache.get(f"otp:{phone}")
        if not cached_otp or cached_otp != otp:
            return Response(
                {"error": "Invalid or expired OTP."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check phone not already used by another user
        if User.objects.filter(phone=phone).exclude(id=user.id).exists():
            return Response(
                {"error": "Phone number already registered to another account."},
                status=status.HTTP_409_CONFLICT,
            )

        # Clear OTP after successful verification
        cache.delete(f"otp:{phone}")

        # Update user profile
        user.phone = phone
        if full_name:
            user.full_name = full_name
        user.set_pin(pin)
        user.save(update_fields=["phone", "full_name", "pin_hash"])

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

        # Generate fresh tokens
        refresh = RefreshToken.for_user(user)

        AuditLog.objects.create(
            user=user,
            action="GOOGLE_COMPLETE_PROFILE",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=self._get_client_ip(request),
        )

        # Send welcome notifications (email + SMS + admin alert)
        try:
            from apps.core.email import send_welcome_email, send_welcome_sms, send_admin_new_user_alert
            send_welcome_email(user)
            send_welcome_sms(user)
            send_admin_new_user_alert(user)
        except Exception as e:
            logger.error(f"Google profile completion notifications failed: {e}")

        # Referral attribution (non-blocking)
        referral_code = serializer.validated_data.get("referral_code", "")
        if referral_code:
            try:
                from apps.referrals.services import attribute_signup
                attribute_signup(
                    user=user,
                    code=referral_code,
                    request_meta={
                        "ip": self._get_client_ip(request),
                        "device_id": device_id,
                        "user_agent": request.META.get("HTTP_USER_AGENT", "")[:500],
                    },
                )
            except Exception as e:
                logger.warning(f"Referral attribution (google) failed for {user.phone} (code={referral_code}): {e}")

        return Response(
            {
                "user": UserSerializer(user, context={"request": request}).data,
                "tokens": {
                    "refresh": str(refresh),
                    "access": str(refresh.access_token),
                },
                "message": "Profile completed successfully.",
            },
            status=status.HTTP_200_OK,
        )

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class SetInitialPINView(APIView):
    """POST /api/v1/auth/set-initial-pin/ — Set PIN for Google OAuth users who have no PIN yet."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        pin = request.data.get("pin", "").strip()
        if not pin or len(pin) != 6 or not pin.isdigit():
            return Response(
                {"error": "PIN must be exactly 6 digits."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        if user.pin_hash:
            return Response(
                {"error": "PIN is already set. Use change-pin to update it."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_pin(pin)
        user.save(update_fields=["pin_hash"])

        AuditLog.objects.create(
            user=user,
            action="INITIAL_PIN_SET",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=self._get_client_ip(request),
        )

        return Response({"message": "PIN set successfully"})

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
        if getattr(request.user, "is_suspended", False):
            return Response(
                {"detail": "Your account is suspended. Contact support for assistance."},
                status=status.HTTP_403_FORBIDDEN,
            )

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

        client_ip = self._get_client_ip(request)

        AuditLog.objects.create(
            user=user,
            action="CHANGE_PIN",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=client_ip,
        )

        # Security alert: email + SMS notification for PIN change
        try:
            from apps.core.email import send_pin_change_alert
            device_info = request.META.get("HTTP_USER_AGENT", "Unknown device")
            send_pin_change_alert(user, ip_address=client_ip, device_info=device_info)
        except Exception as e:
            logger.error(f"PIN change security alert failed: {e}")

        return Response({"message": "PIN changed successfully"})

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class VerifyPINView(APIView):
    """Verify user's PIN without triggering device/OTP checks.

    Used by the app lock screen to verify PIN locally.
    Requires authentication (valid JWT token).
    Rate limited to prevent brute force.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        pin = request.data.get("pin", "")
        if not pin or len(pin) != 6:
            return Response(
                {"error": "PIN must be 6 digits"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Rate limit: max 5 PIN verify attempts per minute
        rate_key = f"pin_verify:{request.user.id}"
        attempts = cache.get(rate_key, 0)
        if attempts >= 5:
            return Response(
                {"error": "Too many attempts. Wait a minute."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        if request.user.check_pin(pin):
            cache.delete(rate_key)
            return Response({"verified": True})

        cache.set(rate_key, attempts + 1, timeout=60)
        return Response(
            {"error": "Incorrect PIN", "verified": False},
            status=status.HTTP_401_UNAUTHORIZED,
        )


class KYCDocumentListView(APIView):
    """List and upload KYC documents for identity verification."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        docs = KYCDocument.objects.filter(user=request.user).order_by("-created_at")
        return Response(KYCDocumentSerializer(docs, many=True).data)

    def post(self, request):
        serializer = KYCUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        doc_type = serializer.validated_data["document_type"]

        # Audit MEDIUM-1: file_url field removed · only multipart uploads
        # are accepted. The URL stored on the model is computed
        # server-side from the saved storage path so the user has no
        # opportunity to inject a URL that an admin reviewer might
        # click. Storage path is also constrained to `kyc_docs/` (audit
        # MEDIUM-2) so the ProtectedMediaView allow-list matches.
        import os
        from django.core.files.storage import default_storage

        uploaded_file = serializer.validated_data["file"]
        ext = os.path.splitext(uploaded_file.name)[1] or ".jpg"
        path = f"kyc_docs/{request.user.id}/{doc_type}_{request.user.id}{ext}"
        saved_path = default_storage.save(path, uploaded_file)
        file_url = request.build_absolute_uri(default_storage.url(saved_path))

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

        # Admin alert: notify admins of new KYC document for review
        try:
            from apps.core.email import send_admin_kyc_upload_alert
            send_admin_kyc_upload_alert(request.user, doc_type)
        except Exception as e:
            logger.error(f"Admin KYC upload alert failed: {e}")

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

        # Send verification email (direct, not via Celery)
        from django.core.mail import send_mail
        from django.template.loader import render_to_string

        verify_url = f"https://cpay.co.ke/verify-email?token={token_obj.token}"

        html_content = render_to_string("email/email_verification.html", {
            "full_name": request.user.full_name or request.user.phone,
            "verify_url": verify_url,
            "verification_code": token_obj.otp_code,
        })
        try:
            send_mail(
                "CPay — Verify Your Email",
                "",
                settings.DEFAULT_FROM_EMAIL,
                [email],
                html_message=html_content,
                fail_silently=False,
            )
            logger.info(f"Email verification sent to {email}")
        except Exception as e:
            logger.error(f"Failed to send verification email to {email}: {e}")

        cache.set(rate_key, attempts + 1, timeout=3600)

        AuditLog.objects.create(
            user=request.user,
            action="EMAIL_VERIFY_SENT",
            entity_type="email",
            details={"email": email},
            ip_address=self._get_client_ip(request),
        )

        data = {"message": "Verification email sent"}
        if settings.DEBUG:
            logger.debug(f"[DEV] Email verification OTP: {token_obj.otp_code}")
        return Response(data)

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

        submitted = serializer.validated_data["token"].strip()

        # Audit HIGH-4: dual-scoped brute-force protection.
        # 1. Per-IP cap (5 wrong / 15 min) · catches a noisy single client.
        # 2. Per-submission-fingerprint cap (5 wrong attempts on the same
        #    submitted code · regardless of source IP) · kills the
        #    IP-rotation attack on a specific OTP. We hash the submission
        #    so the rate-limit key doesn't echo the secret into Redis.
        #
        # Use the trusted-proxy-aware client IP (set by D22 middleware)
        # rather than parsing X-Forwarded-For directly, which is spoofable
        # when the request didn't come through Cloudflare.
        client_ip = (
            getattr(request, "real_client_ip", None)
            or request.META.get("REMOTE_ADDR", "")
        )

        import hashlib as _hashlib  # local import keeps top-of-file clean
        sub_fp = _hashlib.sha256(submitted.encode("utf-8")).hexdigest()[:24]
        ip_key = f"email_verify_attempts:ip:{client_ip}"
        sub_key = f"email_verify_attempts:sub:{sub_fp}"

        ip_attempts = cache.get(ip_key, 0)
        sub_attempts = cache.get(sub_key, 0)

        if ip_attempts >= 5 or sub_attempts >= 5:
            return Response(
                {"error": "Too many attempts. Please wait and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Try full token first
        token_obj = EmailVerificationToken.objects.filter(
            token=submitted, is_used=False
        ).first()

        if not token_obj:
            # Match by OTP code · accepts both legacy 6-digit and current
            # 8-char alphanumeric formats during the migration window.
            # `iexact` because the alphabet is uppercase but users may
            # type lowercase; the unambiguous-letter alphabet means there
            # are no ambiguities introduced by case-folding.
            token_obj = EmailVerificationToken.objects.filter(
                otp_code__iexact=submitted, is_used=False
            ).order_by("-created_at").first()

        if not token_obj:
            cache.set(ip_key, ip_attempts + 1, timeout=900)  # 15-min window
            cache.set(sub_key, sub_attempts + 1, timeout=900)
            # Five strikes against the same submitted value ALSO invalidates
            # any active token that happens to match it · removes the
            # narrow window where the same OTP is being targeted.
            if sub_attempts + 1 >= 5:
                EmailVerificationToken.objects.filter(
                    otp_code__iexact=submitted, is_used=False
                ).update(is_used=True)
            return Response(
                {"error": "Invalid or expired verification code"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if token_obj.is_expired:
            return Response(
                {"error": "Verification code has expired. Request a new one."},
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

        # Send confirmation email (direct)
        try:
            from django.core.mail import send_mail
            from django.template.loader import render_to_string

            html_content = render_to_string("email/welcome.html", {
                "full_name": user.full_name or user.phone,
                "phone": user.phone,
            })
            send_mail(
                "CPay — Email Verified Successfully",
                "",
                settings.DEFAULT_FROM_EMAIL,
                [token_obj.email],
                html_message=html_content,
                fail_silently=True,
            )
        except Exception as e:
            logger.error(f"Email verification confirmation failed: {e}")

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

        # Save TOTP (encrypted at rest)
        user.set_totp_secret(secret)
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
        user.set_totp_secret("")
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

        # Enable TOTP on the user (encrypted at rest)
        user.set_totp_secret(secret)
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

        user.set_totp_secret("")
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

        # Audit cycle-2 LOW 10: previously three different preconditions
        # (phone unknown / TOTP not enabled / account deactivated) returned
        # three distinguishable responses, letting an attacker enumerate
        # which phones exist + which have 2FA set up. Collapse every
        # precondition into the same generic 401 as "wrong code" so the
        # verification endpoint leaks nothing.
        generic_invalid = Response(
            {"error": "Invalid authenticator code"},
            status=status.HTTP_401_UNAUTHORIZED,
        )

        try:
            user = User.objects.get(phone=phone)
        except User.DoesNotExist:
            return generic_invalid

        if not user.totp_enabled or not user.totp_secret_decrypted:
            return generic_invalid

        if not user.is_active or user.is_suspended:
            # Still generic 401 here — the active-account status is
            # separately exposed on the /profile/ endpoint for users
            # who are already authenticated, which is the only place
            # that information belongs.
            return generic_invalid

        # Rate limit TOTP verification attempts
        rate_key = f"totp_verify_rate:{user.id}"
        attempts = cache.get(rate_key, 0)
        if attempts >= 5:
            return Response(
                {"error": "Too many verification attempts. Try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Verify TOTP code or backup code
        is_valid = verify_totp(user.totp_secret_decrypted, code) or verify_backup_code(user, code)

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
            "user": UserSerializer(user, context={"request": request}).data,
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

            # Send verification to recovery email (direct)
            token_obj = EmailVerificationToken.create_for_user(user, recovery_email)
            from django.core.mail import send_mail
            from django.template.loader import render_to_string

            html_content = render_to_string("email/email_verification.html", {
                "full_name": user.full_name or user.phone,
                "verify_url": f"https://cpay.co.ke/verify-email?token={token_obj.token}&type=recovery",
                "verification_code": token_obj.token[:6].upper(),
            })
            send_mail(
                "CPay — Verify Recovery Email",
                "",
                settings.DEFAULT_FROM_EMAIL,
                [recovery_email],
                html_message=html_content,
                fail_silently=True,
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


class ForgotPINView(APIView):
    """Step 1: Initiate PIN reset — send OTP to user's phone (default) or email.

    POST /auth/forgot-pin/
    Body: { phone: "+254...", email: true }  ← optional email flag
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ForgotPINSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]
        use_email = request.data.get("email", False)

        # Rate limit: max 3 reset requests per phone per hour
        rate_key = f"pin_reset_rate:{phone}"
        attempts = cache.get(rate_key, 0)
        if attempts >= 3:
            return Response(
                {"error": "Too many reset requests. Try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Always return success to prevent phone enumeration
        response_data = {"message": "If this number is registered, a verification code has been sent."}

        try:
            user = User.objects.get(phone=phone)
        except User.DoesNotExist:
            return Response(response_data)

        if not user.is_active:
            return Response(response_data)

        # Generate OTP and store with pin_reset prefix (5-minute expiry)
        otp = f"{secrets.randbelow(900000) + 100000}"
        cache.set(f"pin_reset_otp:{phone}", otp, timeout=300)
        cache.set(rate_key, attempts + 1, timeout=3600)  # 1 hour window

        # Send OTP to BOTH SMS and email for maximum delivery reliability
        from apps.core.email import send_sms, send_otp_to_email

        channels = []
        # SMS
        sms_sent = send_sms(
            phone,
            f"Your CPay PIN reset code is: {otp}. Do not share this code. Expires in 5 minutes.",
        )
        if sms_sent:
            channels.append("sms")

        # Email (if user has one)
        if user.email:
            email_sent = send_otp_to_email(user.email, otp, phone)
            if email_sent:
                channels.append("email")

        if not channels:
            logger.error(f"PIN reset OTP delivery failed for {phone[:7]}***")

        response_data["channels"] = channels
        # Tell user if 2FA will be required
        if user.totp_enabled:
            response_data["totp_enabled"] = True

        if settings.DEBUG:
            response_data["dev_otp"] = otp

        AuditLog.objects.create(
            user=user,
            action="PIN_RESET_REQUESTED",
            entity_type="user",
            entity_id=str(user.id),
            details={"channel": "email" if use_email else "sms"},
            ip_address=self._get_client_ip(request),
        )

        return Response(response_data)

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class VerifyPINResetOTPView(APIView):
    """Step 2: Verify OTP and issue a short-lived PIN reset token."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyPINResetOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]
        otp = serializer.validated_data["otp"]

        # Brute-force protection on PIN reset OTP
        otp_attempt_key = f"pin_reset_verify_attempts:{phone}"
        otp_attempts = cache.get(otp_attempt_key, 0)
        if otp_attempts >= 5:
            cache.delete(f"pin_reset_otp:{phone}")
            return Response(
                {"error": "Too many failed attempts. Request a new code."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        stored_otp = cache.get(f"pin_reset_otp:{phone}")
        if not stored_otp or stored_otp != otp:
            cache.set(otp_attempt_key, otp_attempts + 1, timeout=300)
            return Response(
                {"error": "Invalid or expired code"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = User.objects.get(phone=phone)
        except User.DoesNotExist:
            return Response(
                {"error": "Invalid or expired code"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Invalidate OTP and attempt counter after successful verification
        cache.delete(f"pin_reset_otp:{phone}")
        cache.delete(otp_attempt_key)

        # If user has TOTP enabled, require TOTP code or backup code
        if user.totp_enabled:
            totp_code = request.data.get("totp_code", "")
            if not totp_code:
                return Response(
                    {
                        "error": "Authenticator code required",
                        "totp_required": True,
                        "message": "This account has 2FA enabled. Enter your authenticator code to continue.",
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            # Verify TOTP or backup code
            from apps.accounts.totp import verify_totp, verify_backup_code
            totp_valid = verify_totp(user.totp_secret, totp_code) if user.totp_secret else False
            if not totp_valid:
                # Try backup code
                backup_valid = verify_backup_code(user, totp_code)
                if not backup_valid:
                    return Response(
                        {"error": "Invalid authenticator or backup code", "totp_required": True},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        # Invalidate any previous unused tokens for this user
        PINResetToken.objects.filter(user=user, is_used=False).update(is_used=True)

        # Create new reset token (15 min expiry)
        token_obj = PINResetToken.create_for_user(user)

        AuditLog.objects.create(
            user=user,
            action="PIN_RESET_OTP_VERIFIED",
            entity_type="user",
            entity_id=str(user.id),
            details={"totp_verified": user.totp_enabled},
            ip_address=self._get_client_ip(request),
        )

        return Response({"reset_token": token_obj.token})

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


class ResetPINView(APIView):
    """Step 3: Set new PIN using a valid reset token."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResetPINSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.validated_data["token"]
        new_pin = serializer.validated_data["new_pin"]

        try:
            token_obj = PINResetToken.objects.get(token=token, is_used=False)
        except PINResetToken.DoesNotExist:
            return Response(
                {"error": "Invalid or expired reset token"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if token_obj.is_expired:
            return Response(
                {"error": "Reset token has expired. Please start over."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = token_obj.user

        # Mark token as used
        token_obj.is_used = True
        token_obj.save(update_fields=["is_used"])

        # Set new PIN
        user.set_pin(new_pin)
        user.pin_attempts = 0
        user.pin_locked_until = None
        user.otp_challenge_required = False
        user.save(update_fields=["pin_hash", "pin_attempts", "pin_locked_until", "otp_challenge_required"])

        client_ip = self._get_client_ip(request)

        AuditLog.objects.create(
            user=user,
            action="PIN_RESET_COMPLETED",
            entity_type="user",
            entity_id=str(user.id),
            ip_address=client_ip,
        )

        # Security alert: notify user that their PIN was reset
        try:
            from apps.core.email import send_pin_reset_alert
            send_pin_reset_alert(user, ip_address=client_ip)
        except Exception as e:
            logger.error(f"PIN reset security alert failed: {e}")

        return Response({"message": "PIN reset successfully. You can now sign in."})

    def _get_client_ip(self, request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


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


# ── Admin Notification Helpers ────────────────────────────────────────────────


def _notify_kyc_review(user, document_type, action, reason=""):
    """Send email + SMS + push notification for KYC document review result."""
    from apps.core.email import send_kyc_status_email
    from apps.core.tasks import send_push_task, send_transaction_sms_task

    status_str = "approved" if action == "approve" else "rejected"
    doc_label = document_type.replace("_", " ").title()

    # Email notification
    send_kyc_status_email(user, document_type, status_str, rejection_reason=reason if action == "reject" else None)

    # SMS notification
    if user.phone:
        if action == "approve":
            sms_msg = f"CryptoPay: Your {doc_label} has been verified. Your account limits have been upgraded. Thank you!"
        else:
            sms_msg = f"CryptoPay: Your {doc_label} was not approved. Reason: {reason}. Please re-upload a valid document."

        _send_admin_sms(user.phone, sms_msg)

    # Push notification
    if action == "approve":
        send_push_task.delay(
            user_id=str(user.id),
            title="Document Verified",
            body=f"Your {doc_label} has been approved. Your account limits have been upgraded.",
            data={"type": "kyc_approved", "document_type": document_type},
        )
    else:
        send_push_task.delay(
            user_id=str(user.id),
            title="Document Review Update",
            body=f"Your {doc_label} was not approved: {reason}",
            data={"type": "kyc_rejected", "document_type": document_type},
        )


def _notify_suspension(user, action, reason=""):
    """Send email + SMS + push notification for account suspension/unsuspension."""
    from apps.core.tasks import send_push_task, send_security_alert_task

    if action == "suspend":
        # Email via security alert
        if user.email:
            send_security_alert_task.delay(
                user_email=user.email,
                user_full_name=user.full_name or user.phone,
                event_type="account_suspended",
                ip_address="N/A",
                device_info=f"Reason: {reason}",
            )

        # SMS
        _send_admin_sms(user.phone, f"CryptoPay: Your account has been suspended. Reason: {reason}. Contact support@cpay.co.ke for assistance.")

        # Push
        send_push_task.delay(
            user_id=str(user.id),
            title="Account Suspended",
            body=f"Your account has been suspended. Reason: {reason}",
            data={"type": "account_suspended"},
        )
    else:
        # Unsuspend
        if user.email:
            send_security_alert_task.delay(
                user_email=user.email,
                user_full_name=user.full_name or user.phone,
                event_type="account_unsuspended",
                ip_address="N/A",
                device_info="Your account access has been restored.",
            )

        _send_admin_sms(user.phone, "CryptoPay: Your account has been reactivated. You can now use all platform features. Thank you for your patience.")

        send_push_task.delay(
            user_id=str(user.id),
            title="Account Reactivated",
            body="Your account has been reactivated. All features are now available.",
            data={"type": "account_unsuspended"},
        )


def _notify_tier_upgrade(user, old_tier, new_tier):
    """Send notifications when KYC tier changes."""
    from apps.core.tasks import send_push_task
    from apps.core.email import send_kyc_status_email

    tier_labels = {0: "Phone Only", 1: "ID Verified", 2: "KRA PIN", 3: "Enhanced DD"}
    tier_limits = {0: "KSh 5,000/day", 1: "KSh 50,000/day", 2: "KSh 250,000/day", 3: "KSh 1,000,000/day"}

    if new_tier > old_tier:
        # Upgrade
        send_push_task.delay(
            user_id=str(user.id),
            title="Account Upgraded",
            body=f"Your account has been upgraded to Tier {new_tier} ({tier_labels.get(new_tier, '')}). New limit: {tier_limits.get(new_tier, '')}",
            data={"type": "kyc_tier_upgraded", "new_tier": new_tier},
        )

        if user.email:
            send_kyc_status_email(user, f"Account Tier {new_tier}", "approved")

        _send_admin_sms(user.phone, f"CryptoPay: Your account has been upgraded to Tier {new_tier} ({tier_labels.get(new_tier, '')}). New daily limit: {tier_limits.get(new_tier, '')}. Thank you!")
    elif new_tier < old_tier:
        # Downgrade
        send_push_task.delay(
            user_id=str(user.id),
            title="Account Tier Updated",
            body=f"Your account tier has been changed to Tier {new_tier} ({tier_labels.get(new_tier, '')}). Limit: {tier_limits.get(new_tier, '')}",
            data={"type": "kyc_tier_changed", "new_tier": new_tier},
        )


def _send_admin_sms(phone, message):
    """Send an SMS using the reusable send_sms helper (eSMS primary, AT fallback)."""
    if not phone:
        return

    from apps.core.email import send_sms
    send_sms(phone, message)


# ── Admin API Views ──────────────────────────────────────────────────────────

from django.db import models as db_models


class IsStaffUser(IsAuthenticated):
    """Permission that requires staff status."""

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_staff


class AdminUserListView(APIView):
    """List users with KYC distribution stats. Staff only."""

    permission_classes = [IsStaffUser]

    def get(self, request):
        from django.db.models import Count

        # KYC distribution
        kyc_distribution = list(
            User.objects.values("kyc_tier")
            .annotate(count=Count("id"))
            .order_by("kyc_tier")
        )
        tier_labels = {
            0: "Phone Only",
            1: "ID Verified",
            2: "KRA PIN",
            3: "Enhanced DD",
        }
        distribution = [
            {
                "tier": row["kyc_tier"],
                "label": tier_labels.get(row["kyc_tier"], f"Tier {row['kyc_tier']}"),
                "count": row["count"],
            }
            for row in kyc_distribution
        ]

        # User list (paginated)
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 20))
        search = request.query_params.get("search", "").strip()
        tier_filter = request.query_params.get("tier")

        qs = User.objects.all().order_by("-created_at")
        if search:
            qs = qs.filter(
                db_models.Q(phone__icontains=search)
                | db_models.Q(full_name__icontains=search)
                | db_models.Q(email__icontains=search)
            )
        if tier_filter is not None and tier_filter != "":
            qs = qs.filter(kyc_tier=int(tier_filter))

        total = qs.count()
        start = (page - 1) * page_size
        users = qs[start : start + page_size]

        # Online window. Anything newer = "active now" dot. 5 minutes is
        # the common convention; matches Slack/Discord presence UX.
        from datetime import timedelta
        online_cutoff = timezone.now() - timedelta(minutes=5)
        # "Active today" is a softer "recently seen" signal (24h).
        today_cutoff = timezone.now() - timedelta(hours=24)

        user_list = []
        for u in users:
            is_online = bool(u.last_activity_at and u.last_activity_at > online_cutoff)
            active_today = bool(u.last_activity_at and u.last_activity_at > today_cutoff)
            user_list.append({
                "id": str(u.id),
                "phone": u.phone,
                "full_name": u.full_name,
                "email": u.email or "",
                "kyc_tier": u.kyc_tier,
                "kyc_status": u.kyc_status,
                "is_active": u.is_active,
                "is_suspended": u.is_suspended,
                "created_at": u.created_at.isoformat(),
                # Presence + activity
                "is_online": is_online,
                "active_today": active_today,
                "last_activity_at": u.last_activity_at.isoformat() if u.last_activity_at else None,
                "last_activity_ip": u.last_activity_ip,
                "last_login_ip": u.last_login_ip,
                "last_login_country": u.last_login_country or None,
                # Platform fingerprint ("apk" / "ios" / "web_mobile" /
                # "web_desktop" / ""). Admin list renders an icon per row.
                "last_platform": u.last_platform or "",
            })

        # Aggregate: total online right now (useful header stat).
        online_count = User.objects.filter(last_activity_at__gt=online_cutoff).count()
        active_today_count = User.objects.filter(last_activity_at__gt=today_cutoff).count()

        return Response(
            {
                "distribution": distribution,
                "users": user_list,
                "total": total,
                "page": page,
                "page_size": page_size,
                "presence": {
                    "online_now": online_count,
                    "active_today": active_today_count,
                    "online_window_minutes": 5,
                },
            }
        )


class AdminVerifyUserView(APIView):
    """Verify a user's KYC tier. Staff only."""

    permission_classes = [IsStaffUser]

    def post(self, request, user_id):
        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response(
                {"detail": "User not found"}, status=status.HTTP_404_NOT_FOUND
            )

        new_tier = request.data.get("kyc_tier")
        if new_tier is None:
            return Response(
                {"detail": "kyc_tier is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        new_tier = int(new_tier)
        if new_tier not in (0, 1, 2, 3):
            return Response(
                {"detail": "Invalid tier. Must be 0-3."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_tier = target_user.kyc_tier
        target_user.kyc_tier = new_tier
        target_user.kyc_status = "verified" if new_tier > 0 else "pending"
        target_user.save(update_fields=["kyc_tier", "kyc_status", "updated_at"])

        # Audit log
        AuditLog.objects.create(
            user=request.user,
            action="admin_verify_user",
            entity_type="user",
            entity_id=str(target_user.id),
            details={
                "target_phone": target_user.phone,
                "old_tier": old_tier,
                "new_tier": new_tier,
            },
        )

        # Send notifications for tier change
        _notify_tier_upgrade(target_user, old_tier, new_tier)

        logger.info(
            "Admin %s verified user %s: tier %d → %d",
            request.user.phone,
            target_user.phone,
            old_tier,
            new_tier,
        )

        return Response(
            {
                "detail": f"User {target_user.phone} updated to tier {new_tier}",
                "user": {
                    "id": str(target_user.id),
                    "phone": target_user.phone,
                    "full_name": target_user.full_name,
                    "kyc_tier": target_user.kyc_tier,
                    "kyc_status": target_user.kyc_status,
                },
            }
        )


class AdminSuspendUserView(APIView):
    """Suspend or unsuspend a user account. Staff only."""

    permission_classes = [IsStaffUser]

    def post(self, request, user_id):
        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"detail": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        if target_user.is_staff:
            return Response({"detail": "Cannot suspend staff accounts"}, status=status.HTTP_403_FORBIDDEN)

        action = request.data.get("action")  # "suspend" or "unsuspend"
        reason = request.data.get("reason", "")

        if action not in ("suspend", "unsuspend"):
            return Response({"detail": "action must be 'suspend' or 'unsuspend'"}, status=status.HTTP_400_BAD_REQUEST)

        if action == "suspend":
            if not reason:
                return Response({"detail": "Suspension reason is required"}, status=status.HTTP_400_BAD_REQUEST)
            target_user.is_suspended = True
            target_user.suspension_reason = reason
            target_user.suspended_at = timezone.now()
            target_user.suspended_by = request.user
            target_user.save(update_fields=["is_suspended", "suspension_reason", "suspended_at", "suspended_by", "updated_at"])
        else:
            target_user.is_suspended = False
            target_user.suspension_reason = ""
            target_user.suspended_at = None
            target_user.suspended_by = None
            target_user.save(update_fields=["is_suspended", "suspension_reason", "suspended_at", "suspended_by", "updated_at"])

        AuditLog.objects.create(
            user=request.user,
            action=f"admin_{action}_user",
            entity_type="user",
            entity_id=str(target_user.id),
            details={
                "target_phone": target_user.phone,
                "action": action,
                "reason": reason,
            },
        )

        # Send notifications
        _notify_suspension(target_user, action, reason)

        logger.info("Admin %s %sed user %s: %s", request.user.phone, action, target_user.phone, reason)

        return Response({
            "detail": f"User {target_user.phone} {action}ed",
            "user": {
                "id": str(target_user.id),
                "phone": target_user.phone,
                "full_name": target_user.full_name,
                "is_suspended": target_user.is_suspended,
                "suspension_reason": target_user.suspension_reason,
                "suspended_at": target_user.suspended_at.isoformat() if target_user.suspended_at else None,
            },
        })


class AdminUserDetailView(APIView):
    """Get detailed user info including activity and audit trail. Staff only."""

    permission_classes = [IsStaffUser]

    def get(self, request, user_id):
        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"detail": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        # Recent transactions
        from apps.payments.models import Transaction
        recent_txns = Transaction.objects.filter(user=target_user).order_by("-created_at")[:20]
        transactions = [
            {
                "id": str(tx.id)[:8],
                "type": tx.type,
                "status": tx.status,
                "source_amount": str(tx.source_amount),
                "source_currency": tx.source_currency,
                "dest_amount": str(tx.dest_amount),
                "dest_currency": tx.dest_currency,
                "created_at": tx.created_at.isoformat(),
            }
            for tx in recent_txns
        ]

        # Wallet balances
        from apps.wallets.models import Wallet
        wallets = Wallet.objects.filter(user=target_user)
        wallet_data = [
            {
                "currency": w.currency,
                "balance": str(w.balance),
                "locked_balance": str(w.locked_balance),
                "available_balance": str(w.available_balance),
            }
            for w in wallets
        ]

        # Devices
        devices = target_user.devices.all().order_by("-last_seen")[:10]
        device_data = [
            {
                "device_name": d.device_name,
                "platform": d.platform,
                "ip_address": d.ip_address,
                "is_trusted": d.is_trusted,
                "last_seen": d.last_seen.isoformat(),
            }
            for d in devices
        ]

        # Audit log for this user (actions ON this user by admins)
        audit_logs = AuditLog.objects.filter(
            entity_type="user",
            entity_id=str(target_user.id),
        ).order_by("-created_at")[:20]
        audit_data = [
            {
                "action": log.action,
                "details": log.details,
                "admin": log.user.phone if log.user else None,
                "created_at": log.created_at.isoformat(),
            }
            for log in audit_logs
        ]

        # Activity timeline — user's OWN actions (login, payments, kyc
        # uploads, etc). Distinct from the audit_data above which is
        # admin-on-user actions. Top 20 most recent.
        activity_logs = AuditLog.objects.filter(
            user=target_user,
        ).order_by("-created_at")[:20]
        activity_data = [
            {
                "action": log.action,
                "ip": log.ip_address,
                "user_agent": (log.user_agent or "")[:120],
                "created_at": log.created_at.isoformat(),
            }
            for log in activity_logs
        ]

        # Login history — a subset of the activity log filtered to auth
        # events. Useful for "logged in from 3 countries this week" UX.
        login_events = AuditLog.objects.filter(
            user=target_user,
            action__in=["LOGIN", "REGISTER", "SECURITY_CHALLENGE", "LOGIN_CHALLENGE_APPROVED"],
        ).order_by("-created_at")[:10]
        login_history = [
            {
                "action": log.action,
                "ip": log.ip_address,
                "details": log.details,
                "created_at": log.created_at.isoformat(),
            }
            for log in login_events
        ]

        # Presence
        from datetime import timedelta
        online_cutoff = timezone.now() - timedelta(minutes=5)
        is_online = bool(target_user.last_activity_at and target_user.last_activity_at > online_cutoff)
        # Current device = most recently-seen device (if any in last 5m).
        current_device = None
        if is_online:
            recent_device = target_user.devices.filter(last_seen__gt=online_cutoff).order_by("-last_seen").first()
            if recent_device:
                current_device = {
                    "device_name": recent_device.device_name,
                    "platform": recent_device.platform,
                    "ip_address": recent_device.ip_address,
                    "is_trusted": recent_device.is_trusted,
                    "last_seen": recent_device.last_seen.isoformat(),
                }

        # KYC documents
        kyc_docs = target_user.kyc_documents.all().order_by("-created_at")
        kyc_data = [
            {
                "id": str(doc.id),
                "document_type": doc.document_type,
                "file_url": doc.file_url,
                "status": doc.status,
                "rejection_reason": doc.rejection_reason,
                "created_at": doc.created_at.isoformat(),
            }
            for doc in kyc_docs
        ]

        return Response({
            "user": {
                "id": str(target_user.id),
                "phone": target_user.phone,
                "full_name": target_user.full_name,
                "email": target_user.email,
                "email_verified": target_user.email_verified,
                "kyc_tier": target_user.kyc_tier,
                "kyc_status": target_user.kyc_status,
                "is_active": target_user.is_active,
                "is_suspended": target_user.is_suspended,
                "suspension_reason": target_user.suspension_reason,
                "suspended_at": target_user.suspended_at.isoformat() if target_user.suspended_at else None,
                "suspended_by": target_user.suspended_by.phone if target_user.suspended_by else None,
                "totp_enabled": target_user.totp_enabled,
                "last_login_ip": target_user.last_login_ip,
                "last_login_country": target_user.last_login_country or None,
                "last_activity_at": target_user.last_activity_at.isoformat() if target_user.last_activity_at else None,
                "last_activity_ip": target_user.last_activity_ip,
                "is_online": is_online,
                "created_at": target_user.created_at.isoformat(),
                "updated_at": target_user.updated_at.isoformat(),
            },
            "wallets": wallet_data,
            "recent_transactions": transactions,
            "devices": device_data,
            "current_device": current_device,
            "audit_log": audit_data,
            "activity_log": activity_data,
            "login_history": login_history,
            "kyc_documents": kyc_data,
        })


class IsSuperUser(IsAuthenticated):
    """Permission that requires superuser status (Django super admin)."""

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_superuser


class AdminPromoteStaffView(APIView):
    """Promote or demote a user to/from staff. Superuser only.

    This is the only way to grant admin access. Protected by Django's
    is_superuser flag — only the original super admin can promote others.
    """

    permission_classes = [IsSuperUser]

    def post(self, request, user_id):
        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"detail": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        if target_user.is_superuser:
            return Response({"detail": "Cannot modify superuser accounts"}, status=status.HTTP_403_FORBIDDEN)

        action = request.data.get("action")  # "promote" or "demote"
        if action not in ("promote", "demote"):
            return Response({"detail": "action must be 'promote' or 'demote'"}, status=status.HTTP_400_BAD_REQUEST)

        if action == "promote":
            target_user.is_staff = True
        else:
            target_user.is_staff = False

        target_user.save(update_fields=["is_staff", "updated_at"])

        AuditLog.objects.create(
            user=request.user,
            action=f"admin_{action}_staff",
            entity_type="user",
            entity_id=str(target_user.id),
            details={
                "target_phone": target_user.phone,
                "action": action,
                "new_is_staff": target_user.is_staff,
            },
        )

        logger.info("Superuser %s %sd staff for %s", request.user.phone, action, target_user.phone)

        return Response({
            "detail": f"User {target_user.phone} {'promoted to' if action == 'promote' else 'demoted from'} staff",
            "user": {
                "id": str(target_user.id),
                "phone": target_user.phone,
                "full_name": target_user.full_name,
                "is_staff": target_user.is_staff,
            },
        })


class AdminReviewKYCView(APIView):
    """Approve or reject a KYC document. Staff only."""

    permission_classes = [IsStaffUser]

    def post(self, request, doc_id):
        try:
            doc = KYCDocument.objects.select_related("user").get(id=doc_id)
        except KYCDocument.DoesNotExist:
            return Response({"detail": "Document not found"}, status=status.HTTP_404_NOT_FOUND)

        action = request.data.get("action")  # "approve" or "reject"
        reason = request.data.get("reason", "")

        if action not in ("approve", "reject"):
            return Response({"detail": "action must be 'approve' or 'reject'"}, status=status.HTTP_400_BAD_REQUEST)

        if action == "reject" and not reason:
            return Response({"detail": "Rejection reason is required"}, status=status.HTTP_400_BAD_REQUEST)

        doc.status = "approved" if action == "approve" else "rejected"
        doc.rejection_reason = reason if action == "reject" else ""
        doc.verified_by = request.user
        doc.save(update_fields=["status", "rejection_reason", "verified_by"])

        target_user = doc.user

        # Audit log
        AuditLog.objects.create(
            user=request.user,
            action=f"admin_{action}_kyc",
            entity_type="kyc_document",
            entity_id=str(doc.id),
            details={
                "target_phone": target_user.phone,
                "document_type": doc.document_type,
                "action": action,
                "reason": reason,
            },
        )

        # Send notifications (email + SMS + push)
        _notify_kyc_review(target_user, doc.document_type, action, reason)

        logger.info("Admin %s %sd KYC doc %s for user %s", request.user.phone, action, doc.document_type, target_user.phone)

        return Response({
            "detail": f"Document {action}d",
            "document": {
                "id": str(doc.id),
                "document_type": doc.document_type,
                "status": doc.status,
                "rejection_reason": doc.rejection_reason,
            },
        })


# ---------------------------------------------------------------------------
# Push-notification login challenge (2FA alternative to SMS OTP)
# ---------------------------------------------------------------------------


class PushChallengeStatusView(APIView):
    """Polled by the login screen (unauthenticated) to learn whether the user
    has tapped Approve/Deny on their other device.

    Returns 200 with { status: pending|approved|denied|expired } while the
    Redis record exists; 404 once it's gone (treat as expired).

    This endpoint is intentionally unauthenticated because at this point the
    client has no access token yet — the login flow hasn't completed. The
    challenge_id itself is the authorization (16-byte url-safe secret,
    single-use, 5-min TTL).
    """

    permission_classes = [AllowAny]

    def get(self, request, challenge_id):
        from .push_challenge import get_challenge

        c = get_challenge(challenge_id)
        if not c:
            return Response({"status": "expired"}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            "status": c.status,
            "requesting_device_name": c.requesting_device_name,
            "requesting_ip": c.requesting_ip,
        })


class PushChallengeApproveView(APIView):
    """Trusted device taps Approve. Requires authentication — only the user
    whose account is being targeted can approve.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, challenge_id):
        from .push_challenge import approve_challenge

        c = approve_challenge(challenge_id, request.user)
        if not c:
            return Response(
                {"error": "Challenge not found or not yours"},
                status=status.HTTP_404_NOT_FOUND,
            )
        AuditLog.objects.create(
            user=request.user,
            action="LOGIN_CHALLENGE_APPROVED",
            details={"challenge_id": challenge_id, "requesting_ip": c.requesting_ip},
            ip_address=request.META.get("REMOTE_ADDR", ""),
        )
        return Response({"status": c.status})


class PushChallengeDenyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, challenge_id):
        from .push_challenge import deny_challenge

        c = deny_challenge(challenge_id, request.user)
        if not c:
            return Response(
                {"error": "Challenge not found or not yours"},
                status=status.HTTP_404_NOT_FOUND,
            )
        AuditLog.objects.create(
            user=request.user,
            action="LOGIN_CHALLENGE_DENIED",
            details={"challenge_id": challenge_id, "requesting_ip": c.requesting_ip},
            ip_address=request.META.get("REMOTE_ADDR", ""),
        )
        return Response({"status": c.status})


# ---------------------------------------------------------------------------
# A1 + A27: logout + hardened token refresh
# ---------------------------------------------------------------------------


class LogoutView(APIView):
    """A1 + A27: explicitly revoke the caller's refresh token.

    Accepts `{"refresh": "<token>"}` · puts it on the SimpleJWT blacklist
    so `/auth/token/refresh/` can no longer mint new access tokens from it.
    A missing or malformed body still returns 205 (idempotent · the client
    always wants to treat "logged out" as reached) but the event is logged.
    Also wipes the JWT cookies (see C1) for web clients.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_token = request.data.get("refresh", "") or request.COOKIES.get(
            "cpay_refresh", ""
        )
        blacklisted = False
        if refresh_token:
            try:
                RefreshToken(refresh_token).blacklist()
                blacklisted = True
            except TokenError:
                # Already blacklisted, expired, or malformed · fine, still log out.
                pass

        try:
            AuditLog.objects.create(
                user=request.user,
                action="LOGOUT",
                details={"blacklisted": blacklisted},
                ip_address=request.META.get("HTTP_CF_CONNECTING_IP")
                or (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
                or request.META.get("REMOTE_ADDR", ""),
            )
        except Exception:
            pass

        resp = Response(
            {"detail": "Logged out", "blacklisted": blacklisted},
            status=status.HTTP_205_RESET_CONTENT,
        )
        # C1: clear the HttpOnly cookies on web.
        for cookie in ("cpay_access", "cpay_refresh", "csrftoken"):
            resp.delete_cookie(
                cookie,
                path="/",
                domain=getattr(settings, "AUTH_COOKIE_DOMAIN", None),
                samesite="Strict",
            )
        return resp


class HardenedTokenRefreshView(_SimpleJWTTokenRefreshView):
    """A27: re-verify the user is still active on every refresh.

    SimpleJWT's default TokenRefreshView validates the signature and
    expiry but does NOT check whether the user has been suspended /
    deactivated / deleted in the meantime. That meant a stolen refresh
    token kept minting access tokens for up to 30 days after ops clicked
    'Suspend'. We now decode the user_id from the refresh token and
    abort if the backing User is not transactable.
    """

    def post(self, request, *args, **kwargs):
        # Allow the web client to send the refresh in a cookie (see C1).
        if "refresh" not in request.data and request.COOKIES.get("cpay_refresh"):
            # Django's request.data is immutable for MultiValueDict · rebuild.
            try:
                request.data._mutable = True  # type: ignore[attr-defined]
            except Exception:
                pass
            try:
                request.data["refresh"] = request.COOKIES["cpay_refresh"]
            except Exception:
                # DRF parsers return a dict-like · coerce via QueryDict if needed.
                from django.http import QueryDict
                qd = QueryDict(mutable=True)
                qd.update(request.data)
                qd["refresh"] = request.COOKIES["cpay_refresh"]
                request._full_data = qd  # type: ignore[attr-defined]

        raw = request.data.get("refresh", "")
        if raw:
            try:
                rt = RefreshToken(raw)
                uid = rt.get("user_id")
                if uid:
                    try:
                        u = User.objects.get(pk=uid)
                        if not u.is_active or getattr(u, "is_suspended", False):
                            return Response(
                                {"detail": "Account not active"},
                                status=status.HTTP_403_FORBIDDEN,
                            )
                    except User.DoesNotExist:
                        return Response(
                            {"detail": "User not found"},
                            status=status.HTTP_401_UNAUTHORIZED,
                        )
            except TokenError:
                # Defer to SimpleJWT's native handler · it returns 401.
                pass

        response = super().post(request, *args, **kwargs)

        # C1: when a new access token was minted, optionally refresh the
        # web HttpOnly cookies. We only set cookies when the request is
        # tagged as coming from the web client to avoid polluting native
        # app responses.
        if (
            response.status_code == 200
            and request.META.get("HTTP_X_CPAY_WEB") == "1"
            and isinstance(response.data, dict)
        ):
            _set_auth_cookies(
                response,
                access=response.data.get("access", ""),
                refresh=response.data.get("refresh", ""),
            )
            # MEDIUM-9: web token refresh = cookies only, drop JSON body.
            # Strip both `access` and `refresh` directly · the SimpleJWT
            # response uses those keys at the top level instead of nested
            # under `tokens`, so _strip_tokens_for_web won't catch them.
            if isinstance(response.data, dict):
                response.data.pop("access", None)
                response.data.pop("refresh", None)
                if hasattr(response, "_is_rendered") and response._is_rendered:
                    response._is_rendered = False
                    response.render()
        return response


def _strip_tokens_for_web(response, request):
    """Audit MEDIUM-9: when the web client (`X-Cpay-Web: 1` header) is
    talking to us, the response cookie contract is the only authenticator
    we want it to see. Returning the JWT JSON in the body too would
    re-expose it to localStorage / window.tokens / any XSS sink, defeating
    the HttpOnly cookie protection.

    Strip `tokens` from the response payload when the header is set. The
    SPA's auth client falls through to the cookie path automatically.
    Native callers (no `X-Cpay-Web` header) keep getting the JSON tokens
    so their existing flow is unchanged.
    """
    if request.META.get("HTTP_X_CPAY_WEB") != "1":
        return
    if not isinstance(getattr(response, "data", None), dict):
        return
    if "tokens" in response.data:
        # Wholesale removal · the SPA reads `data.user`, never `data.tokens`.
        response.data.pop("tokens", None)
        # Re-render so the change reaches the wire (DRF freezes the body
        # after the first render call internally · in practice, since
        # this runs before middleware finalisation, the change holds).
        if hasattr(response, "_is_rendered") and response._is_rendered:
            response._is_rendered = False
            response.render()


def _set_auth_cookies(response, access: str, refresh: str):
    """C1: write JWTs to HttpOnly/Secure cookies so they're invisible to JS.

    Callable from LoginView, RegisterView, HardenedTokenRefreshView. We also
    set a sibling CSRF cookie via Django's csrf middleware so the web client
    can submit `X-CSRFToken` on mutations (pairs with SameSite=Strict).
    """
    from datetime import timedelta

    domain = getattr(settings, "AUTH_COOKIE_DOMAIN", None)
    secure = not settings.DEBUG  # never downgrade cookies to http in prod
    access_ttl = int(
        getattr(settings, "SIMPLE_JWT", {})
        .get("ACCESS_TOKEN_LIFETIME", timedelta(minutes=15))
        .total_seconds()
    )
    refresh_ttl = int(
        getattr(settings, "SIMPLE_JWT", {})
        .get("REFRESH_TOKEN_LIFETIME", timedelta(days=30))
        .total_seconds()
    )
    if access:
        response.set_cookie(
            "cpay_access",
            access,
            max_age=access_ttl,
            httponly=True,
            secure=secure,
            samesite="Strict",
            domain=domain,
            path="/",
        )
    if refresh:
        response.set_cookie(
            "cpay_refresh",
            refresh,
            max_age=refresh_ttl,
            httponly=True,
            secure=secure,
            samesite="Strict",
            domain=domain,
            path="/api/v1/auth/",  # only sent to auth endpoints
        )
    return response
