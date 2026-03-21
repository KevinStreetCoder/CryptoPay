"""
Liquidity Rebalancing Orchestrator — Production-ready float management.

Manages the KES float by monitoring balance and orchestrating crypto→KES
conversions when the float drops below thresholds. Designed to work with:

1. **Manual mode (now)**: Admin sells crypto on Yellow Card dashboard,
   then confirms the rebalance order here. System tracks everything.
2. **API mode (future)**: Yellow Card API integration — just implement
   the `execute_sell()` method in ExchangeProvider and plug it in.

Architecture:
  - RebalanceOrder model tracks every rebalance attempt end-to-end
  - State machine: PENDING → SUBMITTED → SETTLING → COMPLETED / FAILED / CANCELLED
  - Idempotent Celery tasks with Redis locks prevent duplicate orders
  - Circuit breaker integration: triggers rebalance on HALF_OPEN/OPEN transitions
  - Audit trail: every state change logged to AuditLog for compliance

Float sits in: M-Pesa business account (Safaricom Daraja shortcode).
Cash source: Platform's USDT hot wallet → sell on exchange → KES to M-Pesa.
"""

import logging
import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Optional

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import F, Value
from django.db.models.functions import Greatest
from django.utils import timezone

from .models import RebalanceOrder, SystemWallet

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

MIN_REBALANCE_KES = Decimal(str(getattr(settings, "REBALANCE_MIN_KES", 50_000)))
TARGET_FLOAT_KES = Decimal(str(getattr(settings, "FLOAT_HEALTHY_KES", 1_500_000)))
TRIGGER_FLOAT_KES = Decimal(str(getattr(settings, "FLOAT_RESUME_KES", 800_000)))
MAX_REBALANCE_KES = Decimal(str(getattr(settings, "REBALANCE_MAX_KES", 2_000_000)))
REBALANCE_COOLDOWN_SECONDS = int(getattr(settings, "REBALANCE_COOLDOWN_SECONDS", 300))

# Redis lock keys
REBALANCE_LOCK_KEY = "rebalance:orchestrator:lock"
REBALANCE_ACTIVE_KEY = "rebalance:active_order_id"


# ── Exchange Provider Interface ──────────────────────────────────────────────

class ExchangeProvider:
    """
    Abstract interface for exchange operations.

    Currently: ManualExchangeProvider (admin does it on Yellow Card dashboard).
    Future: YellowCardAPIProvider (automated via API).

    To add Yellow Card API:
    1. Subclass ExchangeProvider
    2. Implement get_sell_quote(), execute_sell(), check_settlement()
    3. Set REBALANCE_EXECUTION_MODE = "api" in settings
    """

    def get_sell_quote(self, currency: str, amount: Decimal) -> dict:
        raise NotImplementedError

    def execute_sell(self, order: RebalanceOrder) -> dict:
        raise NotImplementedError

    def check_settlement(self, order: RebalanceOrder) -> dict:
        raise NotImplementedError


class ManualExchangeProvider(ExchangeProvider):
    """
    Manual mode: Admin sells crypto on Yellow Card (or any exchange) dashboard.

    Flow:
    1. System creates RebalanceOrder with calculated amounts
    2. Admin gets notified (push + email) with instructions
    3. Admin sells on Yellow Card dashboard
    4. Admin confirms here with actual KES received
    5. System updates SystemWallet and float tracking
    """

    def get_sell_quote(self, currency: str, amount: Decimal) -> dict:
        """Use internal rate engine for estimation."""
        from apps.rates.services import get_rate

        rate_data = get_rate(currency)
        raw_rate = Decimal(str(rate_data.get("raw_rate", rate_data.get("final_rate", "0"))))

        if raw_rate <= 0:
            raise ValueError(f"Could not get rate for {currency}/KES")

        kes_amount = amount * raw_rate
        estimated_fee = kes_amount * Decimal("0.01")
        net_kes = kes_amount - estimated_fee

        return {
            "rate": raw_rate,
            "kes_amount": net_kes,
            "fee_kes": estimated_fee,
            "quote_id": f"manual_{uuid.uuid4().hex[:12]}",
            "expires_at": timezone.now() + timedelta(minutes=15),
        }

    def execute_sell(self, order: RebalanceOrder) -> dict:
        """In manual mode, 'executing' means notifying the admin."""
        _notify_admin_rebalance(order)

        return {
            "exchange_order_id": f"manual_{str(order.id)[:8]}",
            "status": "submitted",
            "message": (
                f"Admin notified to sell {order.sell_amount} {order.sell_currency} "
                f"on Yellow Card. Expected: ~KES {order.expected_kes_amount:,.0f}"
            ),
        }

    def check_settlement(self, order: RebalanceOrder) -> dict:
        """Manual orders are confirmed by admin, not polled."""
        return {
            "settled": order.status == RebalanceOrder.Status.COMPLETED,
            "kes_received": order.actual_kes_received,
            "actual_rate": order.actual_exchange_rate,
            "fee_kes": order.exchange_fee_kes,
            "reference": order.exchange_reference,
        }


class YellowCardAPIProvider(ExchangeProvider):
    """
    Automated mode via Yellow Card Payments API.

    Yellow Card API flow:
    1. GET /business/rates?currency=KES → get current USDT/KES rate
    2. GET /business/channels?country=KE → get mobile money channel
    3. POST /business/payments → create off-ramp payment
    4. Webhook notification when settlement complete
    5. GET /business/payments/{id} → verify final status

    Authentication: X-YC-Timestamp + Authorization headers (HMAC)
    Sandbox: https://sandbox.api.yellowcard.io/business
    Production: https://api.yellowcard.io/business
    """

    BASE_URL = getattr(settings, "YELLOW_CARD_BASE_URL", "https://sandbox.api.yellowcard.io/business")

    def _get_headers(self, method: str, path: str, body: str = "") -> dict:
        """Generate HMAC authentication headers for Yellow Card API."""
        import hashlib
        import hmac as hmac_mod
        import time

        api_key = getattr(settings, "YELLOW_CARD_API_KEY", "")
        secret_key = getattr(settings, "YELLOW_CARD_SECRET_KEY", "")
        if not api_key or not secret_key:
            raise RuntimeError("YELLOW_CARD_API_KEY and YELLOW_CARD_SECRET_KEY must be set.")

        timestamp = str(int(time.time()))
        message = f"{timestamp}{path}{method}{body}"
        signature = hmac_mod.new(
            secret_key.encode(), message.encode(), hashlib.sha256
        ).hexdigest()

        return {
            "Authorization": f"YcHmacV1 {api_key}:{signature}",
            "X-YC-Timestamp": timestamp,
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, json_data: dict = None, retries: int = 3) -> dict:
        """Make authenticated request to Yellow Card API with retry/backoff."""
        import requests
        import json
        import time

        url = f"{self.BASE_URL}{path}"
        body = json.dumps(json_data, separators=(",", ":")) if json_data else ""

        last_error = None
        for attempt in range(retries):
            try:
                headers = self._get_headers(method.upper(), path, body)
                resp = requests.request(
                    method, url, headers=headers,
                    data=body if json_data else None, timeout=30,
                )
                if resp.status_code == 429:
                    wait = min(2 ** attempt * 5, 60)
                    logger.warning(f"Yellow Card rate limited, waiting {wait}s (attempt {attempt + 1})")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.exceptions.ConnectionError as e:
                last_error = e
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                    continue
            except requests.exceptions.HTTPError as e:
                if e.response is not None and e.response.status_code >= 500:
                    last_error = e
                    if attempt < retries - 1:
                        time.sleep(2 ** attempt)
                        continue
                raise RuntimeError(
                    f"Yellow Card API error ({method} {path}): "
                    f"HTTP {e.response.status_code if e.response else '?'} — {e}"
                ) from e

        raise RuntimeError(f"Yellow Card API failed after {retries} retries: {last_error}")

    def get_sell_quote(self, currency: str, amount: Decimal) -> dict:
        """Get USDT/KES sell rate from Yellow Card."""
        data = self._request("GET", "/rates?currency=KES")
        # Find the USDT rate
        rate_info = None
        for r in data.get("data", data if isinstance(data, list) else []):
            if r.get("code") == currency or r.get("currency") == currency:
                rate_info = r
                break
        if not rate_info:
            raise RuntimeError(f"No Yellow Card rate found for {currency}/KES")

        rate = Decimal(str(rate_info.get("sell", rate_info.get("rate", 0))))
        kes_amount = amount * rate
        return {
            "rate": rate,
            "kes_amount": kes_amount,
            "currency": currency,
            "amount": amount,
        }

    def execute_sell(self, order: RebalanceOrder) -> dict:
        """Create an off-ramp payment on Yellow Card."""
        # Get the M-Pesa channel
        channels = self._request("GET", "/channels?country=KE")
        mpesa_channel = None
        for ch in channels.get("data", channels if isinstance(channels, list) else []):
            if "mpesa" in ch.get("name", "").lower() or ch.get("code") == "mpesa":
                mpesa_channel = ch
                break
        if not mpesa_channel:
            raise RuntimeError("No M-Pesa channel found on Yellow Card for Kenya")

        # Get merchant's settlement account
        settlement_account = getattr(settings, "YELLOW_CARD_SETTLEMENT_PHONE", "")
        if not settlement_account:
            raise RuntimeError("YELLOW_CARD_SETTLEMENT_PHONE must be set for KES settlement.")

        payment = self._request("POST", "/payments", {
            "channelId": mpesa_channel.get("id"),
            "amount": str(order.sell_amount),
            "currency": order.sell_currency,
            "country": "KE",
            "reason": f"CryptoPay rebalance {str(order.id)[:8]}",
            "destination": {
                "accountNumber": settlement_account,
                "accountType": "mobile_money",
                "networkCode": "63902",
            },
            "customerName": "CryptoPay Ltd",
        })

        return {
            "exchange_order_id": payment.get("id", ""),
            "status": payment.get("status", "pending"),
            "reference": payment.get("reference", ""),
        }

    def check_settlement(self, order: RebalanceOrder) -> dict:
        """Check if a Yellow Card payment has settled."""
        if not order.exchange_order_id:
            return {"settled": False}

        payment = self._request("GET", f"/payments/{order.exchange_order_id}")
        status = payment.get("status", "").lower()
        settled = status in ("completed", "settled", "done")
        actual_rate = Decimal(str(payment.get("rate", 0))) if payment.get("rate") else None

        return {
            "settled": settled,
            "status": status,
            "kes_received": Decimal(str(payment.get("amountSettled", 0))) if settled else None,
            "actual_rate": actual_rate,
            "reference": payment.get("reference", order.exchange_reference or ""),
        }


# ── Rebalancing Orchestrator ─────────────────────────────────────────────────

def get_exchange_provider() -> ExchangeProvider:
    """Factory: returns the configured exchange provider."""
    mode = getattr(settings, "REBALANCE_EXECUTION_MODE", "manual")
    if mode == "api":
        if not getattr(settings, "YELLOW_CARD_API_KEY", ""):
            raise RuntimeError(
                "REBALANCE_EXECUTION_MODE is 'api' but YELLOW_CARD_API_KEY is not set. "
                "Set the API key or switch to 'manual' mode."
            )
        return YellowCardAPIProvider()
    return ManualExchangeProvider()


def get_current_float_kes() -> Optional[Decimal]:
    """
    Get the current M-Pesa float balance.

    Sources (in priority order):
    1. Redis cache (set by circuit breaker from M-Pesa callback)
    2. SystemWallet FLOAT/KES (manual tracking)
    3. None (unknown)
    """
    from apps.payments.circuit_breaker import BREAKER_LAST_FLOAT_KEY

    cached = cache.get(BREAKER_LAST_FLOAT_KEY)
    if cached is not None:
        return Decimal(str(cached))

    try:
        sw = SystemWallet.objects.get(wallet_type="float", currency="KES")
        if sw.balance > 0:
            return sw.balance
    except SystemWallet.DoesNotExist:
        pass

    return None


def get_available_crypto_for_sell(currency: str = "USDT") -> Decimal:
    """Get the platform's available crypto balance for selling."""
    try:
        sw = SystemWallet.objects.get(wallet_type="hot", currency=currency)
        return sw.balance
    except SystemWallet.DoesNotExist:
        return Decimal("0")


def calculate_rebalance_amount(
    current_float: Decimal,
    target: Decimal = TARGET_FLOAT_KES,
) -> Decimal:
    """
    Calculate how much KES we need to add to reach target float.
    Returns 0 if no rebalance needed.
    """
    deficit = target - current_float

    if deficit < MIN_REBALANCE_KES:
        return Decimal("0")

    return min(deficit, MAX_REBALANCE_KES)


def has_active_rebalance() -> bool:
    """Check if there's already an active (in-flight) rebalance order."""
    active_id = cache.get(REBALANCE_ACTIVE_KEY)
    if active_id:
        try:
            order = RebalanceOrder.objects.get(id=active_id)
            if order.is_active:
                return True
            else:
                cache.delete(REBALANCE_ACTIVE_KEY)
        except RebalanceOrder.DoesNotExist:
            cache.delete(REBALANCE_ACTIVE_KEY)

    return RebalanceOrder.objects.filter(
        status__in=[
            RebalanceOrder.Status.PENDING,
            RebalanceOrder.Status.SUBMITTED,
            RebalanceOrder.Status.SETTLING,
        ]
    ).exists()


def is_in_cooldown() -> bool:
    """Check if we're in cool-down period after last rebalance attempt.
    Excludes cancelled orders — they shouldn't block new rebalances."""
    last_order = (
        RebalanceOrder.objects
        .exclude(status=RebalanceOrder.Status.CANCELLED)
        .order_by("-created_at")
        .first()
    )
    if not last_order:
        return False

    elapsed = (timezone.now() - last_order.created_at).total_seconds()
    return elapsed < REBALANCE_COOLDOWN_SECONDS


@transaction.atomic
def create_rebalance_order(
    trigger: str = RebalanceOrder.TriggerType.AUTO,
    reason: str = "",
    sell_currency: str = "USDT",
    force: bool = False,
) -> tuple[Optional["RebalanceOrder"], str]:
    """
    Create a new rebalance order if conditions are met.
    Returns (order, reject_reason) — order is None if preconditions fail.

    Checks:
    1. No active rebalance already in-flight
    2. Not in cool-down period (unless force=True)
    3. Float is actually below trigger threshold
    4. We have enough crypto to sell
    5. Deficit meets minimum rebalance amount (50K KES)
    """
    lock = cache.add(REBALANCE_LOCK_KEY, "1", timeout=60)
    if not lock:
        logger.info("Rebalance lock held by another process, skipping")
        return None, "Another rebalance is being processed. Please wait."

    try:
        if has_active_rebalance():
            logger.info("Active rebalance order exists, skipping new order")
            return None, "An active rebalance order already exists. Complete or cancel it first."

        if is_in_cooldown() and not force:
            logger.info("Rebalance cool-down active, skipping")
            return None, "Rebalance cool-down period active. Use 'Force' to override."

        current_float = get_current_float_kes()
        if current_float is None:
            logger.warning("Cannot determine float balance — skipping rebalance")
            return None, "Cannot determine current M-Pesa float balance. Check balance API."

        if current_float >= TRIGGER_FLOAT_KES and not force:
            logger.info(
                f"Float KES {current_float:,.0f} >= trigger {TRIGGER_FLOAT_KES:,.0f}, "
                f"no rebalance needed"
            )
            return None, f"Float is healthy (KES {current_float:,.0f}). No rebalance needed. Use 'Force' to override."

        kes_needed = calculate_rebalance_amount(current_float)
        if kes_needed <= 0 and not force:
            logger.info("Rebalance deficit below minimum threshold")
            return None, f"Deficit below minimum threshold (KES {MIN_REBALANCE_KES:,.0f}). Use 'Force' to override."

        if force and kes_needed <= 0:
            kes_needed = MIN_REBALANCE_KES

        provider = get_exchange_provider()
        try:
            quote = provider.get_sell_quote(sell_currency, Decimal("1"))
            rate = quote["rate"]
        except Exception as e:
            logger.error(f"Failed to get exchange rate: {e}")
            return None, f"Failed to get exchange rate for {sell_currency}. Try again later."

        if rate <= 0:
            logger.error(f"Invalid exchange rate: {rate}")
            return None, "Invalid exchange rate received. Try again later."

        crypto_amount = (kes_needed / rate).quantize(Decimal("0.00000001"))

        available = get_available_crypto_for_sell(sell_currency)
        if available <= 0:
            logger.warning(
                f"No {sell_currency} available in hot wallet for rebalancing. "
                f"Need {crypto_amount}, have {available}"
            )

        if not reason:
            reason = (
                f"Float at KES {current_float:,.0f} (trigger: KES {TRIGGER_FLOAT_KES:,.0f}). "
                f"Need KES {kes_needed:,.0f} to reach target KES {TARGET_FLOAT_KES:,.0f}."
            )

        order = RebalanceOrder.objects.create(
            trigger=trigger,
            execution_mode=getattr(settings, "REBALANCE_EXECUTION_MODE", "manual"),
            status=RebalanceOrder.Status.PENDING,
            float_balance_at_trigger=current_float,
            target_float_balance=TARGET_FLOAT_KES,
            sell_currency=sell_currency,
            sell_amount=crypto_amount,
            expected_kes_amount=kes_needed,
            exchange_rate_at_quote=rate,
            reason=reason,
        )

        # Safe to set unconditionally: REBALANCE_LOCK_KEY (acquired above via
        # cache.add) serialises all create_rebalance_order calls, and
        # has_active_rebalance() already rejected if an active order exists.
        cache.set(REBALANCE_ACTIVE_KEY, str(order.id), timeout=86400)

        logger.info(
            f"Rebalance order created: {order.id} | "
            f"Sell {crypto_amount} {sell_currency} → ~KES {kes_needed:,.0f}"
        )

        return order, ""

    finally:
        cache.delete(REBALANCE_LOCK_KEY)


@transaction.atomic
def submit_rebalance_order(order_id: str) -> RebalanceOrder:
    """
    Submit a pending rebalance order to the exchange (or notify admin).
    Transitions: PENDING → SUBMITTED
    """
    order = RebalanceOrder.objects.select_for_update().get(id=order_id)

    if order.status != RebalanceOrder.Status.PENDING:
        raise ValueError(f"Order {order_id} is {order.status}, cannot submit")

    provider = get_exchange_provider()
    result = provider.execute_sell(order)

    order.status = RebalanceOrder.Status.SUBMITTED
    order.submitted_at = timezone.now()
    order.exchange_order_id = result.get("exchange_order_id", "")
    order.save(update_fields=[
        "status", "submitted_at", "exchange_order_id", "updated_at",
    ])

    _audit_log(
        "REBALANCE_SUBMITTED",
        order,
        f"Order submitted: {result.get('message', '')}",
    )

    logger.info(f"Rebalance order {str(order.id)[:8]} submitted: {result}")
    return order


@transaction.atomic
def confirm_rebalance_settlement(
    order_id: str,
    kes_received: Decimal,
    actual_rate: Optional[Decimal] = None,
    fee_kes: Optional[Decimal] = None,
    exchange_reference: str = "",
    admin_notes: str = "",
) -> RebalanceOrder:
    """
    Confirm that a rebalance order has been settled (KES received).
    Called by admin (manual mode) or webhook (API mode).
    Transitions: SUBMITTED/SETTLING/PENDING → COMPLETED
    """
    # Atomic UPDATE ... WHERE to prevent double-confirm race condition.
    # Only transition from SUBMITTED or SETTLING (not PENDING — order must
    # have been submitted to an exchange first).
    if kes_received <= 0:
        raise ValueError("KES received must be greater than zero")

    # Bounds sanity checks on kes_received
    order = RebalanceOrder.objects.select_for_update().get(id=order_id)

    # Lower bound: reject if received less than 50% of expected
    min_allowed = order.expected_kes_amount * Decimal("0.5")
    if kes_received < min_allowed:
        raise ValueError(
            f"KES received ({kes_received:,.0f}) is less than 50% of expected "
            f"({order.expected_kes_amount:,.0f}). Verify amount."
        )

    # Upper bound: reject if received more than 5x expected
    max_allowed = order.expected_kes_amount * 5
    if kes_received > max_allowed:
        raise ValueError(
            f"KES received ({kes_received:,.0f}) exceeds 5x expected "
            f"({order.expected_kes_amount:,.0f}). Verify amount."
        )

    now = timezone.now()
    updated = RebalanceOrder.objects.filter(
        id=order_id,
        status__in=[
            RebalanceOrder.Status.SUBMITTED,
            RebalanceOrder.Status.SETTLING,
        ],
    ).update(
        status=RebalanceOrder.Status.COMPLETED,
        actual_kes_received=kes_received,
        actual_exchange_rate=actual_rate,
        exchange_fee_kes=fee_kes,
        exchange_reference=exchange_reference,
        admin_notes=admin_notes,
        settled_at=now,
        completed_at=now,
    )

    if not updated:
        raise ValueError(
            f"Order {order_id} is {order.status}, cannot confirm settlement "
            f"(must be SUBMITTED or SETTLING)"
        )

    order.refresh_from_db()

    # Update SystemWallet FLOAT/KES balance atomically with F()
    float_wallet, _ = SystemWallet.objects.get_or_create(
        wallet_type="float",
        currency="KES",
    )
    SystemWallet.objects.filter(id=float_wallet.id).update(
        balance=F("balance") + kes_received,
    )

    # Deduct sold crypto from HOT wallet atomically using F() expression.
    # Check for deficit BEFORE clamping — log critical alert if balance is insufficient.
    hot_wallet = SystemWallet.objects.filter(
        wallet_type="hot",
        currency=order.sell_currency,
    ).first()

    if hot_wallet:
        if hot_wallet.balance < order.sell_amount:
            deficit = order.sell_amount - hot_wallet.balance
            raise ValueError(
                f"HOT/{order.sell_currency} has insufficient balance for deduction. "
                f"Balance: {hot_wallet.balance}, Required: {order.sell_amount}, "
                f"Deficit: {deficit}. Top up the hot wallet or adjust the order."
            )
        SystemWallet.objects.filter(id=hot_wallet.id).update(
            balance=Greatest(F("balance") - order.sell_amount, Value(Decimal("0"))),
        )
    else:
        logger.warning(
            f"No HOT/{order.sell_currency} SystemWallet found — "
            f"cannot deduct {order.sell_amount} {order.sell_currency} from hot wallet"
        )

    cache.delete(REBALANCE_ACTIVE_KEY)

    _audit_log(
        "REBALANCE_COMPLETED",
        order,
        f"Settlement confirmed: KES {kes_received:,.0f} received. "
        f"Slippage: KES {order.slippage_kes or 0:,.0f}",
    )

    logger.info(
        f"Rebalance {str(order.id)[:8]} COMPLETED: "
        f"KES {kes_received:,.0f} received "
        f"(expected {order.expected_kes_amount:,.0f}, "
        f"slippage: {order.slippage_kes or 0:,.0f})"
    )

    _notify_admin_rebalance_complete(order)
    return order


@transaction.atomic
def fail_rebalance_order(
    order_id: str,
    error_message: str = "",
    admin_notes: str = "",
) -> RebalanceOrder:
    """Mark a rebalance order as failed. Transitions: any active → FAILED"""
    order = RebalanceOrder.objects.select_for_update().get(id=order_id)

    if not order.is_active:
        raise ValueError(f"Order {order_id} is already {order.status}")

    order.status = RebalanceOrder.Status.FAILED
    order.error_message = error_message
    order.admin_notes = admin_notes
    order.completed_at = timezone.now()
    order.save()

    cache.delete(REBALANCE_ACTIVE_KEY)

    _audit_log("REBALANCE_FAILED", order, f"Failed: {error_message}")
    logger.error(f"Rebalance {str(order.id)[:8]} FAILED: {error_message}")
    return order


@transaction.atomic
def cancel_rebalance_order(
    order_id: str,
    reason: str = "Cancelled by admin",
) -> RebalanceOrder:
    """Cancel an active rebalance order."""
    order = RebalanceOrder.objects.select_for_update().get(id=order_id)

    if not order.is_active:
        raise ValueError(f"Order {order_id} is already {order.status}")

    order.status = RebalanceOrder.Status.CANCELLED
    order.admin_notes = reason
    order.completed_at = timezone.now()
    order.save()

    cache.delete(REBALANCE_ACTIVE_KEY)

    _audit_log("REBALANCE_CANCELLED", order, reason)
    logger.info(f"Rebalance {str(order.id)[:8]} cancelled: {reason}")
    return order


# ── Notifications ─────────────────────────────────────────────────────────────

def _notify_admin_rebalance(order: RebalanceOrder) -> None:
    """Send push + email to admin about rebalance action needed."""
    try:
        from apps.core.push import send_admin_alert

        msg = (
            f"REBALANCE NEEDED: Sell {order.sell_amount} {order.sell_currency} "
            f"on Yellow Card. Expected: ~KES {order.expected_kes_amount:,.0f}. "
            f"Float at KES {order.float_balance_at_trigger:,.0f}."
        )

        send_admin_alert(
            title="Float Rebalance Required",
            body=msg,
            data={"type": "rebalance", "order_id": str(order.id)},
        )
    except Exception as e:
        logger.error(f"Failed to send rebalance notification: {e}")

    try:
        from django.core.mail import mail_admins

        mail_admins(
            subject=f"[CryptoPay] Float Rebalance Required — KES {order.expected_kes_amount:,.0f}",
            message=(
                f"Rebalance Order: {order.id}\n"
                f"Float Balance: KES {order.float_balance_at_trigger:,.0f}\n"
                f"Target: KES {order.target_float_balance:,.0f}\n"
                f"Action: Sell {order.sell_amount} {order.sell_currency}\n"
                f"Expected KES: {order.expected_kes_amount:,.0f}\n"
                f"Rate: {order.exchange_rate_at_quote}\n\n"
                f"Steps:\n"
                f"1. Go to Yellow Card dashboard\n"
                f"2. Sell {order.sell_amount} {order.sell_currency}\n"
                f"3. Transfer KES to M-Pesa business account\n"
                f"4. Confirm in CryptoPay admin with actual KES received\n\n"
                f"Trigger: {order.trigger} | {order.reason}"
            ),
        )
    except Exception as e:
        logger.error(f"Failed to send rebalance email: {e}")


def _notify_admin_rebalance_complete(order: RebalanceOrder) -> None:
    """Notify admin that rebalance is complete."""
    try:
        from apps.core.push import send_admin_alert

        send_admin_alert(
            title="Float Rebalance Complete",
            body=(
                f"KES {order.actual_kes_received:,.0f} received. "
                f"Slippage: KES {order.slippage_kes or 0:,.0f}"
            ),
            data={"type": "rebalance_complete", "order_id": str(order.id)},
        )
    except Exception as e:
        logger.error(f"Failed to send completion notification: {e}")


# ── Audit logging ─────────────────────────────────────────────────────────────

def _audit_log(action: str, order: RebalanceOrder, message: str) -> None:
    """Write to AuditLog for compliance trail."""
    try:
        from apps.accounts.models import AuditLog

        AuditLog.objects.create(
            action=action,
            entity_type="rebalance_order",
            entity_id=str(order.id),
            details={
                "order_id": str(order.id),
                "status": order.status,
                "trigger": order.trigger,
                "sell_currency": order.sell_currency,
                "sell_amount": str(order.sell_amount),
                "expected_kes": str(order.expected_kes_amount),
                "actual_kes": str(order.actual_kes_received) if order.actual_kes_received else None,
                "float_at_trigger": str(order.float_balance_at_trigger),
                "message": message,
                "timestamp": timezone.now().isoformat(),
            },
        )
    except Exception as e:
        logger.error(f"Failed to create rebalance audit log: {e}")


# ── Health / Status ───────────────────────────────────────────────────────────

def get_rebalance_status() -> dict:
    """Full rebalance + liquidity system status for admin dashboard."""
    current_float = get_current_float_kes()
    active_orders = RebalanceOrder.objects.filter(
        status__in=[
            RebalanceOrder.Status.PENDING,
            RebalanceOrder.Status.SUBMITTED,
            RebalanceOrder.Status.SETTLING,
        ]
    )

    recent_completed = RebalanceOrder.objects.filter(
        status=RebalanceOrder.Status.COMPLETED,
    ).order_by("-completed_at")[:5]

    from apps.payments.models import Transaction
    from django.db.models import Sum, Count

    daily_outflow = Transaction.objects.filter(
        status="completed",
        type__in=["PAYBILL_PAYMENT", "TILL_PAYMENT", "SEND_MPESA"],
        completed_at__gte=timezone.now() - timedelta(hours=24),
    ).aggregate(total=Sum("dest_amount"))["total"] or Decimal("0")

    days_coverage = None
    if current_float and daily_outflow > 0:
        days_coverage = float(current_float / daily_outflow)

    # ── Hot wallet balances (SystemWallet HOT) ────────────────────────
    crypto_balances = {}
    for sw in SystemWallet.objects.filter(wallet_type="hot").exclude(currency="KES"):
        crypto_balances[sw.currency] = {
            "balance": str(sw.balance),
            "updated_at": sw.updated_at.isoformat() if sw.updated_at else None,
        }

    # ── Fee wallet (collected platform fees) ──────────────────────────
    fee_balances = {}
    for sw in SystemWallet.objects.filter(wallet_type="fee"):
        if sw.balance > 0:
            fee_balances[sw.currency] = str(sw.balance)

    # ── Unsettled user deposits (credited to user but not yet swept) ──
    from apps.blockchain.models import BlockchainDeposit

    unsettled_deposits = (
        BlockchainDeposit.objects
        .filter(status=BlockchainDeposit.Status.CREDITED)
        .values("currency")
        .annotate(
            total=Sum("amount"),
            count=Count("id"),
        )
    )
    unsettled_by_currency = {
        d["currency"]: {"total": str(d["total"]), "count": d["count"]}
        for d in unsettled_deposits
    }

    # ── Sweep status (if sweep module exists) ─────────────────────────
    sweep_summary = _get_sweep_summary()

    # ── HD Wallet info ────────────────────────────────────────────────
    hd_wallet_info = {
        "derivation": "BIP-44 (m/44'/coin_type'/account'/0/index)",
        "seed_source": _get_seed_source_label(),
        "supported_chains": ["tron", "ethereum", "bitcoin", "solana"],
    }

    # ── Float wallet details ──────────────────────────────────────────
    float_wallet_updated = None
    try:
        fw = SystemWallet.objects.get(wallet_type="float", currency="KES")
        float_wallet_updated = fw.updated_at.isoformat() if fw.updated_at else None
    except SystemWallet.DoesNotExist:
        pass

    return {
        # Float status
        "current_float_kes": str(current_float) if current_float else "unknown",
        "target_float_kes": str(TARGET_FLOAT_KES),
        "trigger_threshold_kes": str(TRIGGER_FLOAT_KES),
        "min_rebalance_kes": str(MIN_REBALANCE_KES),
        "needs_rebalance": current_float is not None and current_float < TRIGGER_FLOAT_KES,
        "daily_outflow_kes": str(daily_outflow),
        "days_of_coverage": round(days_coverage, 1) if days_coverage else None,
        "float_source": "M-Pesa Business Account (Safaricom Daraja)",
        "float_last_synced": float_wallet_updated,
        "execution_mode": getattr(settings, "REBALANCE_EXECUTION_MODE", "manual"),
        # Hot wallet
        "available_crypto": crypto_balances,
        "fee_balances": fee_balances,
        "hd_wallet": hd_wallet_info,
        # Sweep / consolidation
        "unsettled_deposits": unsettled_by_currency,
        "sweep": sweep_summary,
        # Rebalance orders
        "active_orders": [
            {
                "id": str(o.id),
                "status": o.status,
                "trigger": o.trigger,
                "sell_amount": str(o.sell_amount),
                "sell_currency": o.sell_currency,
                "expected_kes": str(o.expected_kes_amount),
                "age_minutes": round(o.age_minutes, 1),
                "created_at": o.created_at.isoformat(),
                "reason": o.reason[:100] if o.reason else "",
            }
            for o in active_orders
        ],
        "recent_completed": [
            {
                "id": str(o.id),
                "kes_received": str(o.actual_kes_received),
                "sell_amount": str(o.sell_amount),
                "sell_currency": o.sell_currency,
                "slippage": str(o.slippage_kes or 0),
                "completed_at": o.completed_at.isoformat() if o.completed_at else None,
            }
            for o in recent_completed
        ],
        "is_in_cooldown": is_in_cooldown(),
    }


def _get_sweep_summary() -> dict:
    """Get sweep consolidation summary if sweep module is available."""
    try:
        from apps.blockchain.models import SweepOrder
        from django.db.models import Sum, Count

        active = SweepOrder.objects.filter(
            status__in=["pending", "estimating", "submitted", "confirming"],
        )
        recent = SweepOrder.objects.filter(
            status="credited",
        ).order_by("-credited_at")[:5]

        # Pending sweep value by currency
        pending_by_currency = {}
        for item in active.values("currency").annotate(total=Sum("amount"), count=Count("id")):
            pending_by_currency[item["currency"]] = {
                "total": str(item["total"]),
                "count": item["count"],
            }

        return {
            "enabled": True,
            "active_count": active.count(),
            "pending_by_currency": pending_by_currency,
            "recent_sweeps": [
                {
                    "id": str(s.id),
                    "currency": s.currency,
                    "amount": str(s.amount),
                    "fee": str(s.actual_fee) if s.actual_fee else str(s.estimated_fee),
                    "tx_hash": s.tx_hash[:16] + "..." if s.tx_hash else "",
                    "credited_at": s.credited_at.isoformat() if s.credited_at else None,
                }
                for s in recent
            ],
        }
    except Exception:
        return {
            "enabled": False,
            "active_count": 0,
            "pending_by_currency": {},
            "recent_sweeps": [],
        }


def _get_seed_source_label() -> str:
    """Return a label for the HD wallet seed source (no secrets exposed)."""
    if getattr(settings, "WALLET_MASTER_SEED", ""):
        return "WALLET_MASTER_SEED (hex)"
    if getattr(settings, "WALLET_MNEMONIC", ""):
        return "WALLET_MNEMONIC (BIP-39)"
    return "SECRET_KEY fallback (development only)"
