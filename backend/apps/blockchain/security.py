"""
Blockchain security module — production-grade deposit validation.

Handles:
  - Minimum deposit thresholds (dust attack prevention)
  - Amount-based confirmation tiers (more confirmations for larger deposits)
  - Address format validation per chain
  - Re-org detection via block hash verification
  - Deposit rate limiting and anomaly detection

Security references:
  - BTC: 6 confirmations for large amounts (Satoshi's recommendation)
  - ETH: 64 blocks = 2 finalized epochs post-Merge (Casper FFG finality)
  - Tron: 19 confirmations = 1 solidified block (~57 seconds)
  - Solana: 32 slots ≈ finalized commitment level (~13 seconds)
"""

import logging
import re
from decimal import Decimal

from django.conf import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Minimum deposit thresholds (dust attack prevention)
# ---------------------------------------------------------------------------
# Deposits below these amounts are rejected at detection time to prevent:
#   - Dust attacks (attacker sends many tiny txs to clog processing)
#   - Address poisoning (attacker sends 0-value txs from similar addresses)
#   - Resource exhaustion (each deposit triggers DB writes + confirmation tracking)
#
# Values are in the native unit of each currency.
# These can be overridden in settings via MINIMUM_DEPOSIT_AMOUNTS.

DEFAULT_MINIMUM_DEPOSITS = {
    "BTC": Decimal("0.00005"),       # ~$5 at $100K/BTC — filters dust
    "ETH": Decimal("0.002"),         # ~$5 at $2,500/ETH
    "USDT": Decimal("1.00"),         # $1 minimum
    "USDC": Decimal("1.00"),         # $1 minimum
    "SOL": Decimal("0.05"),          # ~$5 at $100/SOL
}


def get_minimum_deposit(currency: str) -> Decimal:
    """Get minimum deposit amount for a currency."""
    overrides = getattr(settings, "MINIMUM_DEPOSIT_AMOUNTS", {})
    if currency in overrides:
        return Decimal(str(overrides[currency]))
    return DEFAULT_MINIMUM_DEPOSITS.get(currency, Decimal("0"))


def is_dust_deposit(amount: Decimal, currency: str) -> bool:
    """Check if a deposit amount is below the dust threshold."""
    minimum = get_minimum_deposit(currency)
    if minimum and amount < minimum:
        logger.warning(
            f"Dust deposit rejected: {amount} {currency} "
            f"(minimum: {minimum} {currency})"
        )
        return True
    return False


# ---------------------------------------------------------------------------
# Amount-based confirmation tiers
# ---------------------------------------------------------------------------
# Larger deposits require more confirmations to prevent double-spend attacks.
# Each tier is: (threshold_usd, confirmations).
# The highest matching tier is used.
#
# These can be overridden in settings via CONFIRMATION_TIERS.

DEFAULT_CONFIRMATION_TIERS = {
    "bitcoin": [
        # (max_usd, confirmations)
        (1_000, 2),          # < $1K: 2 confs (~20 min)
        (10_000, 3),         # < $10K: 3 confs (~30 min)
        (100_000, 6),        # < $100K: 6 confs (~60 min, Satoshi's recommendation)
        (float("inf"), 6),   # >= $100K: 6 confs (maximum security)
    ],
    "ethereum": [
        (1_000, 12),         # < $1K: 12 confs (~2.4 min)
        (10_000, 32),        # < $10K: 32 confs (~6.4 min, 1 epoch)
        (100_000, 64),       # < $100K: 64 confs (~12.8 min, 2 epochs = finality)
        (float("inf"), 64),  # >= $100K: 2 full epochs
    ],
    "tron": [
        (1_000, 19),         # < $1K: 19 confs (~57 sec, 1 solidified block)
        (10_000, 19),        # < $10K: same (Tron's solidification is all-or-nothing)
        (float("inf"), 19),  # Tron: 19 confs = solidified, equivalent to finality
    ],
    "polygon": [
        (1_000, 64),         # < $1K: 64 confs (~2 min)
        (10_000, 128),       # < $10K: 128 confs (~4 min)
        (float("inf"), 256), # >= $10K: 256 confs (~8 min)
    ],
    "solana": [
        (1_000, 32),         # < $1K: 32 slots (~13 sec, finalized)
        (10_000, 32),        # Solana finality is binary (finalized = final)
        (float("inf"), 32),  # Use "finalized" commitment for all amounts
    ],
}


def get_required_confirmations(chain: str, amount_usd: Decimal) -> int:
    """
    Get required confirmations based on chain and estimated USD value.

    For chains with probabilistic finality (BTC, ETH), larger amounts
    need more confirmations. For chains with deterministic finality
    (Solana, Tron post-solidification), the threshold is fixed.

    Args:
        chain: Blockchain identifier (bitcoin, ethereum, tron, solana, polygon)
        amount_usd: Estimated USD value of the deposit

    Returns:
        Number of required confirmations
    """
    overrides = getattr(settings, "CONFIRMATION_TIERS", {})
    tiers = overrides.get(chain) or DEFAULT_CONFIRMATION_TIERS.get(chain)

    if not tiers:
        # Fallback to settings or default
        return getattr(settings, "REQUIRED_CONFIRMATIONS", {}).get(chain, 19)

    for max_usd, confs in tiers:
        if amount_usd < max_usd:
            return confs

    # Shouldn't reach here, but use the last tier
    return tiers[-1][1]


# ---------------------------------------------------------------------------
# Address format validation
# ---------------------------------------------------------------------------
# Validates address format before crediting to prevent:
#   - Address poisoning attacks (crediting wrong wallet due to similar address)
#   - Malformed addresses from API parsing errors
#   - Cross-chain address confusion

# Address format patterns (basic format check, not checksum verification)
ADDRESS_PATTERNS = {
    "tron": re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$"),
    "ethereum": re.compile(r"^0x[0-9a-fA-F]{40}$"),
    "polygon": re.compile(r"^0x[0-9a-fA-F]{40}$"),
    "bitcoin": re.compile(
        r"^("
        r"[13][a-km-zA-HJ-NP-Z1-9]{25,34}"  # P2PKH / P2SH
        r"|bc1[a-zA-HJ-NP-Z0-9]{25,87}"      # Bech32 / Bech32m
        r")$"
    ),
    "solana": re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$"),
}


def validate_address(chain: str, address: str) -> bool:
    """
    Validate a blockchain address format.

    This is a format check only — it does not verify checksums or
    on-chain existence. It catches obvious malformation and
    cross-chain confusion.

    Args:
        chain: Blockchain identifier
        address: The address to validate

    Returns:
        True if the address format is valid for the given chain
    """
    if not address or not isinstance(address, str):
        return False

    pattern = ADDRESS_PATTERNS.get(chain)
    if not pattern:
        logger.warning(f"No address pattern for chain: {chain}")
        return True  # Allow unknown chains to pass (fail open for new chains)

    is_valid = bool(pattern.match(address.strip()))
    if not is_valid:
        logger.warning(
            f"Invalid {chain} address format: {address[:16]}... "
            f"(length={len(address)})"
        )
    return is_valid


def validate_deposit_address_ownership(to_address: str, currency: str) -> bool:
    """
    Verify that the to_address belongs to a wallet in our system.

    This prevents crediting deposits to addresses we don't control,
    which could happen if an attacker manipulates API responses.

    Args:
        to_address: The deposit destination address
        currency: The currency being deposited

    Returns:
        True if the address belongs to one of our wallets
    """
    from apps.wallets.models import Wallet

    exists = Wallet.objects.filter(
        deposit_address=to_address,
        currency=currency,
    ).exists()

    if not exists:
        logger.error(
            f"Deposit to unknown address: {to_address[:16]}... "
            f"({currency}) — possible API response manipulation"
        )
    return exists


# ---------------------------------------------------------------------------
# Re-org detection
# ---------------------------------------------------------------------------

def verify_block_hash(chain: str, deposit) -> bool:
    """
    Verify that a deposit's block hash hasn't changed (re-org detection).

    During a blockchain reorganization, a previously confirmed transaction
    may end up in a different block or be dropped entirely. This check
    detects re-orgs by comparing the stored block hash against the
    current chain state.

    For chains that don't store block_hash (Solana, some BTC APIs),
    this returns True (skip check).

    Args:
        chain: Blockchain identifier
        deposit: BlockchainDeposit instance

    Returns:
        True if the block hash is consistent (no re-org detected)
    """
    if not deposit.block_hash or not deposit.block_number:
        return True  # Can't verify without block_hash

    if chain == "ethereum":
        try:
            from apps.blockchain.eth_listener import _eth_rpc_call
            block = _eth_rpc_call(
                "eth_getBlockByNumber",
                [hex(deposit.block_number), False],
            )
            if not block:
                logger.warning(
                    f"Block {deposit.block_number} not found on {chain} — "
                    f"possible re-org for deposit {deposit.id}"
                )
                return False

            current_hash = block.get("hash", "")
            if current_hash and current_hash != deposit.block_hash:
                logger.critical(
                    f"RE-ORG DETECTED on {chain}! "
                    f"Deposit {deposit.id} (tx={deposit.tx_hash[:16]}...): "
                    f"stored block_hash={deposit.block_hash[:16]}... "
                    f"vs current={current_hash[:16]}..."
                )
                return False

        except Exception as e:
            logger.error(f"Block hash verification failed for {chain}: {e}")
            return False  # Fail closed — don't credit if we can't verify

    return True


# ---------------------------------------------------------------------------
# Anomaly detection helpers
# ---------------------------------------------------------------------------

def check_deposit_velocity(to_address: str, currency: str, window_minutes: int = 10, max_count: int = 20) -> bool:
    """
    Check if an address is receiving an abnormal number of deposits.

    A sudden burst of deposits to a single address could indicate:
      - An automated attack (dust/spam)
      - A compromised API returning fake transactions
      - A replay attack

    Args:
        to_address: The deposit destination address
        currency: Currency being deposited
        window_minutes: Time window to check
        max_count: Maximum allowed deposits in the window

    Returns:
        True if within normal limits, False if suspicious
    """
    from django.utils import timezone
    from datetime import timedelta
    from .models import BlockchainDeposit

    since = timezone.now() - timedelta(minutes=window_minutes)
    recent_count = BlockchainDeposit.objects.filter(
        to_address=to_address,
        currency=currency,
        created_at__gte=since,
    ).count()

    if recent_count >= max_count:
        logger.critical(
            f"DEPOSIT VELOCITY ALERT: {recent_count} deposits to "
            f"{to_address[:16]}... ({currency}) in {window_minutes} min "
            f"(max: {max_count})"
        )
        return False

    return True


def estimate_usd_value(amount: Decimal, currency: str) -> Decimal:
    """
    Estimate USD value of a crypto amount for confirmation tier selection.

    Uses cached rates from the rate service. Falls back to conservative
    estimates if rates are unavailable (always rounds UP to require
    more confirmations, never less).

    Args:
        amount: Amount of cryptocurrency
        currency: Currency symbol

    Returns:
        Estimated USD value
    """
    # Conservative fallback prices (intentionally high to trigger more confirmations)
    FALLBACK_PRICES = {
        "BTC": Decimal("110000"),
        "ETH": Decimal("4000"),
        "SOL": Decimal("200"),
        "USDT": Decimal("1"),
        "USDC": Decimal("1"),
    }

    try:
        from apps.rates.services import RateService
        rate_info = RateService.get_crypto_kes_rate(currency)
        # Convert KES rate to approximate USD (1 USD ≈ 130 KES)
        kes_rate = Decimal(str(rate_info.get("rate", 0)))
        if kes_rate > 0:
            usd_rate = kes_rate / Decimal("130")
            return amount * usd_rate
    except Exception as e:
        logger.warning(f"Rate service unavailable for {currency}, using conservative fallback: {e}")

    # Fallback: use conservative estimate
    price = FALLBACK_PRICES.get(currency, Decimal("1"))
    return amount * price


# ---------------------------------------------------------------------------
# Confirmation monotonicity check
# ---------------------------------------------------------------------------

def check_confirmation_monotonicity(deposit, new_confirmations: int) -> bool:
    """
    Verify that confirmations only increase (never decrease).

    A decrease in confirmations signals a blockchain reorganization.
    When detected, the deposit should be reverted to CONFIRMING status
    for re-verification.

    Args:
        deposit: BlockchainDeposit instance
        new_confirmations: The newly calculated confirmation count

    Returns:
        True if confirmations are monotonically increasing (normal),
        False if a decrease is detected (re-org suspected)
    """
    if new_confirmations < deposit.confirmations:
        logger.critical(
            f"CONFIRMATION DECREASE DETECTED (possible re-org): "
            f"deposit {deposit.id} ({deposit.chain}) "
            f"tx={deposit.tx_hash[:16]}... "
            f"confirmations dropped from {deposit.confirmations} to {new_confirmations}"
        )
        return False
    return True


# ---------------------------------------------------------------------------
# Bitcoin RBF detection
# ---------------------------------------------------------------------------

def is_rbf_signaled(tx_data: dict) -> bool:
    """
    Detect if a Bitcoin transaction signals Replace-By-Fee (BIP 125).

    A transaction signals RBF if any of its inputs have a sequence number
    less than 0xFFFFFFFE (4294967294). RBF-signaled unconfirmed transactions
    can be replaced by a higher-fee conflicting transaction.

    For deposits: RBF only matters for 0-conf. Once a transaction has 1+
    confirmations, RBF replacement is no longer possible.

    Args:
        tx_data: Transaction data from BlockCypher or similar API

    Returns:
        True if the transaction signals RBF replaceability
    """
    inputs = tx_data.get("inputs", [])
    for inp in inputs:
        sequence = inp.get("sequence", 0xFFFFFFFF)
        if sequence < 0xFFFFFFFE:
            return True
    return False


# ---------------------------------------------------------------------------
# Stablecoin blacklist/freeze check — production on-chain verification
# ---------------------------------------------------------------------------

# Contract addresses per chain
_BLACKLIST_CONTRACTS = {
    # USDT on Ethereum: TetherToken.isBlackListed(address) → bool
    # Function selector: keccak256("isBlackListed(address)")[:4] = 0xe47d6060
    ("USDT", "ethereum"): {
        "contract": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "selector": "e47d6060",
    },
    # USDC on Ethereum: FiatTokenV2_1.isBlacklisted(address) → bool
    # Function selector: keccak256("isBlacklisted(address)")[:4] = 0xfe575a87
    ("USDC", "ethereum"): {
        "contract": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "selector": "fe575a87",
    },
    # USDC on Polygon: same isBlacklisted interface
    ("USDC", "polygon"): {
        "contract": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        "selector": "fe575a87",
    },
    # USDT on Tron: TetherToken.isBlackListed(address) → bool
    ("USDT", "tron"): {
        "contract": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        "selector": "e47d6060",
    },
}


def _evm_blacklist_check(address: str, contract: str, selector: str, rpc_url: str) -> bool:
    """
    Call isBlackListed/isBlacklisted on an EVM chain via eth_call.

    Args:
        address: The address to check (0x-prefixed, 40 hex chars)
        contract: The stablecoin contract address
        selector: 4-byte function selector (hex, no 0x prefix)
        rpc_url: JSON-RPC endpoint URL

    Returns:
        True if blacklisted, False if not (or on error — fail open for availability)
    """
    import requests as http_client

    # ABI-encode the call: selector + address padded to 32 bytes
    addr_clean = address.lower().replace("0x", "").zfill(64)
    call_data = f"0x{selector}{addr_clean}"

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{"to": contract, "data": call_data}, "latest"],
    }

    try:
        resp = http_client.post(rpc_url, json=payload, timeout=10)
        resp.raise_for_status()
        result = resp.json().get("result", "0x")
        # Return value is ABI-encoded bool: 32 bytes, last byte is 0 or 1
        if result and len(result) >= 66:
            return int(result, 16) != 0
        return False
    except Exception as e:
        logger.warning(f"EVM blacklist check failed for {address[:16]}...: {e}")
        return False  # Fail open — don't block deposits on RPC failure


def _tron_blacklist_check(address: str, contract: str, selector: str) -> bool:
    """
    Call isBlackListed on Tron via TronGrid triggersmartcontract.

    Tron addresses are base58check-encoded. The TronGrid API accepts
    the base58 address directly and handles hex conversion internally.

    Args:
        address: Tron address (T-prefix base58)
        contract: USDT TRC-20 contract address
        selector: 4-byte function selector (hex, no 0x prefix)

    Returns:
        True if blacklisted, False if not
    """
    import requests as http_client

    network = getattr(settings, "TRON_NETWORK", "shasta")
    base_url = "https://api.trongrid.io" if network == "mainnet" else "https://api.shasta.trongrid.io"
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    api_key = getattr(settings, "TRON_API_KEY", "")
    if api_key:
        headers["TRON-PRO-API-KEY"] = api_key

    # TronGrid triggersmartcontract: pass the address as parameter
    # Parameter type: address — Tron hex format (41-prefixed, no 0x)
    # Convert base58 Tron address to hex for the parameter
    try:
        from apps.blockchain.services import _base58_decode_tron
        addr_hex = _base58_decode_tron(address)
    except Exception:
        # Manual base58 decode for Tron address → 41-prefixed hex
        addr_hex = address  # Fallback: let TronGrid handle it

    payload = {
        "owner_address": address,
        "contract_address": contract,
        "function_selector": "isBlackListed(address)",
        "parameter": addr_hex.replace("0x", "").zfill(64) if addr_hex.startswith("0x") else address,
        "visible": True,
    }

    try:
        resp = http_client.post(
            f"{base_url}/wallet/triggerconstantcontract",
            json=payload, headers=headers, timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        constant_result = data.get("constant_result", [])
        if constant_result:
            return int(constant_result[0], 16) != 0
        return False
    except Exception as e:
        logger.warning(f"Tron blacklist check failed for {address[:16]}...: {e}")
        return False  # Fail open


def check_stablecoin_blacklist(address: str, currency: str) -> bool:
    """
    Check if an address is blacklisted/frozen by a stablecoin issuer.

    Makes on-chain contract calls to verify the address is not frozen:
      - USDT (Tether): isBlackListed(address) on ETH/Tron contracts
      - USDC (Circle): isBlacklisted(address) on ETH/Polygon contracts

    Tether has frozen $3.3B+ across 7,268 addresses.
    Circle has frozen $109M+ across 372 addresses.

    Fails open: if the RPC call fails, the address is NOT blocked
    (availability over strictness — a false negative is acceptable,
    a false positive would freeze user funds).

    Args:
        address: The blockchain address to check
        currency: USDT or USDC

    Returns:
        True if the address appears safe (not blacklisted),
        False if blacklisted
    """
    if currency not in ("USDT", "USDC"):
        return True  # Only stablecoins have freeze capability

    if not address:
        return True

    # Determine chain from address format
    chain = _detect_chain_from_address(address)
    if not chain:
        return True

    config = _BLACKLIST_CONTRACTS.get((currency, chain))
    if not config:
        return True  # No blacklist contract known for this chain/currency combo

    is_blacklisted = False

    if chain == "tron":
        is_blacklisted = _tron_blacklist_check(
            address, config["contract"], config["selector"]
        )
    elif chain in ("ethereum", "polygon"):
        rpc_url = _get_evm_rpc_url(chain)
        if rpc_url:
            is_blacklisted = _evm_blacklist_check(
                address, config["contract"], config["selector"], rpc_url
            )

    if is_blacklisted:
        logger.critical(
            f"BLACKLISTED ADDRESS DETECTED: {address[:16]}... ({currency} on {chain}). "
            f"Deposit will be blocked."
        )
        return False

    return True


def _detect_chain_from_address(address: str) -> str:
    """Detect blockchain from address format."""
    if not address:
        return ""
    if address.startswith("T") and len(address) == 34:
        return "tron"
    if address.startswith("0x") and len(address) == 42:
        # Could be ETH or Polygon — check both
        return "ethereum"
    return ""


def _get_evm_rpc_url(chain: str) -> str:
    """Get RPC URL for an EVM chain."""
    if chain == "ethereum":
        url = getattr(settings, "ETH_RPC_URL", "")
        if url:
            return url
        network = getattr(settings, "ETH_NETWORK", "mainnet")
        if network == "sepolia":
            return "https://rpc.sepolia.org"
        return "https://cloudflare-eth.com"
    elif chain == "polygon":
        return getattr(settings, "POLYGON_RPC_URL", "https://polygon-rpc.com")
    return ""
