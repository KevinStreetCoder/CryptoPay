"""
Polygon (PoS) / ERC-20 deposit listener.

Monitors USDT and USDC deposits on Polygon using any JSON-RPC endpoint.
Same pattern as eth_listener.py but targeting the Polygon chain.

Polygon PoS: ~2s block time, 128 confirmations recommended (~4-5 minutes).
"""

import logging
from decimal import Decimal

import requests
from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.wallets.models import Wallet
from apps.wallets.services import WalletService

from .models import BlockchainDeposit
from .security import (
    check_confirmation_monotonicity,
    estimate_usd_value,
    get_required_confirmations,
    is_dust_deposit,
)

logger = logging.getLogger(__name__)

# ERC-20 contract addresses (Polygon mainnet)
POLYGON_ERC20_CONTRACTS = {
    "USDT": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    "USDC": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
}

# ERC-20 Transfer event topic: Transfer(address,address,uint256)
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def _get_polygon_rpc_url() -> str:
    """Get Polygon RPC URL. Supports Alchemy, Infura, or any JSON-RPC endpoint."""
    url = getattr(settings, "POLYGON_RPC_URL", "")
    if url:
        return url
    # Fallback to public endpoint (rate-limited, not for production)
    return "https://polygon-rpc.com"


def _polygon_rpc_call(method: str, params: list) -> dict:
    """Make a JSON-RPC call to the Polygon node."""
    url = _get_polygon_rpc_url()
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    response = requests.post(url, json=payload, timeout=15)
    result = response.json()
    if "error" in result:
        raise Exception(f"Polygon RPC error: {result['error']}")
    if response.status_code != 200:
        response.raise_for_status()
    return result.get("result")


def _get_current_block() -> int:
    """Get the latest block number minus the confirmation buffer.

    Polygon PoS: ~2s blocks, 128 confirmations for finality (~4-5 min).
    """
    result = _polygon_rpc_call("eth_blockNumber", [])
    current = int(result, 16)
    confirmations_dict = getattr(settings, "REQUIRED_CONFIRMATIONS", {})
    finality_buffer = confirmations_dict.get("polygon", 128) if isinstance(confirmations_dict, dict) else 128
    return current - finality_buffer


@shared_task
def monitor_polygon_deposits():
    """
    Monitor ERC-20 USDT/USDC deposits on Polygon using eth_getLogs.

    Scans recent blocks for Transfer events to our deposit addresses.
    Uses a high-water mark stored in cache to avoid re-scanning.
    """
    from django.core.cache import cache

    # Get all Polygon deposit addresses (share Ethereum 0x-style addresses)
    polygon_wallets = dict(
        Wallet.objects.filter(
            currency__in=["USDT", "USDC"],
            deposit_address__startswith="0x",
        ).values_list("deposit_address", "currency")
    )

    if not polygon_wallets:
        return

    try:
        current_block = _get_current_block()
    except Exception as e:
        logger.error(f"Failed to get Polygon block number: {e}")
        return

    # High-water mark: last scanned block
    last_scanned = cache.get("polygon:last_scanned_block")
    if last_scanned:
        from_block = int(last_scanned) + 1
    else:
        from django.db.models import Max
        db_max = BlockchainDeposit.objects.filter(chain="polygon").aggregate(
            max_block=Max("block_number")
        )["max_block"]
        if db_max:
            from_block = db_max + 1
        else:
            from_block = current_block - 5  # Start 5 blocks back on first run

    if from_block > current_block:
        return

    # Polygon is faster so we can scan larger ranges
    max_range = int(getattr(settings, "POLYGON_LOG_SCAN_RANGE", 50))
    to_block = min(from_block + max_range, current_block)

    addresses_lower = {addr.lower(): addr for addr in polygon_wallets.keys()}

    # Scan for ERC-20 Transfer events
    for token_symbol, contract_addr in POLYGON_ERC20_CONTRACTS.items():
        try:
            padded_addresses = [
                "0x" + addr[2:].lower().zfill(64)
                for addr in addresses_lower.keys()
            ]

            # Query in batches of 10 addresses
            for i in range(0, len(padded_addresses), 10):
                batch = padded_addresses[i:i + 10]
                logs = _polygon_rpc_call("eth_getLogs", [{
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

                    # Skip duplicates
                    if BlockchainDeposit.objects.filter(chain="polygon", tx_hash=tx_hash).exists():
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

                    # Parse amount from data field
                    raw_amount = int(log.get("data", "0x0"), 16)
                    # USDT and USDC both use 6 decimals on Polygon
                    decimals = 6
                    amount = Decimal(raw_amount) / Decimal(10 ** decimals)

                    if amount <= 0:
                        continue

                    # Security: reject dust deposits
                    if is_dust_deposit(amount, token_symbol):
                        continue

                    block_num = int(log.get("blockNumber", "0x0"), 16)
                    confirmations = max(0, current_block - block_num)

                    # Security: amount-based confirmation tier
                    usd_value = estimate_usd_value(amount, token_symbol)
                    dynamic_confirmations = get_required_confirmations("polygon", usd_value)

                    status = (
                        BlockchainDeposit.Status.CONFIRMED
                        if confirmations >= dynamic_confirmations
                        else BlockchainDeposit.Status.DETECTING
                    )

                    BlockchainDeposit.objects.create(
                        chain="polygon",
                        tx_hash=tx_hash,
                        from_address=from_addr,
                        to_address=to_addr,
                        amount=amount,
                        currency=token_symbol,
                        confirmations=confirmations,
                        required_confirmations=dynamic_confirmations,
                        status=status,
                        block_number=block_num,
                    )

                    logger.info(
                        f"Detected Polygon {token_symbol} deposit: {amount} to {to_addr[:10]}... "
                        f"tx={tx_hash[:16]}... ({confirmations}/{dynamic_confirmations} confs)"
                    )

        except Exception as e:
            logger.error(f"Polygon {token_symbol} log scan failed: {e}")

    # Update high-water mark
    cache.set("polygon:last_scanned_block", str(to_block), timeout=86400)
    logger.debug(f"Polygon scan complete: blocks {from_block}-{to_block}")


@shared_task
def update_polygon_confirmations():
    """Update confirmation counts for pending Polygon deposits."""
    pending = BlockchainDeposit.objects.filter(
        chain="polygon",
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    if not pending.exists():
        return

    try:
        result = _polygon_rpc_call("eth_blockNumber", [])
        current_block = int(result, 16)
    except Exception as e:
        logger.error(f"Failed to get Polygon block for confirmations: {e}")
        return

    for deposit in pending:
        if deposit.block_number:
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

    logger.debug(f"Updated Polygon confirmations for {pending.count()} deposits")
