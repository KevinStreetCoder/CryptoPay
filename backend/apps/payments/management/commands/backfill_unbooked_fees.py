"""
Backfill the SystemWallet FEE / PROVIDER_COST / EXCISE balances for
completed transactions that pre-date the 2026-05-17 fee-booking work.

Before 2026-05-17, only the SWAP path booked revenue into
`SystemWallet(FEE)` · paybill/till/B2C/buy/withdrawal completed but
stamped `fee_amount` + `excise_duty_amount` only on the Transaction
record. The /admin/revenue/ dashboard exposed this as the
"earned-vs-booked gap".

Now that `saga.complete()` + `_process_successful_payment` +
`broadcast_withdrawal_task` book revenue going forward, this command
closes the historical gap.

Usage:
    # Dry run · show what would be booked
    python manage.py backfill_unbooked_fees --dry-run

    # Real run · creates FeeLedgerEntry rows + bumps SystemWallet balance
    python manage.py backfill_unbooked_fees

Idempotency:
    Each booking uses a deterministic UUID5 derived from the source
    tx UUID:
        uuid5(NAMESPACE_URL, f"fee_backfill:{tx.id}:{system_wallet_type}")
    FeeLedgerEntry's UniqueConstraint(transaction_id, system_wallet,
    entry_type) means re-running the command is safe · already-booked
    txs are skipped automatically.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction as db_transaction

from apps.payments.models import Transaction
from apps.wallets.models import FeeLedgerEntry, SystemWallet
from apps.wallets.services import WalletService, FeeWalletMissingError


_FEE_BACKFILL_NS = uuid.NAMESPACE_URL


def _backfill_id(tx_id, system_wallet_type: str) -> uuid.UUID:
    """Deterministic UUID for a backfill booking · idempotent across
    re-runs even if FeeLedgerEntry table is wiped + rebuilt."""
    return uuid.uuid5(
        _FEE_BACKFILL_NS,
        f"fee_backfill:{tx_id}:{system_wallet_type}",
    )


class Command(BaseCommand):
    help = (
        "Backfill SystemWallet FEE / PROVIDER_COST / EXCISE balances "
        "for historical completed transactions whose fees were never "
        "booked. Idempotent via UUID5 keys; safe to re-run."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print planned bookings without writing anything.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Only process the first N candidate transactions (0 = all).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        limit = options["limit"]

        candidates = (
            Transaction.objects
            .filter(status="completed", fee_amount__gt=0)
            .exclude(type="SWAP")  # SWAP path bookings now use book_fee · check
            .order_by("created_at")
        )
        if limit > 0:
            candidates = candidates[:limit]

        total = candidates.count()
        if total == 0:
            self.stdout.write(self.style.SUCCESS(
                "No candidate transactions found. Nothing to backfill."
            ))
            return

        self.stdout.write(
            f"Found {total} candidate transactions "
            f"(completed, fee_amount > 0, not SWAP)."
        )
        if dry_run:
            self.stdout.write(self.style.WARNING(
                "DRY RUN · no writes. Pass without --dry-run to commit."
            ))

        booked_fee = Decimal("0")
        booked_cost = Decimal("0")
        booked_excise = Decimal("0")
        skipped_already_booked = 0
        skipped_missing_wallet = 0
        booked_count = 0

        for tx in candidates:
            sd = tx.saga_data or {}
            fee_currency = (tx.fee_currency or "KES").upper()
            fee_amount = Decimal(tx.fee_amount or 0)
            excise = Decimal(tx.excise_duty_amount or 0)
            provider_cost = Decimal(str(sd.get("intasend_charges") or 0))
            net_fee = max(Decimal("0"), fee_amount - provider_cost)

            plan = []
            if net_fee > 0:
                plan.append(("FEE", fee_currency, net_fee))
            if provider_cost > 0:
                plan.append(("PROVIDER_COST", fee_currency, provider_cost))
            if excise > 0:
                plan.append(("EXCISE", fee_currency, excise))

            if not plan:
                continue

            self.stdout.write(
                f"  tx {str(tx.id)[:8]} · {tx.type:<18s} · "
                + " + ".join(f"{amt} {ccy} → {kind}" for kind, ccy, amt in plan)
            )

            if dry_run:
                continue

            with db_transaction.atomic():
                for kind, ccy, amt in plan:
                    backfill_tx_id = _backfill_id(tx.id, kind)
                    description = (
                        f"Backfill (2026-05-17) for tx {tx.id} · {tx.type} · "
                        f"{kind} {amt} {ccy}"
                    )
                    try:
                        if kind == "FEE":
                            entry = WalletService.book_fee(
                                ccy, amt, backfill_tx_id, description,
                            )
                            booked_fee += amt
                        elif kind == "PROVIDER_COST":
                            entry = WalletService.book_provider_cost(
                                ccy, amt, backfill_tx_id, description,
                            )
                            booked_cost += amt
                        elif kind == "EXCISE":
                            entry = WalletService.book_excise(
                                ccy, amt, backfill_tx_id, description,
                            )
                            booked_excise += amt

                        # Check whether this was an idempotent
                        # already-existed-skip · the WalletService
                        # helpers return the SAME entry on a duplicate
                        # call. We approximate: was the entry's
                        # description NEWLY set to ours? If different
                        # it's likely a prior backfill row.
                        if entry.description != description:
                            skipped_already_booked += 1
                            # Subtract: we didn't actually book it
                            if kind == "FEE":
                                booked_fee -= amt
                            elif kind == "PROVIDER_COST":
                                booked_cost -= amt
                            elif kind == "EXCISE":
                                booked_excise -= amt
                        else:
                            booked_count += 1
                    except FeeWalletMissingError:
                        skipped_missing_wallet += 1
                        self.stderr.write(self.style.WARNING(
                            f"    SKIP · no active SystemWallet for "
                            f"{kind}/{ccy}. Run "
                            f"`python manage.py seed_system_wallets`."
                        ))

        # ── Summary ────────────────────────────────────────────────
        self.stdout.write("")
        if dry_run:
            self.stdout.write(self.style.WARNING("=== DRY RUN summary ==="))
        else:
            self.stdout.write(self.style.SUCCESS("=== Backfill summary ==="))
        self.stdout.write(f"  candidates    · {total}")
        self.stdout.write(f"  bookings made · {booked_count}")
        self.stdout.write(f"  net fee total · {booked_fee}")
        self.stdout.write(f"  provider cost · {booked_cost}")
        self.stdout.write(f"  excise (KRA)  · {booked_excise}")
        self.stdout.write(f"  skipped (already booked) · {skipped_already_booked}")
        self.stdout.write(f"  skipped (missing wallet) · {skipped_missing_wallet}")
        if not dry_run:
            self.stdout.write(self.style.SUCCESS(
                "\nCheck /admin/revenue/ · the earned-vs-booked gap should "
                "now be near 0 for every currency (residual = rounding + "
                "txs that don't have intasend_charges captured)."
            ))
