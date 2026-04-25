"""
Verify that the configured KMS provider is reachable and round-tripping
correctly. Designed for CI smoke tests, deploy hooks, and ad-hoc ops use.

Exit codes:
    0  KMS is healthy (encrypt + decrypt round-trip works)
    1  KMS configuration is missing (disabled or no key id when enabled)
    2  KMS provider rejected the request (credentials, key not found, …)
    3  Round-trip mismatch (corruption · should never happen)

Usage:
    python manage.py kms_health
    python manage.py kms_health --verbose
    python manage.py kms_health --check-blob WALLET_ENCRYPTED_SEED
"""

from __future__ import annotations

import sys
import secrets

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Verify the configured KMS provider can encrypt + decrypt."

    def add_arguments(self, parser):
        parser.add_argument(
            "--verbose",
            action="store_true",
            help="Print provider details and timings.",
        )
        parser.add_argument(
            "--check-blob",
            default="",
            help=(
                "Name of an env var holding an existing envelope blob to "
                "decrypt (e.g. WALLET_ENCRYPTED_SEED, TRON_HOT_WALLET_ENCRYPTED). "
                "Confirms the key can decrypt blobs you already have on disk."
            ),
        )

    def handle(self, *args, **options):
        verbose = options["verbose"]
        check_blob_env = options["check_blob"]

        kms_enabled = getattr(settings, "KMS_ENABLED", False)
        provider = (getattr(settings, "KMS_PROVIDER", "aws") or "aws").lower()
        kms_key_id = getattr(settings, "KMS_KEY_ID", "")          # AWS
        kms_region = getattr(settings, "KMS_REGION", "")          # AWS
        kms_key_resource = getattr(settings, "KMS_KEY_RESOURCE", "")  # GCP

        if verbose:
            self.stdout.write(self.style.MIGRATE_HEADING("KMS configuration"))
            self.stdout.write(f"  KMS_ENABLED:   {kms_enabled}")
            self.stdout.write(f"  KMS_PROVIDER:  {provider}")
            if provider == "aws":
                self.stdout.write(f"  KMS_KEY_ID:    {kms_key_id or '<not set>'}")
                self.stdout.write(f"  KMS_REGION:    {kms_region or '<not set>'}")
            elif provider == "gcp":
                self.stdout.write(
                    f"  KMS_KEY_RESOURCE: {kms_key_resource or '<not set>'}"
                )
            self.stdout.write("")

        if kms_enabled:
            if provider == "aws" and not kms_key_id:
                self.stderr.write(self.style.ERROR(
                    "KMS_ENABLED=True with KMS_PROVIDER=aws but KMS_KEY_ID is empty."
                ))
                sys.exit(1)
            if provider == "gcp" and not kms_key_resource:
                self.stderr.write(self.style.ERROR(
                    "KMS_ENABLED=True with KMS_PROVIDER=gcp but "
                    "KMS_KEY_RESOURCE is empty."
                ))
                sys.exit(1)
            if provider not in ("aws", "gcp"):
                self.stderr.write(self.style.ERROR(
                    f"Unknown KMS_PROVIDER={provider!r}. Use 'aws' or 'gcp'."
                ))
                sys.exit(1)

        # Build a manager and exercise it with a small random sample.
        from apps.blockchain.kms import (
            get_kms_manager,
            reset_kms_manager,
            KMSCredentialError,
            KMSKeyNotFoundError,
            KMSDecryptionError,
            KMSError,
        )

        reset_kms_manager()

        try:
            cached = get_kms_manager()
        except KMSError as exc:
            self.stderr.write(self.style.ERROR(f"Failed to construct KMS manager: {exc}"))
            sys.exit(1)

        provider = type(cached.kms_manager).__name__

        if verbose:
            self.stdout.write(self.style.MIGRATE_HEADING(
                f"Active provider: {provider}"
            ))
            self.stdout.write("")

        # Smoke: encrypt + decrypt 32 random bytes
        sample = secrets.token_bytes(32)
        try:
            blob = cached.kms_manager.encrypt_seed(sample)
        except (KMSCredentialError, KMSKeyNotFoundError) as exc:
            self.stderr.write(self.style.ERROR(
                f"Provider rejected encrypt: {exc}"
            ))
            sys.exit(2)
        except KMSError as exc:
            self.stderr.write(self.style.ERROR(f"Encrypt failed: {exc}"))
            sys.exit(2)

        try:
            roundtrip = cached.kms_manager.decrypt_seed(blob)
        except (KMSCredentialError, KMSKeyNotFoundError) as exc:
            self.stderr.write(self.style.ERROR(
                f"Provider rejected decrypt: {exc}"
            ))
            sys.exit(2)
        except KMSDecryptionError as exc:
            self.stderr.write(self.style.ERROR(f"Decrypt failed: {exc}"))
            sys.exit(3)

        if roundtrip != sample:
            self.stderr.write(self.style.ERROR(
                "Round-trip MISMATCH · ciphertext decrypted to different bytes."
            ))
            sys.exit(3)

        # Optional: decrypt a real blob from env (validates that the
        # currently-stored ciphertext can be opened by the active key).
        if check_blob_env:
            blob_env = (getattr(settings, check_blob_env, "") or "").strip()
            if not blob_env:
                self.stderr.write(self.style.ERROR(
                    f"--check-blob {check_blob_env}: env var is empty."
                ))
                sys.exit(1)
            try:
                cached.kms_manager.decrypt_seed(blob_env)
            except KMSDecryptionError as exc:
                self.stderr.write(self.style.ERROR(
                    f"Existing {check_blob_env} blob failed to decrypt: {exc}"
                ))
                sys.exit(3)
            except KMSError as exc:
                self.stderr.write(self.style.ERROR(
                    f"Provider error decrypting {check_blob_env}: {exc}"
                ))
                sys.exit(2)
            self.stdout.write(self.style.SUCCESS(
                f"Existing {check_blob_env} blob decrypts correctly."
            ))

        self.stdout.write(self.style.SUCCESS(
            f"KMS healthy · provider={provider} round-trip OK"
        ))
        sys.exit(0)
