"""
Management command to encrypt an existing wallet seed with KMS envelope encryption.

Reads the plaintext seed from WALLET_MASTER_SEED (hex) or WALLET_MNEMONIC (BIP-39),
encrypts it using the configured KMS provider (AWS or local fallback), and outputs
the encrypted blob for storage in WALLET_ENCRYPTED_SEED.

Usage:
    python manage.py encrypt_wallet_seed
    python manage.py encrypt_wallet_seed --verify
    python manage.py encrypt_wallet_seed --source mnemonic
    python manage.py encrypt_wallet_seed --source hex
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Encrypt the wallet master seed using KMS envelope encryption. "
        "Reads WALLET_MASTER_SEED or WALLET_MNEMONIC and outputs an encrypted blob."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--source",
            choices=["auto", "hex", "mnemonic"],
            default="auto",
            help=(
                "Which seed source to encrypt. "
                "'auto' tries WALLET_MASTER_SEED first, then WALLET_MNEMONIC. "
                "Default: auto."
            ),
        )
        parser.add_argument(
            "--verify",
            action="store_true",
            help="Decrypt the blob after encryption to verify round-trip integrity.",
        )

    def handle(self, *args, **options):
        source = options["source"]
        verify = options["verify"]

        # Step 1: Get the plaintext seed
        seed = self._get_seed(source)
        seed_source = self._seed_source_label

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING(f"Seed source: {seed_source}"))
        self.stdout.write(f"  Seed length: {len(seed)} bytes ({len(seed) * 2} hex chars)")
        self.stdout.write("")

        # Step 2: Encrypt with KMS
        from apps.blockchain.kms import get_kms_manager, reset_kms_manager

        # Reset to pick up any settings changes
        reset_kms_manager()
        cached_manager = get_kms_manager()
        kms = cached_manager.kms_manager

        kms_enabled = getattr(settings, "KMS_ENABLED", False)
        provider = "AWS KMS" if kms_enabled else "Local Fernet (development)"

        self.stdout.write(self.style.MIGRATE_HEADING(f"Encryption provider: {provider}"))

        try:
            encrypted_blob = kms.encrypt_seed(seed)
        except Exception as e:
            raise CommandError(f"Encryption failed: {e}")

        self.stdout.write(self.style.SUCCESS("  Encryption successful."))
        self.stdout.write(f"  Blob length: {len(encrypted_blob)} characters")
        self.stdout.write("")

        # Step 3: Verify round-trip if requested
        if verify:
            self.stdout.write(self.style.MIGRATE_HEADING("Verification:"))
            try:
                decrypted = kms.decrypt_seed(encrypted_blob)
                if decrypted == seed:
                    self.stdout.write(self.style.SUCCESS(
                        "  Round-trip verification PASSED — decrypted seed matches original."
                    ))
                else:
                    self.stdout.write(self.style.ERROR(
                        "  Round-trip verification FAILED — decrypted seed does NOT match!"
                    ))
                    raise CommandError("Verification failed. Do not use this blob.")
            except Exception as e:
                raise CommandError(f"Verification failed: {e}")
            self.stdout.write("")

        # Step 4: Output the blob
        self.stdout.write(self.style.SUCCESS("=" * 72))
        self.stdout.write(self.style.SUCCESS("  Encrypted Wallet Seed Blob"))
        self.stdout.write(self.style.SUCCESS("=" * 72))
        self.stdout.write("")
        self.stdout.write(self.style.NOTICE(f"WALLET_ENCRYPTED_SEED={encrypted_blob}"))
        self.stdout.write("")

        self.stdout.write(self.style.MIGRATE_HEADING("Next steps:"))
        self.stdout.write("  1. Add the above to your .env or secrets manager.")
        self.stdout.write("  2. Set KMS_ENABLED=True in your environment.")
        if kms_enabled:
            self.stdout.write(f"  3. Ensure KMS_KEY_ID is set to the same key.")
        else:
            self.stdout.write(
                "  3. For production, configure KMS_KEY_ID with your AWS KMS key ARN."
            )
        self.stdout.write(
            "  4. Remove WALLET_MASTER_SEED / WALLET_MNEMONIC from plaintext env vars."
        )
        self.stdout.write("")

        self.stdout.write(self.style.WARNING("=" * 72))
        self.stdout.write(self.style.WARNING(
            "  WARNING: After setting WALLET_ENCRYPTED_SEED, remove the plaintext"
        ))
        self.stdout.write(self.style.WARNING(
            "  WALLET_MASTER_SEED / WALLET_MNEMONIC from your environment."
        ))
        self.stdout.write(self.style.WARNING(
            "  Keeping both defeats the purpose of encryption."
        ))
        self.stdout.write(self.style.WARNING("=" * 72))
        self.stdout.write("")

    def _get_seed(self, source: str) -> bytes:
        """Resolve the plaintext seed from environment variables."""
        self._seed_source_label = ""

        if source in ("auto", "hex"):
            master_seed_hex = getattr(settings, "WALLET_MASTER_SEED", "")
            if master_seed_hex:
                try:
                    seed = bytes.fromhex(master_seed_hex)
                except ValueError:
                    raise CommandError(
                        "WALLET_MASTER_SEED is not valid hex. "
                        "Expected a hex-encoded seed (e.g., 128 hex chars for 64 bytes)."
                    )
                if len(seed) < 16:
                    raise CommandError(
                        "WALLET_MASTER_SEED is too short (minimum 16 bytes / 32 hex chars)."
                    )
                self._seed_source_label = "WALLET_MASTER_SEED (hex)"
                return seed
            elif source == "hex":
                raise CommandError(
                    "WALLET_MASTER_SEED is not set. Cannot use --source=hex."
                )

        if source in ("auto", "mnemonic"):
            mnemonic_phrase = getattr(settings, "WALLET_MNEMONIC", "")
            if mnemonic_phrase:
                try:
                    from mnemonic import Mnemonic
                    mnemo = Mnemonic("english")
                    if not mnemo.check(mnemonic_phrase):
                        raise CommandError(
                            "WALLET_MNEMONIC is not a valid BIP-39 mnemonic. "
                            "Generate one with: python manage.py generate_wallet_seed"
                        )
                    seed = mnemo.to_seed(mnemonic_phrase, passphrase="")
                    self._seed_source_label = "WALLET_MNEMONIC (BIP-39)"
                    return seed
                except ImportError:
                    raise CommandError(
                        "The 'mnemonic' package is required to process WALLET_MNEMONIC. "
                        "Install with: pip install mnemonic"
                    )
            elif source == "mnemonic":
                raise CommandError(
                    "WALLET_MNEMONIC is not set. Cannot use --source=mnemonic."
                )

        raise CommandError(
            "No seed source found. Set WALLET_MASTER_SEED (hex) or WALLET_MNEMONIC "
            "(BIP-39 phrase) in your environment before running this command.\n"
            "Generate a new seed with: python manage.py generate_wallet_seed"
        )
