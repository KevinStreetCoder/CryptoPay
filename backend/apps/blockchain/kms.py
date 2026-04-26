"""
AWS KMS envelope encryption for wallet seeds.

Implements envelope encryption: KMS generates a data encryption key (DEK),
the DEK encrypts the seed locally, and the encrypted DEK + encrypted seed
are stored together as a single blob.

Supports:
  - AWS KMS (production): Real envelope encryption via boto3
  - Local fallback (development): Fernet symmetric encryption derived from SECRET_KEY

Usage:
    from apps.blockchain.kms import get_kms_manager
    manager = get_kms_manager()
    encrypted = manager.encrypt_seed(seed_bytes)
    decrypted = manager.decrypt_seed(encrypted)
"""

import base64
import hashlib
import json
import logging
import os
import time
from typing import Optional

from django.conf import settings

logger = logging.getLogger(__name__)

# Envelope encryption blob version — allows future format changes
_ENVELOPE_VERSION = 1


def _zero_bytes(data: bytearray) -> None:
    """
    Securely zero out a bytearray to prevent seed material from lingering in memory.

    This overwrites every byte with 0x00. While Python's garbage collector
    makes true secure erasure difficult (copies may exist), this is a
    defense-in-depth measure that eliminates the primary reference.

    Only works on mutable bytearray — bytes objects are immutable and cannot
    be zeroed. Callers should convert sensitive data to bytearray for processing.
    """
    if not isinstance(data, bytearray):
        raise TypeError(
            "_zero_bytes requires a bytearray, got %s. "
            "Convert with bytearray(data) before processing sensitive material."
            % type(data).__name__
        )
    for i in range(len(data)):
        data[i] = 0


class KMSError(Exception):
    """Base exception for KMS operations."""
    pass


class KMSKeyNotFoundError(KMSError):
    """The specified KMS key ID does not exist or is not accessible."""
    pass


class KMSCredentialError(KMSError):
    """AWS credentials are missing, expired, or insufficient."""
    pass


class KMSRateLimitError(KMSError):
    """AWS KMS rate limit exceeded. Retry after backoff."""
    pass


class KMSNetworkError(KMSError):
    """Network timeout or connectivity issue with AWS KMS."""
    pass


class KMSDecryptionError(KMSError):
    """Failed to decrypt — blob may be corrupted or encrypted with a different key."""
    pass


class BaseKMSManager:
    """Abstract base for KMS managers."""

    def encrypt_seed(self, plaintext_seed: bytes) -> str:
        """
        Envelope-encrypt a seed.

        Args:
            plaintext_seed: Raw seed bytes (typically 64 bytes for BIP-39).

        Returns:
            Base64-encoded envelope blob containing encrypted DEK + encrypted seed.
        """
        raise NotImplementedError

    def decrypt_seed(self, ciphertext: str) -> bytes:
        """
        Decrypt an envelope-encrypted seed.

        Args:
            ciphertext: Base64-encoded envelope blob from encrypt_seed().

        Returns:
            Raw seed bytes.
        """
        raise NotImplementedError

    def rotate_data_key(self) -> dict:
        """
        Generate a new data encryption key from KMS.

        Returns:
            Dict with 'plaintext_key' (bytes) and 'encrypted_key' (bytes).
        """
        raise NotImplementedError

    def health_check(self) -> dict:
        """Boot-time smoke test · encrypt-decrypt round trip.

        Proves the credentials work AND we have IAM rights for both
        encrypt and decrypt on this specific key. Default
        implementation does a full envelope round-trip on a 16-byte
        payload (cheap · ~50-150 ms in production). Subclasses MAY
        override with a lighter probe (e.g. GCP `GetCryptoKey` is
        free and sufficient for IAM verification) but the round-trip
        is the gold standard because it catches:

          - wrong key resource path
          - missing encrypter / decrypter IAM role
          - DEK / IV format regressions in our own code
          - clock skew on KMS-hosted hostname verification

        Raises one of the typed `KMS*Error` exceptions on failure
        OR `KMSError` for an unexpected failure mode. Returns a
        `{ok: True, latency_ms: ..., key_resource: ...}` dict on
        success so AppConfig.ready() can surface latency in logs.
        """
        import time as _time
        probe = b"cpay-kms-health-check"
        t0 = _time.perf_counter()
        ciphertext = self.encrypt_seed(probe)
        plaintext = self.decrypt_seed(ciphertext)
        elapsed_ms = round((_time.perf_counter() - t0) * 1000, 1)
        if plaintext != probe:
            raise KMSError(
                "KMS health-check decryption returned wrong plaintext. "
                "Provider may have re-keyed this key resource."
            )
        return {
            "ok": True,
            "latency_ms": elapsed_ms,
            "key_resource": getattr(self, "_key_resource", None) or getattr(self, "_key_id", None),
        }


class AWSKMSManager(BaseKMSManager):
    """
    Production KMS manager using AWS KMS envelope encryption.

    Flow (encrypt):
      1. Call KMS GenerateDataKey to get a plaintext DEK + encrypted DEK
      2. Use the plaintext DEK to AES-encrypt the seed locally
      3. Zero the plaintext DEK from memory
      4. Package {version, encrypted_dek, iv, encrypted_seed} as JSON, base64-encode

    Flow (decrypt):
      1. Decode the base64 blob, parse JSON
      2. Call KMS Decrypt to recover the plaintext DEK from the encrypted DEK
      3. Use the plaintext DEK to AES-decrypt the seed locally
      4. Zero the plaintext DEK from memory
      5. Return the seed bytes
    """

    def __init__(self, key_id: str, region: str):
        if not key_id:
            raise KMSError("KMS_KEY_ID is required for AWS KMS mode.")
        self._key_id = key_id
        self._region = region
        self._client = None

    def _get_client(self):
        """Lazily initialize the boto3 KMS client."""
        if self._client is None:
            try:
                import boto3
                from botocore.config import Config

                config = Config(
                    region_name=self._region,
                    connect_timeout=5,
                    read_timeout=10,
                    retries={"max_attempts": 3, "mode": "adaptive"},
                )
                self._client = boto3.client("kms", config=config)
            except ImportError:
                raise KMSError(
                    "boto3 is required for AWS KMS. Install with: pip install boto3"
                )
            except Exception as e:
                raise KMSCredentialError(
                    f"Failed to initialize AWS KMS client: {e}"
                )
        return self._client

    def _handle_aws_error(self, error):
        """Map boto3/botocore exceptions to KMS-specific errors."""
        try:
            from botocore.exceptions import (
                ClientError,
                EndpointConnectionError,
                ConnectTimeoutError,
                ReadTimeoutError,
                NoCredentialsError,
                PartialCredentialsError,
            )
        except ImportError:
            raise KMSError(f"AWS error (botocore not available): {error}")

        if isinstance(error, (NoCredentialsError, PartialCredentialsError)):
            raise KMSCredentialError(
                "AWS credentials not found or incomplete. "
                "Configure AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or use IAM roles."
            ) from error

        if isinstance(error, (EndpointConnectionError, ConnectTimeoutError, ReadTimeoutError)):
            raise KMSNetworkError(
                f"Network error connecting to AWS KMS: {error}"
            ) from error

        if isinstance(error, ClientError):
            code = error.response.get("Error", {}).get("Code", "")
            message = error.response.get("Error", {}).get("Message", "")

            if code == "NotFoundException":
                raise KMSKeyNotFoundError(
                    f"KMS key not found: {self._key_id}. Verify the key ID and region."
                ) from error
            elif code == "DisabledException":
                raise KMSKeyNotFoundError(
                    f"KMS key is disabled: {self._key_id}. Enable it in the AWS console."
                ) from error
            elif code in ("AccessDeniedException", "KMSAccessDeniedException"):
                raise KMSCredentialError(
                    f"Access denied for KMS key {self._key_id}: {message}"
                ) from error
            elif code == "ThrottlingException":
                raise KMSRateLimitError(
                    "AWS KMS rate limit exceeded. Implement caching or increase limits."
                ) from error
            elif code in ("InvalidCiphertextException", "IncorrectKeyException"):
                raise KMSDecryptionError(
                    f"Decryption failed: {message}. "
                    "The blob may be corrupted or encrypted with a different KMS key."
                ) from error

        raise KMSError(f"Unexpected AWS KMS error: {error}") from error

    def rotate_data_key(self) -> dict:
        """Generate a new data encryption key from KMS."""
        client = self._get_client()
        try:
            response = client.generate_data_key(
                KeyId=self._key_id,
                KeySpec="AES_256",
            )
            return {
                "plaintext_key": response["Plaintext"],
                "encrypted_key": response["CiphertextBlob"],
            }
        except Exception as e:
            # Network-level failures (ConnectTimeout, ReadTimeout,
            # EndpointConnectionError, …) don't carry a `.response` attr
            # because the HTTP cycle never reached the service, so the
            # old `hasattr(e, "response")` guard quietly swallowed them
            # into the generic KMSError instead of KMSNetworkError. Let
            # `_handle_aws_error` classify by TYPE too — it already has
            # the type-based branches for network errors.
            self._handle_aws_error(e)
            raise KMSError(f"Failed to generate data key: {e}") from e

    def encrypt_seed(self, plaintext_seed: bytes) -> str:
        """Envelope-encrypt a seed using AWS KMS."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if not plaintext_seed:
            raise ValueError("Cannot encrypt empty seed.")

        # Step 1: Generate a data encryption key
        dek = self.rotate_data_key()
        plaintext_dek = bytearray(dek["plaintext_key"])
        encrypted_dek = dek["encrypted_key"]

        try:
            # Step 2: Encrypt seed with DEK using AES-256-GCM
            iv = os.urandom(12)  # 96-bit nonce for GCM
            aesgcm = AESGCM(bytes(plaintext_dek))
            encrypted_seed = aesgcm.encrypt(iv, plaintext_seed, None)

            # Step 3: Package as envelope blob
            envelope = {
                "v": _ENVELOPE_VERSION,
                "provider": "aws-kms",
                "key_id": self._key_id,
                "encrypted_dek": base64.b64encode(encrypted_dek).decode("ascii"),
                "iv": base64.b64encode(iv).decode("ascii"),
                "encrypted_seed": base64.b64encode(encrypted_seed).decode("ascii"),
            }

            blob_json = json.dumps(envelope, separators=(",", ":"))
            return base64.b64encode(blob_json.encode("utf-8")).decode("ascii")

        finally:
            # Step 4: Zero the plaintext DEK
            _zero_bytes(plaintext_dek)

    def decrypt_seed(self, ciphertext: str) -> bytes:
        """Decrypt an envelope-encrypted seed using AWS KMS."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if not ciphertext:
            raise ValueError("Cannot decrypt empty ciphertext.")

        # Step 1: Decode the envelope
        try:
            blob_json = base64.b64decode(ciphertext)
            envelope = json.loads(blob_json)
        except (ValueError, json.JSONDecodeError) as e:
            raise KMSDecryptionError(
                f"Invalid envelope blob format: {e}"
            ) from e

        version = envelope.get("v")
        if version != _ENVELOPE_VERSION:
            raise KMSDecryptionError(
                f"Unsupported envelope version: {version} (expected {_ENVELOPE_VERSION})"
            )

        try:
            encrypted_dek = base64.b64decode(envelope["encrypted_dek"])
            iv = base64.b64decode(envelope["iv"])
            encrypted_seed = base64.b64decode(envelope["encrypted_seed"])
        except (KeyError, ValueError) as e:
            raise KMSDecryptionError(
                f"Malformed envelope blob — missing or invalid fields: {e}"
            ) from e

        # Step 2: Decrypt the DEK via KMS
        client = self._get_client()
        try:
            response = client.decrypt(CiphertextBlob=encrypted_dek)
            plaintext_dek = bytearray(response["Plaintext"])
        except Exception as e:
            if hasattr(e, "response"):
                self._handle_aws_error(e)
            raise KMSError(f"Failed to decrypt data key: {e}") from e

        try:
            # Step 3: Decrypt the seed with the DEK
            aesgcm = AESGCM(bytes(plaintext_dek))
            seed = aesgcm.decrypt(iv, encrypted_seed, None)
            return bytes(seed)
        except Exception as e:
            raise KMSDecryptionError(
                f"Failed to decrypt seed with data key: {e}. "
                "The blob may be corrupted."
            ) from e
        finally:
            # Step 4: Zero the plaintext DEK
            _zero_bytes(plaintext_dek)


class GCPKMSManager(BaseKMSManager):
    """
    Production KMS manager using Google Cloud KMS envelope encryption.

    GCP KMS doesn't have a native `GenerateDataKey` operation like AWS KMS,
    so we generate the data encryption key (DEK) locally with os.urandom and
    call `encrypt(plaintext_dek)` to produce the encrypted DEK. The seed
    itself is AES-256-GCM encrypted locally using the plaintext DEK · same
    envelope contract as the AWS path so the on-disk blob format is
    identical except for the `provider` discriminator.

    Resource path format:
        projects/{project}/locations/{location}/keyRings/{ring}/cryptoKeys/{key}

    Authentication: the official client picks credentials up via the
    standard Google ADC chain (GOOGLE_APPLICATION_CREDENTIALS env var, or
    workload identity on GKE / Cloud Run / GCE). Cpay's VPS deploys use
    a service account JSON file mounted at runtime.
    """

    def __init__(self, key_resource: str):
        if not key_resource:
            raise KMSError("KMS_KEY_RESOURCE is required for GCP KMS mode.")
        # Sanity check the resource format. A typo here surfaces at boot
        # rather than after a 30-second hang at the first encrypt call.
        if not key_resource.startswith("projects/"):
            raise KMSError(
                f"KMS_KEY_RESOURCE must start with 'projects/...', got "
                f"{key_resource!r}. Format: "
                "projects/<project>/locations/<loc>/keyRings/<ring>/cryptoKeys/<key>"
            )
        self._key_resource = key_resource
        self._client = None

    def _get_client(self):
        """Lazily initialise the GCP KMS client."""
        if self._client is None:
            try:
                from google.cloud import kms  # type: ignore[import-untyped]
                from google.api_core import client_options  # type: ignore[import-untyped]
            except ImportError as e:
                raise KMSError(
                    "google-cloud-kms is required for GCP KMS. "
                    "Install with: pip install google-cloud-kms"
                ) from e

            try:
                # 30 s connection budget · KMS calls are typically <100 ms
                # but slow networks (Kenyan 4G under load) need headroom.
                self._client = kms.KeyManagementServiceClient(
                    client_options=client_options.ClientOptions(
                        api_endpoint=f"cloudkms.googleapis.com:443"
                    ),
                )
            except Exception as e:
                raise KMSCredentialError(
                    f"Failed to initialise GCP KMS client: {e}. "
                    "Check GOOGLE_APPLICATION_CREDENTIALS or workload identity."
                ) from e
        return self._client

    def _handle_gcp_error(self, error):
        """Translate google-api-core exceptions into KMS-typed errors."""
        try:
            from google.api_core import exceptions as gax_exc  # type: ignore[import-untyped]
        except ImportError:
            raise KMSError(f"GCP error (google-api-core not available): {error}")

        if isinstance(error, gax_exc.NotFound):
            raise KMSKeyNotFoundError(
                f"GCP KMS key not found: {self._key_resource}. "
                "Verify the resource path and the service account permissions."
            ) from error
        if isinstance(error, gax_exc.PermissionDenied):
            raise KMSCredentialError(
                f"Permission denied for GCP KMS key {self._key_resource}: {error}. "
                "Grant the service account roles/cloudkms.cryptoKeyEncrypterDecrypter."
            ) from error
        if isinstance(error, (gax_exc.Unauthenticated,)):
            raise KMSCredentialError(
                "GCP credentials missing or invalid. "
                "Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON, "
                "or run on a workload-identity-enabled platform."
            ) from error
        if isinstance(error, gax_exc.ResourceExhausted):
            raise KMSRateLimitError(
                "GCP KMS quota exceeded. Retry after backoff or request a quota bump."
            ) from error
        if isinstance(error, (gax_exc.DeadlineExceeded, gax_exc.ServiceUnavailable)):
            raise KMSNetworkError(
                f"Network/timeout error reaching GCP KMS: {error}"
            ) from error
        if isinstance(error, gax_exc.InvalidArgument):
            raise KMSDecryptionError(
                f"GCP KMS rejected the request: {error}. "
                "Ciphertext may be malformed or encrypted with a different key."
            ) from error

        raise KMSError(f"Unexpected GCP KMS error: {error}") from error

    def rotate_data_key(self) -> dict:
        """
        Generate a fresh 256-bit data encryption key locally, then ask
        GCP KMS to encrypt it. GCP KMS doesn't have an AWS-style
        GenerateDataKey, so we synthesise one.
        """
        client = self._get_client()
        plaintext_key = os.urandom(32)
        try:
            response = client.encrypt(
                request={
                    "name": self._key_resource,
                    "plaintext": plaintext_key,
                }
            )
            return {
                "plaintext_key": plaintext_key,
                "encrypted_key": response.ciphertext,
            }
        except Exception as e:
            self._handle_gcp_error(e)
            raise KMSError(f"Failed to encrypt data key: {e}") from e

    def encrypt_seed(self, plaintext_seed: bytes) -> str:
        """Envelope-encrypt a seed using GCP KMS."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if not plaintext_seed:
            raise ValueError("Cannot encrypt empty seed.")

        dek = self.rotate_data_key()
        plaintext_dek = bytearray(dek["plaintext_key"])
        encrypted_dek = dek["encrypted_key"]

        try:
            iv = os.urandom(12)
            aesgcm = AESGCM(bytes(plaintext_dek))
            encrypted_seed = aesgcm.encrypt(iv, plaintext_seed, None)

            envelope = {
                "v": _ENVELOPE_VERSION,
                "provider": "gcp-kms",
                "key_resource": self._key_resource,
                "encrypted_dek": base64.b64encode(encrypted_dek).decode("ascii"),
                "iv": base64.b64encode(iv).decode("ascii"),
                "encrypted_seed": base64.b64encode(encrypted_seed).decode("ascii"),
            }

            blob_json = json.dumps(envelope, separators=(",", ":"))
            return base64.b64encode(blob_json.encode("utf-8")).decode("ascii")
        finally:
            _zero_bytes(plaintext_dek)

    def decrypt_seed(self, ciphertext: str) -> bytes:
        """Decrypt an envelope-encrypted seed using GCP KMS."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if not ciphertext:
            raise ValueError("Cannot decrypt empty ciphertext.")

        try:
            blob_json = base64.b64decode(ciphertext)
            envelope = json.loads(blob_json)
        except (ValueError, json.JSONDecodeError) as e:
            raise KMSDecryptionError(f"Invalid envelope blob format: {e}") from e

        version = envelope.get("v")
        if version != _ENVELOPE_VERSION:
            raise KMSDecryptionError(
                f"Unsupported envelope version: {version} (expected {_ENVELOPE_VERSION})"
            )

        try:
            encrypted_dek = base64.b64decode(envelope["encrypted_dek"])
            iv = base64.b64decode(envelope["iv"])
            encrypted_seed = base64.b64decode(envelope["encrypted_seed"])
        except (KeyError, ValueError) as e:
            raise KMSDecryptionError(
                f"Malformed envelope blob — missing or invalid fields: {e}"
            ) from e

        client = self._get_client()
        try:
            response = client.decrypt(
                request={
                    "name": self._key_resource,
                    "ciphertext": encrypted_dek,
                }
            )
            plaintext_dek = bytearray(response.plaintext)
        except Exception as e:
            self._handle_gcp_error(e)
            raise KMSError(f"Failed to decrypt data key: {e}") from e

        try:
            aesgcm = AESGCM(bytes(plaintext_dek))
            seed = aesgcm.decrypt(iv, encrypted_seed, None)
            return bytes(seed)
        except Exception as e:
            raise KMSDecryptionError(
                f"Failed to decrypt seed with data key: {e}. "
                "The blob may be corrupted."
            ) from e
        finally:
            _zero_bytes(plaintext_dek)


class LocalKMSManager(BaseKMSManager):
    """
    Local fallback KMS manager for development environments without AWS.

    Uses Fernet symmetric encryption with a key derived from Django's SECRET_KEY.
    This is NOT suitable for production — it provides the same API surface
    so that development and testing workflows are identical.

    The Fernet key is derived via PBKDF2-HMAC-SHA256 from SECRET_KEY with a
    fixed salt, ensuring deterministic key derivation across restarts.
    """

    def __init__(self, secret_key: str):
        if not secret_key:
            raise KMSError("SECRET_KEY is required for local KMS fallback.")
        self._fernet_key = self._derive_fernet_key(secret_key)

    @staticmethod
    def _derive_fernet_key(secret_key: str) -> bytes:
        """Derive a 32-byte Fernet key from SECRET_KEY via PBKDF2."""
        dk = hashlib.pbkdf2_hmac(
            "sha256",
            secret_key.encode("utf-8"),
            b"cryptopay-local-kms-salt-v1",
            iterations=100_000,
            dklen=32,
        )
        return base64.urlsafe_b64encode(dk)

    def _get_fernet(self):
        """Create a Fernet instance."""
        from cryptography.fernet import Fernet
        return Fernet(self._fernet_key)

    def rotate_data_key(self) -> dict:
        """
        Generate a pseudo data key (local mode).

        In local mode, the 'encrypted_key' is just the Fernet-encrypted
        version of the random key. This mimics the KMS envelope pattern.
        """
        plaintext_key = os.urandom(32)
        fernet = self._get_fernet()
        encrypted_key = fernet.encrypt(plaintext_key)
        return {
            "plaintext_key": plaintext_key,
            "encrypted_key": encrypted_key,
        }

    def encrypt_seed(self, plaintext_seed: bytes) -> str:
        """Envelope-encrypt a seed using local Fernet."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if not plaintext_seed:
            raise ValueError("Cannot encrypt empty seed.")

        # Step 1: Generate a local data encryption key
        dek = self.rotate_data_key()
        plaintext_dek = bytearray(dek["plaintext_key"])
        encrypted_dek = dek["encrypted_key"]

        try:
            # Step 2: Encrypt seed with DEK using AES-256-GCM
            iv = os.urandom(12)
            aesgcm = AESGCM(bytes(plaintext_dek))
            encrypted_seed = aesgcm.encrypt(iv, plaintext_seed, None)

            # Step 3: Package as envelope blob.
            # `encrypted_dek` is already a Fernet token (URL-safe base64 bytes
            # returned by fernet.encrypt). Storing the raw token as a string
            # is correct — an extra base64 pass would make decrypt_seed fail
            # because Fernet.decrypt cannot parse a double-encoded token.
            envelope = {
                "v": _ENVELOPE_VERSION,
                "provider": "local-fernet",
                "encrypted_dek": encrypted_dek.decode("ascii"),
                "iv": base64.b64encode(iv).decode("ascii"),
                "encrypted_seed": base64.b64encode(encrypted_seed).decode("ascii"),
            }

            blob_json = json.dumps(envelope, separators=(",", ":"))
            return base64.b64encode(blob_json.encode("utf-8")).decode("ascii")

        finally:
            _zero_bytes(plaintext_dek)

    def decrypt_seed(self, ciphertext: str) -> bytes:
        """Decrypt an envelope-encrypted seed using local Fernet."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if not ciphertext:
            raise ValueError("Cannot decrypt empty ciphertext.")

        # Step 1: Decode the envelope
        try:
            blob_json = base64.b64decode(ciphertext)
            envelope = json.loads(blob_json)
        except (ValueError, json.JSONDecodeError) as e:
            raise KMSDecryptionError(
                f"Invalid envelope blob format: {e}"
            ) from e

        version = envelope.get("v")
        if version != _ENVELOPE_VERSION:
            raise KMSDecryptionError(
                f"Unsupported envelope version: {version} (expected {_ENVELOPE_VERSION})"
            )

        try:
            encrypted_dek = envelope["encrypted_dek"]
            iv = base64.b64decode(envelope["iv"])
            encrypted_seed = base64.b64decode(envelope["encrypted_seed"])
        except (KeyError, ValueError) as e:
            raise KMSDecryptionError(
                f"Malformed envelope blob — missing or invalid fields: {e}"
            ) from e

        # Step 2: Decrypt the DEK via Fernet
        fernet = self._get_fernet()
        try:
            # encrypted_dek is already a Fernet token (base64 string from encrypt)
            if isinstance(encrypted_dek, str):
                encrypted_dek = encrypted_dek.encode("utf-8")
            plaintext_dek = bytearray(fernet.decrypt(encrypted_dek))
        except Exception as e:
            raise KMSDecryptionError(
                f"Failed to decrypt local data key: {e}. "
                "SECRET_KEY may have changed since encryption."
            ) from e

        try:
            # Step 3: Decrypt the seed with the DEK
            aesgcm = AESGCM(bytes(plaintext_dek))
            seed = aesgcm.decrypt(iv, encrypted_seed, None)
            return bytes(seed)
        except Exception as e:
            raise KMSDecryptionError(
                f"Failed to decrypt seed with data key: {e}"
            ) from e
        finally:
            _zero_bytes(plaintext_dek)


class CachedSeedManager:
    """
    Wraps a KMS manager with in-memory seed caching and TTL-based expiry.

    The decrypted seed is cached to avoid hitting KMS on every address
    derivation. The cache expires after `ttl_seconds` (default 300 = 5 min),
    after which the next access re-decrypts from the envelope blob.

    The cached seed is stored as a bytearray so it can be zeroed on eviction.
    """

    def __init__(self, kms_manager: BaseKMSManager, ttl_seconds: int = 300):
        self._kms = kms_manager
        self._ttl = ttl_seconds
        self._cached_seed: Optional[bytearray] = None
        self._cached_at: float = 0.0

    @property
    def kms_manager(self) -> BaseKMSManager:
        """Expose underlying KMS manager for direct encrypt/rotate operations."""
        return self._kms

    def get_seed(self, encrypted_blob: str) -> bytes:
        """
        Get the decrypted seed, using cache if still valid.

        Args:
            encrypted_blob: Base64-encoded envelope blob.

        Returns:
            Raw seed bytes.
        """
        now = time.monotonic()

        if self._cached_seed is not None and (now - self._cached_at) < self._ttl:
            return bytes(self._cached_seed)

        # Cache miss or expired — evict old seed and decrypt
        self._evict()

        seed = self._kms.decrypt_seed(encrypted_blob)
        self._cached_seed = bytearray(seed)
        self._cached_at = now

        logger.debug(
            "Seed cache refreshed (TTL=%ds). Next refresh at +%ds.",
            self._ttl, self._ttl,
        )
        return bytes(self._cached_seed)

    def _evict(self) -> None:
        """Zero and discard the cached seed."""
        if self._cached_seed is not None:
            _zero_bytes(self._cached_seed)
            self._cached_seed = None
            self._cached_at = 0.0

    def invalidate(self) -> None:
        """Force-invalidate the cache (e.g., after key rotation)."""
        self._evict()
        logger.info("Seed cache invalidated.")


# Module-level singleton
_cached_manager: Optional[CachedSeedManager] = None


def get_kms_manager() -> CachedSeedManager:
    """
    Get the singleton CachedSeedManager, configured from Django settings.

    Settings:
      - KMS_ENABLED (bool):  Turn KMS on. Default False (LocalKMS fallback).
      - KMS_PROVIDER (str):  "aws" | "gcp". Default "aws". Selects the
                             cloud KMS implementation when KMS_ENABLED=True.
      - KMS_KEY_ID (str):    AWS KMS key ARN or alias. Required for AWS.
      - KMS_REGION (str):    AWS region. Default "af-south-1" (Cape Town).
      - KMS_KEY_RESOURCE     GCP KMS resource path:
        (str):                 projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>
                             Required for GCP.
      - KMS_SEED_CACHE_TTL:  Seed cache TTL in seconds. Default 300.

    Returns:
        CachedSeedManager wrapping the configured BaseKMSManager.
    """
    global _cached_manager

    if _cached_manager is not None:
        return _cached_manager

    kms_enabled = getattr(settings, "KMS_ENABLED", False)
    cache_ttl = getattr(settings, "KMS_SEED_CACHE_TTL", 300)

    if kms_enabled:
        provider = (getattr(settings, "KMS_PROVIDER", "aws") or "aws").lower()

        if provider == "aws":
            key_id = getattr(settings, "KMS_KEY_ID", "")
            region = getattr(settings, "KMS_REGION", "af-south-1")
            if not key_id:
                raise KMSError(
                    "KMS_ENABLED=True with KMS_PROVIDER=aws but KMS_KEY_ID "
                    "is not set. Provide the AWS KMS key ARN or alias."
                )
            manager = AWSKMSManager(key_id=key_id, region=region)
            logger.info(
                "KMS envelope encryption enabled (provider=aws, region=%s, "
                "key=%s...)", region, key_id[:20],
            )

        elif provider == "gcp":
            key_resource = getattr(settings, "KMS_KEY_RESOURCE", "")
            if not key_resource:
                raise KMSError(
                    "KMS_ENABLED=True with KMS_PROVIDER=gcp but "
                    "KMS_KEY_RESOURCE is not set. Provide the full resource "
                    "path: projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>"
                )
            manager = GCPKMSManager(key_resource=key_resource)
            # Log a redacted resource string · the project ID is
            # not strictly secret but treating it that way gives us
            # a defence-in-depth posture if logs land in a wide audience.
            redacted = "/".join(key_resource.split("/")[:6]) + "/.../<key>"
            logger.info(
                "KMS envelope encryption enabled (provider=gcp, key=%s)",
                redacted,
            )

        else:
            raise KMSError(
                f"Unknown KMS_PROVIDER={provider!r}. Supported: 'aws', 'gcp'."
            )
    else:
        secret_key = getattr(settings, "SECRET_KEY", "")
        manager = LocalKMSManager(secret_key=secret_key)
        logger.info("KMS disabled — using local Fernet fallback (development only).")

    _cached_manager = CachedSeedManager(kms_manager=manager, ttl_seconds=cache_ttl)
    return _cached_manager


def reset_kms_manager() -> None:
    """
    Reset the singleton manager. Used in tests and after settings changes.
    """
    global _cached_manager
    if _cached_manager is not None:
        _cached_manager.invalidate()
    _cached_manager = None
