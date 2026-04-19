from django.contrib import admin
from django.utils.html import format_html

from .models import Referral, ReferralCode, ReferralEvent, RewardLedger


@admin.register(ReferralCode)
class ReferralCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "user", "is_active", "total_invites_sent", "created_at")
    search_fields = ("code", "user__phone", "user__email")
    list_filter = ("is_active",)
    readonly_fields = ("created_at",)


class ReferralEventInline(admin.TabularInline):
    model = ReferralEvent
    extra = 0
    readonly_fields = ("event_type", "user", "payload", "created_at")
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Referral)
class ReferralAdmin(admin.ModelAdmin):
    list_display = (
        "id_short",
        "referrer",
        "referee",
        "code_used",
        "status",
        "attributed_at",
        "qualified_at",
        "rewarded_at",
    )
    list_filter = ("status", "signup_country")
    search_fields = (
        "code_used",
        "referrer__phone",
        "referee__phone",
        "signup_device_id",
    )
    readonly_fields = (
        "id",
        "attributed_at",
        "qualified_at",
        "rewarded_at",
        "attribution_window_ends_at",
        "signup_ip",
        "signup_device_id",
        "signup_country",
        "signup_user_agent",
    )
    inlines = [ReferralEventInline]
    actions = ["clawback_selected"]

    def id_short(self, obj) -> str:
        return str(obj.id)[:8]

    id_short.short_description = "ID"

    def clawback_selected(self, request, queryset):
        from . import tasks
        count = 0
        for referral in queryset:
            tasks.claw_back_reward.delay(str(referral.id), reason="admin_bulk_clawback")
            count += 1
        self.message_user(request, f"Queued {count} clawbacks.")

    clawback_selected.short_description = "Clawback selected referrals"


@admin.register(RewardLedger)
class RewardLedgerAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "amount_kes",
        "kind",
        "status",
        "held_until",
        "expires_at",
        "created_at",
    )
    list_filter = ("kind", "status")
    search_fields = ("user__phone", "idempotency_key")
    readonly_fields = (
        "idempotency_key",
        "created_at",
    )


@admin.register(ReferralEvent)
class ReferralEventAdmin(admin.ModelAdmin):
    list_display = ("event_type", "user", "referral", "created_at")
    list_filter = ("event_type",)
    search_fields = ("user__phone",)
    readonly_fields = ("event_type", "user", "referral", "payload", "ip_address", "device_id", "user_agent", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
