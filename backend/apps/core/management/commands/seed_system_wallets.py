"""
Management command to seed SystemWallet entries for all currency + wallet type combinations.

Usage:
    python manage.py seed_system_wallets
"""

from django.core.management.base import BaseCommand

from apps.wallets.models import Currency, SystemWallet


class Command(BaseCommand):
    help = "Create SystemWallet entries for all currencies and wallet types (hot, fee, float)"

    def handle(self, *args, **options):
        created_count = 0

        for wallet_type, type_label in SystemWallet.WalletType.choices:
            for currency, currency_label in Currency.choices:
                wallet, created = SystemWallet.objects.get_or_create(
                    wallet_type=wallet_type,
                    currency=currency,
                )
                if created:
                    created_count += 1
                    self.stdout.write(
                        self.style.SUCCESS(f"  Created: {type_label} {currency_label}")
                    )
                else:
                    self.stdout.write(
                        f"  Exists:  {type_label} {currency_label} (balance: {wallet.balance})"
                    )

        total = SystemWallet.objects.count()
        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone. Created {created_count} new wallet(s). Total system wallets: {total}"
            )
        )
