"""
On-chain reconciliation service.

Periodically compares on-chain balances of deposit addresses and hot wallets
against internal DB records to detect discrepancies.

Discrepancy types:
1. SURPLUS: On-chain balance higher than expected (missed deposit, or unsent sweep)
2. DEFICIT: On-chain balance lower than expected (unauthorized withdrawal, or sweep credited but not sent)
3. HOT_WALLET_MISMATCH: Hot wallet on-chain balance differs from SystemWallet HOT record

Any discrepancy > threshold triggers a CRITICAL alert for immediate investigation.
"""

import logging
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Sum
from django.utils import timezone

from apps.wallets.models import SystemWallet, Wallet

from .models import BlockchainDeposit, SweepOrder
from .sweep import (
    CURRENCY_CHAIN,
    SWEEP_MINIMUM_AMOUNTS,
    _get_hot_wallet_address,
    get_on_chain_balance,
)

logger = logging.getLogger(__name__)

# Tolerance thresholds per currency -- discrepancies below these are rounding/gas
RECONCILIATION_TOLERANCE = {
    "BTC": Decimal("0.00001"),      # ~$1
    "ETH": Decimal("0.0005"),       # ~$1.25
    "USDT": Decimal("1.00"),        # $1
    "USDC": Decimal("1.00"),        # $1
    "SOL": Decimal("0.01"),         # ~$1.50
}

# Maximum addresses to reconcile per chain per run (prevent timeout)
MAX_ADDRESSES_PER_CHAIN = 100

# Chains and their sweepable currencies (must match sweep.py chain_currencies)
CHAIN_CURRENCIES = {
    "tron": ["USDT"],
    "ethereum": ["ETH", "USDC"],
    "bitcoin": ["BTC"],
    "solana": ["SOL"],
}


def reconcile_deposit_addresses(chain: str) -> list[dict]:
    """
    Compare on-chain balances of deposit addresses against expected balances.

    Expected balance = sum of CREDITED deposits - sum of CREDITED sweeps.
    If the address has been fully swept, expected on-chain balance is ~0.
    If a sweep is in-flight (SUBMITTED/CONFIRMING), the balance may be in transit.

    Returns a list of discrepancy dicts for addresses with unexpected balances.
    """
    currencies = CHAIN_CURRENCIES.get(chain, [])
    if not currencies:
        return []

    discrepancies = []

    # Get all wallets with deposit addresses for this chain's currencies
    wallets = list(
        Wallet.objects.filter(
            currency__in=currencies,
            deposit_address__gt="",
        )
        .values("deposit_address", "currency", "user_id")
        [:MAX_ADDRESSES_PER_CHAIN]
    )

    for wallet_data in wallets:
        address = wallet_data["deposit_address"]
        currency = wallet_data["currency"]

        # Skip addresses with active sweeps (balance is in transit)
        has_active_sweep = SweepOrder.objects.filter(
            chain=chain,
            from_address=address,
            status__in=[
                SweepOrder.Status.PENDING,
                SweepOrder.Status.ESTIMATING,
                SweepOrder.Status.SUBMITTED,
                SweepOrder.Status.CONFIRMING,
            ],
        ).exists()

        if has_active_sweep:
            continue

        # Calculate expected on-chain balance:
        # Total credited deposits - total credited sweeps = should remain on-chain
        total_deposited = (
            BlockchainDeposit.objects.filter(
                chain=chain,
                to_address=address,
                currency=currency,
                status=BlockchainDeposit.Status.CREDITED,
            )
            .aggregate(total=Sum("amount"))["total"]
            or Decimal("0")
        )

        total_swept = (
            SweepOrder.objects.filter(
                chain=chain,
                from_address=address,
                currency=currency,
                status=SweepOrder.Status.CREDITED,
            )
            .aggregate(total=Sum("amount"))["total"]
            or Decimal("0")
        )

        expected_balance = total_deposited - total_swept
        if expected_balance < 0:
            expected_balance = Decimal("0")

        # Query actual on-chain balance
        try:
            actual_balance = get_on_chain_balance(chain, address, currency)
        except Exception as e:
            logger.warning(
                f"Reconciliation: failed to get balance for {address[:12]}... "
                f"on {chain}: {e}"
            )
            continue

        # Compare
        diff = actual_balance - expected_balance
        tolerance = RECONCILIATION_TOLERANCE.get(currency, Decimal("1"))

        if abs(diff) > tolerance:
            disc_type = "SURPLUS" if diff > 0 else "DEFICIT"
            discrepancy = {
                "type": disc_type,
                "chain": chain,
                "currency": currency,
                "address": address,
                "user_id": str(wallet_data["user_id"]),
                "expected": str(expected_balance),
                "actual": str(actual_balance),
                "difference": str(diff),
            }
            discrepancies.append(discrepancy)

            log_fn = logger.critical if disc_type == "DEFICIT" else logger.warning
            log_fn(
                f"RECONCILIATION {disc_type}: {chain} {currency} "
                f"address={address[:12]}... "
                f"expected={expected_balance}, actual={actual_balance}, "
                f"diff={diff}"
            )

    return discrepancies


def reconcile_hot_wallets() -> list[dict]:
    """
    Compare hot wallet on-chain balances against SystemWallet HOT records.

    The SystemWallet HOT balance is incremented when sweep orders are CREDITED.
    It is decremented when rebalance orders sell crypto. The on-chain balance
    should approximately match the DB record.

    Discrepancies indicate:
    - Missing sweep credits (SURPLUS on-chain)
    - Unauthorized outflows (DEFICIT on-chain)
    - Stale DB balance (sweep credited but not yet reflected)
    """
    discrepancies = []

    for chain, currencies in CHAIN_CURRENCIES.items():
        try:
            hot_address = _get_hot_wallet_address(chain)
        except ValueError:
            # Hot wallet not configured for this chain
            continue

        for currency in currencies:
            # Get DB balance
            try:
                system_wallet = SystemWallet.objects.get(
                    wallet_type=SystemWallet.WalletType.HOT,
                    currency=currency,
                )
                db_balance = system_wallet.balance
            except SystemWallet.DoesNotExist:
                db_balance = Decimal("0")

            # Get on-chain balance
            try:
                onchain_balance = get_on_chain_balance(chain, hot_address, currency)
            except Exception as e:
                logger.warning(
                    f"Reconciliation: failed to get hot wallet balance "
                    f"for {chain}/{currency}: {e}"
                )
                continue

            diff = onchain_balance - db_balance
            tolerance = RECONCILIATION_TOLERANCE.get(currency, Decimal("1"))

            if abs(diff) > tolerance:
                disc_type = "HOT_WALLET_SURPLUS" if diff > 0 else "HOT_WALLET_DEFICIT"
                discrepancy = {
                    "type": disc_type,
                    "chain": chain,
                    "currency": currency,
                    "address": hot_address,
                    "db_balance": str(db_balance),
                    "onchain_balance": str(onchain_balance),
                    "difference": str(diff),
                }
                discrepancies.append(discrepancy)

                log_fn = logger.critical if "DEFICIT" in disc_type else logger.warning
                log_fn(
                    f"RECONCILIATION {disc_type}: {chain} {currency} "
                    f"hot_wallet={hot_address[:12]}... "
                    f"db={db_balance}, onchain={onchain_balance}, "
                    f"diff={diff}"
                )

    return discrepancies


def run_full_reconciliation() -> dict:
    """
    Run full reconciliation across all chains and hot wallets.

    Returns a summary dict suitable for the admin dashboard and alerting.
    """
    now = timezone.now()
    all_discrepancies = []

    # 1. Reconcile deposit addresses
    for chain in CHAIN_CURRENCIES:
        try:
            chain_discs = reconcile_deposit_addresses(chain)
            all_discrepancies.extend(chain_discs)
        except Exception as e:
            logger.error(f"Reconciliation failed for {chain} deposits: {e}", exc_info=True)

    # 2. Reconcile hot wallets
    try:
        hot_discs = reconcile_hot_wallets()
        all_discrepancies.extend(hot_discs)
    except Exception as e:
        logger.error(f"Hot wallet reconciliation failed: {e}", exc_info=True)

    # Categorize
    deficits = [d for d in all_discrepancies if "DEFICIT" in d["type"]]
    surpluses = [d for d in all_discrepancies if "SURPLUS" in d["type"]]

    summary = {
        "timestamp": now.isoformat(),
        "total_discrepancies": len(all_discrepancies),
        "deficits": len(deficits),
        "surpluses": len(surpluses),
        "critical": len(deficits),  # All deficits are critical
        "details": all_discrepancies,
    }

    if deficits:
        logger.critical(
            f"RECONCILIATION ALERT: {len(deficits)} deficit(s) detected! "
            f"Possible unauthorized outflows. Immediate investigation required."
        )
    elif all_discrepancies:
        logger.info(
            f"Reconciliation complete: {len(surpluses)} surplus(es) found "
            f"(likely unsent sweeps). No deficits."
        )
    else:
        logger.info("Reconciliation complete: all balances match.")

    return summary
