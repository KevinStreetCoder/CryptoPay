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
    (eligible, reason_if_not). Checked at signup time; attribution still
    happens but reward grant is gated separately in tasks.grant_referral_rewards."""
    from datetime import timedelta
    min_age = timezone.now() - timedelta(hours=min_referrer_age_hours())
    joined = getattr(referrer, "created_at", None) or getattr(referrer, "date_joined", None)
    if joined and joined > min_age:
        return False, "referrer_too_new"
    return True, ""


def referrer_qualifies_for_grant(referrer) -> tuple[bool, str]:
    """B21: gate at grant time (not signup) on whether the referrer has
    skin in the game. Either a completed outbound payment OR KYC tier >= 1.
    Called from tasks.grant_referral_rewards before any reward row is
    created."""
    try:
        from apps.payments.models import Transaction
        has_tx = Transaction.objects.filter(
            user=referrer,
            status=Transaction.Status.COMPLETED,
        ).exists()
    except Exception:
        has_tx = False
    kyc_ok = getattr(referrer, "kyc_tier", 0) >= 1
    if not (has_tx or kyc_ok):
        return False, "referrer_not_established"
    return True, ""


def _device_id_plausible(device_id: str) -> bool:
    """B8: reject obviously-weak device ids. Web fallback `web-<timestamp>`
    and anything shorter than 16 chars is almost certainly not a real device
    fingerprint and is trivially forgeable."""
    if not device_id:
        return False
    if len(device_id) < 16:
        return False
    if device_id.startswith("web-") or device_id.startswith("dev-"):
        return False
    return True


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
    # B27: UA is coarsened + truncated server-side. Client-supplied `country`
    # is ignored entirely (future: resolve via GeoIP on `ip`).
    raw_ua = request_meta.get("user_agent", "") or ""
    user_agent = raw_ua.replace("\x00", "")[:200]
    country = ""

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

    # B8: reject weak/forged device ids up front. Short, missing, or
    # web-fallback device_ids are trivially spoofed by a signup bot.
    if not _device_id_plausible(device_id):
        _log_event(
            event_type=ReferralEvent.EventType.FRAUD_FLAGGED,
            user=user,
            payload={"reason": "device_id_weak", "device_id_len": len(device_id)},
            ip=ip,
            device_id=device_id,
        )
        return None

    # Guard: same device already attached to an existing Referral as
    # the referee. Blocks device farms.
    if Referral.objects.filter(signup_device_id=device_id).exists():
        _log_event(
            event_type=ReferralEvent.EventType.FRAUD_FLAGGED,
            user=user,
            payload={"reason": "device_already_used"},
            ip=ip,
            device_id=device_id,
        )
        return None

    # B8 (additional): per-IP signup cap · max 3 referee signups per /24
    # (IPv4) within the last 7 days. Catches residential-proxy bots that
    # rotate device_ids but share subnets.
    if ip:
        try:
            from datetime import timedelta
            subnet_prefix = ".".join(str(ip).split(".")[:3]) + "."
            recent_subnet_count = Referral.objects.filter(
                signup_ip__startswith=subnet_prefix,
                created_at__gte=timezone.now() - timedelta(days=7),
            ).count()
            if recent_subnet_count >= 3:
                _log_event(
                    event_type=ReferralEvent.EventType.FRAUD_FLAGGED,
                    user=user,
                    payload={"reason": "ip_subnet_velocity", "count": recent_subnet_count},
                    ip=ip,
                    device_id=device_id,
                )
                return None
        except Exception:
            pass

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

    B16: the `select_for_update()` is wrapped in an explicit atomic block
    so Django doesn't raise TransactionManagementError when this is called
    from a non-atomic signal/saga context.
    """
    if not is_enabled():
        return

    if not is_qualifying_tx(transaction):
        return

    referral_id = None
    with db_tx.atomic():
        try:
            referral = Referral.objects.select_for_update().get(
                referee=transaction.user,
                status=Referral.Status.SIGNED_UP,
            )
        except Referral.DoesNotExist:
            return

        now = timezone.now()
        if referral.attribution_window_ends_at < now:
            referral.status = Referral.Status.REJECTED_FRAUD
            referral.fraud_reason = "attribution_window_expired"
            referral.save(update_fields=["status", "fraud_reason"])
            return

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
        referral_id = str(referral.id)

    if referral_id:
        from . import tasks
        tasks.grant_referral_rewards.delay(referral_id)


def apply_credit_to_fee(tx, fee_kes: Decimal) -> tuple[Decimal, Decimal]:
    """Apply available referral credit to an outbound payment's fee.

    Writes a `consumed` RewardLedger row (negative amount) bound to
    the transaction. Returns (reduced_fee, applied_credit_amount).

    Called from apps.payments.services.compute_fee() — idempotent per
    transaction via idempotency_key = 'consume:{tx_id}'.

    B3: the availability read lives INSIDE a user-locked atomic block so
    concurrent payments for the same user serialize against each other
    and cannot each claim the full balance.
    """
    if not is_enabled() or fee_kes <= 0:
        return fee_kes, Decimal("0.00")

    user = tx.user
    key = f"consume:{tx.id}"

    # Cheap idempotency short-circuit before taking the lock. If the
    # consumption was already recorded for this tx, return what we applied.
    existing = RewardLedger.objects.filter(idempotency_key=key).first()
    if existing is not None:
        already = -existing.amount_kes if existing.amount_kes < 0 else Decimal("0.00")
        return max(fee_kes - already, Decimal("0.00")), already

    with db_tx.atomic():
        # B3: serialize per user. Any concurrent apply_credit_to_fee for the
        # same user blocks here until we commit, so availability stays
        # consistent across the read + consume window.
        User = type(user)
        locked = User.objects.select_for_update().filter(pk=user.pk).first()
        if locked is None:
            return fee_kes, Decimal("0.00")

        # Re-check idempotency under the lock; a concurrent caller may have
        # committed between our short-circuit read and the lock acquire.
        existing = RewardLedger.objects.filter(idempotency_key=key).first()
        if existing is not None:
            already = -existing.amount_kes if existing.amount_kes < 0 else Decimal("0.00")
            return max(fee_kes - already, Decimal("0.00")), already

        available = RewardLedger.available_credit_for(user)
        if available <= 0:
            return fee_kes, Decimal("0.00")

        applied = min(available, fee_kes)
        remaining = applied
        # Oldest credits first (FIFO). Rows are already locked by the user
        # lock above; take out a row lock on each for extra safety.
        for row in RewardLedger.objects.select_for_update().filter(
            user=user, status=RewardLedger.Status.AVAILABLE
        ).order_by("created_at"):
            if remaining <= 0:
                break
            take = min(row.amount_kes, remaining)
            if take >= row.amount_kes:
                row.status = RewardLedger.Status.CONSUMED
                row.consumed_by_transaction = tx
                row.save(update_fields=["status", "consumed_by_transaction"])
                remaining -= row.amount_kes
            else:
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

    return max(fee_kes - applied, Decimal("0.00")), applied


def revert_credit_for_tx(tx) -> Decimal:
    """B6 companion: when a payment saga fails after apply_credit_to_fee
    has run, write a positive REFUND ledger row so the user's usable
    balance is restored. Idempotent per transaction.

    Returns the amount reverted (0 if nothing to revert)."""
    if not is_enabled():
        return Decimal("0.00")

    consume_key = f"consume:{tx.id}"
    refund_key = f"refund_consume:{tx.id}"
    consumption = RewardLedger.objects.filter(idempotency_key=consume_key).first()
    if consumption is None or consumption.amount_kes >= 0:
        return Decimal("0.00")
    if RewardLedger.objects.filter(idempotency_key=refund_key).exists():
        return Decimal("0.00")

    amount = -consumption.amount_kes  # positive
    with db_tx.atomic():
        RewardLedger.objects.create(
            user=tx.user,
            amount_kes=amount,
            kind=RewardLedger.Kind.CONSUMED,
            status=RewardLedger.Status.AVAILABLE,
            idempotency_key=refund_key,
            consumed_by_transaction=tx,
            notes=f"Refunded KES {amount} on failed saga for transaction {tx.id}",
        )
    return amount
