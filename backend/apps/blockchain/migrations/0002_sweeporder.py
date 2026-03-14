# Generated manually for SweepOrder model

import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="SweepOrder",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "chain",
                    models.CharField(
                        choices=[
                            ("tron", "Tron"),
                            ("ethereum", "Ethereum"),
                            ("bitcoin", "Bitcoin"),
                            ("solana", "Solana"),
                        ],
                        max_length=20,
                    ),
                ),
                ("currency", models.CharField(max_length=10)),
                ("from_address", models.CharField(max_length=100)),
                ("to_address", models.CharField(max_length=100)),
                ("amount", models.DecimalField(decimal_places=8, max_digits=28)),
                (
                    "estimated_fee",
                    models.DecimalField(decimal_places=8, max_digits=28),
                ),
                (
                    "actual_fee",
                    models.DecimalField(
                        blank=True, decimal_places=8, max_digits=28, null=True
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("estimating", "Estimating"),
                            ("submitted", "Submitted"),
                            ("confirming", "Confirming"),
                            ("confirmed", "Confirmed"),
                            ("credited", "Credited"),
                            ("failed", "Failed"),
                            ("skipped", "Skipped"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("tx_hash", models.CharField(blank=True, default="", max_length=100)),
                ("confirmations", models.IntegerField(default=0)),
                ("required_confirmations", models.IntegerField(default=1)),
                ("error_message", models.TextField(blank=True, default="")),
                ("retry_count", models.SmallIntegerField(default=0)),
                (
                    "batch_id",
                    models.CharField(blank=True, default="", max_length=64),
                ),
                (
                    "skip_reason",
                    models.CharField(blank=True, default="", max_length=200),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("confirmed_at", models.DateTimeField(blank=True, null=True)),
                ("credited_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "sweep_orders",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="sweeporder",
            index=models.Index(
                fields=["status", "-created_at"],
                name="sweep_status_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="sweeporder",
            index=models.Index(
                fields=["chain", "from_address"],
                name="sweep_chain_addr_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="sweeporder",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    status__in=["pending", "submitted", "confirming"]
                ),
                fields=("chain", "from_address", "status"),
                name="unique_active_sweep_per_address",
            ),
        ),
    ]
