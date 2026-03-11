"""Add last_login_ip and last_login_country for device/IP change detection."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_security_features"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="last_login_ip",
            field=models.GenericIPAddressField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="last_login_country",
            field=models.CharField(blank=True, default="", max_length=2),
        ),
    ]
