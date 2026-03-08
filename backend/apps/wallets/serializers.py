from rest_framework import serializers

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
