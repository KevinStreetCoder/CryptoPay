"""
Referrals data model.

Four tables:
 - ReferralCode: one per User — holds their short share code.
 - Referral: one per (referrer, referee) pair. A User can only be
   referred once in their lifetime (enforced by OneToOne on referee).
 - RewardLedger: append-only ledger of fee credits. Two rows per
   rewarded referral (one for referrer, one for referee). Clawbacks,
   consumption, and expiry each write a NEW row — rows are never
   mutated after creation so the ledger is fully auditable.
 - ReferralEvent: audit log of every state change.
"""
from __future__ import annotations

import secrets
import string
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Sum, Q
from django.utils import timezone


# ── Code generation ────────────────────────────────────────────────────────
# Exclude ambiguous characters (0/O, 1/I/L). 6 chars = ~1B keyspace,
# collisions are practically impossible but we still retry 5 times.
_CODE_ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "0OI1L")
_CODE_LEN = 6
_CODE_MAX_RETRIES = 5


def _gen_code(user=None) -> str:
    """Generate a candidate referral code. Seeds from user's first-name
    initials where possible (vanity feel, e.g. KEV8F2 for "Kevin")."""
    if user is not None and getattr(user, "full_name", ""):
        first = "".join(c for c in user.full_name.upper() if c in _CODE_ALPHABET)[:3]
        if len(first) >= 2:
            return first + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LEN - len(first)))
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LEN))


def generate_unique_code(user=None) -> str:
    """Generate a code that doesn't collide with any existing ReferralCode.
    Falls back to 8-char code after _CODE_MAX_RETRIES collisions (never
    expected to fire in practice — guard against pathological cases)."""
    for _ in range(_CODE_MAX_RETRIES):
        candidate = _gen_code(user)
        if not ReferralCode.objects.filter(code__iexact=candidate).exists():
            return candidate
    # Extremely unlikely fallback: longer code.
    while True:
        candidate = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
        if not ReferralCode.objects.filter(code__iexact=candidate).exists():
            return candidate


class ReferralCode(models.Model):
    """One short code per user. OneToOne so users can never collect
    multiple codes."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="referral_code",
        primary_key=True,
    )
    code = models.CharField(max_length=8, unique=True, db_index=True)
    is_active = models.BooleanField(
        default=True,
        help_text="Admin kill switch — disables sharing + attribution for abusers.",
    )
    total_invites_sent = models.PositiveIntegerField(
        default=0,
        help_text="Client-reported share events. Informational only.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Referral Code"
        verbose_name_plural = "Referral Codes"

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.code} ({self.user_id})"

    @classmethod
    def get_or_create_for_user(cls, user) -> "ReferralCode":
        rc, _ = cls.objects.get_or_create(
            user=user, defaults={"code": generate_unique_code(user)}
        )
        return rc


class Referral(models.Model):
    """One row per (referrer, referee) pair. A User can only be referred
    once in their lifetime — enforced by OneToOne on referee."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SIGNED_UP = "signed_up", "Signed up"
        QUALIFIED = "qualified", "Qualified"
        REWARDED = "rewarded", "Rewarded"
        CLAWED_BACK = "clawed_back", "Clawed back"
        REJECTED_FRAUD = "rejected_fraud", "Rejected (fraud)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    referrer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="referrals_made",
        db_index=True,
    )
    referee = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="was_referred_by",
    )
    code_used = models.CharField(
        max_length=8,
        help_text="Denormalised — survives ReferralCode.code changes/revokes.",
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.SIGNED_UP, db_index=True
    )
    # Attribution metadata — captured at signup, informs anti-abuse.
    signup_ip = models.GenericIPAddressField(null=True, blank=True)
    signup_device_id = models.CharField(max_length=128, blank=True, db_index=True)
    signup_country = models.CharField(max_length=2, blank=True)
    signup_user_agent = models.TextField(blank=True)
    # Lifecycle timestamps.
    attributed_at = models.DateTimeField(auto_now_add=True)
    qualified_at = models.DateTimeField(null=True, blank=True)
    rewarded_at = models.DateTimeField(null=True, blank=True)
    attribution_window_ends_at = models.DateTimeField(
        help_text="Hard deadline: referee must qualify before this or the referral dies."
    )
    qualifying_transaction = models.ForeignKey(
        "payments.Transaction",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    fraud_reason = models.TextField(blank=True)

    class Meta:
        verbose_name = "Referral"
        verbose_name_plural = "Referrals"
        indexes = [
            models.Index(fields=["referrer", "status"]),
            models.Index(fields=["status", "attributed_at"]),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.referrer_id} → {self.referee_id} ({self.status})"


class RewardLedger(models.Model):
    """Immutable append-only ledger. Balance is computed from row sums.

    - `held` → `available`: the 7-day clawback window flips the status.
    - Clawback: write a negative-amount row, leave original alone.
    - Consumption: write a `consumed` row with negative amount bound to
      the consuming Transaction.
    """

    class Kind(models.TextChoices):
        REFERRER_BONUS = "referrer_bonus", "Referrer bonus"
        REFEREE_BONUS = "referee_bonus", "Referee bonus"
        ADMIN_GRANT = "admin_grant", "Admin grant"
        CLAWBACK = "clawback", "Clawback (negative adj)"
        CONSUMED = "consumed", "Consumed (negative)"

    class Status(models.TextChoices):
        HELD = "held", "Held"
        AVAILABLE = "available", "Available"
        CONSUMED = "consumed", "Consumed"
        CLAWED_BACK = "clawed_back", "Clawed back"
        EXPIRED = "expired", "Expired"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reward_ledger",
        db_index=True,
    )
    amount_kes = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Positive for credits, negative for clawbacks/consumption.",
    )
    currency = models.CharField(max_length=3, default="KES")
    kind = models.CharField(max_length=24, choices=Kind.choices)
    status = models.CharField(max_length=16, choices=Status.choices, db_index=True)
    referral = models.ForeignKey(
        Referral, null=True, blank=True, on_delete=models.SET_NULL, related_name="rewards"
    )
    held_until = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    consumed_by_transaction = models.ForeignKey(
        "payments.Transaction",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    idempotency_key = models.CharField(
        max_length=80,
        unique=True,
        help_text="e.g. 'ref:{referral_id}:referrer'. Blocks double-grants.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = "Reward Ledger Entry"
        verbose_name_plural = "Reward Ledger"
        indexes = [
            models.Index(fields=["user", "status"]),
            models.Index(fields=["status", "held_until"]),
            models.Index(fields=["status", "expires_at"]),
        ]

    def __str__(self) -> str:  # pragma: no cover
        sign = "+" if self.amount_kes > 0 else ""
        return f"{self.user_id} {sign}{self.amount_kes} {self.currency} ({self.kind})"

    @classmethod
    def available_credit_for(cls, user) -> Decimal:
        """Sum of credits the user can spend right now on fees."""
        agg = cls.objects.filter(user=user, status=cls.Status.AVAILABLE).aggregate(
            total=Sum("amount_kes")
        )
        return agg["total"] or Decimal("0.00")

    @classmethod
    def pending_credit_for(cls, user) -> Decimal:
        agg = cls.objects.filter(user=user, status=cls.Status.HELD).aggregate(
            total=Sum("amount_kes")
        )
        return agg["total"] or Decimal("0.00")

    @classmethod
    def total_earned_for(cls, user) -> Decimal:
        """Cumulative positive credit the user has ever earned. Includes
        already-consumed credits — i.e. "lifetime earned"."""
        agg = cls.objects.filter(
            user=user,
            kind__in=[cls.Kind.REFERRER_BONUS, cls.Kind.REFEREE_BONUS, cls.Kind.ADMIN_GRANT],
            amount_kes__gt=0,
        ).aggregate(total=Sum("amount_kes"))
        return agg["total"] or Decimal("0.00")


class ReferralEvent(models.Model):
    """Audit log — every material state change writes a row. Immutable."""

    class EventType(models.TextChoices):
        CODE_VIEWED = "code_viewed"
        CODE_SHARED = "code_shared"
        LINK_CLICKED = "link_clicked"
        SIGNUP_ATTRIBUTED = "signup_attributed"
        QUALIFIED = "qualified"
        REWARDED = "rewarded"
        CLAWED_BACK = "clawed_back"
        FRAUD_FLAGGED = "fraud_flagged"
        CREDIT_CONSUMED = "credit_consumed"
        CREDIT_EXPIRED = "credit_expired"

    referral = models.ForeignKey(
        Referral, null=True, blank=True, on_delete=models.SET_NULL, related_name="events"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    event_type = models.CharField(max_length=32, choices=EventType.choices, db_index=True)
    payload = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    device_id = models.CharField(max_length=128, blank=True)
    user_agent = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Referral Event"
        verbose_name_plural = "Referral Events"
        ordering = ["-created_at"]
