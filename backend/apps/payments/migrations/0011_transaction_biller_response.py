"""Add biller_response to Transaction · KPLC / utility-token relay.

When the user pays a utility paybill (KPLC prepaid 888880, DSTV,
Zuku, etc.), the biller SMS-sends the prepaid token to the M-Pesa
account that made the payment, which is Cpay's B2B sender, NOT the
user's phone. SasaPay's B2B result callback returns the biller's
response in `ResultDesc` / `ResultParameter` · we capture it here,
surface on the receipt + success screen, AND forward an SMS to the
user's phone so the payment delivers end-to-end.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0010_transaction_merchant_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="biller_response",
            field=models.TextField(
                blank=True,
                help_text="Biller's M-Pesa response (e.g. KPLC prepaid token).",
            ),
        ),
    ]
