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
        """Run qualification check on every Transaction save where
        status is COMPLETED. Idempotent (check_qualification no-ops if
        the user's referral is already qualified/rewarded)."""
        try:
            if instance.status != Transaction.Status.COMPLETED:
                return
            # Lazy-import service to avoid app-load cycles.
            from .services import check_qualification
            check_qualification(instance)
        except Exception:
            logger.exception("referrals.signal.check_qualification_failed")
