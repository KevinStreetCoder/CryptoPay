"""
Encrypt a hot-wallet private key under the configured KMS provider so it
can be stored as `<CHAIN>_HOT_WALLET_ENCRYPTED` instead of plaintext.

Usage:
    # Encrypt the key already in plaintext env var (TRON_HOT_WALLET_PRIVATE_KEY)
    python manage.py encrypt_hot_wallet_key --chain tron

    # Encrypt a key passed on the command line (NOT recommended; key lands
    # in shell history). Prefer reading from env.
    python manage.py encrypt_hot_wallet_key --chain tron --key 0xabcd...

    # Round-trip verify after encryption
    python manage.py encrypt_hot_wallet_key --chain tron --verify

The output is a base64 envelope blob suitable for storage in:
    TRON_HOT_WALLET_ENCRYPTED=<blob>

After setting the encrypted blob, REMOVE the plaintext
TRON_HOT_WALLET_PRIVATE_KEY from the environment and set KMS_ENABLED=True.
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.blockchain.secure_keys import _PLAINTEXT_ENV_VARS, _ENCRYPTED_ENV_VARS


class Command(BaseCommand):
    help = (
        "Encrypt a hot-wallet private key with KMS envelope encryption "
        "for safe storage in <CHAIN>_HOT_WALLET_ENCRYPTED."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--chain",
            required=True,
            choices=sorted(set(_PLAINTEXT_ENV_VARS.keys())),
            help="Chain identifier · tron, eth, polygon, sol, btc.",
        )
        parser.add_argument(
            "--key",
            default="",
            help=(
                "Plaintext private key (hex, with or without 0x). "
                "If omitted, the matching <CHAIN>_HOT_WALLET_PRIVATE_KEY "
                "env var is used. Avoid passing on the CLI · prefer the env."
            ),
        )
        parser.add_argument(
            "--verify",
            action="store_true",
            help="Decrypt the blob after encryption to confirm round-trip.",
        )

    def handle(self, *args, **options):
        chain = options["chain"].lower()
        verify = options["verify"]

        plaintext_env = _PLAINTEXT_ENV_VARS[chain]
        encrypted_env = _ENCRYPTED_ENV_VARS[chain]

        # Resolve plaintext key
        cli_key = (options["key"] or "").strip()
        env_key = (getattr(settings, plaintext_env, "") or "").strip()
        plaintext = cli_key or env_key
        if not plaintext:
            raise CommandError(
                f"No key provided. Pass --key <hex> or set {plaintext_env} "
                "in your environment before running this command."
            )

        # Normalise to bytes
        normalised = plaintext[2:] if plaintext.lower().startswith("0x") else plaintext
        try:
            key_bytes = bytes.fromhex(normalised)
        except ValueError:
            # Solana sometimes ships base58 / JSON-array · pass raw bytes through
            key_bytes = plaintext.encode("utf-8")

        if len(key_bytes) < 16:
            raise CommandError(
                f"Key for chain {chain!r} is suspiciously short "
                f"({len(key_bytes)} bytes). Aborting."
            )

        # Encrypt via the configured KMS manager
        from apps.blockchain.kms import get_kms_manager, reset_kms_manager

        reset_kms_manager()
        cached = get_kms_manager()
        kms = cached.kms_manager

        kms_enabled = getattr(settings, "KMS_ENABLED", False)
        provider_label = "AWS KMS" if kms_enabled else "Local Fernet (DEV ONLY)"

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING(f"Chain:      {chain}"))
        self.stdout.write(self.style.MIGRATE_HEADING(f"Provider:   {provider_label}"))
        self.stdout.write(self.style.MIGRATE_HEADING(f"Key bytes:  {len(key_bytes)}"))
        self.stdout.write("")

        try:
            blob = kms.encrypt_seed(key_bytes)
        except Exception as exc:
            raise CommandError(f"Encryption failed: {exc}") from exc

        if verify:
            try:
                roundtrip = kms.decrypt_seed(blob)
            except Exception as exc:
                raise CommandError(f"Verification failed: {exc}") from exc
            if roundtrip != key_bytes:
                raise CommandError(
                    "Verification failed · decrypted bytes do not match the "
                    "input. Do not use this blob."
                )
            self.stdout.write(self.style.SUCCESS("Round-trip verified."))
            self.stdout.write("")

        self.stdout.write(self.style.SUCCESS("=" * 72))
        self.stdout.write(self.style.SUCCESS(f"  {encrypted_env}"))
        self.stdout.write(self.style.SUCCESS("=" * 72))
        self.stdout.write("")
        self.stdout.write(self.style.NOTICE(f"{encrypted_env}={blob}"))
        self.stdout.write("")

        self.stdout.write(self.style.MIGRATE_HEADING("Next steps:"))
        self.stdout.write(f"  1. Add {encrypted_env}=<blob> to your secrets manager / .env.")
        self.stdout.write(f"  2. Remove the plaintext {plaintext_env} from the environment.")
        self.stdout.write("  3. Confirm KMS_ENABLED=True and KMS_KEY_ID is set.")
        self.stdout.write("  4. Restart the affected services so the new env is loaded.")
        self.stdout.write("")

        self.stdout.write(self.style.WARNING("=" * 72))
        self.stdout.write(self.style.WARNING(
            f"  WARNING: keep BOTH {plaintext_env} AND {encrypted_env} only"
        ))
        self.stdout.write(self.style.WARNING(
            "  long enough to deploy the change. Then DELETE the plaintext."
        ))
        self.stdout.write(self.style.WARNING("=" * 72))
        self.stdout.write("")
