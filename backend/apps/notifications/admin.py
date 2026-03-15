from django.contrib import admin

from .models import AdminNotification, UserNotification


@admin.register(AdminNotification)
class AdminNotificationAdmin(admin.ModelAdmin):
    list_display = ["title", "category", "priority", "recipient_count", "created_by", "created_at"]
    list_filter = ["category", "priority", "created_at"]
    search_fields = ["title", "body"]
    readonly_fields = ["id", "created_at", "recipient_count"]
    ordering = ["-created_at"]


@admin.register(UserNotification)
class UserNotificationAdmin(admin.ModelAdmin):
    list_display = ["user", "get_title", "delivered_via", "read", "created_at"]
    list_filter = ["delivered_via", "read", "created_at"]
    search_fields = ["user__phone", "user__full_name", "notification__title"]
    readonly_fields = ["id", "created_at"]
    raw_id_fields = ["user", "notification"]
    ordering = ["-created_at"]

    def get_title(self, obj):
        return obj.notification.title
    get_title.short_description = "Notification"
