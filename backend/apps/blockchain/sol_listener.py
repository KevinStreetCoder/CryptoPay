"""
Solana deposit listener.

Monitors SOL and SPL token (USDC) deposits using Solana JSON-RPC.
Uses getSignaturesForAddress and getTransaction for deposit detection.

Solana RPC rate limits:
  - Public: 40 req/10s (devnet), 100 req/10s (mainnet)
  - Helius free: 100K credits/day
  - QuickNode/Alchemy: varies by plan
"""

import logging
from decimal import Decimal

import requests
from celery import shared_task
from django.conf import settings

from apps.wallets.models import Wallet

from .models import BlockchainDeposit
from .security import check_confirmation_monotonicity, is_dust_deposit, estimate_usd_value, get_required_confirmations

logger = logging.getLogger(__name__)

# USDC SPL Token mint addresses
USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"

# SOL has 9 decimals, USDC SPL has 6 decimals
SOL_DECIMALS = 9
USDC_DECIMALS = 6


def _get_sol_rpc_url() -> str:
    """Get Solana RPC URL from settings."""
    url = getattr(settings, "SOL_RPC_URL", "")
    if url:
        return url
    network = getattr(settings, "SOL_NETWORK", "devnet")
    if network == "mainnet-beta":
        return "https://api.mainnet-beta.solana.com"
    return "https://api.devnet.solana.com"


def _get_usdc_mint() -> str:
    """Get USDC mint address based on network."""
    network = getattr(settings, "SOL_NETWORK", "devnet")
    return USDC_MINT_MAINNET if network == "mainnet-beta" else USDC_MINT_DEVNET


def _sol_rpc_call(method: str, params: list) -> dict:
    """Make a JSON-RPC call to the Solana node."""
    url = _get_sol_rpc_url()
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    response = requests.post(url, json=payload, timeout=15)
    response.raise_for_status()
    result = response.json()
    if "error" in result:
        raise Exception(f"Solana RPC error: {result['error']}")
    return result.get("result")


@shared_task
def monitor_sol_deposits():
    """
    Monitor SOL and USDC SPL deposits on Solana.

    For each Solana deposit address:
    1. Query recent signatures via getSignaturesForAddress
    2. Fetch transaction details for new signatures
    3. Parse SOL transfers and SPL token transfers
    4. Create BlockchainDeposit records
    """
    from django.core.cache import cache

    # Get all Solana deposit addresses (SOL addresses are base58, not starting with 0x or T)
    sol_wallets = list(
        Wallet.objects.filter(
            currency__in=["SOL", "USDC"],
            deposit_address__gt="",
        )
        .exclude(deposit_address__startswith="0x")
        .exclude(deposit_address__startswith="T")
        .exclude(deposit_address__startswith="1")  # Exclude BTC P2PKH
        .exclude(deposit_address__startswith="3")  # Exclude BTC P2SH
        .exclude(deposit_address__startswith="bc1")  # Exclude BTC bech32
        .values_list("deposit_address", flat=True)
        .distinct()
    )

    if not sol_wallets:
        return

    required_confirmations = settings.REQUIRED_CONFIRMATIONS.get("solana", 32)
    usdc_mint = _get_usdc_mint()

    for address in sol_wallets:
        try:
            # Get last known signature for this address (high-water mark)
            # Priority: 1) Redis cache, 2) latest tx_hash from DB for this address
            cache_key = f"sol:last_sig:{address[:16]}"
            last_sig = cache.get(cache_key)
            if not last_sig:
                # Fall back to the most recent deposit tx_hash for this address,
                # so a Redis restart doesn't cause re-scanning from scratch.
                latest_deposit = (
                    BlockchainDeposit.objects.filter(
                        chain="solana", to_address=address
                    )
                    .order_by("-block_number")
                    .values_list("tx_hash", flat=True)
                    .first()
                )
                if latest_deposit:
                    # Strip any suffix (e.g. ":USDC:0") to get the raw signature
                    last_sig = latest_deposit.split(":")[0]

            # Query recent signatures
            sig_params = [
                address,
                {
                    "limit": 20,
                    "commitment": "finalized",
                },
            ]
            if last_sig:
                sig_params[1]["until"] = last_sig

            signatures = _sol_rpc_call("getSignaturesForAddress", sig_params)
            if not signatures:
                continue

            # Update high-water mark
            if signatures:
                cache.set(cache_key, signatures[0]["signature"], timeout=86400)

            for sig_info in signatures:
                tx_sig = sig_info.get("signature", "")
                if not tx_sig:
                    continue

                # Skip failed transactions
                if sig_info.get("err") is not None:
                    continue

                # Skip if already tracked
                if BlockchainDeposit.objects.filter(
                    chain="solana", tx_hash=tx_sig
                ).exists():
                    continue

                # Fetch full transaction
                try:
                    tx_data = _sol_rpc_call(
                        "getTransaction",
                        [
                            tx_sig,
                            {
                                "encoding": "jsonParsed",
                                "commitment": "finalized",
                                "maxSupportedTransactionVersion": 0,
                            },
                        ],
                    )
                except Exception as e:
                    logger.warning(f"Failed to fetch SOL tx {tx_sig[:16]}...: {e}")
                    continue

                if not tx_data:
                    continue

                slot = tx_data.get("slot", 0)
                block_time = sig_info.get("blockTime")
                meta = tx_data.get("meta", {})
                if not meta:
                    continue

                # Check for SOL transfer
                _check_sol_transfer(
                    tx_data, tx_sig, address, slot,
                    required_confirmations, meta,
                )

                # Check for SPL token (USDC) transfer
                _check_spl_transfer(
                    tx_data, tx_sig, address, slot,
                    required_confirmations, meta, usdc_mint,
                )

        except requests.RequestException as e:
            logger.error(f"Solana RPC request failed for {address[:10]}...: {e}")
        except Exception as e:
            logger.error(f"Error monitoring SOL {address[:10]}...: {e}")

    logger.debug(f"Monitored {len(sol_wallets)} Solana addresses for deposits")


def _check_sol_transfer(
    tx_data: dict,
    tx_sig: str,
    address: str,
    slot: int,
    required_confirmations: int,
    meta: dict,
):
    """Check if a transaction contains a SOL transfer to our address."""
    transaction = tx_data.get("transaction", {})
    message = transaction.get("message", {})
    account_keys = message.get("accountKeys", [])

    if not account_keys:
        return

    # Find our address index in account keys
    our_index = None
    for i, key_info in enumerate(account_keys):
        pubkey = key_info.get("pubkey", key_info) if isinstance(key_info, dict) else key_info
        if pubkey == address:
            our_index = i
            break

    if our_index is None:
        return

    # Compare pre/post balances to detect incoming SOL
    pre_balances = meta.get("preBalances", [])
    post_balances = meta.get("postBalances", [])

    if our_index >= len(pre_balances) or our_index >= len(post_balances):
        return

    pre = pre_balances[our_index]
    post = post_balances[our_index]
    received_lamports = post - pre

    if received_lamports <= 0:
        return

    amount = Decimal(str(received_lamports)) / Decimal(10**SOL_DECIMALS)

    # Security: reject dust deposits
    if is_dust_deposit(amount, "SOL"):
        return

    # Determine sender (first signer that's not us)
    from_addr = ""
    for key_info in account_keys:
        pubkey = key_info.get("pubkey", key_info) if isinstance(key_info, dict) else key_info
        signer = key_info.get("signer", False) if isinstance(key_info, dict) else False
        if signer and pubkey != address:
            from_addr = pubkey
            break

    # Security: amount-based confirmation tier
    usd_value = estimate_usd_value(amount, "SOL")
    dynamic_confirmations = get_required_confirmations("solana", usd_value)

    BlockchainDeposit.objects.create(
        chain="solana",
        tx_hash=tx_sig,
        from_address=from_addr,
        to_address=address,
        amount=amount,
        currency="SOL",
        confirmations=0,
        required_confirmations=dynamic_confirmations,
        status=BlockchainDeposit.Status.DETECTING,
        block_number=slot,
    )

    logger.info(
        f"Detected SOL deposit: {amount} SOL to {address[:10]}... "
        f"tx={tx_sig[:16]}... (requires {dynamic_confirmations} confs)"
    )


def _check_spl_transfer(
    tx_data: dict,
    tx_sig: str,
    address: str,
    slot: int,
    required_confirmations: int,
    meta: dict,
    usdc_mint: str,
):
    """Check if a transaction contains a USDC SPL token transfer to our address."""
    pre_token_balances = meta.get("preTokenBalances", [])
    post_token_balances = meta.get("postTokenBalances", [])

    if not post_token_balances:
        return

    # Find USDC token balance changes for our address
    for post_bal in post_token_balances:
        mint = post_bal.get("mint", "")
        if mint != usdc_mint:
            continue

        owner = post_bal.get("owner", "")
        if owner != address:
            continue

        post_amount_str = (
            post_bal.get("uiTokenAmount", {}).get("uiAmountString", "0")
        )
        post_amount = Decimal(post_amount_str)

        # Find corresponding pre-balance
        pre_amount = Decimal("0")
        account_index = post_bal.get("accountIndex")
        for pre_bal in pre_token_balances:
            if (
                pre_bal.get("accountIndex") == account_index
                and pre_bal.get("mint") == usdc_mint
            ):
                pre_amount = Decimal(
                    pre_bal.get("uiTokenAmount", {}).get("uiAmountString", "0")
                )
                break

        received = post_amount - pre_amount
        if received <= 0:
            continue

        # Security: reject dust deposits
        if is_dust_deposit(received, "USDC"):
            continue

        # A single Solana tx can contain both SOL and USDC transfers.
        # The DB has unique_together = ("chain", "tx_hash"), so we suffix
        # with ":USDC:{accountIndex}" to ensure uniqueness per token
        # transfer within the same transaction.
        account_idx = post_bal.get("accountIndex", 0)
        deposit_tx_hash = f"{tx_sig}:USDC:{account_idx}"
        if BlockchainDeposit.objects.filter(
            chain="solana", tx_hash=deposit_tx_hash
        ).exists():
            continue

        # Security: amount-based confirmation tier
        usd_value = estimate_usd_value(received, "USDC")
        dynamic_confirmations = get_required_confirmations("solana", usd_value)

        BlockchainDeposit.objects.create(
            chain="solana",
            tx_hash=deposit_tx_hash,
            from_address="",
            to_address=address,
            amount=received,
            currency="USDC",
            confirmations=0,
            required_confirmations=dynamic_confirmations,
            status=BlockchainDeposit.Status.DETECTING,
            block_number=slot,
        )

        logger.info(
            f"Detected USDC SPL deposit: {received} USDC to {address[:10]}... "
            f"tx={tx_sig[:16]}... (requires {dynamic_confirmations} confs)"
        )


@shared_task
def update_sol_confirmations():
    """Update confirmation counts for pending Solana deposits."""
    pending = BlockchainDeposit.objects.filter(
        chain="solana",
        status__in=[
            BlockchainDeposit.Status.DETECTING,
            BlockchainDeposit.Status.CONFIRMING,
        ],
    )

    if not pending.exists():
        return

    try:
        # Get current slot
        current_slot = _sol_rpc_call("getSlot", [{"commitment": "finalized"}])
        if not current_slot:
            return
    except Exception as e:
        logger.error(f"Failed to get Solana slot: {e}")
        return

    required = settings.REQUIRED_CONFIRMATIONS.get("solana", 32)

    for deposit in pending:
        if deposit.block_number:
            confirmations = max(0, current_slot - deposit.block_number)

            # Security: confirmation monotonicity check (re-org detection)
            if not check_confirmation_monotonicity(deposit, confirmations):
                deposit.status = BlockchainDeposit.Status.CONFIRMING
                deposit.save(update_fields=["status"])
                continue

            deposit.confirmations = confirmations

            if confirmations >= deposit.required_confirmations:
                deposit.status = BlockchainDeposit.Status.CONFIRMED
            else:
                deposit.status = BlockchainDeposit.Status.CONFIRMING

            deposit.save(update_fields=["confirmations", "status"])

    logger.debug(f"Updated SOL confirmations for {pending.count()} deposits")
