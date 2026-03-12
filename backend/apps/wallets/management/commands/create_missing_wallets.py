"""
Create missing wallets for existing users.

Run after adding new currencies (e.g., USDC, SOL) to ensure all users
have wallets for every supported currency.

Usage:
    python manage.py create_missing_wallets
    python manage.py create_missing_wallets --dry-run
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.wallets.models import Currency, Wallet

User = get_user_model()


class Command(BaseCommand):
    help = "Create missing wallets for all existing users."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be created without actually creating.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        all_currencies = [c.value for c in Currency if c.value != "KES"]
        # Include KES too
        all_currencies.append("KES")

        users = User.objects.all()
        total_created = 0

        for user in users:
            existing = set(
                Wallet.objects.filter(user=user).values_list("currency", flat=True)
            )
            missing = [c for c in all_currencies if c not in existing]

            for currency in missing:
                if dry_run:
                    self.stdout.write(
                        f"  Would create {currency} wallet for {user.phone}"
                    )
                else:
                    Wallet.objects.create(user=user, currency=currency)
                    self.stdout.write(
                        self.style.SUCCESS(f"  Created {currency} wallet for {user.phone}")
                    )
                total_created += 1

        action = "Would create" if dry_run else "Created"
        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                f"{action} {total_created} wallets for {users.count()} users."
            )
        )
