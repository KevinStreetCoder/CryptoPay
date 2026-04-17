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
