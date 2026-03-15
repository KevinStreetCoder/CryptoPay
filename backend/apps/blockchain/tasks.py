"""
Celery tasks for blockchain deposit monitoring.

Tron (TRC-20 USDT) listener and shared deposit-crediting logic.
ETH, BTC, and SOL listeners live in their own dedicated modules:
  - eth_listener.py  (Ethereum / ERC-20)
  - btc_listener.py  (Bitcoin via BlockCypher)
  - sol_listener.py  (Solana / SPL)

Production-grade security hardening:
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
                # TronGrid TRC-20 API returns block_timestamp (ms) but NOT
                # block_number directly. We need the block number for
                # confirmation counting. Extract it from the transaction info
                # if available, otherwise leave null (update_tron_confirmations
                # will handle it via tx lookup).
                block_number = None
                tx_info_url = f"{base_url}/v1/transactions/{tx_hash}"
                try:
                    tx_info_resp = requests.get(
                        tx_info_url, headers=headers, timeout=5,
                    )
                    if tx_info_resp.status_code == 200:
                        tx_info_data = tx_info_resp.json().get("data", [])
                        if tx_info_data:
                            block_number = tx_info_data[0].get(
                                "blockNumber",
                                tx_info_data[0].get("block_number"),
                            )
                except Exception:
                    pass  # Will be resolved in update_tron_confirmations

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
        # If block_number is missing or looks like a timestamp (> 10 billion),
        # look up the actual block number from the transaction.
        if not deposit.block_number or deposit.block_number > 10_000_000_000:
            try:
                tx_url = f"{base_url}/v1/transactions/{deposit.tx_hash}"
                tx_resp = requests.get(tx_url, headers=headers, timeout=5)
                if tx_resp.status_code == 200:
                    tx_data = tx_resp.json().get("data", [])
                    if tx_data:
                        real_block = tx_data[0].get(
                            "blockNumber", tx_data[0].get("block_number")
                        )
                        if real_block and real_block < 10_000_000_000:
                            deposit.block_number = real_block
                            deposit.save(update_fields=["block_number"])
            except Exception as e:
                logger.warning(
                    f"Failed to resolve block_number for Tron deposit "
                    f"{deposit.id}: {e}"
                )

        if deposit.block_number and deposit.block_number < 10_000_000_000:
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

    # Credit the wallet (WalletService.credit uses its own select_for_update).
    # Use deterministic UUID5 from deposit chain+tx_hash to prevent double-credit
    # if this function is retried. Same deposit always produces same tx_id.
    tx_id = uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"deposit:{deposit.chain}:{deposit.tx_hash}",
    )
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

