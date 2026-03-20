from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("rates", "0002_ratealert"),
    ]

    operations = [
        migrations.AddField(
            model_name="ratealert",
            name="trigger_count",
            field=models.PositiveIntegerField(default=0, help_text="How many times this alert has fired"),
        ),
        migrations.AddField(
            model_name="ratealert",
            name="last_triggered_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="ratealert",
            name="expires_at",
            field=models.DateTimeField(blank=True, null=True, help_text="Alert auto-deactivates after this time"),
        ),
        migrations.AddField(
            model_name="ratealert",
            name="cooldown_minutes",
            field=models.PositiveIntegerField(default=60, help_text="Min minutes between re-triggers"),
        ),
    ]
