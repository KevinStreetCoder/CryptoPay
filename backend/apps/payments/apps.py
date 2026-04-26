from django.apps import AppConfig


class PaymentsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.payments"

    def ready(self):
        # Wires the ReconciliationCase post_save / post_delete handlers
        # that maintain `Transaction.has_open_reconciliation` denormalised
        # flag. Imported lazily so test runners that override the app
        # registry don't double-register signals.
        from . import signals as _signals  # noqa: F401
