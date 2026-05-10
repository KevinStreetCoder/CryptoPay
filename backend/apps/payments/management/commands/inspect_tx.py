"""Look up a Transaction by its short reference (first 8 hex of UUID).

Usage:
    python manage.py inspect_tx 9291FB4E
    python manage.py inspect_tx 9291FB4E --json

The short ref matches the format printed in the failed-transaction
admin alert ("Reference: 9291FB4E"). Reads, never mutates · safe to
run against production.

Surfaces the fields ops actually needs to triage a failure:
  - identity (id, type, status, created_at)
  - amounts + currencies
  - M-Pesa rail data (paybill / till / phone / account)
  - failure_reason, biller_response, mpesa_receipt
  - saga_data (locked_amount, intasend_tracking_id, fallback_history)

For ambiguous prefixes (multiple matches) the command lists every
match so ops can disambiguate via created_at / user / amount.
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Look up a Transaction by short ref (first 8 hex chars of UUID)."

    def add_arguments(self, parser):
        parser.add_argument(
            "short_ref",
            help="First 8 hex chars of the Transaction UUID, e.g. 9291FB4E",
        )
        parser.add_argument(
            "--json",
            action="store_true",
            help="Emit a JSON blob (one tx) instead of human-readable text.",
        )

    def handle(self, *args, **options):
        from apps.payments.models import Transaction

        raw = (options["short_ref"] or "").strip().lower()
        if not raw:
            raise CommandError("short_ref is required")
        # Tolerate the user pasting the alert line verbatim.
        for prefix in ("reference:", "ref:", "tx:"):
            if raw.startswith(prefix):
                raw = raw[len(prefix):].strip()

        if len(raw) < 4:
            raise CommandError("short_ref must be at least 4 hex chars")

        # Postgres UUID match works on the dashless lowercase prefix.
        # Convert to canonical UUID form for the LIKE.
        qs = Transaction.objects.select_related("user").extra(
            where=["replace(id::text, '-', '') ILIKE %s"],
            params=[f"{raw}%"],
        ).order_by("-created_at")[:25]

        results = list(qs)
        if not results:
            raise CommandError(f"No transaction found with short ref {raw!r}")

        if options["json"]:
            self.stdout.write(json.dumps(
                [self._tx_dict(tx) for tx in results],
                indent=2, default=str,
            ))
            return

        for tx in results:
            self._render_human(tx)
            self.stdout.write("")

        if len(results) > 1:
            self.stdout.write(self.style.WARNING(
                f"\n{len(results)} transactions matched prefix {raw!r}. "
                f"Pass a longer prefix to narrow."
            ))

    def _tx_dict(self, tx) -> dict:
        return {
            "id": str(tx.id),
            "short_ref": str(tx.id).replace("-", "")[:8].upper(),
            "type": tx.type,
            "status": tx.status,
            "user_phone": tx.user.phone,
            "user_full_name": tx.user.full_name or "",
            "source_amount": str(tx.source_amount or ""),
            "source_currency": tx.source_currency,
            "dest_amount": str(tx.dest_amount or ""),
            "dest_currency": tx.dest_currency,
            "mpesa_paybill": tx.mpesa_paybill,
            "mpesa_till": tx.mpesa_till,
            "mpesa_account": tx.mpesa_account,
            "mpesa_phone": tx.mpesa_phone,
            "mpesa_receipt": tx.mpesa_receipt,
            "failure_reason": tx.failure_reason,
            "biller_response": tx.biller_response,
            "merchant_name": tx.merchant_name,
            "idempotency_key": tx.idempotency_key,
            "created_at": tx.created_at.isoformat() if tx.created_at else None,
            "completed_at": (
                tx.completed_at.isoformat() if tx.completed_at else None
            ),
            "saga_data": tx.saga_data or {},
        }

    def _render_human(self, tx) -> None:
        short = str(tx.id).replace("-", "")[:8].upper()
        out = self.stdout
        bold = self.style.MIGRATE_HEADING
        warn = self.style.WARNING
        ok = self.style.SUCCESS
        err = self.style.ERROR

        out.write(bold(f"Transaction {short}  ·  {tx.id}"))
        out.write(f"  Type           : {tx.type}")
        status_style = ok if tx.status == "completed" else (
            err if tx.status == "failed" else warn
        )
        out.write(f"  Status         : {status_style(tx.status)}")
        out.write(f"  User           : {tx.user.phone}  ({tx.user.full_name or 'N/A'})")
        out.write(
            f"  Amount         : {tx.source_amount} {tx.source_currency} "
            f"-> {tx.dest_amount} {tx.dest_currency}"
        )
        if tx.mpesa_paybill:
            out.write(
                f"  Paybill        : {tx.mpesa_paybill}  "
                f"acc {tx.mpesa_account or '-'}  "
                f"({tx.merchant_name or '-'})"
            )
        if tx.mpesa_till:
            out.write(f"  Till           : {tx.mpesa_till}  ({tx.merchant_name or '-'})")
        if tx.mpesa_phone:
            out.write(f"  Phone          : {tx.mpesa_phone}  ({tx.merchant_name or '-'})")
        out.write(f"  M-Pesa receipt : {tx.mpesa_receipt or '-'}")
        if tx.failure_reason:
            out.write(f"  Failure reason : {err(tx.failure_reason)}")
        if tx.biller_response:
            out.write(f"  Biller response: {tx.biller_response[:200]}")
        out.write(f"  Idempotency    : {tx.idempotency_key}")
        out.write(f"  Created        : {tx.created_at.isoformat() if tx.created_at else '-'}")
        out.write(f"  Completed      : {tx.completed_at.isoformat() if tx.completed_at else '-'}")

        sd = tx.saga_data or {}
        if sd:
            out.write("  saga_data:")
            for k, v in sd.items():
                rendered = json.dumps(v, default=str) if isinstance(v, (dict, list)) else str(v)
                out.write(f"    {k}: {rendered[:300]}")
