from decimal import Decimal

from rest_framework import serializers

from apps.blockchain.models import BlockchainDeposit

from .models import CustodyTransfer, RebalanceOrder, Wallet


class WalletSerializer(serializers.ModelSerializer):
    available_balance = serializers.DecimalField(max_digits=28, decimal_places=8, read_only=True)

    class Meta:
        model = Wallet
        fields = (
            "id", "currency", "balance", "locked_balance",
            "available_balance", "deposit_address", "created_at",
        )
        read_only_fields = fields


class BlockchainDepositSerializer(serializers.ModelSerializer):
    class Meta:
        model = BlockchainDeposit
        fields = (
            "id", "chain", "tx_hash", "from_address", "to_address",
            "amount", "currency", "confirmations", "required_confirmations",
            "status", "credited_at", "block_number", "created_at",
        )
        read_only_fields = fields


class RebalanceOrderSerializer(serializers.ModelSerializer):
    slippage_kes = serializers.DecimalField(
        max_digits=28, decimal_places=2, read_only=True, allow_null=True,
    )
    age_minutes = serializers.FloatField(read_only=True)

    class Meta:
        model = RebalanceOrder
        fields = (
            "id", "trigger", "execution_mode", "status",
            "float_balance_at_trigger", "target_float_balance",
            "sell_currency", "sell_amount",
            "expected_kes_amount", "exchange_rate_at_quote",
            "actual_kes_received", "actual_exchange_rate",
            "exchange_fee_kes", "exchange_provider",
            "exchange_order_id", "exchange_reference",
            "admin_notes", "reason", "error_message", "retry_count",
            "slippage_kes", "age_minutes",
            "created_at", "submitted_at", "settled_at",
            "completed_at", "updated_at",
        )
        read_only_fields = fields


class TriggerRebalanceSerializer(serializers.Serializer):
    sell_currency = serializers.ChoiceField(
        choices=["USDT", "USDC", "BTC", "ETH", "SOL"],
        default="USDT",
    )
    reason = serializers.CharField(required=False, default="", allow_blank=True)
    force = serializers.BooleanField(default=False)


class ConfirmSettlementSerializer(serializers.Serializer):
    kes_received = serializers.DecimalField(
        max_digits=28, decimal_places=2,
        min_value=Decimal("1"),  # Must be positive (not zero)
        max_value=Decimal("10000000"),  # 10M KES upper bound sanity check
    )
    actual_rate = serializers.DecimalField(
        max_digits=18, decimal_places=8, required=False, allow_null=True,
    )
    fee_kes = serializers.DecimalField(
        max_digits=28, decimal_places=2, required=False, allow_null=True,
    )
    exchange_reference = serializers.CharField(required=False, default="", allow_blank=True)
    admin_notes = serializers.CharField(required=False, default="", allow_blank=True)


class FailOrderSerializer(serializers.Serializer):
    error_message = serializers.CharField(required=False, default="", allow_blank=True)
    admin_notes = serializers.CharField(required=False, default="", allow_blank=True)


class CancelOrderSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, default="Cancelled by admin", allow_blank=True)


class CustodyTransferSerializer(serializers.ModelSerializer):
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = CustodyTransfer
        fields = (
            "id", "from_tier", "to_tier", "currency", "amount",
            "status", "tx_hash", "from_address", "to_address",
            "gas_fee", "initiated_by", "reason", "error_message",
            "is_active",
            "created_at", "submitted_at", "confirmed_at",
            "completed_at", "updated_at",
        )
        read_only_fields = fields


class TriggerCustodyRebalanceSerializer(serializers.Serializer):
    currency = serializers.ChoiceField(
        choices=["USDT", "USDC", "BTC", "ETH", "SOL"],
        required=False,
        help_text="Rebalance a specific currency. Omit to rebalance all.",
    )
    force = serializers.BooleanField(
        default=False,
        help_text="Force rebalance even if thresholds are not breached.",
    )
