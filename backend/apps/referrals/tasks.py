"""
Celery tasks for the referrals subsystem.

 - grant_referral_rewards: creates two HELD ledger rows for a qualified
   referral. Schedules release_held_rewards after the clawback window.
 - release_held_rewards: flips HELD → AVAILABLE on a specific referral.
 - expire_unused_credit: daily sweep that flips overdue credits to
   EXPIRED.
 - claw_back_reward: admin-initiated; writes a compensating negative row.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from celery import shared_task
from django.db import transaction as db_tx
from django.utils import timezone

from .constants import (
    clawback_hold_window,
    credit_expiry_window,
    referee_bonus_kes,
    referrer_bonus_kes,
)
from .models import Referral, ReferralEvent, RewardLedger

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def grant_referral_rewards(self, referral_id: str) -> None:
    """Mint two HELD ledger rows (referrer + referee) for a qualified
    referral. Idempotent via the ledger's unique idempotency_key."""
    try:
        with db_tx.atomic():
            referral = Referral.objects.select_for_update().get(id=referral_id)
            if referral.status != Referral.Status.QUALIFIED:
                logger.info(
                    "referrals.grant.skipped_not_qualified",
                    extra={"referral_id": referral_id, "status": referral.status},
                )
                return

            hold_until = timezone.now() + clawback_hold_window()

            referrer_amount = referrer_bonus_kes()
            referee_amount = referee_bonus_kes()

            # Referrer bonus — HELD.
            RewardLedger.objects.get_or_create(
                idempotency_key=f"ref:{referral.id}:referrer",
                defaults={
                    "user": referral.referrer,
                    "amount_kes": referrer_amount,
                    "kind": RewardLedger.Kind.REFERRER_BONUS,
                    "status": RewardLedger.Status.HELD,
                    "referral": referral,
                    "held_until": hold_until,
                },
            )

            # Referee bonus — available immediately (design: user feels
            # the credit on their NEXT payment, no 7-day wait). Still
            # subject to the 180d expiry.
            RewardLedger.objects.get_or_create(
                idempotency_key=f"ref:{referral.id}:referee",
                defaults={
                    "user": referral.referee,
                    "amount_kes": referee_amount,
                    "kind": RewardLedger.Kind.REFEREE_BONUS,
                    "status": RewardLedger.Status.AVAILABLE,
                    "referral": referral,
                    "expires_at": timezone.now() + credit_expiry_window(),
                },
            )

            referral.status = Referral.Status.REWARDED
            referral.rewarded_at = timezone.now()
            referral.save(update_fields=["status", "rewarded_at"])

            ReferralEvent.objects.create(
                event_type=ReferralEvent.EventType.REWARDED,
                referral=referral,
                user=referral.referrer,
                payload={
                    "referrer_amount_kes": str(referrer_amount),
                    "referee_amount_kes": str(referee_amount),
                },
            )

        # Notify referee immediately — they can feel the credit.
        _notify_referee(referral.referee, referee_amount)

        # Schedule referrer release after clawback window.
        release_held_rewards.apply_async(
            args=[str(referral.id)], eta=hold_until
        )
    except Referral.DoesNotExist:
        logger.warning("referrals.grant.referral_missing", extra={"referral_id": referral_id})
    except Exception as exc:
        logger.exception("referrals.grant.error")
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def release_held_rewards(self, referral_id: str) -> None:
    """Flip the referrer's HELD bonus to AVAILABLE after the 7-day
    clawback window. Also notifies the referrer."""
    try:
        with db_tx.atomic():
            referral = Referral.objects.select_for_update().get(id=referral_id)
            if referral.status in (
                Referral.Status.CLAWED_BACK,
                Referral.Status.REJECTED_FRAUD,
            ):
                logger.info(
                    "referrals.release.skipped_clawed_back",
                    extra={"referral_id": referral_id},
                )
                return

            rows = RewardLedger.objects.select_for_update().filter(
                referral=referral,
                kind=RewardLedger.Kind.REFERRER_BONUS,
                status=RewardLedger.Status.HELD,
            )
            for row in rows:
                row.status = RewardLedger.Status.AVAILABLE
                row.expires_at = timezone.now() + credit_expiry_window()
                row.held_until = None
                row.save(update_fields=["status", "expires_at", "held_until"])

        _notify_referrer(referral.referrer, referrer_bonus_kes())
    except Referral.DoesNotExist:
        logger.warning("referrals.release.referral_missing", extra={"referral_id": referral_id})
    except Exception as exc:
        logger.exception("referrals.release.error")
        raise self.retry(exc=exc)


@shared_task
def expire_unused_credit() -> int:
    """Daily beat — flip credits past expires_at from AVAILABLE to
    EXPIRED. Returns count for observability."""
    now = timezone.now()
    rows = RewardLedger.objects.filter(
        status=RewardLedger.Status.AVAILABLE,
        expires_at__lt=now,
    )
    count = 0
    for row in rows:
        row.status = RewardLedger.Status.EXPIRED
        row.save(update_fields=["status"])
        ReferralEvent.objects.create(
            event_type=ReferralEvent.EventType.CREDIT_EXPIRED,
            user=row.user,
            payload={"ledger_id": str(row.id), "amount_kes": str(row.amount_kes)},
        )
        count += 1
    logger.info("referrals.expire.done", extra={"count": count})
    return count


@shared_task
def claw_back_reward(referral_id: str, reason: str = "admin_clawback") -> None:
    """Admin-initiated clawback. Writes compensating negative rows
    against any HELD or AVAILABLE credit tied to the referral. Marks
    the Referral as CLAWED_BACK."""
    try:
        with db_tx.atomic():
            referral = Referral.objects.select_for_update().get(id=referral_id)
            touched = 0
            for row in RewardLedger.objects.select_for_update().filter(
                referral=referral,
                status__in=[RewardLedger.Status.HELD, RewardLedger.Status.AVAILABLE],
            ):
                # Original row retained; a negative offset row tracks
                # the clawback for audit.
                RewardLedger.objects.create(
                    user=row.user,
                    amount_kes=-row.amount_kes,
                    kind=RewardLedger.Kind.CLAWBACK,
                    status=RewardLedger.Status.CLAWED_BACK,
                    referral=referral,
                    idempotency_key=f"clawback:{row.id}",
                    notes=f"Clawback reason: {reason}",
                )
                row.status = RewardLedger.Status.CLAWED_BACK
                row.save(update_fields=["status"])
                touched += 1

            referral.status = Referral.Status.CLAWED_BACK
            referral.fraud_reason = reason
            referral.save(update_fields=["status", "fraud_reason"])

            ReferralEvent.objects.create(
                event_type=ReferralEvent.EventType.CLAWED_BACK,
                referral=referral,
                user=referral.referee,
                payload={"reason": reason, "rows_clawed": touched},
            )
    except Referral.DoesNotExist:
        logger.warning(
            "referrals.clawback.referral_missing", extra={"referral_id": referral_id}
        )


# ── Notifications ─────────────────────────────────────────────────────────
# Route through the existing notification subsystem (email + SMS + push).


def _notify_referee(user, amount_kes: Decimal) -> None:
    """Referee-side notification: 'You saved KES X on your first payment!'"""
    try:
        from apps.core.tasks import send_sms_task  # type: ignore
        msg = (
            f"Welcome to Cpay. You've earned KES {amount_kes:.0f} off your first "
            f"fee — automatically applied on your next payment."
        )
        if user.phone:
            send_sms_task.delay(user.phone, msg)
    except Exception:
        logger.exception("referrals.notify_referee.failed")


def _notify_referrer(user, amount_kes: Decimal) -> None:
    """Referrer-side notification: 'Your friend joined. KES X credit available.'"""
    try:
        from apps.core.tasks import send_sms_task  # type: ignore
        msg = (
            f"Your Cpay invite paid off. KES {amount_kes:.0f} credit is now "
            f"live in your account — applied to your next fee."
        )
        if user.phone:
            send_sms_task.delay(user.phone, msg)
    except Exception:
        logger.exception("referrals.notify_referrer.failed")
