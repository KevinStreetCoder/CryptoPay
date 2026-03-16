from django.contrib import admin

from .models import ExchangeRate, RateAlert


@admin.register(ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    list_display = ("pair", "rate", "source", "created_at")
    list_filter = ("pair", "source")


@admin.register(RateAlert)
class RateAlertAdmin(admin.ModelAdmin):
    list_display = ("user", "currency", "target_rate", "direction", "is_active", "triggered_at", "created_at")
    list_filter = ("currency", "direction", "is_active")
    search_fields = ("user__phone", "currency")
    readonly_fields = ("id", "triggered_at", "created_at")
