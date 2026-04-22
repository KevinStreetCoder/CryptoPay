"""Add user-facing preferences persisted server-side so outbound
notifications honour the user's chosen language + channel opt-outs.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0014_user_last_activity_at_user_last_activity_ip"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="language",
            field=models.CharField(
                choices=[("en", "English"), ("sw", "Kiswahili")],
                default="en",
                max_length=8,
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="notify_email_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="user",
            name="notify_sms_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="user",
            name="notify_push_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="user",
            name="notify_marketing_enabled",
            field=models.BooleanField(default=False),
        ),
    ]
