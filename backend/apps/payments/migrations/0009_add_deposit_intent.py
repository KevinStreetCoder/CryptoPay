"""Deposit-intent · short-code-keyed reservation for SasaPay C2B."""
import uuid

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0008_add_platform_limits"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="DepositIntent",
            fields=[
                ("id", models.UUIDField(
                    primary_key=True, default=uuid.uuid4, editable=False, serialize=False,
                )),
                ("code", models.CharField(
                    max_length=12, unique=True, db_index=True,
                    help_text="Short Crockford-base32 code customers enter as the M-Pesa account number.",
                )),
                ("currency", models.CharField(max_length=10)),
                ("status", models.CharField(
                    max_length=16, default="open", db_index=True,
                    choices=[
                        ("open", "Open"),
                        ("consumed", "Consumed"),
                        ("expired", "Expired"),
                        ("cancelled", "Cancelled"),
                    ],
                )),
                ("expires_at", models.DateTimeField(db_index=True)),
                ("consumed_at", models.DateTimeField(null=True, blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("user", models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name="deposit_intents",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("transaction", models.ForeignKey(
                    on_delete=models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name="deposit_intent",
                    to="payments.transaction",
                )),
            ],
            options={
                "db_table": "deposit_intents",
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["code", "status"], name="deposit_code_status"),
                    models.Index(fields=["status", "expires_at"], name="deposit_sweep"),
                ],
            },
        ),
    ]
