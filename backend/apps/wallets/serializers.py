from rest_framework import serializers

from apps.blockchain.models import BlockchainDeposit

from .models import Wallet


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
