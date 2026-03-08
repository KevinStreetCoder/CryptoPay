import csv

from django.contrib import admin
from django.http import HttpResponse
from django.utils import timezone

from .models import Transaction


def mark_as_reviewed(modeladmin, request, queryset):
    """Admin action: mark selected transactions as reviewed (adds to saga_data)."""
    for tx in queryset:
        tx.saga_data["reviewed_by"] = request.user.get_username()
        tx.saga_data["reviewed_at"] = timezone.now().isoformat()
    Transaction.objects.bulk_update(queryset, ["saga_data"])
    modeladmin.message_user(request, f"{queryset.count()} transaction(s) marked as reviewed.")


mark_as_reviewed.short_description = "Mark selected as reviewed"


def export_csv(modeladmin, request, queryset):
    """Admin action: export selected transactions to CSV."""
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="transactions_{timezone.now():%Y%m%d_%H%M%S}.csv"'

    writer = csv.writer(response)
    writer.writerow([
        "ID", "User", "Type", "Status",
        "Source Amount", "Source Currency",
        "Dest Amount", "Dest Currency",
        "Exchange Rate", "Fee Amount", "Fee Currency",
        "M-Pesa Paybill", "M-Pesa Till", "M-Pesa Account", "M-Pesa Receipt",
        "Chain", "TX Hash",
        "Created At", "Completed At",
    ])

    for tx in queryset.select_related("user"):
        writer.writerow([
            str(tx.id),
            tx.user.phone,
            tx.type,
            tx.status,
            tx.source_amount,
            tx.source_currency,
            tx.dest_amount,
            tx.dest_currency,
            tx.exchange_rate,
            tx.fee_amount,
            tx.fee_currency,
            tx.mpesa_paybill,
            tx.mpesa_till,
            tx.mpesa_account,
            tx.mpesa_receipt,
            tx.chain,
            tx.tx_hash,
            tx.created_at,
            tx.completed_at,
        ])

    return response


export_csv.short_description = "Export selected to CSV"


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = (
        "short_id", "user_phone", "type", "status",
        "source_amount", "source_currency",
        "dest_amount", "dest_currency",
        "fee_amount", "mpesa_receipt", "created_at",
    )
    list_filter = ("type", "status", "source_currency", "dest_currency", "chain")
    search_fields = ("idempotency_key", "user__phone", "mpesa_receipt", "tx_hash", "mpesa_paybill", "mpesa_till")
    readonly_fields = (
        "id", "idempotency_key", "saga_data", "saga_step",
        "ip_address", "device_id", "risk_score",
        "created_at", "updated_at", "completed_at",
    )
    date_hierarchy = "created_at"
    list_per_page = 50
    actions = [mark_as_reviewed, export_csv]

    fieldsets = (
        ("Transaction", {
            "fields": ("id", "idempotency_key", "user", "type", "status"),
        }),
        ("Amounts", {
            "fields": (
                "source_currency", "source_amount",
                "dest_currency", "dest_amount",
                "exchange_rate", "fee_amount", "fee_currency",
            ),
        }),
        ("M-Pesa", {
            "fields": ("mpesa_paybill", "mpesa_till", "mpesa_account", "mpesa_phone", "mpesa_receipt"),
        }),
        ("Blockchain", {
            "fields": ("chain", "tx_hash", "confirmations"),
        }),
        ("Metadata", {
            "fields": ("ip_address", "device_id", "risk_score", "failure_reason"),
            "classes": ("collapse",),
        }),
        ("Saga", {
            "fields": ("saga_step", "saga_data"),
            "classes": ("collapse",),
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at", "completed_at"),
        }),
    )

    def short_id(self, obj):
        return str(obj.id)[:8]
    short_id.short_description = "ID"

    def user_phone(self, obj):
        return obj.user.phone
    user_phone.short_description = "User"
    user_phone.admin_order_field = "user__phone"
