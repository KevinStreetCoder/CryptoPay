"""Add OTP challenge, email verification, recovery contacts, and TOTP fields."""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_add_avatar_field"),
    ]

    operations = [
        # OTP challenge flag
        migrations.AddField(
            model_name="user",
            name="otp_challenge_required",
            field=models.BooleanField(default=False),
        ),
        # Email verification
        migrations.AddField(
            model_name="user",
            name="email_verified",
            field=models.BooleanField(default=False),
        ),
        # Recovery contacts
        migrations.AddField(
            model_name="user",
            name="recovery_email",
            field=models.EmailField(blank=True, max_length=254, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="recovery_email_verified",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="user",
            name="recovery_phone",
            field=models.CharField(blank=True, default="", max_length=15),
        ),
        # TOTP authenticator
        migrations.AddField(
            model_name="user",
            name="totp_secret",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="user",
            name="totp_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="user",
            name="totp_backup_codes",
            field=models.JSONField(blank=True, default=list),
        ),
        # Email verification token model
        migrations.CreateModel(
            name="EmailVerificationToken",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("email", models.EmailField(max_length=254)),
                ("token", models.CharField(db_index=True, max_length=64, unique=True)),
                ("is_used", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="email_tokens", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": "email_verification_tokens",
            },
        ),
    ]
