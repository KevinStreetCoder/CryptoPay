# Generated manually for hot/warm/cold custody tier architecture

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("wallets", "0004_system_wallet_balance_constraint"),
    ]

    operations = [
        # Add new wallet_type choices (warm, cold) to SystemWallet
        migrations.AlterField(
            model_name="systemwallet",
            name="wallet_type",
            field=models.CharField(
                choices=[
                    ("hot", "Hot"),
                    ("warm", "Warm"),
                    ("cold", "Cold"),
                    ("fee", "Fee"),
                    ("float", "Float"),
                ],
                max_length=10,
            ),
        ),
        # Add chain field
        migrations.AddField(
            model_name="systemwallet",
            name="chain",
            field=models.CharField(
                blank=True,
                help_text="Blockchain network (tron, ethereum, bitcoin, solana, polygon)",
                max_length=20,
            ),
        ),
        # Add tier field
        migrations.AddField(
            model_name="systemwallet",
            name="tier",
            field=models.CharField(
                choices=[
                    ("hot", "Hot (online, instant access)"),
                    ("warm", "Warm (online, delayed access)"),
                    ("cold", "Cold (offline, manual access)"),
                ],
                db_index=True,
                default="hot",
                help_text="Custody tier for this wallet",
                max_length=10,
            ),
        ),
        # Add address field
        migrations.AddField(
            model_name="systemwallet",
            name="address",
            field=models.CharField(
                blank=True,
                help_text="On-chain address of this system wallet",
                max_length=255,
            ),
        ),
        # Add last_reconciled field
        migrations.AddField(
            model_name="systemwallet",
            name="last_reconciled",
            field=models.DateTimeField(
                blank=True,
                help_text="Last time on-chain balance was verified against DB balance",
                null=True,
            ),
        ),
        # Add is_active field
        migrations.AddField(
            model_name="systemwallet",
            name="is_active",
            field=models.BooleanField(
                default=True,
                help_text="Whether this wallet is currently in use",
            ),
        ),
        # Add max_daily_withdrawal field
        migrations.AddField(
            model_name="systemwallet",
            name="max_daily_withdrawal",
            field=models.DecimalField(
                blank=True,
                decimal_places=8,
                help_text="Maximum daily withdrawal limit for this wallet",
                max_digits=28,
                null=True,
            ),
        ),
        # Add notes field
        migrations.AddField(
            model_name="systemwallet",
            name="notes",
            field=models.TextField(
                blank=True,
                help_text="Admin notes about this wallet (e.g., HSM location, signing procedure)",
            ),
        ),
        # Create CustodyTransfer model
        migrations.CreateModel(
            name="CustodyTransfer",
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
                    "from_tier",
                    models.CharField(
                        choices=[
                            ("hot", "Hot (online, instant access)"),
                            ("warm", "Warm (online, delayed access)"),
                            ("cold", "Cold (offline, manual access)"),
                        ],
                        max_length=10,
                    ),
                ),
                (
                    "to_tier",
                    models.CharField(
                        choices=[
                            ("hot", "Hot (online, instant access)"),
                            ("warm", "Warm (online, delayed access)"),
                            ("cold", "Cold (offline, manual access)"),
                        ],
                        max_length=10,
                    ),
                ),
                (
                    "currency",
                    models.CharField(
                        choices=[
                            ("USDT", "Usdt"),
                            ("USDC", "Usdc"),
                            ("BTC", "Btc"),
                            ("ETH", "Eth"),
                            ("SOL", "Sol"),
                            ("KES", "Kes"),
                        ],
                        max_length=10,
                    ),
                ),
                (
                    "amount",
                    models.DecimalField(decimal_places=8, max_digits=28),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("submitted", "Submitted (TX broadcast)"),
                            ("confirmed", "Confirmed on-chain"),
                            ("completed", "Completed (balances updated)"),
                            ("failed", "Failed"),
                            ("cancelled", "Cancelled"),
                        ],
                        db_index=True,
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("tx_hash", models.CharField(blank=True, max_length=255)),
                ("from_address", models.CharField(blank=True, max_length=255)),
                ("to_address", models.CharField(blank=True, max_length=255)),
                (
                    "gas_fee",
                    models.DecimalField(
                        blank=True,
                        decimal_places=8,
                        help_text="Network fee paid for this transfer",
                        max_digits=28,
                        null=True,
                    ),
                ),
                (
                    "initiated_by",
                    models.CharField(
                        blank=True,
                        help_text="'system' for automatic, or admin username for manual",
                        max_length=100,
                    ),
                ),
                (
                    "reason",
                    models.TextField(
                        blank=True,
                        help_text="Why this transfer was initiated",
                    ),
                ),
                ("error_message", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("confirmed_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "custody_transfers",
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(
                        fields=["status", "-created_at"],
                        name="custody_tra_status_created_idx",
                    ),
                    models.Index(
                        fields=["from_tier", "to_tier"],
                        name="custody_tra_tiers_idx",
                    ),
                    models.Index(
                        fields=["-created_at"],
                        name="custody_tra_created_idx",
                    ),
                ],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("amount__gt", 0)),
                        name="custody_transfer_amount_positive",
                    ),
                ],
            },
        ),
    ]
