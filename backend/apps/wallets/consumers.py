"""
WebSocket consumer for real-time wallet balance updates.

Authenticated users join a per-user group and receive balance updates
whenever their transactions complete (saga completion, deposits, etc.).
"""

import json
import logging

from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


def user_balance_group(user_id) -> str:
    """Channel group name for a specific user's balance updates."""
    return f"balance_{user_id}"


class WalletBalanceConsumer(AsyncWebsocketConsumer):
    """Authenticated WebSocket — requires JWT token in query param."""

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4001)
            return

        self.group_name = user_balance_group(user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.debug(f"Balance WS connected for user {user.id}: {self.channel_name}")

        # Send current balances immediately on connect
        from channels.db import database_sync_to_async

        balances = await database_sync_to_async(self._get_user_balances)(user.id)
        await self.send(text_data=json.dumps({
            "type": "balance_update",
            "wallets": balances,
        }))

    async def disconnect(self, close_code):
        user = self.scope.get("user")
        if user and user.is_authenticated:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            logger.debug(f"Balance WS disconnected for user {user.id}")

    async def receive(self, text_data=None, bytes_data=None):
        """Client can request a balance refresh."""
        try:
            data = json.loads(text_data or "{}")
            if data.get("type") == "ping":
                await self.send(text_data=json.dumps({"type": "pong"}))
            elif data.get("type") == "refresh":
                from channels.db import database_sync_to_async

                user = self.scope["user"]
                balances = await database_sync_to_async(self._get_user_balances)(user.id)
                await self.send(text_data=json.dumps({
                    "type": "balance_update",
                    "wallets": balances,
                }))
        except json.JSONDecodeError:
            pass

    async def balance_update(self, event):
        """Handler for messages sent to the user's balance group."""
        await self.send(text_data=json.dumps({
            "type": "balance_update",
            "wallets": event["wallets"],
        }))

    @staticmethod
    def _get_user_balances(user_id) -> list[dict]:
        """Fetch user wallets. Runs in sync context."""
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
