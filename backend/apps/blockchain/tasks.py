"""
Celery tasks for blockchain deposit monitoring.

MVP: Tron (TRC-20 USDT) deposit detection via TronGrid API.
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

                from_address = tx.get("from", "")
                block_number = tx.get("block_timestamp")

                # Create deposit record
                BlockchainDeposit.objects.create(
                    chain="tron",
                    tx_hash=tx_hash,
                    from_address=from_address,
                    to_address=address,
                    amount=amount,
                    currency="USDT",
                    confirmations=0,
                    required_confirmations=required_confirmations,
                    status=BlockchainDeposit.Status.DETECTING,
                    block_number=block_number,
                )

                logger.info(
                    f"Detected USDT deposit: {amount} USDT to {address[:10]}... "
                    f"tx={tx_hash[:16]}..."
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
    """
    confirmed = BlockchainDeposit.objects.filter(
        status=BlockchainDeposit.Status.CONFIRMED,
    )

    for deposit in confirmed:
        # Find the wallet this deposit belongs to
        wallet = Wallet.objects.filter(
            deposit_address=deposit.to_address,
            currency=deposit.currency,
        ).first()

        if not wallet:
            logger.warning(f"No wallet found for deposit to {deposit.to_address}")
            continue

        try:
            import uuid

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
                f"(user={wallet.user_id})"
            )
        except Exception as e:
            logger.error(f"Failed to credit deposit {deposit.id}: {e}")

    # Also process legacy detecting/confirming that have enough confirmations
    pending = BlockchainDeposit.objects.filter(
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    for deposit in pending:
        required = settings.REQUIRED_CONFIRMATIONS.get(deposit.chain, 19)
        if deposit.confirmations >= required:
            deposit.status = BlockchainDeposit.Status.CONFIRMED
            deposit.save(update_fields=["status"])
