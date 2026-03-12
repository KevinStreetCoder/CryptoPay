"""
Bitcoin deposit listener.

Monitors BTC deposits using BlockCypher API (free tier: 200 requests/hour).
Tracks UTXO-based transactions to our deposit addresses.

BlockCypher free tier: 200 req/hr, 3 requests/sec, no API key needed.
With API key: 2000 req/hr.
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
from .security import check_confirmation_monotonicity, is_dust_deposit, is_rbf_signaled, estimate_usd_value, get_required_confirmations

logger = logging.getLogger(__name__)


def _get_blockcypher_base() -> str:
    """Get BlockCypher API base URL."""
    network = getattr(settings, "BTC_NETWORK", "main")
    if network == "test3":
        return "https://api.blockcypher.com/v1/btc/test3"
    return "https://api.blockcypher.com/v1/btc/main"


def _blockcypher_params() -> dict:
    """Get API token params if configured."""
    token = getattr(settings, "BLOCKCYPHER_API_TOKEN", "")
    return {"token": token} if token else {}


@shared_task
def monitor_btc_deposits():
    """
    Monitor BTC deposits by checking address balances via BlockCypher.

    For each BTC deposit address:
    1. Query address full transactions
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

    base_url = _get_blockcypher_base()
    params = _blockcypher_params()
    required_confirmations = settings.REQUIRED_CONFIRMATIONS.get("bitcoin", 3)

    for address in btc_wallets:
        try:
            # Get address transactions
            url = f"{base_url}/addrs/{address}/full"
            req_params = {**params, "limit": 20}
            response = requests.get(url, params=req_params, timeout=15)

            if response.status_code == 429:
                logger.warning("BlockCypher rate limit reached, will retry next cycle")
                return  # Stop all scanning, retry next beat cycle
            if response.status_code != 200:
                logger.warning(f"BlockCypher error for {address[:10]}...: {response.status_code}")
                continue

            data = response.json()
            txs = data.get("txs", [])

            for tx in txs:
                tx_hash = tx.get("hash", "")
                if not tx_hash:
                    continue

                # Skip if already tracked
                if BlockchainDeposit.objects.filter(chain="bitcoin", tx_hash=tx_hash).exists():
                    continue

                # Find outputs sent to our address
                total_received = Decimal("0")
                for output in tx.get("outputs", []):
                    addrs = output.get("addresses", [])
                    if address in addrs:
                        # Amount is in satoshis
                        total_received += Decimal(str(output.get("value", 0))) / Decimal("100000000")

                if total_received <= 0:
                    continue

                # Security: reject dust deposits
                if is_dust_deposit(total_received, "BTC"):
                    continue

                # Get sender address (first input)
                from_addr = ""
                inputs = tx.get("inputs", [])
                if inputs and inputs[0].get("addresses"):
                    from_addr = inputs[0]["addresses"][0]

                confirmations = tx.get("confirmations", 0)
                block_height = tx.get("block_height", None)

                # Security: RBF detection — unconfirmed RBF txs can be replaced
                rbf_flagged = is_rbf_signaled(tx) if confirmations == 0 else False
                if rbf_flagged:
                    logger.warning(
                        f"RBF-signaled unconfirmed BTC tx {tx_hash[:16]}... "
                        f"— will not credit until confirmed"
                    )

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
                    block_number=block_height or 0,
                )

                logger.info(
                    f"Detected BTC deposit: {total_received} BTC to {address[:10]}... "
                    f"tx={tx_hash[:16]}... ({confirmations}/{dynamic_confirmations} confs)"
                )

        except requests.RequestException as e:
            logger.error(f"BlockCypher request failed for {address[:10]}...: {e}")
        except Exception as e:
            logger.error(f"Error monitoring BTC {address[:10]}...: {e}")

    logger.debug(f"Monitored {len(btc_wallets)} BTC addresses for deposits")


@shared_task
def update_btc_confirmations():
    """Update confirmation counts for pending BTC deposits."""
    pending = BlockchainDeposit.objects.filter(
        chain="bitcoin",
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    if not pending.exists():
        return

    base_url = _get_blockcypher_base()
    params = _blockcypher_params()
    required = settings.REQUIRED_CONFIRMATIONS.get("bitcoin", 3)

    for deposit in pending:
        try:
            url = f"{base_url}/txs/{deposit.tx_hash}"
            response = requests.get(url, params=params, timeout=15)

            if response.status_code == 429:
                logger.warning("BlockCypher rate limit, pausing BTC confirmation updates")
                return
            if response.status_code != 200:
                continue

            tx_data = response.json()
            confirmations = tx_data.get("confirmations", 0)

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

            # Update block number if now confirmed
            if not deposit.block_number and tx_data.get("block_height"):
                deposit.block_number = tx_data["block_height"]
                deposit.save(update_fields=["confirmations", "status", "block_number"])
            else:
                deposit.save(update_fields=["confirmations", "status"])

        except Exception as e:
            logger.error(f"BTC confirmation update failed for tx {deposit.tx_hash[:16]}...: {e}")

    logger.debug(f"Updated BTC confirmations for {pending.count()} deposits")
