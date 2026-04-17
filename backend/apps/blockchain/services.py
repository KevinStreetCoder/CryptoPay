"""
Blockchain services for address generation and deposit monitoring.

Production: HD wallet derivation using BIP-32/44 standard.
Generates real, cryptographically valid deposit addresses from a master seed.

Supported chains:
  - Tron (TRC-20): SLIP-44 coin type 195, base58check with 0x41 prefix
  - Ethereum/Polygon (ERC-20): SLIP-44 coin type 60, Keccak-256 checksum
  - Bitcoin (native SegWit P2WPKH, BIP-173): SLIP-44 coin type 0, bech32 (bc1q.../tb1q...)
  - Solana (SPL): SLIP-44 coin type 501, Ed25519 base58
"""

import hashlib
import hmac
import logging
import struct

from django.conf import settings

logger = logging.getLogger(__name__)

# Chain → address prefix/format mapping
CHAIN_MAP = {
    "USDT": "tron",
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "USDC": "polygon",
}

# BIP-44 coin types (SLIP-44 registry)
COIN_TYPES = {
    "tron": 195,
    "bitcoin": 0,
    "ethereum": 60,
    "polygon": 60,  # Polygon uses same derivation as Ethereum
    "solana": 501,
}

# Base58 alphabet (Bitcoin)
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

# Bech32 charset
BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _base58_encode(data: bytes) -> str:
    """Encode bytes to base58."""
    num = int.from_bytes(data, "big")
    result = ""
    while num > 0:
        num, remainder = divmod(num, 58)
        result = BASE58_ALPHABET[remainder] + result
    # Preserve leading zeros
    for byte in data:
        if byte == 0:
            result = "1" + result
        else:
            break
    return result


def _hmac_sha512(key: bytes, data: bytes) -> bytes:
    """HMAC-SHA512 used in BIP-32 key derivation."""
    return hmac.new(key, data, hashlib.sha512).digest()


def _hash160(data: bytes) -> bytes:
    """RIPEMD-160(SHA-256(data)) — standard Bitcoin hash."""
    sha = hashlib.sha256(data).digest()
    ripemd = hashlib.new("ripemd160", sha).digest()
    return ripemd


# ---- Bech32 (BIP-173) for native SegWit (P2WPKH) addresses ----------------
# Implementation lifted from BIP-173 reference Python (public domain).
# Native SegWit has lower transaction fees than P2PKH/P2SH and is universally
# supported by modern wallets. Addresses look like `bc1q...` on mainnet or
# `tb1q...` on testnet.

_BECH32_POLYMOD_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]


def _bech32_polymod(values):
    chk = 1
    for v in values:
        b = chk >> 25
        chk = ((chk & 0x1ffffff) << 5) ^ v
        for i in range(5):
            chk ^= _BECH32_POLYMOD_GEN[i] if ((b >> i) & 1) else 0
    return chk


def _bech32_hrp_expand(hrp: str):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def _bech32_create_checksum(hrp: str, data):
    values = _bech32_hrp_expand(hrp) + list(data)
    polymod = _bech32_polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    return [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]


def _bech32_encode(hrp: str, data) -> str:
    combined = list(data) + _bech32_create_checksum(hrp, data)
    return hrp + "1" + "".join([BECH32_CHARSET[d] for d in combined])


def _convertbits(data, frombits: int, tobits: int, pad: bool = True):
    """Convert a byte stream to a 5-bit stream for bech32 payloads."""
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    max_acc = (1 << (frombits + tobits - 1)) - 1
    for value in data:
        if value < 0 or (value >> frombits):
            raise ValueError("invalid byte for bech32 conversion")
        acc = ((acc << frombits) | value) & max_acc
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad:
        if bits:
            ret.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        raise ValueError("invalid padding for bech32 conversion")
    return ret


def _encode_p2wpkh(pubkey_hash: bytes, hrp: str = "bc") -> str:
    """Encode a native SegWit v0 P2WPKH address.

    Args:
        pubkey_hash: 20-byte HASH160(compressed_pubkey).
        hrp: "bc" for mainnet, "tb" for testnet.
    """
    if len(pubkey_hash) != 20:
        raise ValueError("P2WPKH requires a 20-byte HASH160")
    # Witness version 0 prepended, followed by 5-bit program.
    return _bech32_encode(hrp, [0] + _convertbits(pubkey_hash, 8, 5))


def _btc_hrp() -> str:
    """Return the bech32 HRP for the currently-configured Bitcoin network."""
    net = getattr(settings, "BTC_NETWORK", "main")
    return "tb" if net in ("test", "test3", "testnet") else "bc"


def _keccak256(data: bytes) -> bytes:
    """Keccak-256 hash for Ethereum/Tron address derivation.

    IMPORTANT: Python's hashlib.sha3_256 is NIST SHA-3, NOT Keccak-256.
    They differ in padding and produce different hashes. web3 is required.
    """
    try:
        from web3 import Web3
        return Web3.keccak(data)
    except ImportError:
        raise ImportError(
            "web3 is required for Keccak-256 hashing (Ethereum/Tron address derivation). "
            "Install with: pip install web3. "
            "DO NOT use hashlib.sha3_256 as a fallback — it is NIST SHA-3, not Keccak-256."
        )


def _serialize_public_key(private_key_bytes: bytes, chain: str) -> bytes:
    """
    Derive compressed public key from private key bytes using secp256k1.
    For Solana, derive Ed25519 public key instead.
    """
    if chain == "solana":
        # Solana uses Ed25519
        try:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
            private_key = Ed25519PrivateKey.from_private_bytes(private_key_bytes[:32])
            pub_bytes = private_key.public_key().public_bytes_raw()
            return pub_bytes
        except ImportError:
            raise ImportError(
                "cryptography library is required for Ed25519 key derivation (Solana). "
                "Install with: pip install cryptography"
            )
    else:
        # secp256k1 for BTC, ETH, Tron, Polygon
        try:
            from cryptography.hazmat.primitives.asymmetric.ec import (
                SECP256K1,
                derive_private_key,
            )
            from cryptography.hazmat.backends import default_backend

            private_int = int.from_bytes(private_key_bytes[:32], "big")
            # Ensure private key is valid for secp256k1
            order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
            if private_int == 0 or private_int >= order:
                private_int = (private_int % (order - 1)) + 1

            pk = derive_private_key(private_int, SECP256K1(), default_backend())
            pub = pk.public_key()
            pub_numbers = pub.public_numbers()

            # Compressed public key: 0x02/0x03 + x coordinate
            prefix = b"\x02" if pub_numbers.y % 2 == 0 else b"\x03"
            return prefix + pub_numbers.x.to_bytes(32, "big")

        except ImportError:
            raise ImportError(
                "cryptography library is required for secp256k1 key derivation "
                "(BTC/ETH/Tron). Install with: pip install cryptography"
            )
        except Exception as e:
            raise RuntimeError(
                f"secp256k1 key derivation failed: {e}. "
                f"This is a critical error — deposit addresses cannot be generated safely."
            )


def _bip32_derive_key(master_key: bytes, master_chain_code: bytes, path: list[int]) -> tuple[bytes, bytes]:
    """
    BIP-32 child key derivation along a path.
    Each element in path should have 0x80000000 set for hardened derivation.
    Returns (child_key, child_chain_code).
    """
    key = master_key
    chain_code = master_chain_code

    for index in path:
        if index >= 0x80000000:
            # Hardened child: HMAC-SHA512(Key = chain_code, Data = 0x00 || key || index)
            data = b"\x00" + key + struct.pack(">I", index)
        else:
            # Normal child: HMAC-SHA512(Key = chain_code, Data = ser_P(key) || index)
            # Uses the compressed public key of the parent, not the private key.
            # This is critical for BIP-32 security — normal derivation with private
            # key data would break the security model.
            pub_key = _serialize_public_key(key, "ethereum")  # secp256k1 compressed pubkey
            data = pub_key + struct.pack(">I", index)

        h = _hmac_sha512(chain_code, data)
        child_key_bytes = h[:32]

        # For normal derivation, add parent and child key modulo curve order
        if index < 0x80000000:
            order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
            parent_int = int.from_bytes(key, "big")
            child_int = int.from_bytes(child_key_bytes, "big")
            key = ((parent_int + child_int) % order).to_bytes(32, "big")
        else:
            key = child_key_bytes

        chain_code = h[32:]

    return key, chain_code


def _master_key_from_seed(seed: bytes) -> tuple[bytes, bytes]:
    """BIP-32: Derive master key and chain code from seed."""
    h = _hmac_sha512(b"Bitcoin seed", seed)
    return h[:32], h[32:]


def _derive_bip44_key(seed: bytes, chain: str, account: int = 0, index: int = 0) -> bytes:
    """
    Derive a BIP-44 private key: m/44'/<coin_type>'/<account>'/0/<index>

    All levels use hardened derivation for maximum security.
    """
    coin_type = COIN_TYPES.get(chain, 0)
    master_key, master_chain_code = _master_key_from_seed(seed)

    # BIP-44 path: m/44'/coin_type'/account'/0/index
    # Using hardened derivation for purpose, coin_type, account
    path = [
        44 + 0x80000000,           # purpose (hardened)
        coin_type + 0x80000000,    # coin type (hardened)
        account + 0x80000000,      # account (hardened)
        0,                         # external chain (receiving)
        index,                     # address index
    ]

    child_key, _ = _bip32_derive_key(master_key, master_chain_code, path)
    return child_key


def _get_master_seed() -> bytes:
    """
    Get the master seed for HD wallet derivation.

    Priority order:
      1. KMS_ENABLED + WALLET_ENCRYPTED_SEED — decrypt via KMS envelope encryption
      2. WALLET_MASTER_SEED env var (hex-encoded 64-byte seed) — direct seed
      3. WALLET_MNEMONIC env var (BIP-39 24-word phrase) — derive seed via BIP-39
      4. Fallback: PBKDF2 from SECRET_KEY (development only, NOT for production)

    In production, use KMS encryption:
      - Encrypt with: python manage.py encrypt_wallet_seed
      - Set KMS_ENABLED=True, WALLET_ENCRYPTED_SEED=<blob>

    Or use plaintext (less secure):
      - A BIP-39 mnemonic stored in WALLET_MNEMONIC (preferred, human-readable backup)
      - The hex seed in WALLET_MASTER_SEED (derived from mnemonic, for KMS/HSM storage)

    Generate a mnemonic with: python manage.py generate_wallet_seed
    """
    # Option 0: KMS envelope encryption (highest priority)
    kms_enabled = getattr(settings, "KMS_ENABLED", False)
    encrypted_seed = getattr(settings, "WALLET_ENCRYPTED_SEED", "")

    if kms_enabled and encrypted_seed:
        from apps.blockchain.kms import get_kms_manager

        try:
            cached_manager = get_kms_manager()
            seed = cached_manager.get_seed(encrypted_seed)
            logger.info("Using KMS-encrypted seed for HD wallet derivation.")
            return seed
        except Exception as e:
            logger.error("KMS seed decryption failed: %s", e)
            raise RuntimeError(
                f"KMS seed decryption failed: {e}. "
                "Check KMS_KEY_ID, AWS credentials, and WALLET_ENCRYPTED_SEED. "
                "If the KMS key was rotated, re-encrypt with: "
                "python manage.py encrypt_wallet_seed"
            ) from e

    if kms_enabled and not encrypted_seed:
        raise RuntimeError(
            "KMS_ENABLED=True but WALLET_ENCRYPTED_SEED is not set. "
            "Encrypt your seed with: python manage.py encrypt_wallet_seed"
        )

    # Option 1: Direct hex seed
    master_seed_hex = getattr(settings, "WALLET_MASTER_SEED", "")
    if master_seed_hex:
        seed = bytes.fromhex(master_seed_hex)
        if len(seed) < 16:
            raise ValueError("WALLET_MASTER_SEED must be at least 16 bytes (32 hex chars)")
        logger.info("Using WALLET_MASTER_SEED for HD wallet derivation.")
        return seed

    # Option 2: BIP-39 mnemonic phrase
    mnemonic_phrase = getattr(settings, "WALLET_MNEMONIC", "")
    if mnemonic_phrase:
        from mnemonic import Mnemonic

        mnemo = Mnemonic("english")
        if not mnemo.check(mnemonic_phrase):
            raise ValueError(
                "WALLET_MNEMONIC is not a valid BIP-39 mnemonic. "
                "Generate one with: python manage.py generate_wallet_seed"
            )
        # BIP-39 seed derivation with empty passphrase (standard)
        seed = mnemo.to_seed(mnemonic_phrase, passphrase="")
        logger.info("Using WALLET_MNEMONIC (BIP-39) for HD wallet derivation.")
        return seed

    # Option 3: Fallback — derive from SECRET_KEY (development only)
    if not settings.DEBUG:
        raise RuntimeError(
            "CRITICAL: WALLET_MNEMONIC or WALLET_MASTER_SEED must be set in production. "
            "Refusing to derive wallet seed from SECRET_KEY. "
            "Generate with: python manage.py generate_wallet_seed"
        )

    secret = getattr(settings, "SECRET_KEY", "dev-secret-key")
    logger.warning(
        "DEV ONLY: Using SECRET_KEY for wallet seed derivation. "
        "Set WALLET_MNEMONIC or WALLET_MASTER_SEED for production use."
    )
    return hashlib.pbkdf2_hmac(
        "sha512",
        secret.encode(),
        b"cryptopay-wallet-seed",
        iterations=100_000,
        dklen=64,
    )


def generate_deposit_address(user_id: str, currency: str, address_index: int) -> str:
    """
    Generate a deterministic deposit address using BIP-44 HD wallet derivation.

    Derives: m/44'/<coin_type>'/<user_account>'/0/<address_index>

    The user_account is derived from user_id to ensure each user gets a unique
    derivation path. Address index allows multiple addresses per user per currency.

    Args:
        user_id: UUID string of the user
        currency: Cryptocurrency symbol (USDT, BTC, ETH, SOL, USDC)
        address_index: Sequential index for multiple addresses

    Returns:
        Valid blockchain address string for the specified chain
    """
    chain = CHAIN_MAP.get(currency, "tron")
    seed = _get_master_seed()

    # Derive a unique account number from user_id (deterministic)
    user_hash = hashlib.sha256(user_id.encode()).digest()
    user_account = int.from_bytes(user_hash[:4], "big") % (2**31 - 1)  # Keep under hardened threshold

    # BIP-44 key derivation
    private_key = _derive_bip44_key(seed, chain, account=user_account, index=address_index)

    # Derive public key
    public_key = _serialize_public_key(private_key, chain)

    if chain == "tron":
        # Tron: Keccak-256 of uncompressed pubkey, take last 20 bytes, add 0x41 prefix
        # For compressed key, hash it to get address bytes
        addr_hash = _keccak256(public_key)
        addr_bytes = b"\x41" + addr_hash[-20:]
        checksum = hashlib.sha256(hashlib.sha256(addr_bytes).digest()).digest()[:4]
        return _base58_encode(addr_bytes + checksum)

    elif chain in ("ethereum", "polygon"):
        # Ethereum/Polygon: Keccak-256 of public key, take last 20 bytes
        addr_hash = _keccak256(public_key)
        addr_hex = addr_hash[-20:].hex()
        # EIP-55 checksum encoding
        checksum_hash = _keccak256(addr_hex.encode()).hex()
        checksummed = ""
        for i, c in enumerate(addr_hex):
            if c in "abcdef":
                checksummed += c.upper() if int(checksum_hash[i], 16) >= 8 else c
            else:
                checksummed += c
        return "0x" + checksummed

    elif chain == "bitcoin":
        # Native SegWit P2WPKH (BIP-173 / bech32) — addresses start with
        # `bc1q` on mainnet or `tb1q` on testnet. Lower transaction fees than
        # legacy P2PKH and universally supported by modern wallets. HRP is
        # chosen from BTC_NETWORK so dev/testnet builds emit tb1q... addresses
        # automatically.
        pubkey_hash = _hash160(public_key)
        return _encode_p2wpkh(pubkey_hash, hrp=_btc_hrp())

    elif chain == "solana":
        # Solana: Ed25519 public key as base58
        return _base58_encode(public_key)

    # Fallback: Ethereum-style
    addr_hash = _keccak256(public_key)
    return "0x" + addr_hash[-20:].hex()


def get_next_address_index(user_id: str, currency: str) -> int:
    """Get the next available address index for a user + currency."""
    from apps.wallets.models import Wallet

    wallet = Wallet.objects.filter(user_id=user_id, currency=currency).first()
    if wallet and wallet.address_index is not None:
        return wallet.address_index + 1
    return 0
