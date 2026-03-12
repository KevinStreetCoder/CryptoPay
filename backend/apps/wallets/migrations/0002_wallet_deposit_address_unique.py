# Generated manually — adds conditional unique constraint for deposit_address

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("wallets", "0001_initial"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="wallet",
            constraint=models.UniqueConstraint(
                fields=["deposit_address"],
                name="wallet_deposit_address_unique",
                condition=models.Q(("deposit_address__gt", "")),
            ),
        ),
    ]
