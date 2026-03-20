from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("rates", "0003_ratealert_duration_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="ratealert",
            name="schedule_type",
            field=models.CharField(blank=True, default="", help_text="Routine schedule: daily, weekly, monthly, or empty for price-trigger only", max_length=10),
        ),
        migrations.AddField(
            model_name="ratealert",
            name="schedule_hour",
            field=models.PositiveSmallIntegerField(blank=True, help_text="Hour of day to send (0-23, EAT timezone)", null=True),
        ),
        migrations.AddField(
            model_name="ratealert",
            name="schedule_day",
            field=models.PositiveSmallIntegerField(blank=True, help_text="Day of week (0=Mon..6=Sun) for weekly, or day of month (1-28) for monthly", null=True),
        ),
        migrations.AddField(
            model_name="ratealert",
            name="last_scheduled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
