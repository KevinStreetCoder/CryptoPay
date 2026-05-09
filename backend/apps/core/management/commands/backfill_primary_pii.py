"""Backfill primary phone/email PII into Phase-3 Deploy-1 encrypted columns.

After the 0021 migration adds `phone_det`/`phone_fernet`/`email_det`/
`email_fernet`/`normalised_email_det`, run this command once to copy the
existing plaintext into the new columns. The User.save() override does
the same dual-write on every subsequent save · this command is a one-
shot to catch existing rows.

Idempotent · re-running is safe. Each save is atomic and the PII fields'
get_prep_value() detects already-encrypted input and returns it unchanged.

Usage:
    # Dry-run · report counts only
    docker exec cryptopay_web python manage.py backfill_primary_pii

    # Apply
    docker exec cryptopay_web python manage.py backfill_primary_pii --commit

    # Tighter batch on huge tables (default 200, fine for our scale)
    docker exec cryptopay_web python manage.py backfill_primary_pii \\
        --commit --batch-size 50
"""
from django.core.management.base import BaseCommand


# The plaintext source columns we copy from. The User.save() override
# does the actual encryption (det + fernet). We just need to trigger
# a save with the right update_fields list so the override fires.
SOURCE_FIELDS = ("phone", "email", "normalised_email")
TARGET_FIELDS = (
    "phone_det",
    "phone_fernet",
    "email_det",
    "email_fernet",
    "normalised_email_det",
)


class Command(BaseCommand):
    help = "Backfill primary phone/email plaintext into Phase-3 encrypted columns"

    def add_arguments(self, parser):
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Without this, runs in dry-run mode.",
        )
        parser.add_argument(
            "--batch-size", type=int, default=200,
            help="Rows per save batch.",
        )

    def handle(self, *args, **opts):
        from apps.accounts.models import User

        commit = opts["commit"]
        batch = opts["batch_size"]
        self.stdout.write(
            f"backfill_primary_pii · commit={commit}  batch={batch}"
        )

        # Walk all users · for each, set the source field back to its
        # current value (no-op for plaintext, but flushes through the
        # save() override which dual-writes to the encrypted columns).
        # We always touch all three sources because save() recomputes
        # the encrypted columns based on the in-memory state.
        scanned = 0
        backfilled = 0
        skipped = 0
        already_encrypted = 0

        # Update fields that the override will sync. We pass `phone`
        # and `email` as the trigger fields so the override fires its
        # phone_in_scope / email_in_scope branches.
        update_fields = list(SOURCE_FIELDS) + list(TARGET_FIELDS)

        qs = User.objects.all().iterator(chunk_size=batch)
        for user in qs:
            scanned += 1
            # Skip rows where every encrypted column is already populated
            # AND matches the current plaintext (avoid pointless writes
            # · the save() override does this check too, but a no-op
            # save still hits the DB).
            needs_backfill = False
            if user.phone and not user.phone_det:
                needs_backfill = True
            if user.email and not user.email_det:
                needs_backfill = True
            if user.normalised_email and not user.normalised_email_det:
                needs_backfill = True

            if not needs_backfill:
                already_encrypted += 1
                continue

            if commit:
                # Force the override to run on phone + email scope.
                # Casting through the assignment ensures the override's
                # `email_in_scope` and `phone_in_scope` predicates fire.
                user.save(update_fields=update_fields)
                backfilled += 1
            else:
                # Dry-run · just count
                backfilled += 1

            if scanned % 100 == 0:
                self.stdout.write(
                    f"  scanned={scanned}  backfilled={backfilled}  "
                    f"already_encrypted={already_encrypted}"
                )

        verb = "Backfilled" if commit else "Would backfill"
        self.stdout.write(self.style.SUCCESS(
            f"DONE · scanned {scanned}, {verb} {backfilled}, "
            f"already_encrypted {already_encrypted}, skipped {skipped}"
        ))

        if not commit:
            self.stdout.write(self.style.WARNING(
                "DRY-RUN · re-run with --commit to apply."
            ))
