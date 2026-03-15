import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AdminNotification",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=200)),
                ("body", models.TextField()),
                ("category", models.CharField(choices=[("security", "Security"), ("update", "Update"), ("promotion", "Promotion"), ("maintenance", "Maintenance")], default="update", max_length=20)),
                ("priority", models.CharField(choices=[("low", "Low"), ("normal", "Normal"), ("high", "High"), ("critical", "Critical")], default="normal", max_length=10)),
                ("channels", models.JSONField(default=list, help_text="List of delivery channels: email, sms, in_app")),
                ("target", models.CharField(default="all", help_text="Target audience: all, or specific filter", max_length=20)),
                ("target_user_ids", models.JSONField(blank=True, default=list, help_text="Optional list of specific user UUIDs to target")),
                ("recipient_count", models.IntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_notifications", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "Admin Notification",
                "verbose_name_plural": "Admin Notifications",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="UserNotification",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("read", models.BooleanField(default=False)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("delivered_via", models.CharField(choices=[("email", "Email"), ("sms", "SMS"), ("push", "Push"), ("in_app", "In-App")], default="in_app", max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("notification", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="deliveries", to="notifications.adminnotification")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="notifications", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "User Notification",
                "verbose_name_plural": "User Notifications",
                "ordering": ["-created_at"],
                "unique_together": {("user", "notification")},
            },
        ),
    ]
