from django.contrib import admin

from .models import MpesaCallback


@admin.register(MpesaCallback)
class MpesaCallbackAdmin(admin.ModelAdmin):
    list_display = ("merchant_request_id", "result_code", "result_desc", "mpesa_receipt", "amount", "created_at")
    list_filter = ("result_code",)
    search_fields = ("merchant_request_id", "checkout_request_id", "mpesa_receipt")
    readonly_fields = ("raw_payload",)
