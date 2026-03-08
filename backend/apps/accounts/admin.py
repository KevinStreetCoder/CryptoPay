from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import AuditLog, Device, KYCDocument, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("phone", "email", "kyc_tier", "kyc_status", "is_active", "is_suspended", "created_at")
    list_filter = ("kyc_tier", "kyc_status", "is_active", "is_suspended")
    search_fields = ("phone", "email")
    ordering = ("-created_at",)

    fieldsets = (
        (None, {"fields": ("phone", "email")}),
        ("KYC", {"fields": ("kyc_tier", "kyc_status")}),
        ("Status", {"fields": ("is_active", "is_suspended", "is_staff", "is_superuser")}),
        ("Security", {"fields": ("pin_attempts", "pin_locked_until", "device_id")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("phone",)}),
    )


@admin.register(KYCDocument)
class KYCDocumentAdmin(admin.ModelAdmin):
    list_display = ("user", "document_type", "status", "created_at")
    list_filter = ("document_type", "status")


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "user", "entity_type", "entity_id", "ip_address", "created_at")
    list_filter = ("action", "entity_type")
    search_fields = ("entity_id", "user__phone")
    readonly_fields = ("user", "action", "entity_type", "entity_id", "details", "ip_address", "user_agent", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ("user", "device_id", "device_name", "platform", "is_trusted", "last_seen", "created_at")
    list_filter = ("platform", "is_trusted")
    search_fields = ("user__phone", "device_id", "device_name")
    readonly_fields = ("id", "created_at", "last_seen")
