# Generated manually

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0005_savedpaybill"),
    ]

    operations = [
        migrations.AlterField(
            model_name="transaction",
            name="type",
            field=models.CharField(
                choices=[
                    ("DEPOSIT", "Deposit"),
                    ("WITHDRAWAL", "Withdrawal"),
                    ("BUY", "Buy"),
                    ("SELL", "Sell"),
                    ("PAYBILL_PAYMENT", "Paybill Payment"),
                    ("TILL_PAYMENT", "Till Payment"),
                    ("SEND_MPESA", "Send Mpesa"),
                    ("KES_DEPOSIT", "Kes Deposit"),
                    ("KES_DEPOSIT_C2B", "Kes Deposit C2B"),
                    ("SWAP", "Swap"),
                    ("INTERNAL_TRANSFER", "Internal Transfer"),
                    ("FEE", "Fee"),
                ],
                db_index=True,
                max_length=30,
            ),
        ),
    ]
