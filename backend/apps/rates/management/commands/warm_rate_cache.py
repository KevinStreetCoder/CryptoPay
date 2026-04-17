"""
warm_rate_cache — populate Redis with crypto and forex rates at container boot.

Without this command, the first user request after a restart incurs a
~10 s synchronous fetch (CoinGecko batch + forex). After boot-time warming,
all subsequent requests hit Redis directly, and Celery Beat keeps the cache
fresh every 120 s thereafter.

Invocation:
  python manage.py warm_rate_cache                  # best-effort, exit 0 always
  python manage.py warm_rate_cache --strict         # exit 1 on provider failure

Designed to be run as part of the web container entrypoint so readiness
probes never see an empty cache. Safe to run multiple times (idempotent —
RateService.refresh_all_crypto_rates() uses a Redis debounce lock).
"""

from __future__ import annotations

import logging

from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Pre-populate Redis with crypto/USD + USD/KES rates so the first request is warm."

    def add_arguments(self, parser):  # noqa: D401
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit with code 1 if any provider fails. Default: always exit 0 (container boots anyway).",
        )

    def handle(self, *args, **options):
        strict = options.get("strict", False)
        failures: list[str] = []

        self.stdout.write("Warming crypto/USD rate cache...")
        try:
            # Lazy import so the command loads even if rates app has errors.
            from apps.rates.services import RateService

            # Clear the debounce lock in case a prior run set it — we want
            # this explicit warm to actually hit the provider once.
            from django.core.cache import cache

            cache.delete("rate:batch:lock")
            RateService.refresh_all_crypto_rates()
            # Verify at least one currency landed in cache.
            if not cache.get("rate:crypto:USDT:usd"):
                failures.append("crypto_batch_empty")
                self.stderr.write(self.style.WARNING("  ! crypto batch did not populate cache"))
            else:
                self.stdout.write(self.style.SUCCESS("  ✓ crypto/USD rates cached"))
        except Exception as e:  # noqa: BLE001
            failures.append(f"crypto:{e}")
            self.stderr.write(self.style.WARNING(f"  ! crypto fetch raised: {e}"))

        self.stdout.write("Warming USD/KES forex cache...")
        try:
            from apps.rates.services import RateService

            rate = RateService.get_usd_kes_rate()
            self.stdout.write(self.style.SUCCESS(f"  ✓ USD/KES = {rate}"))
        except Exception as e:  # noqa: BLE001
            failures.append(f"forex:{e}")
            self.stderr.write(self.style.WARNING(f"  ! forex fetch raised: {e}"))

        if failures:
            msg = f"warm_rate_cache finished with {len(failures)} failure(s): {failures}"
            if strict:
                self.stderr.write(self.style.ERROR(msg))
                # Non-zero exit for CI / orchestrator to act on.
                raise SystemExit(1)
            # Non-strict mode: report but let the container boot. The cache
            # will self-heal on the next Celery Beat tick.
            self.stderr.write(self.style.WARNING(msg))
            return

        self.stdout.write(self.style.SUCCESS("warm_rate_cache: all providers OK"))
