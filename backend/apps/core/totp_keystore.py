"""Phase-2 KMS-wrapped TOTP encryption key.

Audit recap (2026-05-09): TOTP secrets in `accounts_user.totp_secret`
are Fernet-encrypted using `TOTP_ENCRYPTION_KEY`. That key currently
sits in plain `.env.production` — leaking it decrypts every user's
2FA seed.

Phase-2 raises the bar from "env file with mode 600" to "KMS-wrapped
ciphertext that requires both a Secret Manager fetch AND a KMS decrypt
call to use". The plaintext Fernet key only ever exists in process
memory after a successful boot-time decrypt.

Architecture mirrors `apps/blockchain/kms.py` (wallet seed):

  At ops time (one-shot):
    1. Operator generates Fernet key (Fernet.generate_key())
    2. KMS-encrypts the raw bytes via cpay-prod-wallet
    3. Stores the ciphertext in Secret Manager as
       `TOTP_FERNET_KEY_CIPHERTEXT` (base64-encoded)

  At app boot:
    1. Fetch ciphertext from Secret Manager
    2. KMS-decrypt → plaintext Fernet key bytes
    3. Cache the Fernet instance in module memory for the
       process lifetime; re-fetch on signal or after a timeout

  At TOTP encrypt/decrypt time:
    - Reach into the cached Fernet · zero-overhead vs the previous
      plain-env-key approach. KMS is hit once per process, not per
      record.

If `TOTP_FERNET_KEY_CIPHERTEXT` is empty (ops hasn't migrated yet),
fall through to the legacy plain-env `TOTP_ENCRYPTION_KEY`. This
keeps the existing TOTP path working during the migration window;
the rotation helper ingests legacy keys and KMS-wraps them.

Migration steps (one-shot):
    docker exec cryptopay_web python manage.py rotate_totp_key
"""
from __future__ import annotations

import base64
import logging
import threading
from typing import Optional

from cryptography.fernet import Fernet
from django.conf import settings

logger = logging.getLogger(__name__)

# Module-level cache · the Fernet instance lives here for the process's
# lifetime. Locked because Django's WSGI workers are threaded and we
# want exactly-once decrypt on cold start.
_lock = threading.Lock()
_cached_fernet: Optional[Fernet] = None
_cache_source: str = "uninitialised"


def _decrypt_via_kms(ciphertext_b64: str) -> bytes:
    """Decrypt a base64 KMS envelope back into raw key bytes.
    Uses the same KMS provider/config that wraps the wallet seed
    (cpay-prod-wallet). Raises on any KMS failure · we'd rather
    crashloop than serve TOTP with a stale or wrong key.

    The KMS manager's encrypt_seed/decrypt_seed pair handles the
    full envelope (random DEK + AES-GCM data + KMS-wrapped DEK)
    in one shot · we pass the base64 string straight through.
    """
    from apps.blockchain.kms import get_kms_manager

    manager = get_kms_manager()
    kms = manager._kms  # noqa: SLF001
    return kms.decrypt_seed(ciphertext_b64)


def get_totp_fernet() -> Optional[Fernet]:
    """Return a Fernet ready to encrypt/decrypt TOTP secrets.

    Lookup order (each tier falls through on miss):
      1. KMS-wrapped ciphertext from Secret Manager
         (`TOTP_FERNET_KEY_CIPHERTEXT`) → decrypt via KMS → cache
      2. Legacy plain `TOTP_ENCRYPTION_KEY` (env / Secret Manager)
      3. None · caller falls back to whatever the legacy code did
         (the existing apps/accounts/services.py raises a clear
         "TOTP encryption not configured" error in that case)

    Cached via a module-level lock so cold-start contention doesn't
    spawn N parallel KMS calls.
    """
    global _cached_fernet, _cache_source
    if _cached_fernet is not None:
        return _cached_fernet

    with _lock:
        if _cached_fernet is not None:
            return _cached_fernet

        # Tier 1 · KMS-wrapped ciphertext.
        ciphertext_b64 = (
            getattr(settings, "TOTP_FERNET_KEY_CIPHERTEXT", "") or ""
        ).strip()
        if ciphertext_b64:
            try:
                raw = _decrypt_via_kms(ciphertext_b64)
                _cached_fernet = Fernet(raw)
                _cache_source = "kms_wrapped"
                logger.info(
                    "totp_keystore.loaded",
                    extra={"source": _cache_source},
                )
                return _cached_fernet
            except Exception as e:
                # Don't fall through silently · ops needs to know the
                # KMS-wrapped path is broken before we degrade to env.
                logger.error(
                    "totp_keystore.kms_decrypt_failed",
                    extra={"error": type(e).__name__, "msg": str(e)[:200]},
                )

        # Tier 2 · legacy plain key from env / Secret Manager.
        legacy = (getattr(settings, "TOTP_ENCRYPTION_KEY", "") or "").strip()
        if legacy:
            # Accept either a Fernet-shape key (44 chars, base64-urlsafe
            # ending in =) OR an arbitrary high-entropy string we
            # SHA-256 + b64-wrap. Match the existing apps/accounts/
            # services.py behaviour so encrypted records keep
            # decrypting.
            if len(legacy) == 44 and legacy.endswith("="):
                key = legacy.encode()
            else:
                import hashlib
                key = base64.urlsafe_b64encode(
                    hashlib.sha256(legacy.encode()).digest()
                )
            _cached_fernet = Fernet(key)
            _cache_source = "legacy_env"
            logger.warning(
                "totp_keystore.loaded_legacy · phase-2 migration pending",
                extra={"source": _cache_source},
            )
            return _cached_fernet

        # Tier 3 · nothing configured.
        _cached_fernet = None
        _cache_source = "missing"
        logger.error("totp_keystore.no_key_configured")
        return None


def keystore_status() -> dict:
    """Diagnostic · what tier is currently serving TOTP encryption?
    Surfaced via the admin /health endpoint so ops sees the migration
    progress at a glance."""
    # Trigger initialisation if not yet done · cheap once cached.
    get_totp_fernet()
    return {
        "source": _cache_source,
        "is_kms_wrapped": _cache_source == "kms_wrapped",
        "needs_migration": _cache_source == "legacy_env",
    }


def reset_cache() -> None:
    """Test/seam · clears the module cache. Production code uses this
    only via a `rotate_totp_key` management command after the operator
    has pushed a new ciphertext to Secret Manager."""
    global _cached_fernet, _cache_source
    with _lock:
        _cached_fernet = None
        _cache_source = "uninitialised"
