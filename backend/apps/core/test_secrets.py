"""Tests for apps/core/secrets.py · Phase-1 Secret Manager helper.

Strategy · we DON'T mock-out the helper to make it pass artificially.
Instead we exercise the real code paths:

  1. With Secret Manager DISABLED (no GOOGLE_CLOUD_PROJECT) · verify
     we fall through to env, then default, in that order.
  2. With Secret Manager logically ENABLED but the import shimmed
     to control the response · verify SM hit takes priority and
     env is the fallback when SM raises.
  3. The status helper · returns the correct source label for each
     of {env, secret_manager, missing}.
  4. The cache · second call doesn't hit SM again.
"""
from __future__ import annotations

import os
from unittest import mock

from django.test import TestCase, override_settings


class SecretsHelperTests(TestCase):
    def setUp(self):
        # Each test starts with a clean cache · the lru_cache is
        # per-process so we explicitly clear between tests.
        from apps.core.secrets import clear_secret_cache
        clear_secret_cache()

    # ── Tier 3 · default fallthrough ────────────────────────────────

    def test_returns_default_when_all_paths_miss(self):
        from apps.core.secrets import get_secret
        with mock.patch.dict(os.environ, {"GOOGLE_CLOUD_PROJECT": ""}, clear=False):
            with mock.patch.dict(os.environ, {}, clear=False):
                # Make sure the test secret name isn't in env at all
                if "TEST_NEVER_SET_KEY" in os.environ:
                    del os.environ["TEST_NEVER_SET_KEY"]
                self.assertEqual(
                    get_secret("TEST_NEVER_SET_KEY", default="fallback"),
                    "fallback",
                )

    def test_returns_empty_string_when_no_default_and_all_paths_miss(self):
        from apps.core.secrets import get_secret
        with mock.patch.dict(os.environ, {"GOOGLE_CLOUD_PROJECT": ""}, clear=False):
            if "TEST_NEVER_SET_KEY_2" in os.environ:
                del os.environ["TEST_NEVER_SET_KEY_2"]
            self.assertEqual(get_secret("TEST_NEVER_SET_KEY_2"), "")

    # ── Tier 2 · env fallback ───────────────────────────────────────

    def test_env_value_used_when_sm_disabled(self):
        from apps.core.secrets import get_secret
        with mock.patch.dict(os.environ, {
            "GOOGLE_CLOUD_PROJECT": "",
            "TEST_KEY_FROM_ENV": "env-value-here",
        }):
            self.assertEqual(get_secret("TEST_KEY_FROM_ENV"), "env-value-here")

    def test_env_value_used_when_sm_explicitly_disabled(self):
        from apps.core.secrets import get_secret
        with mock.patch.dict(os.environ, {
            "GOOGLE_CLOUD_PROJECT": "cpay-490223",
            "DISABLE_SECRET_MANAGER": "true",
            "TEST_KEY_X": "env-via-disable-flag",
        }):
            # Reload module so _disabled() re-reads env vars
            import importlib
            import apps.core.secrets as secrets_mod
            importlib.reload(secrets_mod)
            self.assertEqual(secrets_mod.get_secret("TEST_KEY_X"), "env-via-disable-flag")
            # Restore default state
            os.environ["DISABLE_SECRET_MANAGER"] = ""
            importlib.reload(secrets_mod)

    # ── Tier 1 · Secret Manager hit (mocked at the import boundary) ──

    def test_secret_manager_value_takes_priority_over_env(self):
        """When SM is enabled AND returns a value, it's used even if
        env has a different value · SM is the source of truth."""
        from apps.core import secrets as secrets_mod

        secrets_mod._fetch_from_gcp.cache_clear()
        with mock.patch.object(secrets_mod, "_PROJECT_ID", "cpay-490223"), \
             mock.patch.object(secrets_mod, "_disabled", return_value=False), \
             mock.patch.object(
                 secrets_mod,
                 "_fetch_from_gcp",
                 wraps=lambda name, version: "value-from-sm",
             ) as fake_fetch, \
             mock.patch.dict(os.environ, {"TEST_KEY_PRIORITY": "stale-env-value"}):
            self.assertEqual(
                secrets_mod.get_secret("TEST_KEY_PRIORITY"),
                "value-from-sm",
            )
            fake_fetch.assert_called_once_with("TEST_KEY_PRIORITY", "latest")

    def test_falls_back_to_env_when_sm_returns_none(self):
        """When SM raises (IAM denied, network, missing) · `_fetch_from_gcp`
        returns None and we fall through to env."""
        from apps.core import secrets as secrets_mod

        secrets_mod._fetch_from_gcp.cache_clear()
        with mock.patch.object(secrets_mod, "_disabled", return_value=False), \
             mock.patch.object(secrets_mod, "_fetch_from_gcp", return_value=None), \
             mock.patch.dict(os.environ, {"TEST_KEY_FALLBACK": "from-env"}):
            self.assertEqual(secrets_mod.get_secret("TEST_KEY_FALLBACK"), "from-env")

    # ── Diagnostic helper ───────────────────────────────────────────

    def test_status_helper_reports_env_when_sm_disabled(self):
        from apps.core import secrets as secrets_mod
        with mock.patch.object(secrets_mod, "_disabled", return_value=True), \
             mock.patch.dict(os.environ, {
                 "MPESA_CALLBACK_HMAC_KEY": "x",
                 "SASAPAY_CLIENT_SECRET":  "y",
             }, clear=False):
            status = secrets_mod.get_managed_secret_status()
            self.assertTrue(status["disabled"])
            self.assertEqual(status["secrets"]["MPESA_CALLBACK_HMAC_KEY"], "env")
            self.assertEqual(status["secrets"]["SASAPAY_CLIENT_SECRET"],  "env")

    def test_status_helper_reports_secret_manager_when_sm_returns_values(self):
        from apps.core import secrets as secrets_mod

        secrets_mod._fetch_from_gcp.cache_clear()
        # The status helper itself calls _fetch_from_gcp · we shim it
        # to return a value for one secret + None for everything else,
        # asserting the labels come out correct.
        def fake_fetch(name, version):
            return "from-sm" if name == "MPESA_CALLBACK_HMAC_KEY" else None

        with mock.patch.object(secrets_mod, "_disabled", return_value=False), \
             mock.patch.object(secrets_mod, "_fetch_from_gcp", side_effect=fake_fetch), \
             mock.patch.dict(os.environ, {
                 "SASAPAY_CLIENT_SECRET": "from-env",
             }, clear=False):
            status = secrets_mod.get_managed_secret_status()
            self.assertEqual(
                status["secrets"]["MPESA_CALLBACK_HMAC_KEY"],
                "secret_manager",
            )
            self.assertEqual(
                status["secrets"]["SASAPAY_CLIENT_SECRET"],
                "env_fallback",
            )

    # ── Cache behaviour ─────────────────────────────────────────────

    def test_cache_avoids_repeat_sm_fetches_for_same_secret(self):
        """Second call with the same name doesn't re-hit SM."""
        from apps.core import secrets as secrets_mod

        secrets_mod._fetch_from_gcp.cache_clear()
        with mock.patch.object(secrets_mod, "_disabled", return_value=False):
            # Patch only the underlying SM client call (inside
            # _fetch_from_gcp) so the lru_cache wrapper is real.
            with mock.patch.object(
                secrets_mod, "_fetch_from_gcp", wraps=secrets_mod._fetch_from_gcp
            ):
                # We can't easily count cache hits without inspecting
                # `cache_info()` · use that.
                _ = secrets_mod._fetch_from_gcp("CACHE_TEST_KEY", "latest")
                _ = secrets_mod._fetch_from_gcp("CACHE_TEST_KEY", "latest")
                info = secrets_mod._fetch_from_gcp.cache_info()
                self.assertGreaterEqual(info.hits, 1)


class TOTPKeystoreTests(TestCase):
    """Phase-2 KMS-wrapped TOTP Fernet key."""

    def setUp(self):
        from apps.core import totp_keystore
        totp_keystore.reset_cache()

    def test_legacy_env_path_when_no_ciphertext(self):
        """When TOTP_FERNET_KEY_CIPHERTEXT is empty AND a legacy
        TOTP_ENCRYPTION_KEY is set, returns a Fernet derived from
        the legacy key. Status reports source=legacy_env and
        needs_migration=True."""
        from apps.core import totp_keystore
        from cryptography.fernet import Fernet

        legacy_key = Fernet.generate_key().decode()  # 44-char shape
        with override_settings(
            TOTP_FERNET_KEY_CIPHERTEXT="",
            TOTP_ENCRYPTION_KEY=legacy_key,
        ):
            f = totp_keystore.get_totp_fernet()
            self.assertIsNotNone(f)
            # Verify it actually round-trips
            ciphertext = f.encrypt(b"hello-totp")
            self.assertEqual(f.decrypt(ciphertext), b"hello-totp")

            status = totp_keystore.keystore_status()
            self.assertEqual(status["source"], "legacy_env")
            self.assertTrue(status["needs_migration"])
            self.assertFalse(status["is_kms_wrapped"])

    def test_returns_none_when_nothing_configured(self):
        from apps.core import totp_keystore
        with override_settings(
            TOTP_FERNET_KEY_CIPHERTEXT="",
            TOTP_ENCRYPTION_KEY="",
        ):
            self.assertIsNone(totp_keystore.get_totp_fernet())
            self.assertEqual(totp_keystore.keystore_status()["source"], "missing")

    def test_kms_wrapped_path_takes_priority(self):
        """When TOTP_FERNET_KEY_CIPHERTEXT is set AND KMS decrypts it,
        the KMS-wrapped path wins over the legacy env key."""
        from apps.core import totp_keystore
        from cryptography.fernet import Fernet

        kms_wrapped_key = Fernet.generate_key()  # 32 raw bytes after b64-decode
        legacy_key = Fernet.generate_key().decode()

        # Fake KMS · returns the wrapped key bytes verbatim regardless
        # of input. Real KMS would decrypt the ciphertext we'd set on
        # TOTP_FERNET_KEY_CIPHERTEXT, but the tier-1 path only cares
        # that _decrypt_via_kms returns valid Fernet bytes.
        with override_settings(
            TOTP_FERNET_KEY_CIPHERTEXT="ZmFrZS1jaXBoZXJ0ZXh0",
            TOTP_ENCRYPTION_KEY=legacy_key,
        ), mock.patch.object(
            totp_keystore, "_decrypt_via_kms",
            return_value=kms_wrapped_key,
        ):
            f = totp_keystore.get_totp_fernet()
            self.assertIsNotNone(f)
            # Verify the cached Fernet is the KMS-wrapped one, not legacy
            ciphertext = f.encrypt(b"kms-test")
            self.assertEqual(f.decrypt(ciphertext), b"kms-test")
            # Legacy fernet would NOT decrypt this · proves KMS path won
            with self.assertRaises(Exception):
                Fernet(legacy_key.encode()).decrypt(ciphertext)

            status = totp_keystore.keystore_status()
            self.assertEqual(status["source"], "kms_wrapped")
            self.assertTrue(status["is_kms_wrapped"])
            self.assertFalse(status["needs_migration"])

    def test_kms_failure_falls_through_to_legacy(self):
        """If KMS decrypt raises (key revoked, network), the keystore
        falls through to the legacy env key rather than crashing every
        TOTP read · users can still log in, ops sees the warning."""
        from apps.core import totp_keystore
        from cryptography.fernet import Fernet

        legacy_key = Fernet.generate_key().decode()
        with override_settings(
            TOTP_FERNET_KEY_CIPHERTEXT="some-bad-ciphertext",
            TOTP_ENCRYPTION_KEY=legacy_key,
        ), mock.patch.object(
            totp_keystore, "_decrypt_via_kms",
            side_effect=RuntimeError("KMS denied"),
        ):
            f = totp_keystore.get_totp_fernet()
            self.assertIsNotNone(f)
            self.assertEqual(
                totp_keystore.keystore_status()["source"],
                "legacy_env",
            )

    def test_cache_persists_within_process(self):
        from apps.core import totp_keystore
        from cryptography.fernet import Fernet

        legacy_key = Fernet.generate_key().decode()
        with override_settings(
            TOTP_FERNET_KEY_CIPHERTEXT="",
            TOTP_ENCRYPTION_KEY=legacy_key,
        ):
            first = totp_keystore.get_totp_fernet()
            second = totp_keystore.get_totp_fernet()
            self.assertIs(first, second)
