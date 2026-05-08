"""Platform-limits singleton · admin-settable safety caps."""
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0007_add_reconciliation_cases"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PlatformLimit",
            fields=[
                ("id", models.AutoField(primary_key=True, serialize=False)),
                ("max_per_tx_kes", models.DecimalField(
                    decimal_places=2, max_digits=18, default=300000,
                    help_text="Hard cap on a single outgoing transaction (KES). 0 disables.",
                )),
                ("max_per_hour_kes", models.DecimalField(
                    decimal_places=2, max_digits=18, default=2000000,
                    help_text="Cap on outgoing volume in the last 60 minutes (KES). 0 disables.",
                )),
                ("max_per_day_kes", models.DecimalField(
                    decimal_places=2, max_digits=18, default=10000000,
                    help_text="Cap on outgoing volume in the last 24 hours (KES). 0 disables.",
                )),
                ("max_tx_per_hour_count", models.IntegerField(
                    default=200,
                    help_text="Cap on outgoing tx COUNT in the last 60 minutes. 0 disables.",
                )),
                ("hard_pause", models.BooleanField(
                    default=False,
                    help_text="If True, refuses ALL outgoing payments.",
                )),
                ("hard_pause_reason", models.CharField(blank=True, default="", max_length=255)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_updated_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name="updated_platform_limits",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "db_table": "platform_limits",
            },
        ),
    ]
