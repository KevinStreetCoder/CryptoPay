from django.contrib import admin

from .models import BlockchainDeposit


@admin.register(BlockchainDeposit)
class BlockchainDepositAdmin(admin.ModelAdmin):
    list_display = ("chain", "currency", "amount", "status", "confirmations", "required_confirmations", "created_at")
    list_filter = ("chain", "currency", "status")
    search_fields = ("tx_hash", "to_address", "from_address")
