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


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = (
            "id", "type", "status",
            "source_currency", "source_amount",
            "dest_currency", "dest_amount",
            "exchange_rate", "fee_amount", "fee_currency",
            "mpesa_paybill", "mpesa_till", "mpesa_account",
            "mpesa_receipt",
            "chain", "tx_hash", "confirmations",
            "created_at", "completed_at",
        )
        read_only_fields = fields
