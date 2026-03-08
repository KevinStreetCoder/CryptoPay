"""
Celery tasks for blockchain deposit monitoring.

MVP: Tron (TRC-20 USDT) deposit detection.
"""

import logging

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.wallets.models import Wallet
from apps.wallets.services import WalletService

from .models import BlockchainDeposit

logger = logging.getLogger(__name__)


@shared_task
def monitor_tron_deposits():
    """
    Poll for new TRC-20 USDT deposits on Tron.
    Runs every 10 seconds via Celery Beat.
    """
    # Get all Tron deposit addresses we're monitoring
    tron_wallets = Wallet.objects.filter(
        currency="USDT",
        deposit_address__startswith="T",
    ).values_list("deposit_address", flat=True)

    if not tron_wallets:
        return

    # TODO: Implement TronGrid API polling
    # For each address, check for new TRC-20 transfers
    # Create BlockchainDeposit records for new ones
    logger.info(f"Monitoring {len(tron_wallets)} Tron addresses for deposits")


@shared_task
def process_pending_deposits():
    """
    Check confirmation progress for pending deposits.
    Credit user wallet once required confirmations are reached.
    """
    pending = BlockchainDeposit.objects.filter(
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    for deposit in pending:
        required = settings.REQUIRED_CONFIRMATIONS.get(deposit.chain, 19)

        if deposit.confirmations >= required:
            # Find the wallet this deposit belongs to
            wallet = Wallet.objects.filter(
                deposit_address=deposit.to_address,
                currency=deposit.currency,
            ).first()

            if wallet:
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
                        f"Credited {deposit.amount} {deposit.currency} to wallet {wallet.id}"
                    )
                except Exception as e:
                    logger.error(f"Failed to credit deposit {deposit.id}: {e}")
            else:
                logger.warning(f"No wallet found for deposit to {deposit.to_address}")
        else:
            deposit.status = BlockchainDeposit.Status.CONFIRMING
            deposit.save(update_fields=["status"])
