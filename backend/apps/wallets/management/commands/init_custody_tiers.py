"""
Initialise hot/warm/cold SystemWallet rows for all supported currencies.

For each currency in ``CustodyService.CRYPTO_CURRENCIES``, ensures there is a
SystemWallet row for the ``hot``, ``warm`` and ``cold`` tiers. Cold wallet
addresses are pulled from ``settings.COLD_WALLET_<CHAIN>`` env variables when
present. Existing rows are never overwritten — re-running this command is
idempotent.

Usage::

    docker compose exec backend python manage.py init_custody_tiers
    docker compose exec backend python manage.py init_custody_tiers --dry-run
    docker compose exec backend python manage.py init_custody_tiers --check
"""

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.wallets.custody import CustodyService
from apps.wallets.models import SystemWallet, WalletTier

TIER_MAP = {
    "hot": WalletTier.HOT,
    "warm": WalletTier.WARM,
    "cold": WalletTier.COLD,
}


class Command(BaseCommand):
    help = "Seed hot/warm/cold SystemWallet rows from env config."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would change without writing to the DB.",
        )
        parser.add_argument(
            "--check",
            action="store_true",
            help=(
                "Report the current SystemWallet state and which "
                "COLD_WALLET_* env vars are configured. Read-only. "
                "Useful for a deploy-readiness sanity check."
            ),
        )

    def handle(self, *args, **opts):
        if opts.get("check"):
            self._handle_check()
            return

        dry_run = opts["dry_run"]
        service = CustodyService()

        created = 0
        updated = 0
        skipped = 0

        for currency in service.CRYPTO_CURRENCIES:
            chain = service._currency_to_chain(currency)
            cold_env = (
                getattr(settings, f"COLD_WALLET_{chain.upper()}", "") or ""
            ).strip()

            for wallet_type, tier in TIER_MAP.items():
                existing = SystemWallet.objects.filter(
                    wallet_type=wallet_type,
                    currency=currency,
                ).first()

                if existing:
                    # Only fill missing cold address — never clobber a
                    # configured address.
                    if (
                        wallet_type == "cold"
                        and cold_env
                        and not existing.address
                    ):
                        if dry_run:
                            self.stdout.write(
                                f"[DRY] would set cold address for "
                                f"{currency}: {cold_env[:10]}…"
                            )
                        else:
                            existing.address = cold_env
                            existing.chain = chain
                            existing.tier = WalletTier.COLD
                            existing.save(
                                update_fields=["address", "chain", "tier", "updated_at"]
                            )
                            self.stdout.write(
                                self.style.SUCCESS(
                                    f"Updated {currency} cold address → {cold_env[:10]}…"
                                )
                            )
                        updated += 1
                    else:
                        skipped += 1
                    continue

                address = cold_env if wallet_type == "cold" else ""
                if dry_run:
                    self.stdout.write(
                        f"[DRY] would create {wallet_type}/{currency} "
                        f"chain={chain} address={address[:10] or '(empty)'}"
                    )
                else:
                    SystemWallet.objects.create(
                        wallet_type=wallet_type,
                        currency=currency,
                        chain=chain,
                        tier=tier,
                        address=address,
                        is_active=True,
                    )
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Created {wallet_type}/{currency} "
                            f"chain={chain} address={address[:10] or '(empty)'}"
                        )
                    )
                created += 1

        verb = "would create" if dry_run else "created"
        verb2 = "would update" if dry_run else "updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone: {verb}={created}, {verb2}={updated}, skipped={skipped}"
            )
        )
        if dry_run:
            self.stdout.write(
                self.style.WARNING("DRY RUN — no DB changes were made.")
            )

    def _handle_check(self):
        """Read-only ops report · current SystemWallet state + env config."""
        service = CustodyService()
        chains_seen = set()

        self.stdout.write("\n=== Custody tier configuration ===\n")
        for currency in service.CRYPTO_CURRENCIES:
            chain = service._currency_to_chain(currency)
            chains_seen.add(chain)
            cold_env = (
                getattr(settings, f"COLD_WALLET_{chain.upper()}", "") or ""
            ).strip()

            self.stdout.write(self.style.MIGRATE_HEADING(f"\n{currency}"))
            for wallet_type in ("hot", "warm", "cold"):
                row = SystemWallet.objects.filter(
                    wallet_type=wallet_type, currency=currency,
                ).first()
                if not row:
                    self.stdout.write(
                        self.style.WARNING(
                            f"  {wallet_type:5s} · NOT_SEEDED "
                            f"(run init_custody_tiers without --check)"
                        )
                    )
                    continue
                addr = row.address or ""
                if wallet_type == "cold":
                    env_state = (
                        f" env={cold_env[:10]}…" if cold_env else " env=(empty)"
                    )
                    if addr:
                        marker = self.style.SUCCESS(f"OK  {addr[:14]}…")
                    elif cold_env:
                        marker = self.style.WARNING(
                            f"env_set_but_db_empty · {cold_env[:14]}…"
                        )
                    else:
                        marker = self.style.ERROR(
                            "MISSING · set COLD_WALLET_"
                            + chain.upper()
                            + " in .env.production"
                        )
                    self.stdout.write(f"  cold  · {marker}{env_state}")
                else:
                    state = self.style.SUCCESS(addr[:14] + "…") if addr else self.style.WARNING("(empty)")
                    self.stdout.write(f"  {wallet_type:5s} · {state}")

        self.stdout.write("")
