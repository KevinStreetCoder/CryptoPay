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

    def handle(self, *args, **opts):
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
