"""
Single source of truth for the referral program's tunables. Lives in
Django settings as REFERRAL_PROGRAM so product can adjust the numbers
without a code change.
"""
from __future__ import annotations

from decimal import Decimal
from datetime import timedelta

from django.conf import settings


def _cfg() -> dict:
    return getattr(settings, "REFERRAL_PROGRAM", {})


def is_enabled() -> bool:
    return bool(_cfg().get("ENABLED", True))


def referrer_bonus_kes() -> Decimal:
    return Decimal(str(_cfg().get("REFERRER_BONUS_KES", "50.00")))


def referee_bonus_kes() -> Decimal:
    return Decimal(str(_cfg().get("REFEREE_BONUS_KES", "50.00")))


def qualifying_min_kes() -> Decimal:
    """Minimum KES on the referee's first M-Pesa tx for the referral
    to qualify. Raised to qualifying_min_kes_tier0() for KYC tier 0
    users to deter throwaway signups."""
    return Decimal(str(_cfg().get("QUALIFYING_MIN_KES", "500.00")))


def qualifying_min_kes_tier0() -> Decimal:
    return Decimal(str(_cfg().get("QUALIFYING_MIN_KES_TIER0", "1000.00")))


def attribution_window() -> timedelta:
    return timedelta(days=int(_cfg().get("ATTRIBUTION_WINDOW_DAYS", 60)))


def clawback_hold_window() -> timedelta:
    return timedelta(days=int(_cfg().get("CLAWBACK_HOLD_DAYS", 7)))


def credit_expiry_window() -> timedelta:
    return timedelta(days=int(_cfg().get("CREDIT_EXPIRY_DAYS", 180)))


def referrer_monthly_cap() -> int:
    return int(_cfg().get("REFERRER_MONTHLY_CAP", 20))


def referrer_lifetime_cap() -> int:
    return int(_cfg().get("REFERRER_LIFETIME_CAP", 100))


def min_referrer_age_hours() -> int:
    return int(_cfg().get("MIN_REFERRER_AGE_HOURS", 24))


def is_qualifying_tx(tx) -> bool:
    """Whether a Transaction counts as the referee's qualifying first
    payment. Only M-Pesa outbound payments (paybill/till/send) count —
    a deposit or buy-crypto doesn't.
    """
    if tx is None:
        return False
    # Local import to avoid circular (payments app may import this).
    try:
        from apps.payments.models import Transaction
    except Exception:
        return False

    if tx.status != Transaction.Status.COMPLETED:
        return False

    qualifying_types = {
        Transaction.Type.PAYBILL_PAYMENT,
        Transaction.Type.TILL_PAYMENT,
        Transaction.Type.SEND_MPESA,
    }
    if tx.type not in qualifying_types:
        return False

    # Use dest_amount (KES) — matches the project's convention where
    # dest_amount is the user-visible KES figure.
    kes_amount = getattr(tx, "dest_amount", None) or Decimal("0")

    tier0_min = qualifying_min_kes_tier0()
    normal_min = qualifying_min_kes()
    kyc_tier = getattr(tx.user, "kyc_tier", 0) or 0

    min_required = tier0_min if kyc_tier == 0 else normal_min
    return Decimal(str(kes_amount)) >= min_required


# Default settings block — merged into Django settings if the caller
# doesn't already have REFERRAL_PROGRAM defined.
DEFAULTS = {
    "ENABLED": True,
    "REFERRER_BONUS_KES": "50.00",
    "REFEREE_BONUS_KES": "50.00",
    "QUALIFYING_MIN_KES": "500.00",
    "QUALIFYING_MIN_KES_TIER0": "1000.00",
    "ATTRIBUTION_WINDOW_DAYS": 60,
    "CLAWBACK_HOLD_DAYS": 7,
    "CREDIT_EXPIRY_DAYS": 180,
    "REFERRER_MONTHLY_CAP": 20,
    "REFERRER_LIFETIME_CAP": 100,
    "MIN_REFERRER_AGE_HOURS": 24,
}
