import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0009_pin_reset_token"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="suspension_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="user",
            name="suspended_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="suspended_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="suspended_users",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
