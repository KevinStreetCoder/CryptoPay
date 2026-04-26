import logging

from django.apps import AppConfig
from django.conf import settings


class BlockchainConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.blockchain"

    def ready(self):
        """Boot-time sanity checks.

        We loudly warn (once, on app load) when the BTC network configuration
        looks dangerous:

          - Production (DEBUG=False) running against testnet — almost
            certainly a forgotten env var and would mean every deposit
            address is a testnet address that won't receive real funds.
          - Mainnet BTC_NETWORK with BTC withdrawals enabled but no
            BlockCypher token — hard-caps us at 200 req/hour, painful
            under real load.

        These are warnings, not exits — we prefer the app boot and surface
        the misconfiguration in logs/Sentry over a crash-loop that hides
        every other startup error.
        """
        logger = logging.getLogger(__name__)

        btc_network = getattr(settings, "BTC_NETWORK", "test3")
        debug = getattr(settings, "DEBUG", False)
        withdrawals_enabled = getattr(settings, "BTC_WITHDRAWALS_ENABLED", False)
        blockcypher_token = getattr(settings, "BLOCKCYPHER_API_TOKEN", "")

        if btc_network != "main" and not debug:
            logger.error(
                "btc.config.testnet_in_production",
                extra={
                    "btc_network": btc_network,
                    "debug": debug,
                    "hint": "Set BTC_NETWORK=main in .env.production to use mainnet.",
                },
            )

        if btc_network == "main" and withdrawals_enabled and not blockcypher_token:
            logger.warning(
                "btc.config.no_blockcypher_token",
                extra={
                    "btc_network": btc_network,
                    "hint": "Set BLOCKCYPHER_API_TOKEN to raise from 200 to 2000 req/hour.",
                },
            )

        if withdrawals_enabled and btc_network != "main":
            logger.error(
                "btc.config.withdrawals_enabled_on_testnet",
                extra={
                    "btc_network": btc_network,
                    "hint": "BTC_WITHDRAWALS_ENABLED=True with testnet is almost certainly a misconfiguration.",
                },
            )

        # ── KMS boot-time health check ──────────────────────────────
        # When KMS_ENABLED=True, do a real encrypt-decrypt round trip
        # before the app starts serving traffic. Catches a class of
        # silent failures the env-checks in production.py can't:
        #
        #   - GOOGLE_APPLICATION_CREDENTIALS path resolves but the JSON
        #     is from a stale / different project
        #   - Service account exists but lacks
        #     `cloudkms.cryptoKeyEncrypterDecrypter` on this key
        #   - Container has the right env vars but the bind-mount of
        #     `/run/secrets/gcp-kms.json` failed silently
        #   - Our own envelope format regressed (rare, but a half-
        #     deployed migration could)
        #
        # In production (`REQUIRE_PROD_ENV_STRICT=True` or DEBUG=False),
        # a failure raises ImproperlyConfigured · gunicorn refuses to
        # come up · the deploy crashloops loud instead of silently
        # routing every encrypted blob through LocalKMSManager (which
        # derives keys from SECRET_KEY and defeats the whole KMS threat
        # model). Dev logs + skips so `runserver` works without creds.
        #
        # Skipped entirely under `pytest` (DJANGO_SETTINGS_MODULE points
        # at `config.settings.base` for tests, where KMS_ENABLED defaults
        # to False); the conftest fixture also forces deterministic
        # WALLET_MASTER_SEED so the smoke test isn't needed.
        kms_enabled = getattr(settings, "KMS_ENABLED", False)
        require_strict = bool(
            getattr(settings, "REQUIRE_PROD_ENV_STRICT", False) or not debug
        )
        skip_kms_check = bool(getattr(settings, "SKIP_KMS_HEALTH_CHECK", False))
        if kms_enabled and not skip_kms_check:
            try:
                from .kms import get_kms_manager
                manager = get_kms_manager()
                # CachedSeedManager wraps the underlying manager via
                # `self._kms` · unwrap to the real provider so the
                # smoke test hits live KMS rather than the cached
                # plaintext-seed blob in memory.
                inner = (
                    getattr(manager, "_kms", None)
                    or getattr(manager, "_inner", None)
                    or manager
                )
                health = inner.health_check()
                logger.info(
                    "kms.health_ok",
                    extra={
                        "provider": getattr(settings, "KMS_PROVIDER", "aws"),
                        "latency_ms": health.get("latency_ms"),
                        "key_resource": health.get("key_resource"),
                    },
                )
            except Exception as e:
                logger.error(
                    "kms.health_failed",
                    extra={
                        "provider": getattr(settings, "KMS_PROVIDER", "aws"),
                        "error_type": type(e).__name__,
                        "error": str(e),
                        "hint": (
                            "Run `python manage.py kms_health` for a verbose "
                            "dump. Common causes: wrong service account, "
                            "missing roles/cloudkms.cryptoKeyEncrypterDecrypter, "
                            "stale GOOGLE_APPLICATION_CREDENTIALS path."
                        ),
                    },
                )
                if require_strict:
                    from django.core.exceptions import ImproperlyConfigured
                    raise ImproperlyConfigured(
                        f"KMS health check failed at boot: {type(e).__name__}: {e}. "
                        "Refusing to start · the LocalKMSManager fallback would "
                        "decrypt every wallet blob with a SECRET_KEY-derived key, "
                        "which defeats the platform's key hierarchy. Fix the KMS "
                        "credentials or set KMS_ENABLED=False in dev."
                    ) from e
