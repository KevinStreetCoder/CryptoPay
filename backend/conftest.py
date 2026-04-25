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
    Using `setdefault` so a real env value (e.g. an integration runner
    with a different test seed) wins over our placeholder.
    """
    os.environ.setdefault("WALLET_MASTER_SEED", _TEST_WALLET_SEED_HEX)
    os.environ.setdefault("MPESA_CALLBACK_HMAC_KEY", _TEST_MPESA_HMAC_KEY)


# Run at import time · before pytest-django reads DJANGO_SETTINGS_MODULE.
_inject_test_env()


@pytest.fixture(autouse=True)
def enable_db_access_for_all_tests(db):
    pass
