from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0007_login_tracking"),
    ]

    operations = [
        migrations.AddField(
            model_name="device",
            name="ip_address",
            field=models.GenericIPAddressField(blank=True, null=True),
        ),
    ]
