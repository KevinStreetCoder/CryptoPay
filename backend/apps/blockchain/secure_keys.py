"""A14: Secure hot-wallet private-key loader.

Philosophy: signing-key material must never be a process-lifetime global.

Priority order at call time:
  1. KMS_ENABLED · decrypt `<CHAIN>_HOT_WALLET_ENCRYPTED` via KMS, return a
     `bytearray` that the caller can signal-clear after signing.
  2. DEBUG · read the plaintext env var (dev only · never permitted in
     production by the boot-time `_assert_production_env` check).
  3. Otherwise · refuse.

Callers should:

    from apps.blockchain.secure_keys import load_hot_wallet_key, wipe
    key = load_hot_wallet_key("tron")
    try:
        tx.sign(bytes(key))
    finally:
        wipe(key)

This pattern narrows the window during which the key exists in process
memory to the exact span of the signing call, and zeros the backing buffer
so subsequent heap dumps / core files / Sentry captures cannot retrieve it.

Pure-bytes are immutable in CPython so we can't zero them once leaked. Using
a `bytearray` here lets the caller overwrite every byte before GC runs.
"""
from __future__ import annotations

import logging
from typing import Dict

from django.conf import settings

logger = logging.getLogger(__name__)

# Env-var suffix lookup for the plaintext fallback. Keys are the `chain`
# identifiers used across the broadcast paths.
_PLAINTEXT_ENV_VARS: Dict[str, str] = {
    "tron": "TRON_HOT_WALLET_PRIVATE_KEY",
    "eth": "ETH_HOT_WALLET_PRIVATE_KEY",
    "ethereum": "ETH_HOT_WALLET_PRIVATE_KEY",
    "polygon": "POLYGON_HOT_WALLET_PRIVATE_KEY",
    "sol": "SOL_HOT_WALLET_PRIVATE_KEY",
    "solana": "SOL_HOT_WALLET_PRIVATE_KEY",
    "btc": "BTC_HOT_WALLET_PRIVATE_KEY",
    "bitcoin": "BTC_HOT_WALLET_PRIVATE_KEY",
}

_ENCRYPTED_ENV_VARS: Dict[str, str] = {
    "tron": "TRON_HOT_WALLET_ENCRYPTED",
    "eth": "ETH_HOT_WALLET_ENCRYPTED",
    "ethereum": "ETH_HOT_WALLET_ENCRYPTED",
    "polygon": "POLYGON_HOT_WALLET_ENCRYPTED",
    "sol": "SOL_HOT_WALLET_ENCRYPTED",
    "solana": "SOL_HOT_WALLET_ENCRYPTED",
    "btc": "BTC_HOT_WALLET_ENCRYPTED",
    "bitcoin": "BTC_HOT_WALLET_ENCRYPTED",
}


class HotWalletKeyMissing(RuntimeError):
    """Raised when no key source is configured for a chain."""


def _decrypt_via_kms(blob: str) -> bytearray:
    """Thin wrapper around the existing KMS manager. Returns a fresh
    `bytearray` · the caller is responsible for wiping it."""
    from apps.blockchain.kms import get_kms_manager

    manager = get_kms_manager()
    # get_seed is implemented as generic ciphertext decryption; we reuse it
    # here because the envelope format is identical.
    plaintext = manager.get_seed(blob)
    return bytearray(plaintext)


def load_hot_wallet_key(chain: str) -> bytearray:
    """Return a fresh `bytearray` holding the signing key for `chain`.

    Raises `HotWalletKeyMissing` if no configured source exists. The caller
    MUST call `wipe(ba)` after signing to zero the buffer.
    """
    chain_l = (chain or "").lower()

    # Option 1: KMS-encrypted blob (production-grade).
    if getattr(settings, "KMS_ENABLED", False):
        env_name = _ENCRYPTED_ENV_VARS.get(chain_l)
        if env_name:
            blob = getattr(settings, env_name, "")
            if blob:
                return _decrypt_via_kms(blob)

    # Option 2: plaintext env var (dev only).
    env_name = _PLAINTEXT_ENV_VARS.get(chain_l)
    if not env_name:
        raise HotWalletKeyMissing(f"No hot-wallet key mapping for chain '{chain}'")

    plaintext = getattr(settings, env_name, "")
    if not plaintext:
        raise HotWalletKeyMissing(
            f"{env_name} not configured. Set it in .env or provide a "
            f"KMS-encrypted {_ENCRYPTED_ENV_VARS.get(chain_l, '<encrypted-env>')} "
            "with KMS_ENABLED=True for production."
        )

    # Production must not ship with plaintext hot-wallet keys. The
    # `_assert_production_env` boot-time check will also fire, but we
    # defensively refuse here too · belt-and-braces.
    if not settings.DEBUG and not getattr(settings, "ALLOW_PLAINTEXT_HOT_WALLET", False):
        raise HotWalletKeyMissing(
            f"Refusing to load plaintext {env_name} in production. "
            "Encrypt with `python manage.py encrypt_hot_wallet_key --chain "
            f"{chain_l}` and set KMS_ENABLED=True."
        )

    # Hex is the canonical format for secp256k1 / ed25519 keys across
    # tronpy / web3.py / solders. Support both "0x…" and bare hex.
    s = plaintext.strip()
    if s.startswith("0x") or s.startswith("0X"):
        s = s[2:]
    try:
        return bytearray(bytes.fromhex(s))
    except ValueError:
        # Solana sometimes stores the keypair as a JSON array or base58.
        # Don't try to be clever · just return the raw bytes.
        return bytearray(plaintext.encode("utf-8"))


def wipe(ba: bytearray) -> None:
    """Zero the backing buffer of a `bytearray`. Safe to call multiple
    times · subsequent calls are no-ops if length becomes 0."""
    try:
        for i in range(len(ba)):
            ba[i] = 0
    except Exception:
        pass
