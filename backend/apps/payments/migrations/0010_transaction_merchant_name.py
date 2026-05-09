"""Add merchant_name to Transaction · resolved business name for the
paybill/till the user paid.

Sourced at quote time from SasaPay's `account-validation` endpoint
(POST /api/v1/accounts/account-validation/) and/or from the
`RecipientName` field in the B2B/B2C result callback. Surfaced on
receipts and the tx detail page so users see "Paid to KPLC PREPAID"
instead of just "Paybill 888880".
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0009_add_deposit_intent"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="merchant_name",
            field=models.CharField(blank=True, max_length=120),
        ),
    ]
