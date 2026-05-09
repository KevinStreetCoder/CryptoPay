"""Phase-3 Deploy-1 · primary phone + email encryption columns.

Adds parallel encrypted columns next to the existing plaintext
`phone`, `email`, `normalised_email`. Reads stay on the plaintext
columns in this deploy; `User.save()` dual-writes the new columns
(see `apps.accounts.models.User.save`).

  *_det     PIIDeterministicField (HMAC-SHA256) · queryable, unique
            by underlying plaintext.
  *_fernet  PIIEncryptedField (Fernet, non-deterministic) · for
            retrieval after Deploy-2 drops the plaintext.

Migration is FULLY ADDITIVE · no existing column is altered, no
data is destroyed, the migration is reversible (Django's automatic
RemoveField reversal works because every operation here is AddField).

Backfill (run after this migration applies):
    docker exec cryptopay_web python manage.py backfill_pii_encryption \\
        --fields phone_det,phone_fernet,email_det,email_fernet,\\
                 normalised_email_det --commit

Deploy-2 (NOT in this migration · separate session, separate drop)
will:
  - Flip read paths to use *_det for queries + *_fernet for display
  - Drop `phone`, `email`, `normalised_email` plaintext columns
  - Make *_det / *_fernet NOT NULL
"""
from django.db import migrations

import apps.core.pii


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0020_pii_encrypt_recovery_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="phone_det",
            field=apps.core.pii.PIIDeterministicField(
                "phone",
                blank=True,
                db_index=True,
                max_length=70,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="phone_fernet",
            field=apps.core.pii.PIIEncryptedField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="email_det",
            field=apps.core.pii.PIIDeterministicField(
                "email",
                blank=True,
                db_index=True,
                max_length=70,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="email_fernet",
            field=apps.core.pii.PIIEncryptedField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="normalised_email_det",
            field=apps.core.pii.PIIDeterministicField(
                "normalised_email",
                blank=True,
                db_index=True,
                default="",
                max_length=70,
            ),
        ),
    ]
