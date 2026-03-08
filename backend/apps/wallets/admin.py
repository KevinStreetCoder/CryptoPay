from django.contrib import admin

from .models import LedgerEntry, SystemWallet, Wallet


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = (
        "user_phone", "currency", "balance", "locked_balance",
        "available", "deposit_address", "created_at",
    )
    list_filter = ("currency",)
    search_fields = ("user__phone", "deposit_address")
    readonly_fields = ("id", "balance", "locked_balance", "created_at")
    list_per_page = 50

    def user_phone(self, obj):
        return obj.user.phone
    user_phone.short_description = "User"
    user_phone.admin_order_field = "user__phone"

    def available(self, obj):
        return obj.available_balance
    available.short_description = "Available"


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = (
        "short_tx_id", "wallet_info", "entry_type",
        "amount", "balance_after", "created_at",
    )
    list_filter = ("entry_type", "wallet__currency")
    search_fields = ("transaction_id", "wallet__user__phone")
    readonly_fields = (
        "transaction_id", "wallet", "entry_type",
        "amount", "balance_after", "description", "created_at",
    )
    date_hierarchy = "created_at"
    list_per_page = 50

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def short_tx_id(self, obj):
        return str(obj.transaction_id)[:8]
    short_tx_id.short_description = "TX ID"

    def wallet_info(self, obj):
        return f"{obj.wallet.user.phone} ({obj.wallet.currency})"
    wallet_info.short_description = "Wallet"


@admin.register(SystemWallet)
class SystemWalletAdmin(admin.ModelAdmin):
    list_display = ("wallet_type", "currency", "balance", "updated_at")
    list_filter = ("wallet_type", "currency")
    readonly_fields = ("id", "created_at", "updated_at")
