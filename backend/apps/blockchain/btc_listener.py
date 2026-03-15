"""
Bitcoin deposit listener.

Monitors BTC deposits using Blockstream Esplora API (free, no API key required).
Tracks UTXO-based transactions to our deposit addresses.

Esplora API: https://github.com/Blockstream/esplora/blob/master/API.md
No rate limits documented, but be reasonable (~1 req/sec).
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

# Blockstream Esplora — free, no API key, supports mainnet + testnet
ESPLORA_MAINNET = "https://blockstream.info/api"
ESPLORA_TESTNET = "https://blockstream.info/testnet/api"


def _get_esplora_base() -> str:
    """Get Esplora API base URL based on network setting."""
    network = getattr(settings, "BTC_NETWORK", "main")
    if network in ("test3", "testnet", "signet"):
        return ESPLORA_TESTNET
    return ESPLORA_MAINNET


@shared_task
def monitor_btc_deposits():
    """
    Monitor BTC deposits by checking address transactions via Blockstream Esplora.

    For each BTC deposit address:
    1. Query address transactions (confirmed + mempool)
    2. Find new incoming transactions
    3. Create BlockchainDeposit records
    """
    btc_wallets = list(
        Wallet.objects.filter(
            currency="BTC",
            deposit_address__gt="",
        ).exclude(
            deposit_address__startswith="0x",
        ).exclude(
            deposit_address__startswith="T",
        ).values_list("deposit_address", flat=True)
    )

    if not btc_wallets:
        return

    base_url = _get_esplora_base()

    for address in btc_wallets:
        try:
            # Get confirmed transactions
            url = f"{base_url}/address/{address}/txs"
            response = requests.get(url, timeout=15)

            if response.status_code == 429:
                logger.warning("Esplora rate limit reached, will retry next cycle")
                return
            if response.status_code != 200:
                logger.warning(f"Esplora error for {address[:10]}...: {response.status_code}")
                continue

            txs = response.json()

            # Fetch tip height once per address (avoid redundant calls per tx)
            tip_height = None
            try:
                tip_url = f"{base_url}/blocks/tip/height"
                tip_resp = requests.get(tip_url, timeout=10)
                if tip_resp.status_code == 200:
                    tip_height = int(tip_resp.text.strip())
            except Exception:
                pass

            for tx in txs:
                tx_hash = tx.get("txid", "")
                if not tx_hash:
                    continue

                # Skip if already tracked
                if BlockchainDeposit.objects.filter(chain="bitcoin", tx_hash=tx_hash).exists():
                    continue

                # Find outputs (vout) sent to our address
                total_received = Decimal("0")
                for vout in tx.get("vout", []):
                    scriptpubkey_addr = vout.get("scriptpubkey_address", "")
                    if scriptpubkey_addr == address:
                        # Esplora amounts are in satoshis
                        total_received += Decimal(str(vout.get("value", 0))) / Decimal("100000000")

                if total_received <= 0:
                    continue

                # Security: reject dust deposits
                if is_dust_deposit(total_received, "BTC"):
                    continue

                # Security: validate address format
                if not validate_address("bitcoin", address):
                    continue

                # Security: check deposit velocity
                if not check_deposit_velocity(address, "BTC"):
                    logger.critical(f"Deposit velocity exceeded for {address[:10]}..., skipping new deposits")
                    break

                # Get sender address (first input's prevout)
                from_addr = ""
                vin = tx.get("vin", [])
                if vin and vin[0].get("prevout", {}).get("scriptpubkey_address"):
                    from_addr = vin[0]["prevout"]["scriptpubkey_address"]

                # Confirmation status
                tx_status = tx.get("status", {})
                is_confirmed = tx_status.get("confirmed", False)
                block_height = tx_status.get("block_height")

                # Calculate confirmations from tip
                confirmations = 0
                if is_confirmed and block_height and tip_height:
                    confirmations = max(0, tip_height - block_height + 1)
                elif is_confirmed:
                    confirmations = 1  # At least 1 if confirmed but tip unknown

                # Security: amount-based confirmation tier
                usd_value = estimate_usd_value(total_received, "BTC")
                dynamic_confirmations = get_required_confirmations("bitcoin", usd_value)

                status = (
                    BlockchainDeposit.Status.CONFIRMED
                    if confirmations >= dynamic_confirmations
                    else BlockchainDeposit.Status.DETECTING
                )

                BlockchainDeposit.objects.create(
                    chain="bitcoin",
                    tx_hash=tx_hash,
                    from_address=from_addr,
                    to_address=address,
                    amount=total_received,
                    currency="BTC",
                    confirmations=confirmations,
                    required_confirmations=dynamic_confirmations,
                    status=status,
                    block_number=block_height,  # None if unconfirmed (mempool)
                )

                logger.info(
                    f"Detected BTC deposit: {total_received} BTC to {address[:10]}... "
                    f"tx={tx_hash[:16]}... ({confirmations}/{dynamic_confirmations} confs)"
                )

        except requests.RequestException as e:
            logger.error(f"Esplora request failed for {address[:10]}...: {e}")
        except Exception as e:
            logger.error(f"Error monitoring BTC {address[:10]}...: {e}")


@shared_task
def update_btc_confirmations():
    """
    Update confirmation counts for pending BTC deposits.

    Does NOT credit wallets — that is handled by process_pending_deposits()
    in tasks.py, which applies full security checks (select_for_update locking,
    re-org detection, address ownership validation, stablecoin blacklist, etc.).
    """
    pending = BlockchainDeposit.objects.filter(
        chain="bitcoin",
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    if not pending.exists():
        return

    base_url = _get_esplora_base()

    # Get current tip height
    try:
        tip_resp = requests.get(f"{base_url}/blocks/tip/height", timeout=10)
        tip_height = int(tip_resp.text.strip())
    except Exception as e:
        logger.error(f"Failed to get BTC tip height: {e}")
        return

    for deposit in pending:
        try:
            # If we don't have a block_number yet (mempool tx), look it up
            if not deposit.block_number:
                url = f"{base_url}/tx/{deposit.tx_hash}"
                resp = requests.get(url, timeout=10)
                if resp.status_code != 200:
                    continue

                tx = resp.json()
                tx_status = tx.get("status", {})
                is_confirmed = tx_status.get("confirmed", False)
                block_height = tx_status.get("block_height")

                if is_confirmed and block_height:
                    deposit.block_number = block_height
                    deposit.save(update_fields=["block_number"])
                else:
                    continue  # Still in mempool

            # Calculate confirmations
            confirmations = max(0, tip_height - deposit.block_number + 1)

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

        except Exception as e:
            logger.error(f"Error updating BTC deposit {deposit.id}: {e}")

    logger.debug(f"Updated BTC confirmations for {pending.count()} deposits")
