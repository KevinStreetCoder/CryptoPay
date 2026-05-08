"""Project-wide pytest fixtures.

Two pieces of always-on behaviour:

  1. Database access · we hand every test a live test DB (the @pytest.mark.django_db
     equivalent) without each test having to declare the marker.

  2. Deterministic crypto inputs · CI runs without the production env file,
     so settings that gate wallet derivation (`WALLET_MASTER_SEED`) and
     callback HMAC token minting (`MPESA_CALLBACK_HMAC_KEY`) are blank by
     default and would crash any test that hits the related code path.
     We inject test-only deterministic values at session start so:
       - Wallet derivation is reproducible (every test gets the same
         BIP-32 child keys for a given user_id + index).
       - HMAC token URLs in the M-Pesa client get minted instead of
         raising the production hard-fail guard.
     Both keys are public and clearly test-only · they MUST never
     appear in real env files (the prefix and shape make them obvious).
"""
import os

import pytest


# Test-only deterministic values. The production validators (key length,
# format, etc.) are still enforced; these literals are just stable
# inputs so the suite reproduces every run regardless of host env.
_TEST_WALLET_SEED_HEX = "0" * 64  # 32 bytes of zero · stable, obviously fake
_TEST_MPESA_HMAC_KEY = "0" * 64   # 32 bytes of zero · same convention


def _inject_test_env() -> None:
    """Set os.environ values BEFORE Django settings module loads.

    `django-environ` reads `os.environ` at module import time, so we
    need these set before pytest-django imports `config.settings.*`.

    `setdefault` for the deterministic test seed + HMAC key (so a real
    env value e.g. on an integration runner can override). HARD
    overrides for the KMS knobs because tests must NEVER reach a real
    cloud KMS · a contractor's GCP billing flap (or our own flat-rate
    retirement) must not break CI. The unit-test boundary is the
    LocalKMSManager (Fernet-from-SECRET_KEY · safe for tests, refused
    in production by the `_assert_production_env` guard).
    """
    # Use force-assignment (`=`) not `setdefault` so a stale empty
    # value from .env.production (e.g. `WALLET_MASTER_SEED=`) doesn't
    # silently shadow our deterministic test value · `setdefault` would
    # leave the empty string in place because the key already exists.
    if not os.environ.get("WALLET_MASTER_SEED"):
        os.environ["WALLET_MASTER_SEED"] = _TEST_WALLET_SEED_HEX
    if not os.environ.get("MPESA_CALLBACK_HMAC_KEY"):
        os.environ["MPESA_CALLBACK_HMAC_KEY"] = _TEST_MPESA_HMAC_KEY

    # Force KMS off in tests · 2026-04-25 + 2026-05-08 we've been bitten
    # twice when GCP KMS billing flapped and turned the suite red. Unit
    # tests must be self-contained · LocalKMSManager (Fernet) is the
    # right test boundary, not a live cloud round-trip.
    #
    # IMPORTANT · we use explicit assignment (`=`) rather than `pop()`
    # because `config/settings/base.py:11` calls
    # `env.read_env('<BASE_DIR>/.env')` which uses setdefault to
    # re-populate os.environ from a `.env` file. Popping keys lets
    # read_env restore the prod values; setting them explicitly to
    # the test-safe values blocks the restore.
    os.environ["KMS_ENABLED"] = "False"
    os.environ["KMS_PROVIDER"] = "aws"  # tests that opt into KMS=True
                                         # use AWS by default · matches
                                         # what each override_settings
                                         # block in test_kms.py expects
    os.environ["KMS_KEY_RESOURCE"] = ""  # block GCP path entirely
    os.environ["KMS_KEY_ID"] = ""        # AWS tests set their own via
                                         # override_settings; stay empty
                                         # at import time so the factory's
                                         # "missing key id" branch fires
                                         # cleanly when tested
    os.environ["WALLET_ENCRYPTED_SEED"] = ""  # forces services.py to
                                              # fall through to the
                                              # deterministic WALLET_
                                              # MASTER_SEED above
    # Skip the Apps.ready() boot health check too · redundant with
    # KMS_ENABLED=False but explicit is better.
    os.environ["SKIP_KMS_HEALTH_CHECK"] = "True"


# Run at import time · before pytest-django reads DJANGO_SETTINGS_MODULE.
_inject_test_env()


def _force_test_kms_settings() -> None:
    """Belt-and-braces · override Django settings DIRECTLY when they
    were loaded before our conftest got a chance.

    pytest-django's `pytest_load_initial_conftests` hook scans for
    manage.py and imports settings AS PART of that scan · which means
    by the time our `_inject_test_env()` runs above, `settings.KMS_*`
    have already been frozen with whatever os.environ had at scan
    time. Mutating os.environ afterwards is a no-op for those values.

    So we also patch the settings object directly if it's loaded.
    Safe because:
      - We only flip safety knobs (KMS_ENABLED → False, WALLET_
        ENCRYPTED_SEED → "") to the test-safe values.
      - Tests that need a real cloud-KMS shape use override_settings
        within the test, which composes correctly on top.
    """
    try:
        from django.conf import settings as dj_settings
        # Touching `settings.<attr>` triggers lazy load, but if already
        # loaded this just rebinds to a known-test-safe value.
        dj_settings.KMS_ENABLED = False
        dj_settings.WALLET_ENCRYPTED_SEED = ""
        dj_settings.KMS_PROVIDER = "aws"
        dj_settings.KMS_KEY_ID = ""
        dj_settings.KMS_KEY_RESOURCE = ""
        dj_settings.SKIP_KMS_HEALTH_CHECK = True
        # Wallet seed · pin the deterministic test value if prod env
        # left it blank (which it does · prod uses WALLET_ENCRYPTED_SEED
        # only).
        if not getattr(dj_settings, "WALLET_MASTER_SEED", ""):
            dj_settings.WALLET_MASTER_SEED = _TEST_WALLET_SEED_HEX
        if not getattr(dj_settings, "MPESA_CALLBACK_HMAC_KEY", ""):
            dj_settings.MPESA_CALLBACK_HMAC_KEY = _TEST_MPESA_HMAC_KEY
        # Reset the KMS singleton so a previously cached GCP manager
        # doesn't survive across tests · the factory rebuilds with
        # the now-safe settings on the next get_kms_manager() call.
        try:
            from apps.blockchain.kms import reset_kms_manager
            reset_kms_manager()
        except Exception:
            # If the import fails (e.g. apps not yet ready) it's fine ·
            # this is best-effort cleanup.
            pass
    except Exception:
        # Settings not yet configured · the os.environ overrides above
        # will catch it on first load. Don't crash the conftest.
        pass


_force_test_kms_settings()


@pytest.fixture(autouse=True)
def enable_db_access_for_all_tests(db):
    pass


@pytest.fixture(autouse=True)
def _kms_test_safe_settings(settings):
    """Per-test · re-pin the KMS-safe overrides on the live `settings`
    proxy. Some tests use `override_settings(KMS_ENABLED=True, ...)` to
    exercise the real-cloud path with mocks; this fixture ensures the
    DEFAULT for tests that don't override is the safe LocalKMSManager.
    """
    settings.KMS_ENABLED = False
    settings.WALLET_ENCRYPTED_SEED = ""
    settings.KMS_PROVIDER = "aws"
    settings.KMS_KEY_ID = ""
    settings.KMS_KEY_RESOURCE = ""
    settings.SKIP_KMS_HEALTH_CHECK = True
    # Pin the deterministic wallet seed too · tests that run before
    # this fixture fires (or under override_settings) may still see
    # an empty WALLET_MASTER_SEED from the prod env shape.
    if not getattr(settings, "WALLET_MASTER_SEED", "") or settings.WALLET_MASTER_SEED == "":
        settings.WALLET_MASTER_SEED = _TEST_WALLET_SEED_HEX
    if not getattr(settings, "MPESA_CALLBACK_HMAC_KEY", "") or settings.MPESA_CALLBACK_HMAC_KEY == "":
        settings.MPESA_CALLBACK_HMAC_KEY = _TEST_MPESA_HMAC_KEY
    yield
