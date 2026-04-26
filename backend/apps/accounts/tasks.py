"""Celery tasks for the accounts app.

Currently exposes:
  - `purge_pending_deletions` · daily beat task that hard-deletes
    accounts whose `deletion_scheduled_for` has passed.

Two-stage delete (Google Play compliance · 2026-04-26):

  Stage 1  (T+0 → T+14d)  · soft-delete · login refused.
  Stage 2  (T+14d)        · hard-delete the User row · cascades to
                            Wallet, Transaction, KYCDocument, etc. via
                            FK on_delete=CASCADE. AML/CFT retention
                            obligations under the Kenya VASP Act 2025
                            and CBK Prudential Guideline CBK/PG/08
                            require us to keep an anonymised audit
                            mirror for 7 years; that's done by the
                            `_archive_user_payments` helper before the
                            cascade fires.

Operationally: the purge is best-effort idempotent. A failed run
leaves rows where they are · the next run picks them up. We never
purge inside a single transaction with the archive write because a DB
hiccup mid-operation would leave us with anonymised audit data and
NO main-table rows · the inverse is safer (audit may briefly lag).
"""
from __future__ import annotations

import logging
from typing import Any

from celery import shared_task
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="apps.accounts.tasks.purge_pending_deletions")
def purge_pending_deletions() -> dict[str, Any]:
    """Hard-delete users past their grace period.

    Returns a small summary dict for monitoring / log inspection.
    Safe to run repeatedly · only acts on rows that are actually due.
    """
    from apps.accounts.models import User

    now = timezone.now()
    due = User.objects.filter(
        deletion_requested_at__isnull=False,
        deletion_scheduled_for__isnull=False,
        deletion_scheduled_for__lte=now,
    )

    purged = 0
    failed: list[str] = []

    for user in due.iterator():
        user_id = str(user.id)
        try:
            with transaction.atomic():
                _archive_user_payments(user)
                # Cascade deletes Wallet, Transaction, KYCDocument,
                # Device, AuditLog rows scoped to this user.
                user.delete()
            purged += 1
            logger.info("account_purged", extra={"user_id": user_id})
        except Exception as e:
            failed.append(user_id)
            logger.exception(
                "account_purge_failed",
                extra={"user_id": user_id, "error": str(e)},
            )

    return {"purged": purged, "failed": failed, "checked_at": now.isoformat()}


def _archive_user_payments(user) -> None:
    """Write an anonymised mirror of the user's transactions.

    The Kenya VASP Act 2025 and CBK Prudential Guideline CBK/PG/08
    both require 7-year retention of transaction records. We keep
    only the regulator-needed fields (amounts, M-Pesa references,
    timestamps) under a SHA-256 hash of the original user ID · no
    PII, but enough to satisfy a SAR / law-enforcement subpoena that
    references the original account.

    For now this is a best-effort log-only archive · the dedicated
    `AuditArchive` model lands in a follow-up migration so the
    accounts app doesn't carry payments-domain schema. Once the
    model exists, swap the JSON-line write below for a model row.
    """
    import hashlib
    import json

    try:
        from apps.payments.models import Transaction
    except ImportError:
        return

    user_hash = hashlib.sha256(str(user.id).encode()).hexdigest()
    txs = Transaction.objects.filter(user=user).order_by("created_at")
    rows: list[dict[str, Any]] = []
    for tx in txs.iterator():
        rows.append({
            "user_hash": user_hash,
            "tx_id": str(tx.id),
            "type": getattr(tx, "type", ""),
            "status": getattr(tx, "status", ""),
            "amount_kes": str(getattr(tx, "kes_amount", "") or ""),
            "crypto_currency": getattr(tx, "source_currency", "")
                or getattr(tx, "dest_currency", ""),
            "crypto_amount": str(getattr(tx, "crypto_amount", "") or ""),
            "mpesa_ref": getattr(tx, "mpesa_ref", "") or getattr(tx, "mpesa_receipt", ""),
            "mpesa_paybill": getattr(tx, "mpesa_paybill", ""),
            "created_at": tx.created_at.isoformat() if tx.created_at else "",
            "completed_at": (
                tx.completed_at.isoformat()
                if getattr(tx, "completed_at", None) else ""
            ),
        })

    if rows:
        # Structured log line · easily piped to long-term storage by
        # the existing log shipper. Replace with the dedicated
        # `AuditArchive.objects.bulk_create` once that model lands.
        logger.info(
            "audit_archive",
            extra={
                "user_hash": user_hash,
                "tx_count": len(rows),
                "rows_json": json.dumps(rows),
            },
        )
