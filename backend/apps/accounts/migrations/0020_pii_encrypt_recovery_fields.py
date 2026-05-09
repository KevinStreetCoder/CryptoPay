"""Phase-3 · widen recovery_email + recovery_phone to TextField so
they can hold Fernet ciphertext.

Fernet output is ~140-180 chars for an email/phone-sized plaintext
(IV + ciphertext + HMAC, base64-encoded), well over the original
EmailField (default 254) and CharField(15) caps. We migrate the
column type to TextField (unbounded). The legacy plaintext values
remain intact · the field's `from_db_value` returns plaintext for
non-Fernet rows. The next save() encrypts.

Backfill plan (separate from this migration · no destructive side
effect here):
    docker exec cryptopay_web python manage.py backfill_pii_encryption \\
        --fields recovery_email,recovery_phone --commit
"""
from django.db import migrations, models

import apps.core.pii


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0019_user_account_deletion"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="recovery_email",
            field=apps.core.pii.PIIEncryptedField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="user",
            name="recovery_phone",
            field=apps.core.pii.PIIEncryptedField(blank=True, default="", null=True),
        ),
    ]
