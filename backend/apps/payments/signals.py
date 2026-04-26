"""Payment domain signal handlers.

Currently maintains the `Transaction.has_open_reconciliation`
denormalised flag whenever a `ReconciliationCase` is saved or deleted
· the API layer reads that flag on every withdraw / swap to refuse
sensitive actions on a transaction that ops are still investigating.

Why denormalised · reading "is there at least one OPEN/ESCALATED
ReconciliationCase for this user's transaction" on every API request
would mean a join + WHERE per call. The flag turns it into a single
indexed boolean lookup. Cost: signal handlers must keep both sides
in lockstep · which is what this module does.
"""
from __future__ import annotations

import logging

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import ReconciliationCase, Transaction

logger = logging.getLogger(__name__)

_OPEN_STATUSES = {ReconciliationCase.Status.OPEN, ReconciliationCase.Status.ESCALATED}


def _recompute_flag(transaction_id) -> None:
    """Re-evaluate has_open_reconciliation for one transaction.

    Idempotent · rewrites the flag from the live state of the
    ReconciliationCase table. Cheaper than guessing at delta logic
    inside post_save (which has to handle creates, status flips, and
    soft-deletes uniformly). One indexed query.
    """
    has_open = (
        ReconciliationCase.objects
        .filter(transaction_id=transaction_id, status__in=_OPEN_STATUSES)
        .exists()
    )
    Transaction.objects.filter(id=transaction_id).update(
        has_open_reconciliation=has_open,
    )


@receiver(post_save, sender=ReconciliationCase)
def _recon_saved(sender, instance: ReconciliationCase, **kwargs):
    try:
        _recompute_flag(instance.transaction_id)
    except Exception as e:  # never fail the save · just log
        logger.exception(
            "recon.flag_update_failed",
            extra={
                "case_id": str(instance.id),
                "transaction_id": str(instance.transaction_id),
                "error": str(e),
            },
        )


@receiver(post_delete, sender=ReconciliationCase)
def _recon_deleted(sender, instance: ReconciliationCase, **kwargs):
    try:
        _recompute_flag(instance.transaction_id)
    except Exception:
        # Same defensive behaviour as save · don't let a denormalised-
        # flag refresh failure break the cascade delete that triggered
        # this handler.
        pass
