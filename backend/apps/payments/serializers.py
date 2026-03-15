from rest_framework import serializers

from .models import Transaction


def _normalize_phone(value):
    """Normalize Kenyan phone numbers to +254 format."""
    value = value.strip().replace(" ", "")
    if value.startswith("0"):
        value = "+254" + value[1:]
    elif value.startswith("254"):
        value = "+" + value
    elif not value.startswith("+"):
        value = "+254" + value
    return value


def _validate_pin(value):
    """Validate PIN is exactly 6 digits."""
    if not value.isdigit():
        raise serializers.ValidationError("PIN must contain only digits.")
    if len(value) != 6:
        raise serializers.ValidationError("PIN must be exactly 6 digits.")
    return value


class PayBillSerializer(serializers.Serializer):
    """Crypto → Paybill payment request."""

    quote_id = serializers.CharField(max_length=64)
    paybill = serializers.CharField(min_length=5, max_length=20)
    account = serializers.CharField(max_length=50)
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)

    def validate_paybill(self, value):
        if not value.isdigit():
            raise serializers.ValidationError("Paybill number must contain only digits.")
        return value

    def validate_pin(self, value):
        return _validate_pin(value)


class PayTillSerializer(serializers.Serializer):
    """Crypto → Till number payment request."""

    quote_id = serializers.CharField(max_length=64)
    till = serializers.CharField(min_length=5, max_length=20)
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)

    def validate_till(self, value):
        if not value.isdigit():
            raise serializers.ValidationError("Till number must contain only digits.")
        return value

    def validate_pin(self, value):
        return _validate_pin(value)


class SendMpesaSerializer(serializers.Serializer):
    """Crypto → M-Pesa send payment request."""

    phone = serializers.CharField(max_length=15)
    amount_kes = serializers.DecimalField(max_digits=12, decimal_places=2)
    crypto_currency = serializers.CharField(max_length=10)
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)
    quote_id = serializers.CharField(max_length=64)

    def validate_phone(self, value):
        return _normalize_phone(value)

    def validate_pin(self, value):
        return _validate_pin(value)


class BuyCryptoSerializer(serializers.Serializer):
    """M-Pesa STK Push → Buy crypto request."""

    phone = serializers.CharField(max_length=15)
    quote_id = serializers.CharField(max_length=64)
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)

    def validate_phone(self, value):
        return _normalize_phone(value)

    def validate_pin(self, value):
        return _validate_pin(value)


class DepositQuoteSerializer(serializers.Serializer):
    """Request a KES → crypto deposit quote."""

    kes_amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    dest_currency = serializers.ChoiceField(choices=["USDT", "USDC", "BTC", "ETH", "SOL"])

    def validate_kes_amount(self, value):
        from django.conf import settings as app_settings

        if value < app_settings.DEPOSIT_MIN_KES:
            raise serializers.ValidationError(f"Minimum deposit is KES {app_settings.DEPOSIT_MIN_KES}")
        if value > app_settings.DEPOSIT_MAX_KES:
            raise serializers.ValidationError(f"Maximum deposit is KES {app_settings.DEPOSIT_MAX_KES:,}")
        return value


class WithdrawSerializer(serializers.Serializer):
    """Crypto withdrawal to external blockchain address."""

    currency = serializers.ChoiceField(choices=["USDT", "USDC", "BTC", "ETH", "SOL"])
    amount = serializers.DecimalField(max_digits=28, decimal_places=8)
    destination_address = serializers.CharField(max_length=255)
    network = serializers.ChoiceField(choices=["tron", "ethereum", "polygon", "bitcoin", "solana"])
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)

    def validate_pin(self, value):
        return _validate_pin(value)

    def validate_amount(self, value):
        from django.conf import settings as app_settings

        if value <= 0:
            raise serializers.ValidationError("Amount must be positive.")
        # Minimum withdrawal amounts
        min_amounts = getattr(app_settings, "MINIMUM_WITHDRAWAL_AMOUNTS", {
            "USDT": "2.00",
            "USDC": "2.00",
            "BTC": "0.0001",
            "ETH": "0.005",
            "SOL": "0.1",
        })
        return value

    def validate_destination_address(self, value):
        return value.strip()

    def validate(self, data):
        from apps.blockchain.security import validate_address

        from django.conf import settings as app_settings

        # Validate address format for the selected network
        if not validate_address(data["network"], data["destination_address"]):
            raise serializers.ValidationError({
                "destination_address": f"Invalid {data['network']} address format."
            })

        # Check minimum withdrawal amount
        min_amounts = getattr(app_settings, "MINIMUM_WITHDRAWAL_AMOUNTS", {
            "USDT": "2.00",
            "USDC": "2.00",
            "BTC": "0.0001",
            "ETH": "0.005",
            "SOL": "0.1",
        })
        from decimal import Decimal
        min_amount = Decimal(min_amounts.get(data["currency"], "0"))
        if data["amount"] < min_amount:
            raise serializers.ValidationError({
                "amount": f"Minimum withdrawal for {data['currency']} is {min_amount}."
            })

        # Validate currency-network compatibility
        currency_network_map = {
            "USDT": ["tron", "ethereum", "polygon"],
            "USDC": ["ethereum", "polygon"],
            "BTC": ["bitcoin"],
            "ETH": ["ethereum"],
            "SOL": ["solana"],
        }
        allowed_networks = currency_network_map.get(data["currency"], [])
        if data["network"] not in allowed_networks:
            raise serializers.ValidationError({
                "network": f"{data['currency']} is not supported on {data['network']}. "
                           f"Allowed: {', '.join(allowed_networks)}."
            })

        return data


class TransactionSerializer(serializers.ModelSerializer):
    destination_address = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = (
            "id", "type", "status",
            "source_currency", "source_amount",
            "dest_currency", "dest_amount",
            "exchange_rate", "fee_amount", "fee_currency", "excise_duty_amount",
            "mpesa_paybill", "mpesa_till", "mpesa_account",
            "mpesa_phone", "mpesa_receipt",
            "chain", "tx_hash", "confirmations",
            "destination_address", "failure_reason",
            "created_at", "completed_at",
        )
        read_only_fields = fields

    def get_destination_address(self, obj):
        return obj.saga_data.get("destination_address", "") if obj.saga_data else ""
