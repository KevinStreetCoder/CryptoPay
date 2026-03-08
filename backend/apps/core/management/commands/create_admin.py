"""
Create the admin user with both Django password and mobile PIN.
Seeds test balances for transaction testing.
Usage: python manage.py create_admin
"""

import uuid
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import User
from apps.wallets.models import LedgerEntry, Wallet
from apps.wallets.services import WalletService


# Test balances for the admin user
TEST_BALANCES = {
    "USDT": Decimal("500.00000000"),
    "BTC": Decimal("0.05000000"),
    "ETH": Decimal("1.50000000"),
    "KES": Decimal("50000.00000000"),
}


class Command(BaseCommand):
    help = "Create admin user with phone, PIN, password, wallets, and test balances"

    def add_arguments(self, parser):
        parser.add_argument("--phone", default="+254701961618")
        parser.add_argument("--pin", default="869913")
        parser.add_argument("--password", default="KELvin8699")
        parser.add_argument("--name", default="Admin")
        parser.add_argument(
            "--no-balance",
            action="store_true",
            help="Skip seeding test balances",
        )

    def handle(self, *args, **options):
        phone = options["phone"]
        pin = options["pin"]
        password = options["password"]
        name = options["name"]

        user, created = User.objects.get_or_create(
            phone=phone,
            defaults={
                "full_name": name,
                "is_staff": True,
                "is_superuser": True,
                "is_active": True,
                "kyc_tier": 3,
                "kyc_status": "verified",
            },
        )

        if not created:
            user.full_name = name
            user.is_staff = True
            user.is_superuser = True
            user.kyc_tier = 3
            user.kyc_status = "verified"

        # Set both Django password (for admin panel) and PIN (for mobile login)
        user.set_password(password)
        user.set_pin(pin)
        user.save()

        # Create wallets if they don't exist
        try:
            WalletService.create_user_wallets(user)
            self.stdout.write(self.style.SUCCESS(f"Wallets created for {phone}"))
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"Wallets: {e}"))

        # Seed test balances
        if not options["no_balance"]:
            self._seed_balances(user)

        action = "Created" if created else "Updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{action} admin user:\n"
                f"  Phone:    {phone}\n"
                f"  Name:     {name}\n"
                f"  PIN:      {pin}\n"
                f"  Password: {password}\n"
                f"  KYC Tier: 3 (Enhanced DD)\n"
                f"  Staff:    Yes\n"
                f"  Super:    Yes\n"
            )
        )

    def _seed_balances(self, user):
        """Seed test balances into admin wallets via proper ledger entries."""
        tx_id = uuid.uuid4()  # Single transaction ID for the seed operation

        for currency, target_balance in TEST_BALANCES.items():
            try:
                wallet = Wallet.objects.get(user=user, currency=currency)
            except Wallet.DoesNotExist:
                self.stdout.write(self.style.WARNING(f"  {currency} wallet not found, skipping"))
                continue

            if wallet.balance >= target_balance:
                self.stdout.write(f"  {currency}: already has {wallet.balance} (target: {target_balance})")
                continue

            # Credit the difference to reach target balance
            diff = target_balance - wallet.balance
            entry = WalletService.credit(
                wallet.id,
                diff,
                tx_id,
                f"Admin test balance seed: +{diff} {currency}",
            )

            self.stdout.write(
                self.style.SUCCESS(
                    f"  {currency}: {wallet.balance} → {entry.balance_after} "
                    f"(+{diff})"
                )
            )
