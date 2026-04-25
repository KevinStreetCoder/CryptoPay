"""
One-shot migration: re-encrypt every existing TOTP secret under the
new TOTP_ENCRYPTION_KEY (audit HIGH-1).

Before HIGH-1, TOTP secrets were encrypted with a Fernet key derived
from SECRET_KEY. After the fix, they're encrypted under the dedicated
TOTP_ENCRYPTION_KEY env var. The model's `_decrypt_totp_token` helper
walks both candidate keys at read time, so the app is forward-
compatible with un-migrated rows · but to fully retire the legacy key,
every row must be rewritten under the new one.

Usage:
    # Dry run (no writes, just report)
    python manage.py migrate_totp_encryption

    # Actually re-encrypt
    python manage.py migrate_totp_encryption --apply

The command is idempotent · re-running it is a no-op on already-
migrated rows. If a row is corrupt (decryption fails under both keys),
it's logged and skipped, never deleted.
"""
from __future__ import annotations

from cryptography.fernet import InvalidToken

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import (
    User,
    _decrypt_totp_token,
    _fernet_from_legacy_key,
    _fernet_from_primary_key,
)


class Command(BaseCommand):
    help = "Re-encrypt every TOTP secret under TOTP_ENCRYPTION_KEY."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually rewrite rows. Without this, the command is a dry run.",
        )

    def handle(self, *args, **options):
        apply = options["apply"]

        try:
            primary = _fernet_from_primary_key()
        except Exception as exc:
            self.stderr.write(self.style.ERROR(
                f"TOTP_ENCRYPTION_KEY is not configured: {exc}"
            ))
            return
        try:
            legacy = _fernet_from_legacy_key()
        except Exception:
            legacy = None

        rows = User.objects.exclude(totp_secret="").only("id", "totp_secret")
        total = rows.count()

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"Found {total} user(s) with a non-empty totp_secret."
        ))

        rewritten = 0
        already_primary = 0
        legacy_rewritten = 0
        legacy_plaintext = 0
        corrupt = 0

        with transaction.atomic():
            for user in rows.iterator(chunk_size=200):
                token = user.totp_secret
                if not token:
                    continue

                # Already encrypted under the primary key?
                try:
                    primary.decrypt(token.encode())
                    already_primary += 1
                    continue
                except InvalidToken:
                    pass
                except Exception:
                    pass

                # Try the legacy key.
                plaintext = None
                if legacy is not None:
                    try:
                        plaintext = legacy.decrypt(token.encode()).decode()
                    except InvalidToken:
                        pass
                    except Exception:
                        pass

                # Last-ditch: maybe the row is legacy plaintext (no Fernet
                # wrapping at all · pre-encryption era).
                if plaintext is None and not token.startswith("gAAAAA"):
                    plaintext = token
                    legacy_plaintext += 1

                if plaintext is None:
                    self.stderr.write(self.style.WARNING(
                        f"  user={user.id} totp_secret unreadable under either key; skipping."
                    ))
                    corrupt += 1
                    continue

                new_token = primary.encrypt(plaintext.encode()).decode()
                if apply:
                    User.objects.filter(pk=user.pk).update(totp_secret=new_token)
                rewritten += 1
                if not legacy_plaintext or token.startswith("gAAAAA"):
                    legacy_rewritten += 1

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"Re-encrypted (or would re-encrypt): {rewritten}"))
        self.stdout.write(f"  Already under primary key (no-op):       {already_primary}")
        self.stdout.write(f"  Migrated from legacy SECRET_KEY-derived: {legacy_rewritten}")
        self.stdout.write(f"  Migrated from pre-encryption plaintext:  {legacy_plaintext}")
        self.stdout.write(self.style.WARNING(f"  Corrupt / unreadable rows skipped:       {corrupt}"))
        self.stdout.write("")

        if not apply:
            self.stdout.write(self.style.WARNING(
                "DRY RUN · pass --apply to actually rewrite rows."
            ))
        else:
            self.stdout.write(self.style.SUCCESS("Done. Verify with `manage.py shell` if desired."))
