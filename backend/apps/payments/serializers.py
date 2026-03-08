from rest_framework import serializers

from .models import Transaction


class PayBillSerializer(serializers.Serializer):
    """Crypto → Paybill payment request."""

    quote_id = serializers.CharField(max_length=64)
    paybill = serializers.CharField(max_length=20)
    account = serializers.CharField(max_length=50)
    pin = serializers.CharField(max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)


class PayTillSerializer(serializers.Serializer):
    """Crypto → Till number payment request."""

    quote_id = serializers.CharField(max_length=64)
    till = serializers.CharField(max_length=20)
    pin = serializers.CharField(max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)


class SendMpesaSerializer(serializers.Serializer):
    """Crypto → M-Pesa send payment request."""

    phone = serializers.CharField(max_length=15)
    amount_kes = serializers.DecimalField(max_digits=12, decimal_places=2)
    crypto_currency = serializers.CharField(max_length=10)
    pin = serializers.CharField(max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)
    quote_id = serializers.CharField(max_length=64)


class BuyCryptoSerializer(serializers.Serializer):
    """M-Pesa STK Push → Buy crypto request."""

    phone = serializers.CharField(max_length=15)
    quote_id = serializers.CharField(max_length=64)
    pin = serializers.CharField(max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)

    def validate_phone(self, value):
        value = value.strip().replace(" ", "")
        if value.startswith("0"):
            value = "+254" + value[1:]
        elif value.startswith("254"):
            value = "+" + value
        elif not value.startswith("+"):
            value = "+254" + value
        return value


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = (
            "id", "type", "status",
            "source_currency", "source_amount",
            "dest_currency", "dest_amount",
            "exchange_rate", "fee_amount", "fee_currency",
            "mpesa_paybill", "mpesa_till", "mpesa_account",
            "mpesa_phone", "mpesa_receipt",
            "chain", "tx_hash", "confirmations",
            "created_at", "completed_at",
        )
        read_only_fields = fields
