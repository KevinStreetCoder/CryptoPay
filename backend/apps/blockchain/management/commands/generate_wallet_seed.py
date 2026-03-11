"""
Management command to generate a BIP-39 mnemonic and HD wallet seed.

Usage:
    python manage.py generate_wallet_seed
    python manage.py generate_wallet_seed --strength 128   # 12 words
    python manage.py generate_wallet_seed --strength 256   # 24 words (default)
"""

from django.core.management.base import BaseCommand

from mnemonic import Mnemonic


class Command(BaseCommand):
    help = "Generate a BIP-39 mnemonic phrase and corresponding HD wallet seed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--strength",
            type=int,
            default=256,
            choices=[128, 160, 192, 224, 256],
            help="Entropy strength in bits. 128=12 words, 256=24 words (default: 256).",
        )

    def handle(self, *args, **options):
        strength = options["strength"]
        word_count = strength * 3 // 32

        mnemo = Mnemonic("english")
        mnemonic_phrase = mnemo.generate(strength=strength)
        seed = mnemo.to_seed(mnemonic_phrase, passphrase="")
        seed_hex = seed.hex()

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=" * 72))
        self.stdout.write(self.style.SUCCESS("  BIP-39 HD Wallet Seed Generated"))
        self.stdout.write(self.style.SUCCESS("=" * 72))
        self.stdout.write("")

        self.stdout.write(self.style.MIGRATE_HEADING(f"Mnemonic ({word_count} words):"))
        self.stdout.write(f"  {mnemonic_phrase}")
        self.stdout.write("")

        self.stdout.write(self.style.MIGRATE_HEADING("Hex Seed (128 chars):"))
        self.stdout.write(f"  {seed_hex}")
        self.stdout.write("")

        self.stdout.write(self.style.WARNING("=" * 72))
        self.stdout.write(self.style.WARNING("  WARNING: BACK UP THIS MNEMONIC SECURELY!"))
        self.stdout.write(self.style.WARNING("=" * 72))
        self.stdout.write(self.style.WARNING(
            "  - Write it down on paper and store in a safe/vault."
        ))
        self.stdout.write(self.style.WARNING(
            "  - NEVER commit it to version control."
        ))
        self.stdout.write(self.style.WARNING(
            "  - NEVER share it over email, chat, or unencrypted channels."
        ))
        self.stdout.write(self.style.WARNING(
            "  - Losing this mnemonic means losing access to ALL deposit wallets."
        ))
        self.stdout.write(self.style.WARNING("=" * 72))
        self.stdout.write("")

        self.stdout.write(self.style.MIGRATE_HEADING("Environment Setup:"))
        self.stdout.write("")
        self.stdout.write("  Option A — Set the mnemonic (preferred, human-readable):")
        self.stdout.write(self.style.NOTICE(
            f'    WALLET_MNEMONIC="{mnemonic_phrase}"'
        ))
        self.stdout.write("")
        self.stdout.write("  Option B — Set the hex seed (for KMS/HSM storage):")
        self.stdout.write(self.style.NOTICE(
            f'    WALLET_MASTER_SEED="{seed_hex}"'
        ))
        self.stdout.write("")
        self.stdout.write(
            "  Add the chosen variable to your .env file or secrets manager."
        )
        self.stdout.write(
            "  Both options produce identical wallet addresses."
        )
        self.stdout.write("")

        # Verify round-trip
        verify_seed = mnemo.to_seed(mnemonic_phrase, passphrase="")
        if verify_seed == seed:
            self.stdout.write(self.style.SUCCESS(
                "  Verification: Mnemonic round-trip OK"
            ))
        else:
            self.stdout.write(self.style.ERROR(
                "  Verification FAILED: seed mismatch! Do not use."
            ))

        self.stdout.write("")
