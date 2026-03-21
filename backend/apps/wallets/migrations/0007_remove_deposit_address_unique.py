"""Remove unique constraint on deposit_address.

EVM chains (ETH, USDC/Polygon) share the same BIP-44 coin type 60,
so multiple wallets for the same user can have the same deposit address.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("wallets", "0006_add_ledger_idempotent_entry_constraint"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="wallet",
            name="wallet_deposit_address_unique",
        ),
    ]
