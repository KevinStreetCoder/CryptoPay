"""Email-abuse defence Layer 4 · add `normalised_email` column.

Adds the column, backfills it from existing rows by re-applying
`normalise_email` to whatever's in `email`, then installs a partial
unique constraint that only enforces uniqueness when the value isn't
the empty default. Phone-only users don't collide on "".

The backfill is best-effort. If two existing rows would collide after
normalisation (extremely unlikely on a clean prod DB but possible if
someone snuck a duplicate in via raw SQL), we leave the second row's
column blank and emit a log warning so an operator can resolve it
manually before the unique constraint creates.

Reverse migration removes the constraint and the column · safe.
"""
from django.db import migrations, models


def backfill_normalised(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    # Avoid hammering the disposable-domains import at migration time ·
    # `normalise_email` is the only piece we need. Inline the logic so
    # the migration doesn't depend on the app's helper module shape if
    # someone refactors it later.
    seen: dict[str, str] = {}
    skipped: list[tuple[str, str]] = []

    for user in User.objects.iterator(chunk_size=500):
        email = (user.email or "").strip().lower()
        if not email or "@" not in email:
            continue
        local, _, domain = email.rpartition("@")
        if not local or not domain:
            continue
        if "+" in local:
            local = local.split("+", 1)[0]
        if domain in ("gmail.com", "googlemail.com"):
            local = local.replace(".", "")
            domain = "gmail.com"
        if not local:
            continue
        normalised = f"{local}@{domain}"

        if normalised in seen and seen[normalised] != str(user.pk):
            # A duplicate already claimed this slot · leave the second
            # one blank so the unique constraint can be created. The
            # operator can decide which row keeps the email.
            skipped.append((str(user.pk), normalised))
            continue
        seen[normalised] = str(user.pk)
        user.normalised_email = normalised
        user.save(update_fields=["normalised_email"])

    if skipped:
        # Best we can do at migration time · stdout shows in `migrate -v 2`.
        print(
            f"WARN: {len(skipped)} user rows had a colliding "
            "normalised_email and were left blank. Resolve manually "
            "before relying on uniqueness."
        )


def reverse_noop(apps, schema_editor):
    """Reverse migration drops the column entirely · no data to restore."""
    return None


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0017_otp_code_8chars"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="normalised_email",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="",
                max_length=254,
            ),
        ),
        migrations.RunPython(backfill_normalised, reverse_noop),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(
                condition=models.Q(("normalised_email", ""), _negated=True),
                fields=("normalised_email",),
                name="user_normalised_email_unique",
            ),
        ),
    ]
