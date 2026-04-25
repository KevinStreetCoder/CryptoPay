"""Audit HIGH-4: bump EmailVerificationToken.otp_code from 6 to 8 chars
so we can mint 8-character alphanumeric codes (36^8 = 2.8×10^12 space)
instead of 6-digit numeric (1M space, IP-rotation-brute-forceable in
the 10-minute TTL).

Old rows keep working · this is a column-widen, not a value rewrite,
and the verify view accepts both lengths during the natural 10-minute
expiry window.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0016_user_last_platform"),
    ]

    operations = [
        migrations.AlterField(
            model_name="emailverificationtoken",
            name="otp_code",
            field=models.CharField(db_index=True, default="", max_length=8),
        ),
    ]
