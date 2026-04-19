from django.apps import AppConfig


class ReferralsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.referrals"
    verbose_name = "Referrals"

    def ready(self):
        # Wire the completion-hook signal that fires
        # check_qualification on every Transaction whose status flips
        # to completed. Safe to import here — Django guarantees apps
        # are loaded before ready() runs.
        from . import signals  # noqa: F401
