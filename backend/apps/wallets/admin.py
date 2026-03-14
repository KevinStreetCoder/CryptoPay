from django.contrib import admin

from .models import CustodyTransfer, LedgerEntry, RebalanceOrder, SystemWallet, Wallet


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

    def has_delete_permission(self, request, obj=None):
        return False

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
    list_display = (
        "wallet_type", "tier", "currency", "chain", "balance",
        "is_active", "last_reconciled", "updated_at",
    )
    list_filter = ("wallet_type", "tier", "currency", "is_active")
    search_fields = ("address", "notes")
    readonly_fields = ("id", "balance", "created_at", "updated_at", "last_reconciled")

    def has_delete_permission(self, request, obj=None):
        return False

    fieldsets = (
        ("Identity", {
            "fields": ("id", "wallet_type", "tier", "currency", "chain"),
        }),
        ("Address & Balance", {
            "fields": ("address", "balance", "is_active"),
        }),
        ("Limits", {
            "fields": ("max_daily_withdrawal",),
        }),
        ("Reconciliation", {
            "fields": ("last_reconciled",),
        }),
        ("Notes", {
            "fields": ("notes",),
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at"),
        }),
    )


@admin.register(RebalanceOrder)
class RebalanceOrderAdmin(admin.ModelAdmin):
    list_display = (
        "short_id", "status", "trigger", "execution_mode",
        "sell_amount_display", "expected_kes_display",
        "actual_kes_display", "slippage_display", "created_at",
    )
    list_filter = ("status", "trigger", "execution_mode", "sell_currency")
    search_fields = ("id", "exchange_order_id", "exchange_reference")
    readonly_fields = (
        "id", "trigger", "float_balance_at_trigger", "target_float_balance",
        "sell_currency", "sell_amount", "expected_kes_amount",
        "exchange_rate_at_quote", "actual_kes_received", "actual_exchange_rate",
        "exchange_fee_kes", "exchange_provider", "exchange_order_id",
        "exchange_reference", "reason", "error_message",
        "created_at", "submitted_at", "settled_at", "completed_at", "updated_at",
    )
    date_hierarchy = "created_at"
    list_per_page = 25
    ordering = ["-created_at"]

    fieldsets = (
        ("Order Info", {
            "fields": (
                "id", "status", "trigger", "execution_mode", "reason",
            ),
        }),
        ("Float State", {
            "fields": (
                "float_balance_at_trigger", "target_float_balance",
            ),
        }),
        ("Sell Details", {
            "fields": (
                "sell_currency", "sell_amount", "expected_kes_amount",
                "exchange_rate_at_quote",
            ),
        }),
        ("Settlement", {
            "fields": (
                "actual_kes_received", "actual_exchange_rate",
                "exchange_fee_kes", "exchange_reference",
            ),
        }),
        ("Exchange", {
            "fields": (
                "exchange_provider", "exchange_order_id",
            ),
        }),
        ("Admin", {
            "fields": (
                "admin_notes", "error_message", "retry_count",
            ),
        }),
        ("Timestamps", {
            "fields": (
                "created_at", "submitted_at", "settled_at",
                "completed_at", "updated_at",
            ),
        }),
    )

    def short_id(self, obj):
        return str(obj.id)[:8]
    short_id.short_description = "ID"

    def sell_amount_display(self, obj):
        return f"{obj.sell_amount} {obj.sell_currency}"
    sell_amount_display.short_description = "Sell"

    def expected_kes_display(self, obj):
        return f"KES {obj.expected_kes_amount:,.0f}"
    expected_kes_display.short_description = "Expected KES"

    def actual_kes_display(self, obj):
        if obj.actual_kes_received:
            return f"KES {obj.actual_kes_received:,.0f}"
        return "—"
    actual_kes_display.short_description = "Actual KES"

    def slippage_display(self, obj):
        s = obj.slippage_kes
        if s is not None:
            prefix = "+" if s >= 0 else ""
            return f"{prefix}KES {s:,.0f}"
        return "—"
    slippage_display.short_description = "Slippage"


@admin.register(CustodyTransfer)
class CustodyTransferAdmin(admin.ModelAdmin):
    list_display = (
        "short_id", "status", "direction_display", "currency",
        "amount", "initiated_by", "created_at",
    )
    list_filter = ("status", "from_tier", "to_tier", "currency")
    search_fields = ("id", "tx_hash", "initiated_by", "from_address", "to_address")
    readonly_fields = (
        "id", "from_tier", "to_tier", "currency", "amount",
        "from_address", "to_address", "gas_fee", "initiated_by",
        "created_at", "submitted_at", "confirmed_at", "completed_at", "updated_at",
    )
    date_hierarchy = "created_at"
    list_per_page = 25
    ordering = ["-created_at"]

    fieldsets = (
        ("Transfer Info", {
            "fields": (
                "id", "status", "from_tier", "to_tier",
                "currency", "amount",
            ),
        }),
        ("On-chain Details", {
            "fields": (
                "from_address", "to_address", "tx_hash", "gas_fee",
            ),
        }),
        ("Metadata", {
            "fields": (
                "initiated_by", "reason", "error_message",
            ),
        }),
        ("Timestamps", {
            "fields": (
                "created_at", "submitted_at", "confirmed_at",
                "completed_at", "updated_at",
            ),
        }),
    )

    def short_id(self, obj):
        return str(obj.id)[:8]
    short_id.short_description = "ID"

    def direction_display(self, obj):
        return f"{obj.from_tier} → {obj.to_tier}"
    direction_display.short_description = "Direction"
