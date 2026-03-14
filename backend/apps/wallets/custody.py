"""
Tiered Custody Service — Hot/Warm/Cold wallet architecture.

Manages the platform's crypto holdings across three security tiers:

  HOT  (5%)  — Online, auto-signing. Serves user withdrawals and payments.
               Replenished automatically from warm wallet when balance drops.
  WARM (15%) — Online, multi-sig or delayed signing. Buffer between hot and cold.
               Receives swept user deposits. Feeds hot wallet on demand.
  COLD (80%) — Offline/HSM. Long-term storage. Manual transfers only.
               Only accessed for large rebalances or emergency replenishment.

Thresholds trigger automatic rebalancing:
  - Hot wallet > max_threshold → excess swept to warm
  - Hot wallet < min_threshold → warm tops up hot
  - Warm wallet > max_threshold → excess moved to cold (manual approval)

All transfers are logged to CustodyTransfer model for audit compliance.
"""

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from typing import Optional

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import F, Sum, Value
from django.db.models.functions import Greatest
from django.utils import timezone

from .models import Currency, CustodyTransfer, SystemWallet, WalletTier

logger = logging.getLogger(__name__)

# Redis lock keys
CUSTODY_REBALANCE_LOCK = "custody:rebalance:lock"
CUSTODY_DAILY_WITHDRAWAL_KEY = "custody:daily_withdrawal:{currency}:{tier}"


# ── Configuration ─────────────────────────────────────────────────────────────

@dataclass
class CustodyConfig:
    """Threshold configuration for a single currency's custody tiers."""

    currency: str

    # Target allocation percentages (must sum to 100)
    hot_target_pct: Decimal = Decimal("5")
    warm_target_pct: Decimal = Decimal("15")
    cold_target_pct: Decimal = Decimal("80")

    # Hot wallet thresholds (absolute amounts) — trigger rebalance when breached
    hot_min_threshold: Decimal = Decimal("0")
    hot_max_threshold: Decimal = Decimal("0")

    # Warm wallet thresholds
    warm_min_threshold: Decimal = Decimal("0")
    warm_max_threshold: Decimal = Decimal("0")

    # Rate limiting
    max_single_withdrawal: Decimal = Decimal("0")
    daily_withdrawal_cap: Decimal = Decimal("0")

    def __post_init__(self):
        total = self.hot_target_pct + self.warm_target_pct + self.cold_target_pct
        if total != Decimal("100"):
            raise ValueError(
                f"Custody allocation for {self.currency} must sum to 100%, got {total}%"
            )


# Default configurations per currency.
# Override via CUSTODY_THRESHOLDS in Django settings.
DEFAULT_CONFIGS: dict[str, CustodyConfig] = {
    "USDT": CustodyConfig(
        currency="USDT",
        hot_min_threshold=Decimal("500"),       # $500
        hot_max_threshold=Decimal("5000"),       # $5,000
        warm_min_threshold=Decimal("1000"),      # $1,000
        warm_max_threshold=Decimal("20000"),     # $20,000
        max_single_withdrawal=Decimal("2000"),   # $2,000 per transfer
        daily_withdrawal_cap=Decimal("10000"),   # $10,000/day
    ),
    "USDC": CustodyConfig(
        currency="USDC",
        hot_min_threshold=Decimal("500"),
        hot_max_threshold=Decimal("5000"),
        warm_min_threshold=Decimal("1000"),
        warm_max_threshold=Decimal("20000"),
        max_single_withdrawal=Decimal("2000"),
        daily_withdrawal_cap=Decimal("10000"),
    ),
    "BTC": CustodyConfig(
        currency="BTC",
        hot_min_threshold=Decimal("0.01"),       # ~$500
        hot_max_threshold=Decimal("0.1"),         # ~$5,000
        warm_min_threshold=Decimal("0.02"),
        warm_max_threshold=Decimal("0.5"),
        max_single_withdrawal=Decimal("0.05"),
        daily_withdrawal_cap=Decimal("0.2"),
    ),
    "ETH": CustodyConfig(
        currency="ETH",
        hot_min_threshold=Decimal("0.2"),        # ~$500
        hot_max_threshold=Decimal("2.0"),         # ~$5,000
        warm_min_threshold=Decimal("0.5"),
        warm_max_threshold=Decimal("10.0"),
        max_single_withdrawal=Decimal("1.0"),
        daily_withdrawal_cap=Decimal("5.0"),
    ),
    "SOL": CustodyConfig(
        currency="SOL",
        hot_min_threshold=Decimal("3"),           # ~$500
        hot_max_threshold=Decimal("30"),           # ~$5,000
        warm_min_threshold=Decimal("5"),
        warm_max_threshold=Decimal("100"),
        max_single_withdrawal=Decimal("15"),
        daily_withdrawal_cap=Decimal("50"),
    ),
}


def get_custody_config(currency: str) -> CustodyConfig:
    """Get custody configuration for a currency, with settings overrides."""
    # Check for overrides in Django settings
    overrides = getattr(settings, "CUSTODY_THRESHOLDS", {})
    if currency in overrides:
        return CustodyConfig(currency=currency, **overrides[currency])
    return DEFAULT_CONFIGS.get(currency, CustodyConfig(currency=currency))


# ── Custody Service ───────────────────────────────────────────────────────────

class CustodyService:
    """
    Manages tiered custody operations across hot/warm/cold wallets.

    Responsibilities:
    - Monitor tier balances and detect threshold breaches
    - Initiate transfers between tiers (with rate limiting)
    - Generate custody reports for compliance
    - Track daily withdrawal volumes per tier
    """

    CRYPTO_CURRENCIES = ["USDT", "USDC", "BTC", "ETH", "SOL"]

    def get_tier_balances(self, currency: str) -> dict[str, Decimal]:
        """
        Get the current balance for each tier of a given currency.

        Returns dict with keys: hot, warm, cold, total
        """
        balances = {"hot": Decimal("0"), "warm": Decimal("0"), "cold": Decimal("0")}

        wallets = SystemWallet.objects.filter(
            currency=currency,
            is_active=True,
            wallet_type__in=["hot", "warm", "cold"],
        )

        for wallet in wallets:
            tier = wallet.wallet_type
            if tier in balances:
                balances[tier] = wallet.balance

        balances["total"] = balances["hot"] + balances["warm"] + balances["cold"]
        return balances

    def check_rebalance_needed(self, currency: str) -> Optional[dict]:
        """
        Check if any tier threshold is breached and rebalance is needed.

        Returns:
            None if no rebalance needed, or a dict with:
            - direction: "hot_to_warm", "warm_to_hot", "warm_to_cold", "cold_to_warm"
            - amount: suggested transfer amount
            - reason: human-readable explanation
        """
        config = get_custody_config(currency)
        balances = self.get_tier_balances(currency)

        # Skip if no funds at all
        if balances["total"] <= 0:
            return None

        hot = balances["hot"]
        warm = balances["warm"]

        # Priority 1: Hot wallet too low — needs urgent replenishment
        if hot < config.hot_min_threshold and warm > 0:
            target_hot = balances["total"] * config.hot_target_pct / 100
            deficit = max(target_hot - hot, config.hot_min_threshold - hot)
            transfer_amount = min(deficit, warm)  # Can't transfer more than warm has
            if transfer_amount > 0:
                return {
                    "direction": "warm_to_hot",
                    "amount": transfer_amount.quantize(Decimal("0.00000001")),
                    "reason": (
                        f"Hot wallet {currency} balance ({hot}) below min threshold "
                        f"({config.hot_min_threshold}). Replenishing from warm."
                    ),
                }

        # Priority 2: Hot wallet too high — sweep excess to warm
        if hot > config.hot_max_threshold:
            target_hot = balances["total"] * config.hot_target_pct / 100
            excess = hot - max(target_hot, config.hot_min_threshold)
            if excess > 0:
                return {
                    "direction": "hot_to_warm",
                    "amount": excess.quantize(Decimal("0.00000001")),
                    "reason": (
                        f"Hot wallet {currency} balance ({hot}) above max threshold "
                        f"({config.hot_max_threshold}). Sweeping excess to warm."
                    ),
                }

        # Priority 3: Warm wallet too high — move to cold
        if warm > config.warm_max_threshold:
            target_warm = balances["total"] * config.warm_target_pct / 100
            excess = warm - max(target_warm, config.warm_min_threshold)
            if excess > 0:
                return {
                    "direction": "warm_to_cold",
                    "amount": excess.quantize(Decimal("0.00000001")),
                    "reason": (
                        f"Warm wallet {currency} balance ({warm}) above max threshold "
                        f"({config.warm_max_threshold}). Moving excess to cold storage."
                    ),
                }

        # Priority 4: Warm wallet too low and cold has funds
        cold = balances["cold"]
        if warm < config.warm_min_threshold and cold > 0:
            target_warm = balances["total"] * config.warm_target_pct / 100
            deficit = target_warm - warm
            transfer_amount = min(deficit, cold)
            if transfer_amount > 0:
                return {
                    "direction": "cold_to_warm",
                    "amount": transfer_amount.quantize(Decimal("0.00000001")),
                    "reason": (
                        f"Warm wallet {currency} balance ({warm}) below min threshold "
                        f"({config.warm_min_threshold}). Requesting cold storage release."
                    ),
                }

        return None

    @transaction.atomic
    def initiate_hot_to_warm_transfer(
        self,
        currency: str,
        amount: Decimal,
        initiated_by: str = "system",
        reason: str = "",
    ) -> CustodyTransfer:
        """
        Initiate a transfer from hot wallet to warm wallet.

        This is typically triggered automatically when the hot wallet
        exceeds its max threshold after user deposits are swept in.
        """
        config = get_custody_config(currency)

        # Rate limit check
        self._check_rate_limits(config, amount, WalletTier.HOT)

        # Verify hot wallet has sufficient balance
        hot_wallet = self._get_or_create_wallet("hot", currency, WalletTier.HOT)
        if hot_wallet.balance < amount:
            raise ValueError(
                f"Insufficient hot wallet balance for {currency}: "
                f"have {hot_wallet.balance}, need {amount}"
            )

        warm_wallet = self._get_or_create_wallet("warm", currency, WalletTier.WARM)

        # Create transfer record
        transfer = CustodyTransfer.objects.create(
            from_tier=WalletTier.HOT,
            to_tier=WalletTier.WARM,
            currency=currency,
            amount=amount,
            status=CustodyTransfer.Status.PENDING,
            from_address=hot_wallet.address,
            to_address=warm_wallet.address,
            initiated_by=initiated_by,
            reason=reason or f"Hot→Warm sweep: hot balance exceeded max threshold",
        )

        # Update balances atomically
        SystemWallet.objects.filter(id=hot_wallet.id).update(
            balance=Greatest(F("balance") - amount, Value(Decimal("0"))),
        )
        SystemWallet.objects.filter(id=warm_wallet.id).update(
            balance=F("balance") + amount,
        )

        # Mark as completed (internal ledger transfer, no on-chain TX needed
        # if hot and warm are on the same infrastructure)
        transfer.status = CustodyTransfer.Status.COMPLETED
        transfer.completed_at = timezone.now()
        transfer.save(update_fields=["status", "completed_at", "updated_at"])

        # Track daily withdrawal volume
        self._record_daily_withdrawal(currency, WalletTier.HOT, amount)

        # Audit log
        self._audit_log(
            "CUSTODY_HOT_TO_WARM",
            transfer,
            f"Transferred {amount} {currency} from hot to warm wallet",
        )

        logger.info(
            f"Custody transfer {str(transfer.id)[:8]}: "
            f"{amount} {currency} hot→warm | initiated_by={initiated_by}"
        )

        return transfer

    @transaction.atomic
    def initiate_warm_to_hot_transfer(
        self,
        currency: str,
        amount: Decimal,
        initiated_by: str = "system",
        reason: str = "",
    ) -> CustodyTransfer:
        """
        Initiate a transfer from warm wallet to hot wallet.

        This is typically triggered automatically when the hot wallet
        drops below its min threshold (e.g., after large user withdrawals).
        """
        config = get_custody_config(currency)

        # Rate limit check
        self._check_rate_limits(config, amount, WalletTier.WARM)

        # Verify warm wallet has sufficient balance
        warm_wallet = self._get_or_create_wallet("warm", currency, WalletTier.WARM)
        if warm_wallet.balance < amount:
            raise ValueError(
                f"Insufficient warm wallet balance for {currency}: "
                f"have {warm_wallet.balance}, need {amount}"
            )

        hot_wallet = self._get_or_create_wallet("hot", currency, WalletTier.HOT)

        # Create transfer record
        transfer = CustodyTransfer.objects.create(
            from_tier=WalletTier.WARM,
            to_tier=WalletTier.HOT,
            currency=currency,
            amount=amount,
            status=CustodyTransfer.Status.PENDING,
            from_address=warm_wallet.address,
            to_address=hot_wallet.address,
            initiated_by=initiated_by,
            reason=reason or f"Warm→Hot replenishment: hot balance below min threshold",
        )

        # Update balances atomically
        SystemWallet.objects.filter(id=warm_wallet.id).update(
            balance=Greatest(F("balance") - amount, Value(Decimal("0"))),
        )
        SystemWallet.objects.filter(id=hot_wallet.id).update(
            balance=F("balance") + amount,
        )

        transfer.status = CustodyTransfer.Status.COMPLETED
        transfer.completed_at = timezone.now()
        transfer.save(update_fields=["status", "completed_at", "updated_at"])

        self._record_daily_withdrawal(currency, WalletTier.WARM, amount)

        self._audit_log(
            "CUSTODY_WARM_TO_HOT",
            transfer,
            f"Transferred {amount} {currency} from warm to hot wallet",
        )

        logger.info(
            f"Custody transfer {str(transfer.id)[:8]}: "
            f"{amount} {currency} warm→hot | initiated_by={initiated_by}"
        )

        return transfer

    @transaction.atomic
    def initiate_warm_to_cold_transfer(
        self,
        currency: str,
        amount: Decimal,
        initiated_by: str = "system",
        reason: str = "",
    ) -> CustodyTransfer:
        """
        Initiate a transfer from warm wallet to cold storage.

        Cold transfers are always logged as PENDING and require manual
        confirmation since cold wallets are typically offline/HSM.
        """
        warm_wallet = self._get_or_create_wallet("warm", currency, WalletTier.WARM)
        if warm_wallet.balance < amount:
            raise ValueError(
                f"Insufficient warm wallet balance for {currency}: "
                f"have {warm_wallet.balance}, need {amount}"
            )

        cold_wallet = self._get_or_create_wallet("cold", currency, WalletTier.COLD)

        transfer = CustodyTransfer.objects.create(
            from_tier=WalletTier.WARM,
            to_tier=WalletTier.COLD,
            currency=currency,
            amount=amount,
            status=CustodyTransfer.Status.PENDING,
            from_address=warm_wallet.address,
            to_address=cold_wallet.address,
            initiated_by=initiated_by,
            reason=reason or f"Warm→Cold: warm balance exceeded max threshold",
        )

        # Deduct from warm immediately (locked for transfer)
        SystemWallet.objects.filter(id=warm_wallet.id).update(
            balance=Greatest(F("balance") - amount, Value(Decimal("0"))),
        )

        self._audit_log(
            "CUSTODY_WARM_TO_COLD_INITIATED",
            transfer,
            f"Transfer {amount} {currency} warm→cold initiated. "
            f"Awaiting cold wallet confirmation.",
        )

        # Notify admin for manual cold storage deposit
        self._notify_admin_cold_transfer(transfer)

        logger.info(
            f"Custody transfer {str(transfer.id)[:8]}: "
            f"{amount} {currency} warm→cold PENDING | initiated_by={initiated_by}"
        )

        return transfer

    @transaction.atomic
    def confirm_cold_transfer(
        self,
        transfer_id: str,
        tx_hash: str = "",
        admin_notes: str = "",
    ) -> CustodyTransfer:
        """
        Confirm a pending warm→cold or cold→warm transfer.
        Called by admin after manual cold storage operation.
        """
        transfer = CustodyTransfer.objects.select_for_update().get(id=transfer_id)

        if transfer.status not in (
            CustodyTransfer.Status.PENDING,
            CustodyTransfer.Status.SUBMITTED,
            CustodyTransfer.Status.CONFIRMED,
        ):
            raise ValueError(
                f"Transfer {transfer_id} is {transfer.status}, cannot confirm"
            )

        now = timezone.now()

        # Credit the destination wallet
        dest_type = transfer.to_tier  # "cold" or "hot" or "warm"
        SystemWallet.objects.filter(
            wallet_type=dest_type,
            currency=transfer.currency,
        ).update(balance=F("balance") + transfer.amount)

        transfer.status = CustodyTransfer.Status.COMPLETED
        transfer.tx_hash = tx_hash
        transfer.completed_at = now
        if admin_notes:
            transfer.reason = f"{transfer.reason}\nAdmin: {admin_notes}"
        transfer.save(update_fields=[
            "status", "tx_hash", "completed_at", "reason", "updated_at",
        ])

        self._audit_log(
            "CUSTODY_TRANSFER_CONFIRMED",
            transfer,
            f"Cold transfer confirmed: {transfer.amount} {transfer.currency} "
            f"{transfer.from_tier}→{transfer.to_tier} | tx={tx_hash[:16] if tx_hash else 'N/A'}",
        )

        logger.info(
            f"Custody transfer {str(transfer.id)[:8]} CONFIRMED: "
            f"{transfer.amount} {transfer.currency} {transfer.from_tier}→{transfer.to_tier}"
        )

        return transfer

    def get_custody_report(self) -> dict:
        """
        Generate a comprehensive custody report across all currencies and tiers.

        Returns a structured dict suitable for API response or logging.
        """
        report = {
            "generated_at": timezone.now().isoformat(),
            "currencies": {},
            "totals": {
                "hot": Decimal("0"),
                "warm": Decimal("0"),
                "cold": Decimal("0"),
            },
            "active_transfers": [],
            "recent_transfers": [],
            "alerts": [],
        }

        for currency in self.CRYPTO_CURRENCIES:
            config = get_custody_config(currency)
            balances = self.get_tier_balances(currency)
            rebalance_needed = self.check_rebalance_needed(currency)

            # Calculate actual percentages
            total = balances["total"]
            pcts = {}
            if total > 0:
                pcts = {
                    "hot_pct": float(balances["hot"] / total * 100),
                    "warm_pct": float(balances["warm"] / total * 100),
                    "cold_pct": float(balances["cold"] / total * 100),
                }
            else:
                pcts = {"hot_pct": 0, "warm_pct": 0, "cold_pct": 0}

            currency_report = {
                "balances": {k: str(v) for k, v in balances.items()},
                "allocation_pct": pcts,
                "targets": {
                    "hot_target_pct": str(config.hot_target_pct),
                    "warm_target_pct": str(config.warm_target_pct),
                    "cold_target_pct": str(config.cold_target_pct),
                },
                "thresholds": {
                    "hot_min": str(config.hot_min_threshold),
                    "hot_max": str(config.hot_max_threshold),
                    "warm_min": str(config.warm_min_threshold),
                    "warm_max": str(config.warm_max_threshold),
                },
                "rate_limits": {
                    "max_single_withdrawal": str(config.max_single_withdrawal),
                    "daily_withdrawal_cap": str(config.daily_withdrawal_cap),
                },
                "rebalance_needed": rebalance_needed,
            }

            report["currencies"][currency] = currency_report

            # Generate alerts
            if rebalance_needed:
                report["alerts"].append({
                    "currency": currency,
                    "severity": "high" if rebalance_needed["direction"] == "warm_to_hot" else "medium",
                    "message": rebalance_needed["reason"],
                    "action": rebalance_needed["direction"],
                    "amount": str(rebalance_needed["amount"]),
                })

        # Wallet details with addresses and reconciliation status
        wallets = SystemWallet.objects.filter(
            wallet_type__in=["hot", "warm", "cold"],
            is_active=True,
        ).order_by("currency", "wallet_type")

        report["wallets"] = [
            {
                "id": str(w.id),
                "type": w.wallet_type,
                "tier": w.tier,
                "currency": w.currency,
                "chain": w.chain,
                "address": w.address[:10] + "..." + w.address[-6:] if len(w.address) > 16 else w.address,
                "balance": str(w.balance),
                "last_reconciled": w.last_reconciled.isoformat() if w.last_reconciled else None,
                "max_daily_withdrawal": str(w.max_daily_withdrawal) if w.max_daily_withdrawal else None,
            }
            for w in wallets
        ]

        # Active (in-flight) transfers
        active_transfers = CustodyTransfer.objects.filter(
            status__in=[
                CustodyTransfer.Status.PENDING,
                CustodyTransfer.Status.SUBMITTED,
                CustodyTransfer.Status.CONFIRMED,
            ],
        ).order_by("-created_at")

        report["active_transfers"] = [
            {
                "id": str(t.id),
                "from_tier": t.from_tier,
                "to_tier": t.to_tier,
                "currency": t.currency,
                "amount": str(t.amount),
                "status": t.status,
                "initiated_by": t.initiated_by,
                "created_at": t.created_at.isoformat(),
            }
            for t in active_transfers
        ]

        # Recent completed transfers (last 10)
        recent = CustodyTransfer.objects.filter(
            status=CustodyTransfer.Status.COMPLETED,
        ).order_by("-completed_at")[:10]

        report["recent_transfers"] = [
            {
                "id": str(t.id),
                "from_tier": t.from_tier,
                "to_tier": t.to_tier,
                "currency": t.currency,
                "amount": str(t.amount),
                "tx_hash": t.tx_hash[:16] + "..." if t.tx_hash else "",
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
            }
            for t in recent
        ]

        return report

    def reconcile_balances(self, currency: str) -> dict:
        """
        Reconcile on-chain balances with DB records for a currency.

        In production, this would query each chain's RPC to verify balances.
        For now, it updates last_reconciled timestamp and returns status.
        """
        now = timezone.now()
        results = {}

        for tier in ["hot", "warm", "cold"]:
            try:
                wallet = SystemWallet.objects.get(
                    wallet_type=tier,
                    currency=currency,
                    is_active=True,
                )

                # On-chain reconciliation: uses the same RPC queries as sweep.py
                # When wallet has an on-chain address, query real balance
                on_chain_balance = None
                discrepancy = None
                if wallet.address:
                    try:
                        from apps.blockchain.sweep import get_on_chain_balance
                        chain = wallet.chain or self._currency_to_chain(currency)
                        on_chain_balance = get_on_chain_balance(
                            chain, wallet.address, currency,
                        )
                        discrepancy = on_chain_balance - wallet.balance
                        if abs(discrepancy) > Decimal("0.001"):
                            level = "CRITICAL" if discrepancy < 0 else "WARNING"
                            logger.warning(
                                f"{level}: {tier}/{currency} reconciliation mismatch: "
                                f"DB={wallet.balance}, on-chain={on_chain_balance}, "
                                f"discrepancy={discrepancy}"
                            )
                    except Exception as e:
                        logger.error(f"On-chain balance query failed for {tier}/{currency}: {e}")

                wallet.last_reconciled = now
                wallet.save(update_fields=["last_reconciled", "updated_at"])

                results[tier] = {
                    "db_balance": str(wallet.balance),
                    "last_reconciled": now.isoformat(),
                    "status": "ok",
                }
                if on_chain_balance is not None:
                    results[tier]["on_chain_balance"] = str(on_chain_balance)
                    results[tier]["discrepancy"] = str(discrepancy)

            except SystemWallet.DoesNotExist:
                results[tier] = {"status": "no_wallet"}

        return results

    # ── Private helpers ───────────────────────────────────────────────────────

    def _get_or_create_wallet(
        self,
        wallet_type: str,
        currency: str,
        tier: str,
    ) -> SystemWallet:
        """Get or create a SystemWallet for the given type/currency/tier."""
        wallet, created = SystemWallet.objects.get_or_create(
            wallet_type=wallet_type,
            currency=currency,
            defaults={
                "tier": tier,
                "is_active": True,
            },
        )
        if created:
            logger.info(f"Created SystemWallet: {wallet_type}/{currency}/{tier}")
        return wallet

    def _check_rate_limits(
        self,
        config: CustodyConfig,
        amount: Decimal,
        from_tier: str,
    ) -> None:
        """Check single-transfer and daily withdrawal limits."""
        if config.max_single_withdrawal > 0 and amount > config.max_single_withdrawal:
            raise ValueError(
                f"Transfer amount {amount} {config.currency} exceeds max single "
                f"withdrawal limit of {config.max_single_withdrawal}"
            )

        if config.daily_withdrawal_cap > 0:
            daily_key = CUSTODY_DAILY_WITHDRAWAL_KEY.format(
                currency=config.currency,
                tier=from_tier,
            )
            daily_total = Decimal(str(cache.get(daily_key, "0")))
            if daily_total + amount > config.daily_withdrawal_cap:
                raise ValueError(
                    f"Transfer would exceed daily withdrawal cap for "
                    f"{config.currency} {from_tier} wallet: "
                    f"used {daily_total}, requesting {amount}, "
                    f"cap {config.daily_withdrawal_cap}"
                )

    def _record_daily_withdrawal(
        self,
        currency: str,
        tier: str,
        amount: Decimal,
    ) -> None:
        """Track daily withdrawal volume in Redis."""
        daily_key = CUSTODY_DAILY_WITHDRAWAL_KEY.format(
            currency=currency,
            tier=tier,
        )
        current = Decimal(str(cache.get(daily_key, "0")))
        # Set with TTL of 24 hours
        cache.set(daily_key, str(current + amount), timeout=86400)

    def _audit_log(
        self,
        action: str,
        transfer: CustodyTransfer,
        message: str,
    ) -> None:
        """Write custody transfer to audit log."""
        try:
            from apps.accounts.models import AuditLog

            AuditLog.objects.create(
                action=action,
                entity_type="custody_transfer",
                entity_id=str(transfer.id),
                details={
                    "transfer_id": str(transfer.id),
                    "from_tier": transfer.from_tier,
                    "to_tier": transfer.to_tier,
                    "currency": transfer.currency,
                    "amount": str(transfer.amount),
                    "status": transfer.status,
                    "initiated_by": transfer.initiated_by,
                    "message": message,
                    "timestamp": timezone.now().isoformat(),
                },
            )
        except Exception as e:
            logger.error(f"Failed to create custody audit log: {e}")

    def _notify_admin_cold_transfer(self, transfer: CustodyTransfer) -> None:
        """Notify admin about a pending cold storage transfer."""
        try:
            from apps.core.push import send_admin_alert

            send_admin_alert(
                title="Cold Storage Transfer Required",
                body=(
                    f"Transfer {transfer.amount} {transfer.currency} "
                    f"from {transfer.from_tier} to {transfer.to_tier} wallet. "
                    f"Transfer ID: {str(transfer.id)[:8]}"
                ),
                data={
                    "type": "cold_transfer",
                    "transfer_id": str(transfer.id),
                },
            )
        except Exception as e:
            logger.error(f"Failed to send cold transfer notification: {e}")

        try:
            from django.core.mail import mail_admins

            mail_admins(
                subject=f"[CryptoPay] Cold Storage Transfer — {transfer.amount} {transfer.currency}",
                message=(
                    f"Transfer ID: {transfer.id}\n"
                    f"Direction: {transfer.from_tier} → {transfer.to_tier}\n"
                    f"Amount: {transfer.amount} {transfer.currency}\n"
                    f"From: {transfer.from_address}\n"
                    f"To: {transfer.to_address}\n\n"
                    f"Reason: {transfer.reason}\n\n"
                    f"Steps:\n"
                    f"1. Sign the transaction on the cold storage device\n"
                    f"2. Broadcast the signed transaction\n"
                    f"3. Confirm in CryptoPay admin with TX hash\n"
                ),
            )
        except Exception as e:
            logger.error(f"Failed to send cold transfer email: {e}")


# Module-level singleton for convenience
custody_service = CustodyService()
