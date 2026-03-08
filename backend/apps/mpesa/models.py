from django.db import models

from apps.payments.models import Transaction


class MpesaCallback(models.Model):
    """Records M-Pesa Daraja callback payloads for audit and reconciliation."""

    id = models.BigAutoField(primary_key=True)
    transaction = models.ForeignKey(
        Transaction, on_delete=models.CASCADE, related_name="mpesa_callbacks",
        null=True, blank=True,
    )
    merchant_request_id = models.CharField(max_length=50, blank=True, db_index=True)
    checkout_request_id = models.CharField(max_length=50, blank=True, db_index=True)
    result_code = models.IntegerField(null=True)
    result_desc = models.TextField(blank=True)
    mpesa_receipt = models.CharField(max_length=30, blank=True)
    phone = models.CharField(max_length=15, blank=True)
    amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    raw_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "mpesa_callbacks"

    def __str__(self):
        return f"Callback {self.merchant_request_id} - {self.result_code}"
