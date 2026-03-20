"""
Tests for KMS envelope encryption module.

Covers:
  - Envelope encryption/decryption round-trip (local fallback)
  - Local Fernet fallback mode (no AWS required)
  - Seed caching behavior and TTL expiry
  - Memory zeroing (_zero_bytes)
  - _get_master_seed() with KMS enabled/disabled
  - Error handling for malformed blobs
  - AWS KMS error mapping (mocked)
"""

import base64
import json
import os
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings

from apps.blockchain.kms import (
    AWSKMSManager,
    CachedSeedManager,
    KMSDecryptionError,
    KMSError,
    KMSKeyNotFoundError,
    KMSCredentialError,
    KMSNetworkError,
    KMSRateLimitError,
    LocalKMSManager,
    _zero_bytes,
    get_kms_manager,
    reset_kms_manager,
)


class ZeroBytesTest(TestCase):
    """Tests for secure memory zeroing."""

    def test_zeros_all_bytes(self):
        """All bytes in the bytearray should be set to 0."""
        data = bytearray(b"\xff\xaa\x55\x01\x02\x03")
        _zero_bytes(data)
        self.assertEqual(data, bytearray(6))
        self.assertTrue(all(b == 0 for b in data))

    def test_empty_bytearray(self):
        """Zeroing an empty bytearray should be a no-op."""
        data = bytearray()
        _zero_bytes(data)
        self.assertEqual(len(data), 0)

    def test_rejects_bytes_type(self):
        """Should raise TypeError for immutable bytes."""
        with self.assertRaises(TypeError):
            _zero_bytes(b"immutable data")

    def test_rejects_string(self):
        """Should raise TypeError for strings."""
        with self.assertRaises(TypeError):
            _zero_bytes("string data")

    def test_large_bytearray(self):
        """Should handle large bytearrays."""
        data = bytearray(os.urandom(10_000))
        _zero_bytes(data)
        self.assertTrue(all(b == 0 for b in data))


class LocalKMSManagerTest(TestCase):
    """Tests for the local Fernet fallback KMS manager."""

    def setUp(self):
        self.manager = LocalKMSManager(secret_key="test-secret-key-for-kms")

    def test_encrypt_decrypt_round_trip(self):
        """Encrypting then decrypting should return the original seed."""
        seed = os.urandom(64)
        encrypted = self.manager.encrypt_seed(seed)
        decrypted = self.manager.decrypt_seed(encrypted)
        self.assertEqual(decrypted, seed)

    def test_encrypt_decrypt_small_seed(self):
        """Should work with small seeds (16 bytes)."""
        seed = os.urandom(16)
        encrypted = self.manager.encrypt_seed(seed)
        decrypted = self.manager.decrypt_seed(encrypted)
        self.assertEqual(decrypted, seed)

    def test_encrypt_decrypt_large_seed(self):
        """Should work with larger payloads."""
        seed = os.urandom(256)
        encrypted = self.manager.encrypt_seed(seed)
        decrypted = self.manager.decrypt_seed(encrypted)
        self.assertEqual(decrypted, seed)

    def test_encrypted_blob_is_base64(self):
        """The output should be valid base64."""
        seed = os.urandom(64)
        encrypted = self.manager.encrypt_seed(seed)
        decoded = base64.b64decode(encrypted)
        envelope = json.loads(decoded)
        self.assertEqual(envelope["v"], 1)
        self.assertEqual(envelope["provider"], "local-fernet")

    def test_different_seeds_produce_different_blobs(self):
        """Each encryption should produce a unique blob (random IV + DEK)."""
        seed = os.urandom(64)
        blob1 = self.manager.encrypt_seed(seed)
        blob2 = self.manager.encrypt_seed(seed)
        self.assertNotEqual(blob1, blob2)

    def test_empty_seed_raises(self):
        """Encrypting an empty seed should raise ValueError."""
        with self.assertRaises(ValueError):
            self.manager.encrypt_seed(b"")

    def test_empty_ciphertext_raises(self):
        """Decrypting an empty string should raise ValueError."""
        with self.assertRaises(ValueError):
            self.manager.decrypt_seed("")

    def test_invalid_base64_raises(self):
        """Decrypting invalid base64 should raise KMSDecryptionError."""
        with self.assertRaises(KMSDecryptionError):
            self.manager.decrypt_seed("not-valid-base64!!!")

    def test_malformed_json_raises(self):
        """Decrypting a base64 blob with invalid JSON should raise."""
        bad_blob = base64.b64encode(b"not json").decode()
        with self.assertRaises(KMSDecryptionError):
            self.manager.decrypt_seed(bad_blob)

    def test_wrong_version_raises(self):
        """Envelope with wrong version should be rejected."""
        envelope = {"v": 999, "provider": "local-fernet"}
        blob = base64.b64encode(json.dumps(envelope).encode()).decode()
        with self.assertRaises(KMSDecryptionError):
            self.manager.decrypt_seed(blob)

    def test_missing_fields_raises(self):
        """Envelope missing required fields should raise."""
        envelope = {"v": 1, "provider": "local-fernet"}
        blob = base64.b64encode(json.dumps(envelope).encode()).decode()
        with self.assertRaises(KMSDecryptionError):
            self.manager.decrypt_seed(blob)

    def test_different_secret_key_cannot_decrypt(self):
        """A blob encrypted with one key should not decrypt with another."""
        seed = os.urandom(64)
        encrypted = self.manager.encrypt_seed(seed)

        other_manager = LocalKMSManager(secret_key="completely-different-key")
        with self.assertRaises(KMSDecryptionError):
            other_manager.decrypt_seed(encrypted)

    def test_empty_secret_key_raises(self):
        """LocalKMSManager should reject empty secret key."""
        with self.assertRaises(KMSError):
            LocalKMSManager(secret_key="")

    def test_rotate_data_key_returns_both_forms(self):
        """rotate_data_key should return plaintext and encrypted key."""
        result = self.manager.rotate_data_key()
        self.assertIn("plaintext_key", result)
        self.assertIn("encrypted_key", result)
        self.assertEqual(len(result["plaintext_key"]), 32)
        self.assertIsInstance(result["encrypted_key"], bytes)


class CachedSeedManagerTest(TestCase):
    """Tests for seed caching with TTL."""

    def setUp(self):
        self.kms = LocalKMSManager(secret_key="cache-test-key")
        self.seed = os.urandom(64)
        self.encrypted = self.kms.encrypt_seed(self.seed)

    def test_cache_returns_correct_seed(self):
        """Cached manager should return the correct decrypted seed."""
        cached = CachedSeedManager(self.kms, ttl_seconds=60)
        result = cached.get_seed(self.encrypted)
        self.assertEqual(result, self.seed)

    def test_cache_hit_avoids_decrypt(self):
        """Second call within TTL should use cache, not decrypt again."""
        cached = CachedSeedManager(self.kms, ttl_seconds=60)

        # First call decrypts
        result1 = cached.get_seed(self.encrypted)

        # Patch decrypt to track calls
        with patch.object(self.kms, "decrypt_seed", wraps=self.kms.decrypt_seed) as mock_decrypt:
            result2 = cached.get_seed(self.encrypted)
            mock_decrypt.assert_not_called()

        self.assertEqual(result1, result2)
        self.assertEqual(result2, self.seed)

    def test_cache_expires_after_ttl(self):
        """After TTL expires, the cache should re-decrypt."""
        cached = CachedSeedManager(self.kms, ttl_seconds=0)

        result1 = cached.get_seed(self.encrypted)
        result2 = cached.get_seed(self.encrypted)
        self.assertEqual(result1, self.seed)
        self.assertEqual(result2, self.seed)

    def test_invalidate_clears_cache(self):
        """invalidate() should force re-decryption on next access."""
        cached = CachedSeedManager(self.kms, ttl_seconds=3600)

        cached.get_seed(self.encrypted)
        cached.invalidate()

        self.assertIsNone(cached._cached_seed)

    def test_invalidate_zeros_memory(self):
        """invalidate() should zero the cached bytearray."""
        cached = CachedSeedManager(self.kms, ttl_seconds=3600)
        cached.get_seed(self.encrypted)

        cached_ref = cached._cached_seed
        self.assertIsNotNone(cached_ref)

        cached.invalidate()

        # The original bytearray should be zeroed
        self.assertTrue(all(b == 0 for b in cached_ref))

    def test_kms_manager_property(self):
        """kms_manager property should expose the underlying manager."""
        cached = CachedSeedManager(self.kms, ttl_seconds=60)
        self.assertIs(cached.kms_manager, self.kms)


class GetKMSManagerTest(TestCase):
    """Tests for get_kms_manager() factory function."""

    def tearDown(self):
        reset_kms_manager()

    @override_settings(KMS_ENABLED=False, SECRET_KEY="test-factory-key")
    def test_returns_local_manager_when_disabled(self):
        """When KMS_ENABLED=False, should return a LocalKMSManager."""
        manager = get_kms_manager()
        self.assertIsInstance(manager, CachedSeedManager)
        self.assertIsInstance(manager.kms_manager, LocalKMSManager)

    @override_settings(KMS_ENABLED=True, KMS_KEY_ID="", KMS_REGION="us-east-1")
    def test_raises_when_enabled_without_key_id(self):
        """KMS_ENABLED=True without KMS_KEY_ID should raise."""
        with self.assertRaises(KMSError):
            get_kms_manager()

    @override_settings(
        KMS_ENABLED=True,
        KMS_KEY_ID="arn:aws:kms:us-east-1:123456:key/test-key",
        KMS_REGION="us-east-1",
    )
    def test_returns_aws_manager_when_enabled(self):
        """When KMS_ENABLED=True with key ID, should return AWSKMSManager."""
        manager = get_kms_manager()
        self.assertIsInstance(manager, CachedSeedManager)
        self.assertIsInstance(manager.kms_manager, AWSKMSManager)

    @override_settings(KMS_ENABLED=False, SECRET_KEY="singleton-test")
    def test_singleton_returns_same_instance(self):
        """Repeated calls should return the same singleton."""
        m1 = get_kms_manager()
        m2 = get_kms_manager()
        self.assertIs(m1, m2)

    @override_settings(KMS_ENABLED=False, SECRET_KEY="reset-test")
    def test_reset_clears_singleton(self):
        """reset_kms_manager should clear the singleton."""
        m1 = get_kms_manager()
        reset_kms_manager()
        m2 = get_kms_manager()
        self.assertIsNot(m1, m2)

    @override_settings(
        KMS_ENABLED=False,
        SECRET_KEY="ttl-test",
        KMS_SEED_CACHE_TTL=120,
    )
    def test_custom_cache_ttl(self):
        """Custom TTL should be applied to the cached manager."""
        manager = get_kms_manager()
        self.assertEqual(manager._ttl, 120)


class GetMasterSeedKMSTest(TestCase):
    """Tests for _get_master_seed() with KMS integration."""

    def tearDown(self):
        reset_kms_manager()

    @override_settings(
        KMS_ENABLED=False,
        WALLET_MASTER_SEED="aa" * 32,
        WALLET_MNEMONIC="",
        WALLET_ENCRYPTED_SEED="",
    )
    def test_plaintext_hex_seed_when_kms_disabled(self):
        """With KMS disabled, should use WALLET_MASTER_SEED as before."""
        from apps.blockchain.services import _get_master_seed

        seed = _get_master_seed()
        self.assertEqual(seed, bytes.fromhex("aa" * 32))

    @override_settings(
        KMS_ENABLED=True,
        WALLET_ENCRYPTED_SEED="",
        KMS_KEY_ID="test-key",
    )
    def test_kms_enabled_without_blob_raises(self):
        """KMS_ENABLED=True without WALLET_ENCRYPTED_SEED should raise."""
        from apps.blockchain.services import _get_master_seed

        with self.assertRaises(RuntimeError):
            _get_master_seed()

    @override_settings(
        KMS_ENABLED=False,
        SECRET_KEY="kms-integration-test-key",
        KMS_SEED_CACHE_TTL=300,
    )
    def test_kms_enabled_decrypts_via_manager(self):
        """KMS_ENABLED=True should decrypt via the KMS manager."""
        from apps.blockchain.services import _get_master_seed

        test_seed = os.urandom(64)

        # Create a real encrypted blob using local fallback
        local_manager = LocalKMSManager(secret_key="kms-integration-test-key")
        real_blob = local_manager.encrypt_seed(test_seed)

        cached = CachedSeedManager(local_manager, ttl_seconds=300)

        with patch("apps.blockchain.services.settings") as mock_settings:
            mock_settings.KMS_ENABLED = True
            mock_settings.WALLET_ENCRYPTED_SEED = real_blob
            mock_settings.DEBUG = False

            with patch("apps.blockchain.services.get_kms_manager", return_value=cached):
                seed = _get_master_seed()
                self.assertEqual(seed, test_seed)

    @override_settings(
        KMS_ENABLED=False,
        WALLET_MASTER_SEED="",
        WALLET_MNEMONIC="",
        WALLET_ENCRYPTED_SEED="",
        DEBUG=True,
        SECRET_KEY="dev-fallback-key",
    )
    def test_fallback_to_secret_key_in_debug(self):
        """With nothing set and DEBUG=True, should derive from SECRET_KEY."""
        from apps.blockchain.services import _get_master_seed

        seed = _get_master_seed()
        self.assertIsInstance(seed, bytes)
        self.assertEqual(len(seed), 64)

    @override_settings(
        KMS_ENABLED=False,
        WALLET_MASTER_SEED="",
        WALLET_MNEMONIC="",
        WALLET_ENCRYPTED_SEED="",
        DEBUG=False,
    )
    def test_no_seed_in_production_raises(self):
        """In production (DEBUG=False) with no seed, should raise RuntimeError."""
        from apps.blockchain.services import _get_master_seed

        with self.assertRaises(RuntimeError):
            _get_master_seed()


class AWSKMSManagerMockTest(TestCase):
    """Tests for AWSKMSManager using mocked boto3 client."""

    def _make_manager_with_mock_client(self):
        """Create an AWSKMSManager with a mocked boto3 client."""
        manager = AWSKMSManager(key_id="arn:aws:kms:us-east-1:123:key/test", region="us-east-1")
        mock_client = MagicMock()
        manager._client = mock_client
        return manager, mock_client

    def test_encrypt_decrypt_round_trip_mocked(self):
        """Full envelope encrypt/decrypt with mocked KMS GenerateDataKey and Decrypt."""
        manager, mock_client = self._make_manager_with_mock_client()

        plaintext_dek = os.urandom(32)
        encrypted_dek = os.urandom(64)

        mock_client.generate_data_key.return_value = {
            "Plaintext": plaintext_dek,
            "CiphertextBlob": encrypted_dek,
        }

        seed = os.urandom(64)
        blob = manager.encrypt_seed(seed)

        mock_client.decrypt.return_value = {
            "Plaintext": plaintext_dek,
        }

        result = manager.decrypt_seed(blob)
        self.assertEqual(result, seed)

    def test_generate_data_key_called_correctly(self):
        """encrypt_seed should call generate_data_key with AES_256."""
        manager, mock_client = self._make_manager_with_mock_client()

        mock_client.generate_data_key.return_value = {
            "Plaintext": os.urandom(32),
            "CiphertextBlob": os.urandom(64),
        }

        manager.encrypt_seed(os.urandom(64))

        mock_client.generate_data_key.assert_called_once_with(
            KeyId="arn:aws:kms:us-east-1:123:key/test",
            KeySpec="AES_256",
        )

    def test_not_found_error_mapping(self):
        """NotFoundException should map to KMSKeyNotFoundError."""
        manager, mock_client = self._make_manager_with_mock_client()

        from botocore.exceptions import ClientError

        error_response = {"Error": {"Code": "NotFoundException", "Message": "Key not found"}}
        mock_client.generate_data_key.side_effect = ClientError(error_response, "GenerateDataKey")

        with self.assertRaises(KMSKeyNotFoundError):
            manager.encrypt_seed(os.urandom(64))

    def test_access_denied_error_mapping(self):
        """AccessDeniedException should map to KMSCredentialError."""
        manager, mock_client = self._make_manager_with_mock_client()

        from botocore.exceptions import ClientError

        error_response = {"Error": {"Code": "AccessDeniedException", "Message": "Access denied"}}
        mock_client.generate_data_key.side_effect = ClientError(error_response, "GenerateDataKey")

        with self.assertRaises(KMSCredentialError):
            manager.encrypt_seed(os.urandom(64))

    def test_throttling_error_mapping(self):
        """ThrottlingException should map to KMSRateLimitError."""
        manager, mock_client = self._make_manager_with_mock_client()

        from botocore.exceptions import ClientError

        error_response = {"Error": {"Code": "ThrottlingException", "Message": "Rate exceeded"}}
        mock_client.generate_data_key.side_effect = ClientError(error_response, "GenerateDataKey")

        with self.assertRaises(KMSRateLimitError):
            manager.encrypt_seed(os.urandom(64))

    def test_invalid_ciphertext_error_mapping(self):
        """InvalidCiphertextException should map to KMSDecryptionError."""
        manager, mock_client = self._make_manager_with_mock_client()

        from botocore.exceptions import ClientError

        mock_client.generate_data_key.return_value = {
            "Plaintext": os.urandom(32),
            "CiphertextBlob": os.urandom(64),
        }
        blob = manager.encrypt_seed(os.urandom(64))

        error_response = {"Error": {"Code": "InvalidCiphertextException", "Message": "Bad ciphertext"}}
        mock_client.decrypt.side_effect = ClientError(error_response, "Decrypt")

        with self.assertRaises(KMSDecryptionError):
            manager.decrypt_seed(blob)

    def test_network_timeout_error_mapping(self):
        """ConnectTimeoutError should map to KMSNetworkError."""
        manager, mock_client = self._make_manager_with_mock_client()

        from botocore.exceptions import ConnectTimeoutError

        mock_client.generate_data_key.side_effect = ConnectTimeoutError(endpoint_url="https://kms.us-east-1.amazonaws.com")

        with self.assertRaises(KMSNetworkError):
            manager.encrypt_seed(os.urandom(64))

    def test_empty_key_id_raises(self):
        """AWSKMSManager should reject empty key ID."""
        with self.assertRaises(KMSError):
            AWSKMSManager(key_id="", region="us-east-1")

    def test_rotate_data_key(self):
        """rotate_data_key should call KMS and return both key forms."""
        manager, mock_client = self._make_manager_with_mock_client()

        plaintext = os.urandom(32)
        encrypted = os.urandom(64)
        mock_client.generate_data_key.return_value = {
            "Plaintext": plaintext,
            "CiphertextBlob": encrypted,
        }

        result = manager.rotate_data_key()
        self.assertEqual(result["plaintext_key"], plaintext)
        self.assertEqual(result["encrypted_key"], encrypted)


class EnvelopeIntegrityTest(TestCase):
    """Tests for envelope blob format integrity."""

    def setUp(self):
        self.manager = LocalKMSManager(secret_key="integrity-test")

    def test_envelope_contains_required_fields(self):
        """The envelope JSON should contain all required fields."""
        seed = os.urandom(64)
        blob = self.manager.encrypt_seed(seed)

        envelope = json.loads(base64.b64decode(blob))
        self.assertIn("v", envelope)
        self.assertIn("provider", envelope)
        self.assertIn("encrypted_dek", envelope)
        self.assertIn("iv", envelope)
        self.assertIn("encrypted_seed", envelope)

    def test_tampered_encrypted_seed_fails(self):
        """Modifying the encrypted seed should cause decryption to fail."""
        seed = os.urandom(64)
        blob = self.manager.encrypt_seed(seed)

        envelope = json.loads(base64.b64decode(blob))
        original = base64.b64decode(envelope["encrypted_seed"])
        tampered = bytearray(original)
        tampered[0] ^= 0xFF
        envelope["encrypted_seed"] = base64.b64encode(bytes(tampered)).decode()

        tampered_blob = base64.b64encode(json.dumps(envelope).encode()).decode()
        with self.assertRaises(KMSDecryptionError):
            self.manager.decrypt_seed(tampered_blob)

    def test_tampered_iv_fails(self):
        """Modifying the IV should cause decryption to fail."""
        seed = os.urandom(64)
        blob = self.manager.encrypt_seed(seed)

        envelope = json.loads(base64.b64decode(blob))
        original_iv = base64.b64decode(envelope["iv"])
        tampered_iv = bytearray(original_iv)
        tampered_iv[0] ^= 0xFF
        envelope["iv"] = base64.b64encode(bytes(tampered_iv)).decode()

        tampered_blob = base64.b64encode(json.dumps(envelope).encode()).decode()
        with self.assertRaises(KMSDecryptionError):
            self.manager.decrypt_seed(tampered_blob)
