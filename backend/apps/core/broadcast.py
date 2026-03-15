"""
Utility functions to broadcast WebSocket messages from Celery tasks or views.

These use `async_to_sync` so they can be called from synchronous code
(Celery tasks, Django views, model signals, etc.).
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def broadcast_rates(rates: dict):
    """
    Broadcast rate update to all connected WebSocket clients.

    Args:
        rates: dict like {"USDT": {"usd": 1.0, "kes": 129.5}, "BTC": {...}, ...}
    """
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return

        async_to_sync(channel_layer.group_send)(
            "rates",
            {
                "type": "rate_update",
                "rates": rates,
            },
        )
        logger.debug("Broadcast rate update to WebSocket clients")
    except Exception as e:
        # Non-critical — don't break rate refresh if WS broadcast fails
        logger.warning(f"Failed to broadcast rates via WebSocket: {e}")


def broadcast_user_balance(user_id, wallets: list[dict] | None = None):
    """
    Broadcast balance update to a specific user's WebSocket connections.

    Args:
        user_id: The user's ID (UUID or int)
        wallets: Optional pre-fetched wallet data. If None, fetched from DB.
    """
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return

        if wallets is None:
            wallets = _fetch_user_wallets(user_id)

        group_name = f"balance_{user_id}"
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                "type": "balance_update",
                "wallets": wallets,
            },
        )
        logger.debug(f"Broadcast balance update for user {user_id}")
    except Exception as e:
        # Non-critical — don't break transaction flow if WS broadcast fails
        logger.warning(f"Failed to broadcast balance for user {user_id}: {e}")


def _fetch_user_wallets(user_id) -> list[dict]:
    """Fetch wallet balances for a user."""
    from apps.wallets.models import Wallet

    wallets = Wallet.objects.filter(user_id=user_id).order_by("currency")
    return [
        {
            "id": str(w.id),
            "currency": w.currency,
            "balance": str(w.balance),
            "locked_balance": str(w.locked_balance),
            "available_balance": str(w.balance - w.locked_balance),
        }
        for w in wallets
    ]
