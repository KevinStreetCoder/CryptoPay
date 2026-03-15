"""
Ethereum / ERC-20 deposit listener.

Monitors ETH and ERC-20 USDT/USDC deposits using Alchemy or public RPC.
Uses eth_getLogs for token transfers and eth_getTransactionReceipt for native ETH.

Alchemy free tier: 300M compute units/month (getLogs = 75 CU, ~4M calls).
"""

import logging
from decimal import Decimal

import requests
from celery import shared_task
from django.conf import settings

from apps.wallets.models import Wallet

from .models import BlockchainDeposit
from .security import (
    check_confirmation_monotonicity,
    check_deposit_velocity,
    estimate_usd_value,
    get_required_confirmations,
    is_dust_deposit,
    validate_address,
)

logger = logging.getLogger(__name__)

# ERC-20 contract addresses (Ethereum mainnet)
ERC20_CONTRACTS = {
    "USDT": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
}

# ERC-20 Transfer event topic: Transfer(address,address,uint256)
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def _get_eth_rpc_url() -> str:
    """Get Ethereum RPC URL. Supports Alchemy, Infura, or any JSON-RPC endpoint."""
    url = getattr(settings, "ETH_RPC_URL", "")
    if url:
        return url
    # Fallback to public endpoint (rate-limited, not for production)
    network = getattr(settings, "ETH_NETWORK", "mainnet")
    if network == "sepolia":
        return "https://rpc.sepolia.org"
    return "https://cloudflare-eth.com"


def _eth_rpc_call(method: str, params: list) -> dict:
    """Make a JSON-RPC call to the Ethereum node."""
    url = _get_eth_rpc_url()
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    response = requests.post(url, json=payload, timeout=15)
    result = response.json()
    if "error" in result:
        raise Exception(f"RPC error: {result['error']}")
    if response.status_code != 200:
        response.raise_for_status()
    return result.get("result")


def _get_current_block() -> int:
    """Get the latest finalized block number.

    Post-Merge Ethereum: subtracts the required confirmation buffer
    from the latest block to only scan blocks that have reached
    sufficient finality depth.
    """
    result = _eth_rpc_call("eth_blockNumber", [])
    current = int(result, 16)
    # Subtract safe confirmation buffer (2 epochs ≈ 64 blocks for finality)
    confirmations_dict = getattr(settings, "REQUIRED_CONFIRMATIONS", {})
    finality_buffer = confirmations_dict.get("ethereum", 12) if isinstance(confirmations_dict, dict) else 12
    return current - finality_buffer


@shared_task
def monitor_eth_deposits():
    """
    Monitor ERC-20 USDT/USDC deposits on Ethereum using eth_getLogs.

    Scans the last ~100 blocks for Transfer events to our deposit addresses.
    Uses a high-water mark stored in cache to avoid re-scanning.
    """
    from django.core.cache import cache

    # Get all Ethereum deposit addresses
    eth_wallets = dict(
        Wallet.objects.filter(
            currency__in=["ETH", "USDT", "USDC"],
            deposit_address__startswith="0x",
        ).values_list("deposit_address", "currency")
    )

    if not eth_wallets:
        return

    try:
        current_block = _get_current_block()
    except Exception as e:
        logger.error(f"Failed to get ETH block number: {e}")
        return

    # High-water mark: last scanned block
    # Priority: 1) Redis cache, 2) MAX block_number from DB, 3) current - 100
    last_scanned = cache.get("eth:last_scanned_block")
    if last_scanned:
        from_block = int(last_scanned) + 1
    else:
        # Fall back to the latest block we have on record for this chain,
        # so a Redis restart doesn't cause re-scanning from scratch.
        from django.db.models import Max
        db_max = BlockchainDeposit.objects.filter(chain="ethereum").aggregate(
            max_block=Max("block_number")
        )["max_block"]
        if db_max:
            from_block = db_max + 1
        else:
            from_block = current_block - 5  # Start 5 blocks back on first run

    if from_block > current_block:
        return

    # Cap scan range — Alchemy free tier limits eth_getLogs to 10 blocks
    max_range = int(getattr(settings, "ETH_LOG_SCAN_RANGE", 10))
    to_block = min(from_block + max_range, current_block)

    required_confirmations = settings.REQUIRED_CONFIRMATIONS.get("ethereum", 12)
    addresses_lower = {addr.lower(): addr for addr in eth_wallets.keys()}

    # Scan for ERC-20 Transfer events
    for token_symbol, contract_addr in ERC20_CONTRACTS.items():
        try:
            # eth_getLogs: filter Transfer events TO our addresses
            # Topic[0] = Transfer, Topic[2] = to address (padded to 32 bytes)
            padded_addresses = [
                "0x" + addr[2:].lower().zfill(64)
                for addr in addresses_lower.keys()
            ]

            # Query in batches of 10 addresses
            for i in range(0, len(padded_addresses), 10):
                batch = padded_addresses[i:i + 10]
                logs = _eth_rpc_call("eth_getLogs", [{
                    "fromBlock": hex(from_block),
                    "toBlock": hex(to_block),
                    "address": contract_addr,
                    "topics": [TRANSFER_TOPIC, None, batch if len(batch) > 1 else batch[0]],
                }])

                if not logs:
                    continue

                for log in logs:
                    tx_hash = log.get("transactionHash", "")
                    if not tx_hash:
                        continue

                    # Parse transfer: topic[1]=from, topic[2]=to, data=amount
                    topics = log.get("topics", [])
                    if len(topics) < 3:
                        continue

                    to_addr_raw = "0x" + topics[2][-40:]
                    to_addr = addresses_lower.get(to_addr_raw.lower())
                    if not to_addr:
                        continue

                    from_addr = "0x" + topics[1][-40:]
                    log_index = log.get("logIndex", "0x0")
                    log_index_int = int(log_index, 16) if isinstance(log_index, str) else log_index

                    # Use tx_hash:logIndex as unique key to handle multiple
                    # Transfer events within a single transaction (e.g., batch
                    # transfers to different deposit addresses).
                    deposit_tx_key = f"{tx_hash}:{log_index_int}"

                    # Skip duplicates
                    if BlockchainDeposit.objects.filter(chain="ethereum", tx_hash=deposit_tx_key).exists():
                        continue

                    # Parse amount from data field
                    raw_amount = int(log.get("data", "0x0"), 16)
                    # USDT and USDC both use 6 decimals on Ethereum
                    decimals = 6
                    amount = Decimal(raw_amount) / Decimal(10 ** decimals)

                    if amount <= 0:
                        continue

                    # Security: reject dust deposits
                    if is_dust_deposit(amount, token_symbol):
                        continue

                    # Security: validate address format
                    if not validate_address("ethereum", to_addr):
                        continue

                    # Security: check deposit velocity
                    if not check_deposit_velocity(to_addr, token_symbol):
                        logger.critical(f"Deposit velocity exceeded for {to_addr[:10]}..., skipping")
                        break

                    block_num = int(log.get("blockNumber", "0x0"), 16)
                    block_hash = log.get("blockHash", "")
                    confirmations = max(0, current_block - block_num)

                    # Security: amount-based confirmation tier
                    usd_value = estimate_usd_value(amount, token_symbol)
                    dynamic_confirmations = get_required_confirmations("ethereum", usd_value)

                    status = (
                        BlockchainDeposit.Status.CONFIRMED
                        if confirmations >= dynamic_confirmations
                        else BlockchainDeposit.Status.DETECTING
                    )

                    BlockchainDeposit.objects.create(
                        chain="ethereum",
                        tx_hash=deposit_tx_key,
                        from_address=from_addr,
                        to_address=to_addr,
                        amount=amount,
                        currency=token_symbol,
                        confirmations=confirmations,
                        required_confirmations=dynamic_confirmations,
                        status=status,
                        block_number=block_num,
                        block_hash=block_hash,
                    )

                    logger.info(
                        f"Detected ETH {token_symbol} deposit: {amount} to {to_addr[:10]}... "
                        f"tx={tx_hash[:16]}... log={log_index_int} ({confirmations}/{dynamic_confirmations} confs)"
                    )

        except Exception as e:
            logger.error(f"ETH {token_symbol} log scan failed: {e}")

    # Update high-water mark
    cache.set("eth:last_scanned_block", str(to_block), timeout=86400)
    logger.debug(f"ETH scan complete: blocks {from_block}-{to_block}")


@shared_task
def update_eth_confirmations():
    """Update confirmation counts for pending Ethereum deposits."""
    pending = BlockchainDeposit.objects.filter(
        chain="ethereum",
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    if not pending.exists():
        return

    try:
        result = _eth_rpc_call("eth_blockNumber", [])
        current_block = int(result, 16)
    except Exception as e:
        logger.error(f"Failed to get ETH block for confirmations: {e}")
        return

    for deposit in pending:
        # If block_number is missing, try to resolve it from the tx receipt
        if not deposit.block_number:
            try:
                # Extract the original tx hash (strip :logIndex suffix)
                raw_tx_hash = deposit.tx_hash.split(":")[0]
                receipt = _eth_rpc_call("eth_getTransactionReceipt", [raw_tx_hash])
                if receipt and receipt.get("blockNumber"):
                    deposit.block_number = int(receipt["blockNumber"], 16)
                    if not deposit.block_hash and receipt.get("blockHash"):
                        deposit.block_hash = receipt["blockHash"]
                    deposit.save(update_fields=["block_number", "block_hash"])
                else:
                    continue  # Still pending
            except Exception as e:
                logger.warning(f"Failed to resolve block for ETH deposit {deposit.id}: {e}")
                continue

        confirmations = max(0, current_block - deposit.block_number)

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

    logger.debug(f"Updated ETH confirmations for {pending.count()} deposits")
