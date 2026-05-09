"""Initial migration for the exchanges app.

Creates ExchangeLink + ExchangeWithdrawal with appropriate indexes
and the partial unique constraint that lets a user re-link a
provider after revoking the previous link.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid

import apps.core.pii


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("accounts", "0021_pii_encrypt_primary_phone_email"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExchangeLink",
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
                    "provider",
                    models.CharField(
                        choices=[
                            ("binance", "Binance"),
                            ("coinbase", "Coinbase"),
                            ("noones", "Noones"),
                        ],
                        max_length=24,
                    ),
                ),
                (
                    "refresh_token",
                    apps.core.pii.PIIEncryptedField(blank=True, null=True),
                ),
                (
                    "access_token",
                    apps.core.pii.PIIEncryptedField(blank=True, null=True),
                ),
                ("access_token_expires_at", models.DateTimeField(blank=True, null=True)),
                ("api_key", models.CharField(blank=True, default="", max_length=128)),
                (
                    "api_secret",
                    apps.core.pii.PIIEncryptedField(blank=True, null=True),
                ),
                ("scopes", models.JSONField(blank=True, default=list)),
                ("verified_at", models.DateTimeField(auto_now_add=True)),
                ("last_used_at", models.DateTimeField(blank=True, null=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("linked_from_ip", models.GenericIPAddressField(blank=True, null=True)),
                ("linked_user_agent", models.CharField(blank=True, default="", max_length=255)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="exchange_links",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "exchange_links",
            },
        ),
        migrations.AddConstraint(
            model_name="exchangelink",
            constraint=models.UniqueConstraint(
                condition=models.Q(("revoked_at__isnull", True)),
                fields=("user", "provider"),
                name="exchange_links_one_active_per_provider",
            ),
        ),
        migrations.AddIndex(
            model_name="exchangelink",
            index=models.Index(
                fields=["user", "provider"],
                name="exchange_li_user_id_8a4c93_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="exchangelink",
            index=models.Index(
                fields=["provider", "verified_at"],
                name="exchange_li_provide_5f2b7c_idx",
            ),
        ),
        migrations.CreateModel(
            name="ExchangeWithdrawal",
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
                ("request_id", models.CharField(max_length=64)),
                ("currency", models.CharField(max_length=8)),
                ("network", models.CharField(max_length=24)),
                ("amount", models.DecimalField(decimal_places=8, max_digits=20)),
                ("destination_address", models.CharField(max_length=128)),
                ("exchange_tx_id", models.CharField(blank=True, default="", max_length=128)),
                ("on_chain_tx", models.CharField(blank=True, default="", max_length=128)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("confirming", "Confirming"),
                            ("done", "Done"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("error_code", models.CharField(blank=True, default="", max_length=64)),
                ("error_message", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "link",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="withdrawals",
                        to="exchanges.exchangelink",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="exchange_withdrawals",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "exchange_withdrawals",
            },
        ),
        migrations.AddConstraint(
            model_name="exchangewithdrawal",
            constraint=models.UniqueConstraint(
                fields=("link", "request_id"),
                name="exchange_withdrawals_idempotency",
            ),
        ),
        migrations.AddIndex(
            model_name="exchangewithdrawal",
            index=models.Index(
                fields=["user", "status"],
                name="exchange_wi_user_id_b3c2a8_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="exchangewithdrawal",
            index=models.Index(
                fields=["link", "status"],
                name="exchange_wi_link_id_4e1f6d_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="exchangewithdrawal",
            index=models.Index(
                fields=["created_at"],
                name="exchange_wi_created_a8d2c5_idx",
            ),
        ),
    ]
