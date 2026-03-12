"""
Celery tasks for blockchain deposit monitoring.

Production-grade multi-chain listener with security hardening:
  - Dust attack prevention (minimum deposit thresholds)
  - Amount-based confirmation tiers (more confs for larger deposits)
  - Address format validation
  - Re-org detection (block hash verification)
  - Double-credit prevention (select_for_update locking)
  - Deposit velocity anomaly detection
"""

import logging
import uuid
from decimal import Decimal

import requests
from celery import shared_task
from django.conf import settings
from django.db import transaction as db_transaction
from django.utils import timezone

from apps.wallets.models import Wallet
from apps.wallets.services import WalletService

from .models import BlockchainDeposit
from .security import (
    check_confirmation_monotonicity,
    check_deposit_velocity,
    check_stablecoin_blacklist,
    estimate_usd_value,
    get_required_confirmations,
    is_dust_deposit,
    validate_address,
    validate_deposit_address_ownership,
    verify_block_hash,
)

logger = logging.getLogger(__name__)

# USDT TRC-20 contract address
USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"  # Mainnet
USDT_TRC20_CONTRACT_SHASTA = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"  # Shasta testnet

# TronGrid API endpoints
TRONGRID_MAINNET = "https://api.trongrid.io"
TRONGRID_SHASTA = "https://api.shasta.trongrid.io"


def _get_trongrid_base_url() -> str:
    """Get TronGrid base URL based on configured network."""
    network = getattr(settings, "TRON_NETWORK", "shasta")
    return TRONGRID_MAINNET if network == "mainnet" else TRONGRID_SHASTA


def _get_usdt_contract() -> str:
    """Get USDT contract address based on configured network."""
    network = getattr(settings, "TRON_NETWORK", "shasta")
    return USDT_TRC20_CONTRACT if network == "mainnet" else USDT_TRC20_CONTRACT_SHASTA


def _get_trongrid_headers() -> dict:
    """Get TronGrid API headers."""
    headers = {"Accept": "application/json"}
    api_key = getattr(settings, "TRON_API_KEY", "")
    if api_key:
        headers["TRON-PRO-API-KEY"] = api_key
    return headers


@shared_task
def monitor_tron_deposits():
    """
    Poll for new TRC-20 USDT deposits on Tron via TronGrid API.
    Runs every 10 seconds via Celery Beat.

    For each monitored address:
    1. Query TronGrid for recent TRC-20 transfers TO that address
    2. Create BlockchainDeposit records for new transactions
    3. process_pending_deposits() handles confirmation tracking
    """
    tron_wallets = list(
        Wallet.objects.filter(
            currency="USDT",
            deposit_address__startswith="T",
        ).values_list("deposit_address", flat=True)
    )

    if not tron_wallets:
        return

    base_url = _get_trongrid_base_url()
    headers = _get_trongrid_headers()
    usdt_contract = _get_usdt_contract()
    required_confirmations = settings.REQUIRED_CONFIRMATIONS.get("tron", 19)

    for address in tron_wallets:
        try:
            # Query TRC-20 transfers to this address
            url = f"{base_url}/v1/accounts/{address}/transactions/trc20"
            params = {
                "only_to": "true",
                "limit": 20,
                "contract_address": usdt_contract,
            }
            response = requests.get(url, headers=headers, params=params, timeout=10)

            if response.status_code != 200:
                logger.warning(
                    f"TronGrid API error for {address[:10]}...: {response.status_code}"
                )
                continue

            data = response.json()
            transactions = data.get("data", [])

            for tx in transactions:
                tx_hash = tx.get("transaction_id", "")
                if not tx_hash:
                    continue

                # Skip if we already track this deposit
                if BlockchainDeposit.objects.filter(
                    chain="tron", tx_hash=tx_hash
                ).exists():
                    continue

                # Parse amount (USDT has 6 decimals on TRC-20)
                raw_value = tx.get("value", "0")
                amount = Decimal(raw_value) / Decimal("1000000")

                if amount <= 0:
                    continue

                # Security: reject dust deposits
                if is_dust_deposit(amount, "USDT"):
                    continue

                # Security: validate address format
                if not validate_address("tron", address):
                    continue

                # Security: check deposit velocity
                if not check_deposit_velocity(address, "USDT"):
                    logger.critical(f"Deposit velocity exceeded for {address[:10]}..., skipping new deposits")
                    break

                from_address = tx.get("from", "")
                block_number = tx.get("block_timestamp")

                # Security: amount-based confirmation tier
                usd_value = estimate_usd_value(amount, "USDT")
                dynamic_confirmations = get_required_confirmations("tron", usd_value)

                # Create deposit record
                BlockchainDeposit.objects.create(
                    chain="tron",
                    tx_hash=tx_hash,
                    from_address=from_address,
                    to_address=address,
                    amount=amount,
                    currency="USDT",
                    confirmations=0,
                    required_confirmations=dynamic_confirmations,
                    status=BlockchainDeposit.Status.DETECTING,
                    block_number=block_number,
                )

                logger.info(
                    f"Detected USDT deposit: {amount} USDT to {address[:10]}... "
                    f"tx={tx_hash[:16]}... (requires {dynamic_confirmations} confs)"
                )

        except requests.RequestException as e:
            logger.error(f"TronGrid request failed for {address[:10]}...: {e}")
        except Exception as e:
            logger.error(f"Error monitoring {address[:10]}...: {e}")

    logger.debug(f"Monitored {len(tron_wallets)} Tron addresses for deposits")


@shared_task
def update_tron_confirmations():
    """
    Update confirmation count for pending Tron deposits.
    Queries TronGrid for current block number and calculates confirmations.
    """
    pending = BlockchainDeposit.objects.filter(
        chain="tron",
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    if not pending.exists():
        return

    base_url = _get_trongrid_base_url()
    headers = _get_trongrid_headers()

    try:
        # Get current block number
        response = requests.post(
            f"{base_url}/wallet/getnowblock",
            headers=headers,
            timeout=10,
        )
        if response.status_code != 200:
            logger.warning(f"Failed to get current block: {response.status_code}")
            return

        current_block = response.json().get("block_header", {}).get("raw_data", {}).get("number", 0)
        if not current_block:
            return

    except requests.RequestException as e:
        logger.error(f"Failed to get current Tron block: {e}")
        return

    for deposit in pending:
        if deposit.block_number:
            confirmations = max(0, current_block - deposit.block_number + 1)

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

    logger.debug(f"Updated confirmations for {pending.count()} Tron deposits")


@shared_task
def process_pending_deposits():
    """
    Credit user wallet once required confirmations are reached.
    Processes CONFIRMED deposits that haven't been credited yet.

    Security hardening:
      - select_for_update() prevents double-crediting from concurrent workers
      - Re-org detection via block hash verification (ETH)
      - Address ownership validation before crediting
      - Dust threshold re-check at credit time
      - Atomic transaction wrapping per deposit
    """
    confirmed_ids = list(
        BlockchainDeposit.objects.filter(
            status=BlockchainDeposit.Status.CONFIRMED,
        ).values_list("id", flat=True)
    )

    for deposit_id in confirmed_ids:
        try:
            _credit_single_deposit(deposit_id)
        except Exception as e:
            logger.error(f"Failed to credit deposit {deposit_id}: {e}")

    # Also process legacy detecting/confirming that have enough confirmations
    pending = BlockchainDeposit.objects.filter(
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    for deposit in pending:
        if deposit.confirmations >= deposit.required_confirmations:
            deposit.status = BlockchainDeposit.Status.CONFIRMED
            deposit.save(update_fields=["status"])


@db_transaction.atomic
def _credit_single_deposit(deposit_id: int):
    """
    Credit a single deposit atomically with full security checks.

    Uses select_for_update() to lock the deposit row, preventing
    concurrent workers from double-crediting the same deposit.
    """
    # Lock the deposit row to prevent concurrent crediting
    deposit = (
        BlockchainDeposit.objects
        .select_for_update()
        .filter(id=deposit_id, status=BlockchainDeposit.Status.CONFIRMED)
        .first()
    )

    if not deposit:
        return  # Already credited or status changed

    # Security check 1: Re-org detection (ETH block hash verification)
    if not verify_block_hash(deposit.chain, deposit):
        logger.critical(
            f"BLOCKING credit for deposit {deposit.id} due to re-org detection. "
            f"Reverting to CONFIRMING for re-verification."
        )
        deposit.status = BlockchainDeposit.Status.CONFIRMING
        deposit.save(update_fields=["status"])
        return

    # Security check 2: Verify destination address belongs to our system
    if not validate_deposit_address_ownership(deposit.to_address, deposit.currency):
        logger.critical(
            f"BLOCKING credit for deposit {deposit.id}: "
            f"address {deposit.to_address[:16]}... not found in our wallets"
        )
        return

    # Security check 3: Re-check dust threshold at credit time
    if is_dust_deposit(deposit.amount, deposit.currency):
        logger.warning(
            f"Dust deposit {deposit.id} reached CONFIRMED but below threshold. Skipping."
        )
        return

    # Security check 4: Stablecoin blacklist/freeze check
    if not check_stablecoin_blacklist(deposit.from_address, deposit.currency):
        logger.critical(
            f"BLOCKING credit for deposit {deposit.id}: "
            f"sender {deposit.from_address[:16]}... is blacklisted ({deposit.currency})"
        )
        return

    # Find the wallet
    wallet = Wallet.objects.filter(
        deposit_address=deposit.to_address,
        currency=deposit.currency,
    ).first()

    if not wallet:
        logger.warning(f"No wallet found for deposit to {deposit.to_address}")
        return

    # Credit the wallet (WalletService.credit uses its own select_for_update)
    tx_id = uuid.uuid4()
    WalletService.credit(
        wallet.id,
        deposit.amount,
        tx_id,
        f"Blockchain deposit: {deposit.chain} tx {deposit.tx_hash}",
    )
    deposit.status = BlockchainDeposit.Status.CREDITED
    deposit.credited_at = timezone.now()
    deposit.save(update_fields=["status", "credited_at"])

    logger.info(
        f"Credited {deposit.amount} {deposit.currency} to wallet {wallet.id} "
        f"(user={wallet.user_id}, tx={deposit.tx_hash[:16]}...)"
    )


# ---------------------------------------------------------------------------
# Ethereum (ETH + USDC ERC-20) deposit monitoring
# ---------------------------------------------------------------------------

# USDC ERC-20 contract addresses
USDC_ERC20_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
USDC_ERC20_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"

# ERC-20 Transfer event topic: keccak256("Transfer(address,address,uint256)")
ERC20_TRANSFER_TOPIC = (
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
)


def _get_usdc_erc20_contract() -> str:
    """Get USDC ERC-20 contract address based on configured network."""
    network = getattr(settings, "ETH_NETWORK", "sepolia")
    return USDC_ERC20_MAINNET if network == "mainnet" else USDC_ERC20_SEPOLIA


def _eth_rpc_call(method: str, params: list) -> dict:
    """Make a JSON-RPC call to the Ethereum node."""
    rpc_url = getattr(settings, "ETH_RPC_URL", "")
    if not rpc_url:
        raise ValueError("ETH_RPC_URL is not configured")

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    response = requests.post(rpc_url, json=payload, timeout=10)
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise ValueError(f"RPC error: {data['error']}")
    return data


@shared_task
def monitor_eth_deposits():
    """
    Poll for new ETH native transfers and USDC ERC-20 deposits via Alchemy/JSON-RPC.
    Runs every 15 seconds via Celery Beat.

    1. Fetch the latest block number.
    2. For ETH native: scan recent blocks for value transfers to monitored addresses.
    3. For USDC ERC-20: use eth_getLogs to find Transfer events to monitored addresses.
    """
    # Gather ETH wallet addresses (lowercase for comparison)
    eth_wallets = list(
        Wallet.objects.filter(
            currency="ETH",
            deposit_address__startswith="0x",
        ).values_list("deposit_address", flat=True)
    )
    usdc_wallets = list(
        Wallet.objects.filter(
            currency="USDC",
            deposit_address__startswith="0x",
        ).values_list("deposit_address", flat=True)
    )

    all_addresses = list(set(eth_wallets + usdc_wallets))
    if not all_addresses:
        return

    required_eth = settings.REQUIRED_CONFIRMATIONS.get("ethereum", 12)
    required_usdc = settings.REQUIRED_CONFIRMATIONS.get("ethereum", 12)

    try:
        # Get current block number
        result = _eth_rpc_call("eth_blockNumber", [])
        current_block = int(result["result"], 16)
    except Exception as e:
        logger.error(f"Failed to get ETH block number: {e}")
        return

    # Scan the last 10 blocks for native ETH transfers
    from_block = max(0, current_block - 10)
    address_set_lower = {addr.lower() for addr in all_addresses}

    # --- Native ETH transfers ---
    if eth_wallets:
        _scan_eth_native_transfers(
            from_block, current_block, address_set_lower, required_eth
        )

    # --- USDC ERC-20 transfers via eth_getLogs ---
    if usdc_wallets:
        _scan_usdc_erc20_transfers(
            from_block, current_block, usdc_wallets, required_usdc
        )

    logger.debug(
        f"Monitored {len(all_addresses)} ETH/USDC addresses "
        f"(blocks {from_block}-{current_block})"
    )


def _scan_eth_native_transfers(
    from_block: int, to_block: int, address_set_lower: set, required_confirmations: int
):
    """Scan recent blocks for native ETH transfers to monitored addresses."""
    for block_num in range(from_block, to_block + 1):
        try:
            result = _eth_rpc_call(
                "eth_getBlockByNumber", [hex(block_num), True]
            )
            block = result.get("result")
            if not block or not block.get("transactions"):
                continue

            for tx in block["transactions"]:
                to_addr = (tx.get("to") or "").lower()
                if to_addr not in address_set_lower:
                    continue

                value_wei = int(tx.get("value", "0x0"), 16)
                if value_wei == 0:
                    continue

                tx_hash = tx.get("hash", "")
                if not tx_hash:
                    continue

                if BlockchainDeposit.objects.filter(
                    chain="ethereum", tx_hash=tx_hash
                ).exists():
                    continue

                amount = Decimal(value_wei) / Decimal("1000000000000000000")

                # Security: reject dust deposits
                if is_dust_deposit(amount, "ETH"):
                    continue

                # Security: amount-based confirmation tier
                usd_value = estimate_usd_value(amount, "ETH")
                dynamic_confirmations = get_required_confirmations("ethereum", usd_value)

                BlockchainDeposit.objects.create(
                    chain="ethereum",
                    tx_hash=tx_hash,
                    from_address=tx.get("from", ""),
                    to_address=to_addr,
                    amount=amount,
                    currency="ETH",
                    confirmations=0,
                    required_confirmations=dynamic_confirmations,
                    status=BlockchainDeposit.Status.DETECTING,
                    block_number=block_num,
                    block_hash=block.get("hash", ""),
                )

                logger.info(
                    f"Detected ETH deposit: {amount} ETH to {to_addr[:12]}... "
                    f"tx={tx_hash[:16]}... (requires {dynamic_confirmations} confs)"
                )

        except requests.RequestException as e:
            logger.error(f"ETH RPC request failed for block {block_num}: {e}")
        except Exception as e:
            logger.error(f"Error scanning ETH block {block_num}: {e}")


def _scan_usdc_erc20_transfers(
    from_block: int,
    to_block: int,
    usdc_wallets: list,
    required_confirmations: int,
):
    """Scan for USDC ERC-20 Transfer events to monitored addresses using eth_getLogs."""
    usdc_contract = _get_usdc_erc20_contract()

    # Build padded topic filters for each monitored address
    # Transfer(address indexed from, address indexed to, uint256 value)
    # topic[0] = event sig, topic[2] = to address (padded to 32 bytes)
    padded_addresses = [
        "0x" + addr.lower().replace("0x", "").zfill(64)
        for addr in usdc_wallets
    ]

    try:
        result = _eth_rpc_call(
            "eth_getLogs",
            [
                {
                    "fromBlock": hex(from_block),
                    "toBlock": hex(to_block),
                    "address": usdc_contract,
                    "topics": [
                        ERC20_TRANSFER_TOPIC,
                        None,  # from (any)
                        padded_addresses,  # to (our addresses)
                    ],
                }
            ],
        )

        logs = result.get("result", [])

        for log in logs:
            tx_hash = log.get("transactionHash", "")
            if not tx_hash:
                continue

            if BlockchainDeposit.objects.filter(
                chain="ethereum", tx_hash=tx_hash
            ).exists():
                continue

            # Decode from and to from indexed topics
            from_address = "0x" + log["topics"][1][-40:]
            to_address = "0x" + log["topics"][2][-40:]

            # Decode amount from data (uint256, USDC has 6 decimals)
            raw_amount = int(log.get("data", "0x0"), 16)
            amount = Decimal(raw_amount) / Decimal("1000000")

            if amount <= 0:
                continue

            # Security: reject dust deposits
            if is_dust_deposit(amount, "USDC"):
                continue

            block_num = int(log.get("blockNumber", "0x0"), 16)

            # Security: amount-based confirmation tier
            usd_value = estimate_usd_value(amount, "USDC")
            dynamic_confirmations = get_required_confirmations("ethereum", usd_value)

            BlockchainDeposit.objects.create(
                chain="ethereum",
                tx_hash=tx_hash,
                from_address=from_address,
                to_address=to_address,
                amount=amount,
                currency="USDC",
                confirmations=0,
                required_confirmations=dynamic_confirmations,
                status=BlockchainDeposit.Status.DETECTING,
                block_number=block_num,
                block_hash=log.get("blockHash", ""),
            )

            logger.info(
                f"Detected USDC deposit: {amount} USDC to {to_address[:12]}... "
                f"tx={tx_hash[:16]}... (requires {dynamic_confirmations} confs)"
            )

    except requests.RequestException as e:
        logger.error(f"eth_getLogs request failed for USDC: {e}")
    except Exception as e:
        logger.error(f"Error scanning USDC ERC-20 logs: {e}")


@shared_task
def update_eth_confirmations():
    """
    Update confirmation count for pending Ethereum deposits.
    Queries the current block number and calculates confirmations from block_number.
    """
    pending = BlockchainDeposit.objects.filter(
        chain="ethereum",
        status__in=[
            BlockchainDeposit.Status.DETECTING,
            BlockchainDeposit.Status.CONFIRMING,
        ],
    )

    if not pending.exists():
        return

    try:
        result = _eth_rpc_call("eth_blockNumber", [])
        current_block = int(result["result"], 16)
    except Exception as e:
        logger.error(f"Failed to get current ETH block: {e}")
        return

    for deposit in pending:
        if deposit.block_number:
            confirmations = max(0, current_block - deposit.block_number + 1)

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

    logger.debug(f"Updated confirmations for {pending.count()} Ethereum deposits")


# ---------------------------------------------------------------------------
# Bitcoin (BTC) deposit monitoring
# ---------------------------------------------------------------------------

BLOCKCYPHER_MAINNET = "https://api.blockcypher.com/v1/btc/main"
BLOCKCYPHER_TESTNET = "https://api.blockcypher.com/v1/btc/test3"


def _get_blockcypher_base_url() -> str:
    """Get BlockCypher base URL based on configured network."""
    network = getattr(settings, "BTC_NETWORK", "test3")
    return BLOCKCYPHER_MAINNET if network == "main" else BLOCKCYPHER_TESTNET


def _get_blockcypher_params() -> dict:
    """Get BlockCypher query params including optional API token."""
    params = {}
    token = getattr(settings, "BLOCKCYPHER_API_TOKEN", "")
    if token:
        params["token"] = token
    return params


@shared_task
def monitor_btc_deposits():
    """
    Poll for new BTC deposits via BlockCypher API.
    Runs every 30 seconds via Celery Beat.

    For each monitored BTC address:
    1. Query BlockCypher for recent transactions
    2. Filter for incoming transfers (outputs to our address)
    3. Create BlockchainDeposit records for new transactions
    """
    btc_wallets = list(
        Wallet.objects.filter(
            currency="BTC",
        )
        .exclude(deposit_address="")
        .values_list("deposit_address", flat=True)
    )

    if not btc_wallets:
        return

    base_url = _get_blockcypher_base_url()
    base_params = _get_blockcypher_params()
    required_confirmations = settings.REQUIRED_CONFIRMATIONS.get("bitcoin", 3)

    for address in btc_wallets:
        try:
            url = f"{base_url}/addrs/{address}"
            params = {**base_params, "limit": 20, "unspentOnly": "false"}
            response = requests.get(url, params=params, timeout=10)

            if response.status_code == 429:
                logger.warning("BlockCypher rate limit hit, backing off")
                break
            if response.status_code != 200:
                logger.warning(
                    f"BlockCypher API error for {address[:10]}...: "
                    f"{response.status_code}"
                )
                continue

            data = response.json()
            txrefs = data.get("txrefs", [])

            for txref in txrefs:
                # Only look at incoming (received) outputs
                if txref.get("tx_input_n", -1) != -1:
                    continue  # This is a spent output, skip

                tx_hash = txref.get("tx_hash", "")
                if not tx_hash:
                    continue

                if BlockchainDeposit.objects.filter(
                    chain="bitcoin", tx_hash=tx_hash
                ).exists():
                    continue

                # BlockCypher returns value in satoshis
                value_satoshis = txref.get("value", 0)
                if value_satoshis <= 0:
                    continue

                amount = Decimal(value_satoshis) / Decimal("100000000")

                # Security: reject dust deposits
                if is_dust_deposit(amount, "BTC"):
                    continue

                # Security: validate address format
                if not validate_address("bitcoin", address):
                    continue

                block_height = txref.get("block_height", None)
                confirmations = txref.get("confirmations", 0)

                # Security: amount-based confirmation tier
                usd_value = estimate_usd_value(amount, "BTC")
                dynamic_confirmations = get_required_confirmations("bitcoin", usd_value)

                deposit_status = BlockchainDeposit.Status.DETECTING
                if confirmations >= dynamic_confirmations:
                    deposit_status = BlockchainDeposit.Status.CONFIRMED
                elif confirmations > 0:
                    deposit_status = BlockchainDeposit.Status.CONFIRMING

                BlockchainDeposit.objects.create(
                    chain="bitcoin",
                    tx_hash=tx_hash,
                    from_address="",  # BTC UTXO model: sender not directly available
                    to_address=address,
                    amount=amount,
                    currency="BTC",
                    confirmations=confirmations,
                    required_confirmations=dynamic_confirmations,
                    status=deposit_status,
                    block_number=block_height,
                )

                logger.info(
                    f"Detected BTC deposit: {amount} BTC to {address[:10]}... "
                    f"tx={tx_hash[:16]}... ({confirmations}/{dynamic_confirmations} confs)"
                )

        except requests.RequestException as e:
            logger.error(f"BlockCypher request failed for {address[:10]}...: {e}")
        except Exception as e:
            logger.error(f"Error monitoring BTC {address[:10]}...: {e}")

    logger.debug(f"Monitored {len(btc_wallets)} BTC addresses for deposits")


@shared_task
def update_btc_confirmations():
    """
    Update confirmation count for pending Bitcoin deposits via BlockCypher.
    Queries the chain height and recalculates confirmations from block_number.
    """
    pending = BlockchainDeposit.objects.filter(
        chain="bitcoin",
        status__in=[
            BlockchainDeposit.Status.DETECTING,
            BlockchainDeposit.Status.CONFIRMING,
        ],
    )

    if not pending.exists():
        return

    base_url = _get_blockcypher_base_url()
    base_params = _get_blockcypher_params()

    try:
        response = requests.get(base_url, params=base_params, timeout=10)
        response.raise_for_status()
        chain_info = response.json()
        current_height = chain_info.get("height", 0)
        if not current_height:
            return
    except requests.RequestException as e:
        logger.error(f"Failed to get BTC chain height: {e}")
        return

    for deposit in pending:
        if deposit.block_number:
            confirmations = max(0, current_height - deposit.block_number + 1)

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

    logger.debug(f"Updated confirmations for {pending.count()} BTC deposits")


# ---------------------------------------------------------------------------
# Solana (SOL + USDC SPL) deposit monitoring
# ---------------------------------------------------------------------------

# USDC SPL token mint address (mainnet)
USDC_SPL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

# SPL Token Program ID
SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"


def _get_sol_rpc_url() -> str:
    """Get Solana RPC URL from settings or default to devnet."""
    return getattr(settings, "SOL_RPC_URL", "https://api.devnet.solana.com")


def _sol_rpc_call(method: str, params: list) -> dict:
    """Make a JSON-RPC call to the Solana node."""
    rpc_url = _get_sol_rpc_url()
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    response = requests.post(rpc_url, json=payload, timeout=10)
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise ValueError(f"Solana RPC error: {data['error']}")
    return data


@shared_task
def monitor_sol_deposits():
    """
    Poll for new SOL native transfers and USDC SPL token deposits via Solana JSON-RPC.
    Runs every 15 seconds via Celery Beat.

    For each monitored address:
    1. Fetch recent transaction signatures via getSignaturesForAddress.
    2. For each new signature, fetch the transaction and parse transfers.
    3. Create BlockchainDeposit records for SOL native and USDC SPL deposits.
    """
    sol_wallets = list(
        Wallet.objects.filter(
            currency="SOL",
        )
        .exclude(deposit_address="")
        .values_list("deposit_address", flat=True)
    )
    usdc_spl_wallets = list(
        Wallet.objects.filter(
            currency="USDC",
        )
        .exclude(deposit_address="")
        .exclude(deposit_address__startswith="0x")  # Exclude ETH addresses
        .values_list("deposit_address", flat=True)
    )

    all_addresses = list(set(sol_wallets + usdc_spl_wallets))
    if not all_addresses:
        return

    sol_address_set = set(sol_wallets)
    usdc_spl_address_set = set(usdc_spl_wallets)
    required_sol = settings.REQUIRED_CONFIRMATIONS.get("solana", 32)

    for address in all_addresses:
        try:
            _scan_solana_address(
                address, sol_address_set, usdc_spl_address_set, required_sol
            )
        except requests.RequestException as e:
            logger.error(f"Solana RPC request failed for {address[:10]}...: {e}")
        except Exception as e:
            logger.error(f"Error monitoring SOL {address[:10]}...: {e}")

    logger.debug(f"Monitored {len(all_addresses)} Solana addresses for deposits")


def _scan_solana_address(
    address: str,
    sol_address_set: set,
    usdc_spl_address_set: set,
    required_confirmations: int,
):
    """Scan a single Solana address for recent deposits."""
    # Get recent transaction signatures for this address
    result = _sol_rpc_call(
        "getSignaturesForAddress",
        [address, {"limit": 20, "commitment": "confirmed"}],
    )
    signatures = result.get("result", [])

    for sig_info in signatures:
        tx_sig = sig_info.get("signature", "")
        if not tx_sig:
            continue

        # Skip failed transactions
        if sig_info.get("err") is not None:
            continue

        # Skip already-tracked deposits
        if BlockchainDeposit.objects.filter(
            chain="solana", tx_hash=tx_sig
        ).exists():
            continue

        slot = sig_info.get("slot", 0)

        # Fetch full transaction details
        try:
            tx_result = _sol_rpc_call(
                "getTransaction",
                [
                    tx_sig,
                    {
                        "encoding": "jsonParsed",
                        "commitment": "confirmed",
                        "maxSupportedTransactionVersion": 0,
                    },
                ],
            )
            tx_data = tx_result.get("result")
            if not tx_data:
                continue
        except Exception as e:
            logger.warning(f"Failed to fetch SOL tx {tx_sig[:16]}...: {e}")
            continue

        meta = tx_data.get("meta", {})
        if meta.get("err") is not None:
            continue

        transaction = tx_data.get("transaction", {})
        message = transaction.get("message", {})
        account_keys = message.get("accountKeys", [])

        # Build account list (handle both parsed and unparsed formats)
        accounts = []
        for ak in account_keys:
            if isinstance(ak, dict):
                accounts.append(ak.get("pubkey", ""))
            else:
                accounts.append(str(ak))

        # --- Native SOL transfers ---
        if address in sol_address_set:
            _detect_sol_native_transfer(
                address, accounts, meta, tx_sig, slot, required_confirmations
            )

        # --- USDC SPL token transfers ---
        if address in usdc_spl_address_set:
            _detect_usdc_spl_transfer(
                address, meta, tx_sig, slot, required_confirmations
            )


def _detect_sol_native_transfer(
    address: str,
    accounts: list,
    meta: dict,
    tx_sig: str,
    slot: int,
    required_confirmations: int,
):
    """Detect native SOL transfer to the monitored address."""
    pre_balances = meta.get("preBalances", [])
    post_balances = meta.get("postBalances", [])

    try:
        addr_index = accounts.index(address)
    except ValueError:
        return

    if addr_index >= len(pre_balances) or addr_index >= len(post_balances):
        return

    pre_bal = pre_balances[addr_index]
    post_bal = post_balances[addr_index]
    diff_lamports = post_bal - pre_bal

    if diff_lamports <= 0:
        return

    # 1 SOL = 1,000,000,000 lamports
    amount = Decimal(diff_lamports) / Decimal("1000000000")

    # Security: reject dust deposits
    if is_dust_deposit(amount, "SOL"):
        return

    # Determine sender (first signer, typically accounts[0])
    from_address = accounts[0] if accounts else ""

    # Security: amount-based confirmation tier
    usd_value = estimate_usd_value(amount, "SOL")
    dynamic_confirmations = get_required_confirmations("solana", usd_value)

    BlockchainDeposit.objects.create(
        chain="solana",
        tx_hash=tx_sig,
        from_address=from_address,
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


def _detect_usdc_spl_transfer(
    address: str,
    meta: dict,
    tx_sig: str,
    slot: int,
    required_confirmations: int,
):
    """Detect USDC SPL token transfer to the monitored address."""
    pre_token_balances = meta.get("preTokenBalances", [])
    post_token_balances = meta.get("postTokenBalances", [])

    # Look for USDC mint in post-token balances belonging to our address
    for post_bal in post_token_balances:
        mint = post_bal.get("mint", "")
        if mint != USDC_SPL_MINT:
            continue

        owner = post_bal.get("owner", "")
        if owner != address:
            continue

        post_amount_str = (
            post_bal.get("uiTokenAmount", {}).get("uiAmountString", "0")
        )
        post_amount = Decimal(post_amount_str)

        # Find matching pre-balance
        pre_amount = Decimal("0")
        account_index = post_bal.get("accountIndex")
        for pre_bal in pre_token_balances:
            if (
                pre_bal.get("accountIndex") == account_index
                and pre_bal.get("mint") == USDC_SPL_MINT
            ):
                pre_amount = Decimal(
                    pre_bal.get("uiTokenAmount", {}).get("uiAmountString", "0")
                )
                break

        diff = post_amount - pre_amount
        if diff <= 0:
            continue

        # Security: reject dust deposits
        if is_dust_deposit(diff, "USDC"):
            continue

        # Already checked at caller level, but guard against duplicates
        # from multiple token balance entries
        if BlockchainDeposit.objects.filter(
            chain="solana", tx_hash=tx_sig, currency="USDC"
        ).exists():
            continue

        # Security: amount-based confirmation tier
        usd_value = estimate_usd_value(diff, "USDC")
        dynamic_confirmations = get_required_confirmations("solana", usd_value)

        BlockchainDeposit.objects.create(
            chain="solana",
            tx_hash=tx_sig,
            from_address="",  # SPL transfers: sender derived from token accounts
            to_address=address,
            amount=diff,
            currency="USDC",
            confirmations=0,
            required_confirmations=dynamic_confirmations,
            status=BlockchainDeposit.Status.DETECTING,
            block_number=slot,
        )

        logger.info(
            f"Detected USDC SPL deposit: {diff} USDC to {address[:10]}... "
            f"tx={tx_sig[:16]}... (requires {dynamic_confirmations} confs)"
        )
        break  # One USDC deposit per transaction per address


@shared_task
def update_sol_confirmations():
    """
    Update confirmation count for pending Solana deposits.
    Queries the current slot and calculates confirmations from the deposit slot.
    """
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
        result = _sol_rpc_call("getSlot", [{"commitment": "confirmed"}])
        current_slot = result.get("result", 0)
        if not current_slot:
            return
    except Exception as e:
        logger.error(f"Failed to get current Solana slot: {e}")
        return

    for deposit in pending:
        if deposit.block_number:
            confirmations = max(0, current_slot - deposit.block_number + 1)

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

    logger.debug(f"Updated confirmations for {pending.count()} Solana deposits")
