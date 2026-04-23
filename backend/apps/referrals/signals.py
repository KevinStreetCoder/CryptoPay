"""
Signals wiring referrals into the payment completion lifecycle.

We listen on post_save of Transaction. When status flips to COMPLETED
and the transaction is a qualifying type, check_qualification runs.

This is intentionally defensive — if payments app isn't installed
(unlikely but possible in test harnesses), the signal import is a
no-op. The signal itself is lightweight: the actual qualification
logic runs in apps.referrals.services.check_qualification.
"""
from __future__ import annotations

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

try:
    from apps.payments.models import Transaction  # type: ignore
except Exception:
    Transaction = None  # type: ignore


if Transaction is not None:

    @receiver(post_save, sender=Transaction, dispatch_uid="referrals_check_qualification")
    def on_transaction_saved(sender, instance, created, **kwargs):
        """Run qualification / clawback hooks on every Transaction save.

        - COMPLETED on a qualifying tx → run `check_qualification`
          (idempotent; no-ops when the user's referral is already
          qualified/rewarded).
        - REVERSED (or FAILED after having been COMPLETED) on a
          transaction that was the *qualifying* deposit for a referral
          → enqueue `claw_back_reward`. This closes the abuse vector
          where an attacker deposits KES 500 to trigger the 50 KES
          bonus, waits for credit, then reverses via M-Pesa support.
        """
        try:
            if instance.status == Transaction.Status.COMPLETED:
                from .services import check_qualification
                check_qualification(instance)
                return

            if instance.status == Transaction.Status.REVERSED:
                # Find any Referral whose qualifying_transaction is this
                # tx and whose status is already qualified/rewarded. A
                # pending referral doesn't need clawback (no credit was
                # issued yet). Queue the clawback task — it already
                # handles idempotency + compensating ledger writes.
                from .models import Referral
                from . import tasks

                affected = list(
                    Referral.objects.filter(
                        qualifying_transaction=instance,
                        status__in=[
                            Referral.Status.QUALIFIED,
                            Referral.Status.REWARDED,
                        ],
                    ).values_list("id", flat=True)
                )
                for ref_id in affected:
                    try:
                        tasks.claw_back_reward.delay(
                            str(ref_id),
                            reason=f"qualifying_tx_reversed:{instance.id}",
                        )
                    except Exception:
                        # Celery-broker hiccup must not crash the reversal
                        # pathway. Fall back to an in-process call so the
                        # clawback still fires, just slower.
                        logger.warning(
                            "referrals.signal.clawback_delay_failed",
                            extra={"referral_id": str(ref_id)},
                        )
                        tasks.claw_back_reward(
                            str(ref_id),
                            reason=f"qualifying_tx_reversed:{instance.id}",
                        )
                if affected:
                    logger.info(
                        "referrals.clawback_triggered",
                        extra={"tx_id": str(instance.id), "count": len(affected)},
                    )
        except Exception:
            logger.exception("referrals.signal.dispatch_failed")
