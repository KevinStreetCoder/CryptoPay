"""
Push-notification based login challenge (2FA alternative to SMS OTP).

When a login triggers a security challenge (new device or similar), and the
user has a push token on another trusted device, we:
  1. Create a short-lived challenge record in Redis (5-min TTL)
  2. Send an Expo push notification to the user's other device(s) with a
     deep link that opens an "Approve sign-in?" screen
  3. The original login flow polls GET /challenge/<id>/status/ until
     approved/denied/expired
  4. On approval, the login request is re-submitted with challenge_id=<id>
     and tokens are issued

SMS remains as automatic fallback if push delivery fails or the user has no
other trusted device with a push token. The user experience is "try the
notification, tap to approve — or fall back to the code we just texted you."

All challenge state is Redis-only (no DB migration needed). Challenges are
single-use and auto-expire after 5 minutes.
"""

import json
import logging
import secrets
import time
from dataclasses import dataclass, asdict
from typing import Optional

from django.conf import settings
from django.core.cache import cache

from apps.accounts.models import PushToken, User
from apps.core.push import send_push_notification

logger = logging.getLogger(__name__)

CHALLENGE_TTL_SECONDS = 300  # 5 minutes
CHALLENGE_KEY_PREFIX = "login_challenge:"

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_DENIED = "denied"
STATUS_EXPIRED = "expired"


@dataclass
class LoginChallenge:
    id: str
    user_id: str
    status: str  # pending | approved | denied | expired
    requesting_ip: str
    requesting_device_id: str
    requesting_device_name: str
    created_at: float  # unix seconds

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> "LoginChallenge":
        return cls(**json.loads(raw))


def _cache_key(challenge_id: str) -> str:
    return f"{CHALLENGE_KEY_PREFIX}{challenge_id}"


def create_challenge(
    user: User,
    requesting_ip: str,
    requesting_device_id: str,
    requesting_device_name: str,
) -> Optional[LoginChallenge]:
    """Create a push challenge and dispatch the notification.

    Returns the LoginChallenge on success, or None if the user has no push
    tokens (caller should fall back to SMS OTP).
    """
    # Don't create a push challenge if the user has no devices that can receive it
    token_count = PushToken.objects.filter(user=user).count()
    if token_count == 0:
        logger.info(
            "push_challenge.skip_no_tokens",
            extra={"user_id": str(user.id)},
        )
        return None

    challenge = LoginChallenge(
        id=secrets.token_urlsafe(16),
        user_id=str(user.id),
        status=STATUS_PENDING,
        requesting_ip=requesting_ip or "",
        requesting_device_id=requesting_device_id or "",
        requesting_device_name=requesting_device_name or "Unknown device",
        created_at=time.time(),
    )
    cache.set(_cache_key(challenge.id), challenge.to_json(), timeout=CHALLENGE_TTL_SECONDS)

    # Fire the push — approximate location is the IP; the mobile approval
    # screen can reverse-geo it if you want, but IP + device name is usually
    # enough to recognize "yes that was me."
    body = (
        f"Sign-in attempt from {challenge.requesting_device_name}. "
        "Tap to approve or deny."
    )
    try:
        send_push_notification(
            user_id=str(user.id),
            title="Approve sign-in?",
            body=body,
            data={
                "type": "login_challenge",
                "challenge_id": challenge.id,
                # Deep link so tapping the notification routes straight to the
                # approval screen. Mobile app must register this route.
                "deep_link": f"cryptopay://approve-login/{challenge.id}",
                "requesting_ip": challenge.requesting_ip,
                "requesting_device_name": challenge.requesting_device_name,
                "expires_in_seconds": CHALLENGE_TTL_SECONDS,
            },
        )
        logger.info(
            "push_challenge.sent",
            extra={
                "user_id": str(user.id),
                "challenge_id": challenge.id,
                "push_token_count": token_count,
            },
        )
    except Exception as e:
        # Don't fail the login flow if push dispatch fails — SMS fallback will
        # still deliver. Just mark it and let the caller decide.
        logger.exception(
            "push_challenge.dispatch_failed",
            extra={"user_id": str(user.id), "error": str(e)},
        )

    return challenge


def get_challenge(challenge_id: str) -> Optional[LoginChallenge]:
    raw = cache.get(_cache_key(challenge_id))
    if not raw:
        return None
    try:
        return LoginChallenge.from_json(raw)
    except (ValueError, TypeError):
        return None


def _save(challenge: LoginChallenge, ttl: int = CHALLENGE_TTL_SECONDS) -> None:
    cache.set(_cache_key(challenge.id), challenge.to_json(), timeout=ttl)


def approve_challenge(challenge_id: str, user: User) -> Optional[LoginChallenge]:
    """User taps Approve on their trusted device.

    Returns the updated challenge on success, None if not found / wrong user /
    already resolved.
    """
    challenge = get_challenge(challenge_id)
    if not challenge:
        return None
    if challenge.user_id != str(user.id):
        logger.warning(
            "push_challenge.approve_wrong_user",
            extra={"challenge_id": challenge_id, "attempted_by": str(user.id)},
        )
        return None
    if challenge.status != STATUS_PENDING:
        return challenge  # idempotent — already resolved
    challenge.status = STATUS_APPROVED
    _save(challenge)
    logger.info("push_challenge.approved", extra={"challenge_id": challenge_id})
    return challenge


def deny_challenge(challenge_id: str, user: User) -> Optional[LoginChallenge]:
    challenge = get_challenge(challenge_id)
    if not challenge:
        return None
    if challenge.user_id != str(user.id):
        return None
    if challenge.status != STATUS_PENDING:
        return challenge
    challenge.status = STATUS_DENIED
    _save(challenge, ttl=60)  # keep denial around briefly so the polling login sees it
    logger.info("push_challenge.denied", extra={"challenge_id": challenge_id})
    return challenge


def consume_if_approved(challenge_id: str, user: User) -> bool:
    """Check if a challenge is approved for this user and consume it (single-use).

    Returns True only if the challenge exists, belongs to the user, and is
    APPROVED. Deletes the challenge key to prevent reuse.
    """
    challenge = get_challenge(challenge_id)
    if not challenge or challenge.user_id != str(user.id):
        return False
    if challenge.status != STATUS_APPROVED:
        return False
    cache.delete(_cache_key(challenge_id))
    return True
