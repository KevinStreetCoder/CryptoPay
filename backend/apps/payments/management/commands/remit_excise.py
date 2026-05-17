"""Mark the EXCISE SystemWallet balance as remitted to KRA.

VASP Act 2025 requires excise duty remittance on a quarterly cycle
(per the current draft regulations · ops should confirm with the
accountants). This command:

  1. Reads the current `SystemWallet(EXCISE, KES).balance`
  2. Books a DEBIT FeeLedgerEntry for that exact amount with a
     "remitted to KRA" description + an ops-provided reference
     (the KRA receipt number / iTax PRN)
  3. Decrements the SystemWallet balance to 0

The FeeLedgerEntry audit trail preserves the historical balance
so reports for the remitted period can be reconstructed.

Usage:
    # Dry-run · show what would be remitted
    python manage.py remit_excise --dry-run

    # Real run · with the KRA PRN as reference
    python manage.py remit_excise --reference KRA-2026-Q2-A1B2C3 \
        --note "Q2 2026 quarterly remittance"

Idempotency:
    The DEBIT uses a deterministic UUID5 from the ops-provided
    reference, so re-running with the SAME reference is a no-op.
    Run with a fresh reference for each remittance cycle.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction as db_transaction

from apps.wallets.models import FeeLedgerEntry, SystemWallet


_REMIT_NS = uuid.NAMESPACE_URL


class Command(BaseCommand):
    help = "Remit the accumulated EXCISE balance to KRA · idempotent via reference UUID5."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reference",
            required=False,
            help=(
                "KRA reference / iTax PRN / accountant batch ID. "
                "Required unless --dry-run. Used to derive the DEBIT's "
                "transaction_id so re-runs with the same reference are "
                "no-ops."
            ),
        )
        parser.add_argument(
            "--currency",
            default="KES",
            help="Excise wallet currency (default KES · KRA settles in KES).",
        )
        parser.add_argument(
            "--note",
            default="",
            help="Free-text note appended to the DEBIT description.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print the planned remittance without writing.",
        )

    def handle(self, *args, **options):
        currency = options["currency"].upper()
        dry_run = options["dry_run"]
        reference = (options["reference"] or "").strip()
        note = (options["note"] or "").strip()

        try:
            sw = SystemWallet.objects.get(
                wallet_type=SystemWallet.WalletType.EXCISE,
                currency=currency,
            )
        except SystemWallet.DoesNotExist:
            raise CommandError(
                f"No EXCISE wallet for currency {currency}. "
                f"Run `seed_system_wallets` first."
            )

        balance = sw.balance
        self.stdout.write(self.style.SUCCESS(
            f"EXCISE/{currency} current balance: {balance}"
        ))
        if balance <= 0:
            self.stdout.write("Nothing to remit · balance is 0.")
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f"DRY RUN · would DEBIT {balance} {currency} from EXCISE "
                f"wallet (reference: {reference or '(none)'})"
            ))
            return

        if not reference:
            raise CommandError(
                "--reference is required for a real remittance (use the "
                "KRA PRN or iTax batch ID). Pass --dry-run to preview."
            )

        # Deterministic tx_id · safe to re-run with the same reference.
        debit_tx_id = uuid.uuid5(_REMIT_NS, f"excise_remit:{reference}")

        # Idempotency check via FeeLedgerEntry unique constraint.
        existing = FeeLedgerEntry.objects.filter(
            transaction_id=debit_tx_id,
            system_wallet=sw,
            entry_type=FeeLedgerEntry.EntryType.DEBIT,
        ).first()
        if existing:
            self.stdout.write(self.style.WARNING(
                f"Already remitted under reference {reference} · "
                f"existing DEBIT entry id={existing.id} for "
                f"{existing.amount} {currency}. No-op."
            ))
            return

        description = (
            f"KRA excise remittance · reference={reference} · "
            f"period_balance={balance} {currency}"
        )
        if note:
            description += f" · {note}"

        with db_transaction.atomic():
            # Lock + decrement.
            sw_locked = SystemWallet.objects.select_for_update().get(pk=sw.pk)
            if sw_locked.balance < balance:
                # Balance shifted between read + lock · re-snapshot.
                balance = sw_locked.balance
            sw_locked.balance = Decimal("0")
            sw_locked.save(update_fields=["balance", "updated_at"])

            FeeLedgerEntry.objects.create(
                transaction_id=debit_tx_id,
                system_wallet=sw_locked,
                entry_type=FeeLedgerEntry.EntryType.DEBIT,
                amount=balance,
                balance_after=Decimal("0"),
                description=description,
            )

        self.stdout.write(self.style.SUCCESS(
            f"✓ Remitted {balance} {currency} to KRA. "
            f"Reference: {reference} · DEBIT tx_id={debit_tx_id}"
        ))
