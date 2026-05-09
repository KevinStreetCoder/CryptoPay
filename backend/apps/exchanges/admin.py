"""Read-only-ish admin for exchange links + withdrawals.

Operators can revoke a link (sets `revoked_at`) but cannot view any
secret. The PIIEncryptedField is decrypted on read but we never
expose it in the changelist or readonly_fields · admins look at
metadata only.
"""
from django.contrib import admin
from django.utils import timezone

from .models import ExchangeLink, ExchangeWithdrawal


@admin.register(ExchangeLink)
class ExchangeLinkAdmin(admin.ModelAdmin):
    list_display = (
        "user", "provider", "verified_at", "last_used_at",
        "is_active", "linked_from_ip",
    )
    list_filter = ("provider", "revoked_at")
    search_fields = ("user__phone", "user__email", "api_key")
    readonly_fields = (
        "id", "user", "provider", "scopes",
        "verified_at", "last_used_at", "revoked_at",
        "linked_from_ip", "linked_user_agent", "is_active",
        # The api_key is non-sensitive but read-only · operators
        # should never edit it via admin (forces a re-link instead).
        "api_key",
    )
    # SECURITY · we deliberately do NOT include refresh_token /
    # access_token / api_secret in any admin field. Even though
    # PIIEncryptedField decrypts on read, displaying it in the
    # admin would hand secrets to anyone with admin access. Use
    # the Django shell + an audit-logged management command if
    # ops needs to inspect a credential.
    fields = readonly_fields
    actions = ("revoke_links",)

    @admin.display(boolean=True, description="Active")
    def is_active(self, obj):
        return obj.revoked_at is None

    @admin.action(description="Revoke selected links (clears credentials)")
    def revoke_links(self, request, queryset):
        n = 0
        for link in queryset.filter(revoked_at__isnull=True):
            link.revoked_at = timezone.now()
            # Wipe credentials on revoke so a recovered DB dump
            # leaks nothing.
            link.refresh_token = ""
            link.access_token = ""
            link.api_secret = ""
            link.save(update_fields=[
                "revoked_at", "refresh_token", "access_token", "api_secret",
            ])
            n += 1
        self.message_user(request, f"Revoked {n} link(s).")


@admin.register(ExchangeWithdrawal)
class ExchangeWithdrawalAdmin(admin.ModelAdmin):
    list_display = (
        "user", "provider", "amount", "currency", "network",
        "status", "exchange_tx_id", "created_at",
    )
    list_filter = ("status", "currency", "network")
    search_fields = (
        "user__phone", "request_id", "exchange_tx_id", "on_chain_tx",
    )
    readonly_fields = (
        "id", "user", "link", "request_id", "currency", "network",
        "amount", "destination_address", "exchange_tx_id",
        "on_chain_tx", "status", "error_code", "error_message",
        "created_at", "completed_at",
    )
    fields = readonly_fields
    ordering = ("-created_at",)

    @admin.display(description="Provider")
    def provider(self, obj):
        return obj.link.provider
