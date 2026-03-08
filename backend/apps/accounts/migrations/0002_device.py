# Generated migration for Device model

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Device",
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
                ("device_id", models.CharField(db_index=True, max_length=255)),
                ("device_name", models.CharField(blank=True, max_length=255)),
                ("platform", models.CharField(blank=True, max_length=50)),
                ("os_version", models.CharField(blank=True, max_length=50)),
                ("is_trusted", models.BooleanField(default=False)),
                ("last_seen", models.DateTimeField(auto_now=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="devices",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "devices",
                "unique_together": {("user", "device_id")},
            },
        ),
    ]
