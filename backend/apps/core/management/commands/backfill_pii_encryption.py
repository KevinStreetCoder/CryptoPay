"""Backfill plaintext PII columns into Fernet ciphertext.

Phase-3 (2026-05-09) added column encryption to a handful of LOW-
traffic PII fields (recovery_email, recovery_phone, KYC rejection
notes, etc.). Existing rows kept their plaintext · this command
walks them and re-saves under encryption.

Idempotent · already-encrypted rows (Fernet `gAAAAA` prefix) are
detected and skipped. Safe to re-run.

Usage:
    # Dry-run · count rows that would be encrypted
    docker exec cryptopay_web python manage.py backfill_pii_encryption \\
        --fields recovery_email,recovery_phone

    # Apply
    docker exec cryptopay_web python manage.py backfill_pii_encryption \\
        --fields recovery_email,recovery_phone --commit

Run during a low-traffic window · the User table walks update one
row at a time to keep concurrent writes safe (no SELECT ... FOR
UPDATE so signups during backfill aren't blocked, just race-
condition-tolerated · the from_db_value layer handles a save that
lands mid-backfill).
"""
from django.core.management.base import BaseCommand

# Map of model-label → list of fields the command knows how to
# encrypt. Adding a model here is the same as registering the
# encryption · no other glue needed.
SUPPORTED = {
    "accounts.User": ["recovery_email", "recovery_phone"],
}


class Command(BaseCommand):
    help = "Backfill plaintext PII columns into Fernet ciphertext"

    def add_arguments(self, parser):
        parser.add_argument(
            "--fields",
            type=str,
            default="recovery_email,recovery_phone",
            help="Comma-separated field names to encrypt.",
        )
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Without this, runs in dry-run mode (counts rows only).",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=200,
            help="Rows per save batch.",
        )

    def handle(self, *args, **opts):
        from apps.accounts.models import User

        target_fields = [f.strip() for f in opts["fields"].split(",") if f.strip()]
        if not target_fields:
            self.stderr.write("--fields is empty")
            return

        # Validate all requested fields exist on User
        valid = SUPPORTED.get("accounts.User", [])
        for f in target_fields:
            if f not in valid:
                self.stderr.write(
                    f"Field '{f}' not in supported list ({valid}). "
                    "Add it to SUPPORTED in this command if needed."
                )
                return

        commit = opts["commit"]
        batch = opts["batch_size"]
        self.stdout.write(
            f"backfill · fields={target_fields}  commit={commit}  batch={batch}"
        )

        encrypted = 0
        skipped = 0
        scanned = 0

        # Build a Q so we only touch rows that have at least one
        # plaintext value (skip rows where every target field is
        # already encrypted or empty).
        from django.db.models import Q
        q = Q()
        for f in target_fields:
            q |= ~Q(**{f"{f}__startswith": "gAAAAA"}) & ~Q(**{f"{f}__exact": ""})

        qs = User.objects.filter(q).only("id", *target_fields).iterator(chunk_size=batch)
        for user in qs:
            scanned += 1
            changed = False
            for f in target_fields:
                val = getattr(user, f)
                if val and isinstance(val, str) and not val.startswith("gAAAAA"):
                    # `setattr` triggers no encryption · we rely on
                    # the field's get_prep_value being called when
                    # save() runs.
                    setattr(user, f, val)
                    changed = True
            if changed:
                if commit:
                    user.save(update_fields=target_fields)
                encrypted += 1
            else:
                skipped += 1
            if scanned % 500 == 0:
                self.stdout.write(f"  scanned={scanned}  encrypted={encrypted}")

        verb = "Encrypted" if commit else "Would encrypt"
        self.stdout.write(self.style.SUCCESS(
            f"DONE · scanned {scanned}, {verb} {encrypted}, skipped {skipped} "
            f"(already encrypted or empty)"
        ))
