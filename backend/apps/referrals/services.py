"""
Referrals core service functions.

attribute_signup(user, code, request_meta) — bind a Referral at user
create time. Runs fraud checks; returns the Referral row (or None if
rejected).

check_qualification(transaction) — called from the payments saga when
a Transaction flips to completed. If the user is a referee with a
live attribution, mark the referral qualified and enqueue reward grant.

apply_credit_to_fee(tx, fee_kes) — returns (reduced_fee, applied_credit)
and writes a `consumed` ledger row bound to the transaction. Called
from payments fee computation before persisting the tx.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional

from django.db import transaction as db_tx
from django.utils import timezone

from .constants import (
    attribution_window,
    is_enabled,
    is_qualifying_tx,
    referrer_lifetime_cap,
    referrer_monthly_cap,
    min_referrer_age_hours,
)
from .models import Referral, ReferralCode, ReferralEvent, RewardLedger

logger = logging.getLogger(__name__)


def _log_event(
    *,
    event_type: str,
    referral: Optional[Referral] = None,
    user=None,
    payload: Optional[dict] = None,
    ip: Optional[str] = None,
    device_id: str = "",
    user_agent: str = "",
) -> None:
    ReferralEvent.objects.create(
        event_type=event_type,
        referral=referral,
        user=user,
        payload=payload or {},
        ip_address=ip,
        device_id=device_id,
        user_agent=user_agent,
    )


def _referrer_hit_caps(referrer) -> bool:
    """True if the referrer has hit either their monthly or lifetime
    cap. Uses the REWARDED status to count (not SIGNED_UP) — only
    completed/rewarded referrals count against the cap."""
    now = timezone.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_count = Referral.objects.filter(
        referrer=referrer,
        status=Referral.Status.REWARDED,
        rewarded_at__gte=month_start,
    ).count()
    if monthly_count >= referrer_monthly_cap():
        return True
    lifetime_count = Referral.objects.filter(
        referrer=referrer, status=Referral.Status.REWARDED
    ).count()
    return lifetime_count >= referrer_lifetime_cap()


def _referrer_eligible(referrer) -> tuple[bool, str]:
    """Check referrer is old enough + has transacted once. Returns
    (eligible, reason_if_not)."""
    from datetime import timedelta
    min_age = timezone.now() - timedelta(hours=min_referrer_age_hours())
    # User model uses created_at (AbstractBaseUser), not date_joined.
    joined = getattr(referrer, "created_at", None) or getattr(referrer, "date_joined", None)
    if joined and joined > min_age:
        return False, "referrer_too_new"

    # Optional: check they've transacted. Defer this to avoid a hard
    # dep on payments — a referrer with zero txs is likely a fake
    # account but may also be a legit early adopter. We gate on age
    # only for now.
    return True, ""


def attribute_signup(
    *,
    user,
    code: str,
    request_meta: Optional[dict] = None,
) -> Optional[Referral]:
    """Bind a Referral at user-create time.

    Returns the Referral row, or None if the code is invalid / self-
    referral / referrer ineligible / caps hit. The caller (RegisterView)
    should NOT fail the signup — a bad code is silently ignored.
    """
    if not is_enabled() or not code:
        return None

    request_meta = request_meta or {}
    ip = request_meta.get("ip")
    device_id = request_meta.get("device_id", "")
    user_agent = request_meta.get("user_agent", "")
    country = request_meta.get("country", "")

    code = code.strip().upper()
    try:
        rc = ReferralCode.objects.select_related("user").get(
            code__iexact=code, is_active=True
        )
    except ReferralCode.DoesNotExist:
        logger.info("referrals.attribute_signup.code_not_found", extra={"code": code})
        return None

    referrer = rc.user

    # Guard: self-referral (same user_id — can happen if someone uses
    # their own code after a failed signup).
    if referrer.id == user.id:
        _log_event(
            event_type=ReferralEvent.EventType.FRAUD_FLAGGED,
            user=user,
            payload={"reason": "self_referral", "code": code},
            ip=ip,
            device_id=device_id,
        )
        return None

    # Guard: referrer caps.
    eligible, why = _referrer_eligible(referrer)
    if not eligible:
        _log_event(
            event_type=ReferralEvent.EventType.FRAUD_FLAGGED,
            user=user,
            payload={"reason": why, "referrer_id": str(referrer.id)},
            ip=ip,
            device_id=device_id,
        )
        return None

    if _referrer_hit_caps(referrer):
        _log_event(
            event_type=ReferralEvent.EventType.FRAUD_FLAGGED,
            user=user,
            payload={"reason": "referrer_cap_hit", "referrer_id": str(referrer.id)},
            ip=ip,
            device_id=device_id,
        )
        return None

    # Guard: same device already attached to an existing Referral as
    # the referee. Blocks device farms.
    if device_id and Referral.objects.filter(signup_device_id=device_id).exists():
        _log_event(
            event_type=ReferralEvent.EventType.FRAUD_FLAGGED,
            user=user,
            payload={"reason": "device_already_used"},
            ip=ip,
            device_id=device_id,
        )
        return None

    # All checks passed — create the referral.
    with db_tx.atomic():
        referral = Referral.objects.create(
            referrer=referrer,
            referee=user,
            code_used=code,
            status=Referral.Status.SIGNED_UP,
            signup_ip=ip,
            signup_device_id=device_id,
            signup_country=country,
            signup_user_agent=user_agent,
            attribution_window_ends_at=timezone.now() + attribution_window(),
        )
        _log_event(
            event_type=ReferralEvent.EventType.SIGNUP_ATTRIBUTED,
            referral=referral,
            user=user,
            payload={"code": code, "referrer_id": str(referrer.id)},
            ip=ip,
            device_id=device_id,
            user_agent=user_agent,
        )
    return referral


def check_qualification(transaction) -> None:
    """Called from the payments saga on every Transaction completion.

    If the user has a SIGNED_UP referral within the attribution window
    and this is a qualifying M-Pesa payment, mark the referral as
    QUALIFIED and enqueue the reward grant.
    """
    if not is_enabled():
        return

    if not is_qualifying_tx(transaction):
        return

    try:
        referral = Referral.objects.select_for_update().get(
            referee=transaction.user,
            status=Referral.Status.SIGNED_UP,
        )
    except Referral.DoesNotExist:
        return

    now = timezone.now()
    if referral.attribution_window_ends_at < now:
        # Window expired — mark rejected.
        referral.status = Referral.Status.REJECTED_FRAUD
        referral.fraud_reason = "attribution_window_expired"
        referral.save(update_fields=["status", "fraud_reason"])
        return

    with db_tx.atomic():
        referral.status = Referral.Status.QUALIFIED
        referral.qualified_at = now
        referral.qualifying_transaction = transaction
        referral.save(
            update_fields=["status", "qualified_at", "qualifying_transaction"]
        )
        _log_event(
            event_type=ReferralEvent.EventType.QUALIFIED,
            referral=referral,
            user=transaction.user,
            payload={"transaction_id": str(transaction.id)},
        )

    # Enqueue reward grant — imported lazily to avoid circular at app
    # boot.
    from . import tasks
    tasks.grant_referral_rewards.delay(str(referral.id))


def apply_credit_to_fee(tx, fee_kes: Decimal) -> tuple[Decimal, Decimal]:
    """Apply available referral credit to an outbound payment's fee.

    Writes a `consumed` RewardLedger row (negative amount) bound to
    the transaction. Returns (reduced_fee, applied_credit_amount).

    Called from apps.payments.services.compute_fee() — idempotent per
    transaction via idempotency_key = 'consume:{tx_id}'.
    """
    if not is_enabled() or fee_kes <= 0:
        return fee_kes, Decimal("0.00")

    user = tx.user
    available = RewardLedger.available_credit_for(user)
    if available <= 0:
        return fee_kes, Decimal("0.00")

    applied = min(available, fee_kes)
    reduced_fee = fee_kes - applied

    # Idempotent write.
    key = f"consume:{tx.id}"
    if RewardLedger.objects.filter(idempotency_key=key).exists():
        return reduced_fee, applied

    with db_tx.atomic():
        # Oldest credits first (FIFO) — walk AVAILABLE rows until
        # `applied` is covered, flipping each to CONSUMED.
        remaining = applied
        for row in RewardLedger.objects.select_for_update().filter(
            user=user, status=RewardLedger.Status.AVAILABLE
        ).order_by("created_at"):
            if remaining <= 0:
                break
            take = min(row.amount_kes, remaining)
            # If we're consuming the whole row, mark it consumed.
            # Partial consumption writes a negative consumption row +
            # leaves the original partially spent.
            if take >= row.amount_kes:
                row.status = RewardLedger.Status.CONSUMED
                row.consumed_by_transaction = tx
                row.save(update_fields=["status", "consumed_by_transaction"])
                remaining -= row.amount_kes
            else:
                # Split: reduce original, write a consumed -take row.
                row.amount_kes = row.amount_kes - take
                row.save(update_fields=["amount_kes"])
                remaining -= take

        RewardLedger.objects.create(
            user=user,
            amount_kes=-applied,
            kind=RewardLedger.Kind.CONSUMED,
            status=RewardLedger.Status.CONSUMED,
            idempotency_key=key,
            consumed_by_transaction=tx,
            notes=f"Applied KES {applied} credit to transaction {tx.id} fee",
        )
        _log_event(
            event_type=ReferralEvent.EventType.CREDIT_CONSUMED,
            user=user,
            payload={"transaction_id": str(tx.id), "amount_kes": str(applied)},
        )

    return reduced_fee, applied
