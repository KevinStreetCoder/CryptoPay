from django.contrib import admin

from .models import ExchangeRate


@admin.register(ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    list_display = ("pair", "rate", "source", "created_at")
    list_filter = ("pair", "source")
