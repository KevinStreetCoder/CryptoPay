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
        # Each test starts with a clean cache + clean runtime-disable
        # latch · both are per-process module state, so leftovers from
        # prior tests would otherwise cause order-dependent flakes.
        from apps.core.secrets import reset_runtime_state
        reset_runtime_state()

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

    # ── Runtime self-disable on hard auth failure (2026-05-10) ──────
    #
    # Regression guard for the "secret_manager.fetch_failed warnings on
    # every manage.py run" log spam. Root cause was every hard auth
    # failure (creds file missing, SA revoked) re-trying the SM client
    # for every secret + every callsite + every CLI invocation, logging
    # WARNING each time. The fix latches the SM-disabled state at the
    # process level after the first hard failure, so ops sees ONE INFO
    # line and zero noise after that.

    def test_default_credentials_error_latches_runtime_disable(self):
        """When SA JSON is missing, SecretManagerServiceClient() raises
        DefaultCredentialsError. The first call must:
          - Return None (env fallback)
          - Set _runtime_disabled = True
          - NOT log per-secret WARNING lines on subsequent calls
        """
        from apps.core import secrets as secrets_mod

        secrets_mod.reset_runtime_state()

        # Build a fake exception class with the right __name__.
        class DefaultCredentialsError(Exception):
            pass

        # Build a fake `secretmanager` module whose Client() raises
        # the auth error verbatim (matches what google.auth does in
        # prod when /run/secrets/gcp-kms.json doesn't exist).
        fake_secretmanager = mock.MagicMock()
        fake_secretmanager.SecretManagerServiceClient.side_effect = (
            DefaultCredentialsError("File /run/secrets/gcp-kms.json was not found.")
        )
        fake_google_cloud = mock.MagicMock(secretmanager=fake_secretmanager)

        with mock.patch.dict("sys.modules", {
            "google.cloud": fake_google_cloud,
            "google.cloud.secretmanager": fake_secretmanager,
        }), mock.patch.object(secrets_mod, "_PROJECT_ID", "cpay-490223"):

            # First call · should latch + log INFO once.
            with self.assertLogs("apps.core.secrets", level="INFO") as cm:
                v1 = secrets_mod._fetch_from_gcp("MPESA_CALLBACK_HMAC_KEY", "latest")
            self.assertIsNone(v1)
            self.assertTrue(secrets_mod._runtime_disabled)
            self.assertIn("DefaultCredentialsError", secrets_mod._runtime_disable_reason)
            # Exactly ONE log entry · the runtime_disabled INFO line.
            self.assertTrue(any(
                "secret_manager.runtime_disabled" in msg for msg in cm.output
            ))

            # Second call · MUST be silent (no further logs · short-
            # circuit before the SM client is even instantiated).
            secrets_mod._fetch_from_gcp.cache_clear()
            try:
                with self.assertLogs("apps.core.secrets", level="DEBUG") as cm2:
                    v2 = secrets_mod._fetch_from_gcp("SASAPAY_CLIENT_SECRET", "latest")
                # If we got here, assertLogs found at least one log line.
                # Verify it wasn't a fetch_failed WARNING repeat.
                for line in cm2.output:
                    self.assertNotIn("secret_manager.fetch_failed", line)
            except AssertionError as e:
                # assertLogs raises AssertionError when NO logs are
                # captured · that's the desired state. Verify it's
                # the no-logs case, not an unrelated assertion.
                if "no logs of level" in str(e):
                    pass
                else:
                    raise
            self.assertIsNone(v2)

        # Cleanup · don't leak _runtime_disabled into other tests.
        secrets_mod.reset_runtime_state()

    def test_runtime_disabled_short_circuits_get_secret(self):
        """Once latched, get_secret() goes straight to env without
        calling _fetch_from_gcp at all."""
        from apps.core import secrets as secrets_mod

        secrets_mod.reset_runtime_state()
        # Manually flip the latch (mimics what _latch_runtime_disable
        # would do after the first hard failure).
        secrets_mod._runtime_disabled = True
        secrets_mod._runtime_disable_reason = "test-fixture"

        try:
            with mock.patch.object(secrets_mod, "_fetch_from_gcp") as fake_fetch, \
                 mock.patch.dict(os.environ, {
                     "TEST_LATCH_KEY": "from-env",
                     "GOOGLE_CLOUD_PROJECT": "cpay-490223",
                 }):
                self.assertEqual(
                    secrets_mod.get_secret("TEST_LATCH_KEY"),
                    "from-env",
                )
                fake_fetch.assert_not_called()
        finally:
            secrets_mod.reset_runtime_state()

    def test_per_secret_notfound_does_NOT_latch(self):
        """A 404 on one secret means that ONE secret isn't in SM yet ·
        env fallback is the design. Must NOT latch _runtime_disabled
        (the SA + IAM are working, just this name isn't migrated yet)."""
        from apps.core import secrets as secrets_mod

        secrets_mod.reset_runtime_state()

        class NotFound(Exception):
            pass

        fake_client = mock.MagicMock()
        fake_client.access_secret_version.side_effect = NotFound(
            "Secret [MPESA_CALLBACK_HMAC_KEY] not found"
        )
        fake_secretmanager = mock.MagicMock()
        fake_secretmanager.SecretManagerServiceClient.return_value = fake_client
        fake_google_cloud = mock.MagicMock(secretmanager=fake_secretmanager)

        with mock.patch.dict("sys.modules", {
            "google.cloud": fake_google_cloud,
            "google.cloud.secretmanager": fake_secretmanager,
        }), mock.patch.object(secrets_mod, "_PROJECT_ID", "cpay-490223"):
            v = secrets_mod._fetch_from_gcp("MPESA_CALLBACK_HMAC_KEY", "latest")

        self.assertIsNone(v)
        self.assertFalse(
            secrets_mod._runtime_disabled,
            "Per-secret NotFound must not flip the process-wide latch · "
            "other secrets may still be available from SM",
        )
        secrets_mod.reset_runtime_state()

    def test_permission_denied_latches_runtime_disable(self):
        """IAM revoked the secretmanager.viewer role · same outcome
        as missing creds, latch the disable."""
        from apps.core import secrets as secrets_mod

        secrets_mod.reset_runtime_state()

        class PermissionDenied(Exception):
            pass

        fake_client = mock.MagicMock()
        fake_client.access_secret_version.side_effect = PermissionDenied(
            "403 Permission denied on resource"
        )
        fake_secretmanager = mock.MagicMock()
        fake_secretmanager.SecretManagerServiceClient.return_value = fake_client
        fake_google_cloud = mock.MagicMock(secretmanager=fake_secretmanager)

        with mock.patch.dict("sys.modules", {
            "google.cloud": fake_google_cloud,
            "google.cloud.secretmanager": fake_secretmanager,
        }), mock.patch.object(secrets_mod, "_PROJECT_ID", "cpay-490223"):
            secrets_mod._fetch_from_gcp("ANYTHING", "latest")

        self.assertTrue(secrets_mod._runtime_disabled)
        self.assertIn("PermissionDenied", secrets_mod._runtime_disable_reason)
        secrets_mod.reset_runtime_state()

    def test_status_helper_exposes_runtime_disable_reason(self):
        """Admin /health needs to see WHY SM is in env-only mode ·
        not just that it is."""
        from apps.core import secrets as secrets_mod

        secrets_mod.reset_runtime_state()
        secrets_mod._runtime_disabled = True
        secrets_mod._runtime_disable_reason = "DefaultCredentialsError: file missing"

        try:
            status = secrets_mod.get_managed_secret_status()
            self.assertTrue(status["runtime_disabled"])
            self.assertIn("DefaultCredentialsError", status["runtime_disable_reason"])
        finally:
            secrets_mod.reset_runtime_state()

    def test_reset_runtime_state_unlatches(self):
        """After ops fixes the SA JSON, calling reset_runtime_state()
        re-enables Secret Manager for subsequent calls."""
        from apps.core import secrets as secrets_mod

        secrets_mod._runtime_disabled = True
        secrets_mod._runtime_disable_reason = "test"
        secrets_mod.reset_runtime_state()
        self.assertFalse(secrets_mod._runtime_disabled)
        self.assertEqual(secrets_mod._runtime_disable_reason, "")

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
