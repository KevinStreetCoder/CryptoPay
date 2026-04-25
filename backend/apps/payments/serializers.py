from rest_framework import serializers

from .banks import bank_slugs, get_bank
from .models import SavedPaybill, Transaction


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
    """Crypto → M-Pesa send payment request.

    `context` is an optional UX-only label. The send-money rail itself
    does not branch on it · Daraja's BusinessSendMoney command works
    identically for personal numbers and Pochi la Biashara recipients.
    When a Pochi-aware client passes `context=pochi`, the resulting
    Transaction is tagged so the user's history can render "Business"
    next to the recipient. See `docs/research/MPESA-RAILS.md`.
    """

    phone = serializers.CharField(max_length=15)
    amount_kes = serializers.DecimalField(max_digits=12, decimal_places=2)
    crypto_currency = serializers.CharField(max_length=10)
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)
    quote_id = serializers.CharField(max_length=64)
    context = serializers.ChoiceField(
        choices=[("personal", "Personal"), ("pochi", "Pochi la Biashara")],
        required=False,
        default="personal",
    )

    def validate_phone(self, value):
        return _normalize_phone(value)

    def validate_pin(self, value):
        return _validate_pin(value)


class SendToBankSerializer(serializers.Serializer):
    """Crypto → Kenyan bank account via the existing Pay Bill rail.

    Wraps `PayBillSerializer` with a bank picker · the user selects a
    bank slug from the curated registry, and we substitute the bank's
    paybill server-side. The customer's bank account number flows
    through as the Pay Bill `account` reference. No new Daraja API.
    """

    quote_id = serializers.CharField(max_length=64)
    bank_slug = serializers.ChoiceField(choices=[(s, s) for s in bank_slugs()])
    account_number = serializers.CharField(min_length=4, max_length=30)
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    idempotency_key = serializers.CharField(max_length=64)

    def validate_account_number(self, value):
        # Banks vary widely in account-number format · keep validation
        # loose for the v1 launch and tighten per-bank later if support
        # tickets show a typo pattern. We strip whitespace and refuse
        # anything with letters or symbols (the M-Pesa receiving system
        # rejects these anyway).
        cleaned = value.strip().replace(" ", "").replace("-", "")
        if not cleaned.isdigit():
            raise serializers.ValidationError(
                "Account number must be digits only."
            )
        return cleaned

    def validate_pin(self, value):
        return _validate_pin(value)

    def validate_bank_slug(self, value):
        # ChoiceField already restricts to known slugs but we double-
        # check in case the registry was reloaded between request and
        # validation (paranoid · cheap).
        if get_bank(value) is None:
            raise serializers.ValidationError("Unknown bank.")
        return value


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


class SwapSerializer(serializers.Serializer):
    """Crypto-to-crypto swap request."""

    from_currency = serializers.ChoiceField(choices=["USDT", "USDC", "BTC", "ETH", "SOL"])
    to_currency = serializers.ChoiceField(choices=["USDT", "USDC", "BTC", "ETH", "SOL"])
    amount = serializers.DecimalField(max_digits=28, decimal_places=8)
    pin = serializers.CharField(min_length=6, max_length=6, write_only=True)
    # B13: client-supplied idempotency key deduplicates double-tap retries
    # at the DB unique constraint. Optional on the wire for backwards
    # compatibility; if omitted, server generates a UUID4.
    idempotency_key = serializers.CharField(max_length=64, required=False, allow_blank=True)

    def validate_pin(self, value):
        return _validate_pin(value)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be positive.")
        return value

    def validate(self, data):
        if data["from_currency"] == data["to_currency"]:
            raise serializers.ValidationError({
                "to_currency": "Cannot swap to the same currency."
            })
        return data


class SavedPaybillSerializer(serializers.ModelSerializer):
    """Serializer for user-saved paybills."""

    class Meta:
        model = SavedPaybill
        fields = ("id", "paybill_number", "account_number", "label", "last_used_at", "created_at")
        read_only_fields = ("id", "last_used_at", "created_at")

    def validate_paybill_number(self, value):
        if not value.isdigit():
            raise serializers.ValidationError("Paybill number must contain only digits.")
        if len(value) < 4 or len(value) > 7:
            raise serializers.ValidationError("Paybill number must be 4-7 digits.")
        return value


class TransactionSerializer(serializers.ModelSerializer):
    destination_address = serializers.SerializerMethodField()
    mpesa_phone = serializers.SerializerMethodField()
    mpesa_receipt = serializers.SerializerMethodField()
    recipient_kind = serializers.SerializerMethodField()
    bank = serializers.SerializerMethodField()

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
            "recipient_kind", "bank",
            "created_at", "completed_at",
        )
        read_only_fields = fields

    def get_destination_address(self, obj):
        return obj.saga_data.get("destination_address", "") if obj.saga_data else ""

    def get_mpesa_phone(self, obj):
        """Mask phone number: +254701****23"""
        phone = obj.mpesa_phone
        if not phone or len(phone) < 6:
            return phone
        return phone[:6] + "****" + phone[-2:]

    def get_mpesa_receipt(self, obj):
        """Mask M-Pesa receipt: show only last 6 chars"""
        receipt = obj.mpesa_receipt
        if not receipt or len(receipt) < 6:
            return receipt
        return "****" + receipt[-6:]

    def get_recipient_kind(self, obj):
        """Surface the Pochi / business / bank label set in saga_data.

        Returns one of "pochi", "bank", "personal", or "" (no label).
        Mobile history uses this to render a small badge ("Business",
        "Bank") next to the recipient line.
        """
        if not obj.saga_data:
            return ""
        return obj.saga_data.get("recipient_kind", "")

    def get_bank(self, obj):
        """For Send-to-Bank transactions, surface the destination bank
        metadata so receipts can render a friendly name. Returns None
        when the transaction wasn't a bank send.
        """
        if not obj.saga_data:
            return None
        meta = obj.saga_data.get("bank")
        if not meta:
            return None
        # Defensive copy so we never leak future internal fields.
        return {
            "slug": meta.get("slug", ""),
            "name": meta.get("name", ""),
            "paybill": meta.get("paybill", ""),
        }
