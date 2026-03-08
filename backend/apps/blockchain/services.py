"""
Blockchain services for address generation and deposit monitoring.

MVP: Deterministic address generation using HMAC derivation.
Production: Replace with HD wallet (BIP-32/44) or custodial API (Fireblocks).
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

# Base58 alphabet (Bitcoin)
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


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


def generate_deposit_address(user_id: str, currency: str, address_index: int) -> str:
    """
    Generate a deterministic deposit address for a user + currency + index.

    MVP: Uses HMAC-SHA256 to derive a deterministic but unique address per user.
    This is NOT cryptographically secure for real blockchain use - it generates
    realistic-looking addresses for development and testing.

    In production, replace with:
    - HD wallet derivation (BIP-32/44) for self-custodied wallets
    - Fireblocks/BitGo API for institutional custody
    - TronGrid/Infura for address generation
    """
    chain = CHAIN_MAP.get(currency, "tron")
    seed = getattr(settings, "SECRET_KEY", "dev-secret-key")

    # Deterministic derivation: HMAC(secret, user_id + currency + index)
    message = f"{user_id}:{currency}:{address_index}".encode()
    derived = hmac.new(seed.encode(), message, hashlib.sha256).digest()

    if chain == "tron":
        # Tron addresses: 'T' + 33 chars (base58)
        addr_bytes = b"\x41" + derived[:20]  # 0x41 = Tron mainnet prefix
        # Add checksum
        checksum = hashlib.sha256(hashlib.sha256(addr_bytes).digest()).digest()[:4]
        return _base58_encode(addr_bytes + checksum)

    elif chain == "ethereum" or chain == "polygon":
        # Ethereum/Polygon addresses: '0x' + 40 hex chars
        return "0x" + derived[:20].hex()

    elif chain == "bitcoin":
        # Bitcoin addresses (P2PKH): '1' or '3' + base58
        addr_bytes = b"\x00" + derived[:20]
        checksum = hashlib.sha256(hashlib.sha256(addr_bytes).digest()).digest()[:4]
        return _base58_encode(addr_bytes + checksum)

    elif chain == "solana":
        # Solana addresses: base58 encoded 32-byte public key
        return _base58_encode(derived[:32])

    # Fallback
    return "0x" + derived[:20].hex()


def get_next_address_index(user_id: str, currency: str) -> int:
    """Get the next available address index for a user + currency."""
    from apps.wallets.models import Wallet

    wallet = Wallet.objects.filter(user_id=user_id, currency=currency).first()
    if wallet and wallet.address_index is not None:
        return wallet.address_index + 1
    return 0
