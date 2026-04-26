"""Add account-deletion fields to User · Google Play compliance.

Two new nullable timestamps:
  - deletion_requested_at · set the moment a user initiates deletion;
    login refused while non-null. Indexed because the daily purge
    task scans users by `deletion_scheduled_for <= now`.
  - deletion_scheduled_for · 14 days after request · the Celery beat
    task `purge_pending_deletions` hard-deletes when this passes.

Both nullable so existing rows migrate cleanly with no default value.
The auth flow refuses login when `deletion_requested_at IS NOT NULL`
regardless of `deletion_scheduled_for`, so a partially-set state still
locks the user out (defensive).
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0018_user_normalised_email"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="deletion_requested_at",
            field=models.DateTimeField(
                blank=True,
                db_index=True,
                help_text="Set when the user initiates account deletion. Login is refused while non-null.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="deletion_scheduled_for",
            field=models.DateTimeField(
                blank=True,
                help_text="Hard-delete timestamp · 14 days after deletion_requested_at.",
                null=True,
            ),
        ),
    ]
