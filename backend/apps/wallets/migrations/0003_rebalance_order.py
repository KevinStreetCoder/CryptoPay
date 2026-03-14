import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("wallets", "0002_wallet_deposit_address_unique"),
    ]

    operations = [
        migrations.CreateModel(
            name="RebalanceOrder",
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
                    "trigger",
                    models.CharField(
                        choices=[
                            ("auto", "Automatic (circuit breaker)"),
                            ("manual", "Manual (admin)"),
                            ("scheduled", "Scheduled (periodic check)"),
                        ],
                        max_length=20,
                    ),
                ),
                (
                    "execution_mode",
                    models.CharField(
                        choices=[
                            ("manual", "Manual (admin sells on exchange dashboard)"),
                            ("api", "API (automated via Yellow Card API)"),
                        ],
                        default="manual",
                        max_length=20,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("submitted", "Submitted to Exchange"),
                            ("settling", "Settlement in Progress"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                            ("cancelled", "Cancelled"),
                        ],
                        db_index=True,
                        default="pending",
                        max_length=20,
                    ),
                ),
                (
                    "float_balance_at_trigger",
                    models.DecimalField(
                        decimal_places=2,
                        help_text="M-Pesa float balance when rebalance was triggered",
                        max_digits=28,
                    ),
                ),
                (
                    "target_float_balance",
                    models.DecimalField(
                        decimal_places=2,
                        default=1500000,
                        help_text="Target float balance after rebalance",
                        max_digits=28,
                    ),
                ),
                (
                    "sell_currency",
                    models.CharField(default="USDT", max_length=10),
                ),
                (
                    "sell_amount",
                    models.DecimalField(
                        decimal_places=8,
                        help_text="Amount of crypto to sell",
                        max_digits=28,
                    ),
                ),
                (
                    "expected_kes_amount",
                    models.DecimalField(
                        decimal_places=2,
                        help_text="Expected KES from the sale (at quote time)",
                        max_digits=28,
                    ),
                ),
                (
                    "exchange_rate_at_quote",
                    models.DecimalField(
                        decimal_places=8,
                        help_text="Exchange rate when order was calculated",
                        max_digits=18,
                    ),
                ),
                (
                    "actual_kes_received",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        help_text="Actual KES received after settlement",
                        max_digits=28,
                        null=True,
                    ),
                ),
                (
                    "actual_exchange_rate",
                    models.DecimalField(
                        blank=True,
                        decimal_places=8,
                        help_text="Actual rate at execution",
                        max_digits=18,
                        null=True,
                    ),
                ),
                (
                    "exchange_fee_kes",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        help_text="Fee charged by exchange",
                        max_digits=28,
                        null=True,
                    ),
                ),
                (
                    "exchange_provider",
                    models.CharField(
                        default="yellow_card",
                        help_text="Which exchange was used",
                        max_length=50,
                    ),
                ),
                (
                    "exchange_order_id",
                    models.CharField(
                        blank=True,
                        help_text="Order ID from exchange (for reconciliation)",
                        max_length=255,
                    ),
                ),
                (
                    "exchange_reference",
                    models.CharField(
                        blank=True,
                        help_text="Any reference from the exchange (receipt, tx hash, etc.)",
                        max_length=255,
                    ),
                ),
                (
                    "admin_notes",
                    models.TextField(
                        blank=True,
                        help_text="Notes from admin about manual execution",
                    ),
                ),
                (
                    "reason",
                    models.TextField(
                        blank=True,
                        help_text="Why this rebalance was triggered",
                    ),
                ),
                ("error_message", models.TextField(blank=True)),
                ("retry_count", models.SmallIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("settled_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "rebalance_orders",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="rebalanceorder",
            index=models.Index(
                fields=["status", "-created_at"],
                name="rebalance_o_status_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="rebalanceorder",
            index=models.Index(
                fields=["-created_at"],
                name="rebalance_o_created_idx",
            ),
        ),
    ]
