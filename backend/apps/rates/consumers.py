"""
WebSocket consumer for real-time exchange rate updates.

All connected clients join the "rates" group and receive rate updates
whenever Celery Beat refreshes rates (every ~2 minutes).
"""

import json
import logging

from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)

RATES_GROUP = "rates"


class RateConsumer(AsyncWebsocketConsumer):
    """Public WebSocket — no auth required. Broadcasts rates to all clients."""

    async def connect(self):
        await self.channel_layer.group_add(RATES_GROUP, self.channel_name)
        await self.accept()
        logger.debug(f"Rate WS connected: {self.channel_name}")

        # Send current rates immediately on connect
        from channels.db import database_sync_to_async

        rates = await database_sync_to_async(self._get_current_rates)()
        if rates:
            await self.send(text_data=json.dumps({
                "type": "rate_update",
                "rates": rates,
            }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(RATES_GROUP, self.channel_name)
        logger.debug(f"Rate WS disconnected: {self.channel_name}")

    async def receive(self, text_data=None, bytes_data=None):
        """Client can send a ping; we respond with current rates."""
        try:
            data = json.loads(text_data or "{}")
            if data.get("type") == "ping":
                await self.send(text_data=json.dumps({"type": "pong"}))
        except json.JSONDecodeError:
            pass

    async def rate_update(self, event):
        """Handler for messages sent to the rates group."""
        await self.send(text_data=json.dumps({
            "type": "rate_update",
            "rates": event["rates"],
        }))

    @staticmethod
    def _get_current_rates() -> dict:
        """Fetch current cached rates. Runs in sync context."""
        from django.core.cache import cache

        currencies = ["USDT", "USDC", "BTC", "ETH", "SOL"]
        usd_kes = cache.get("rate:forex:usd:kes")
        rates = {}

        for currency in currencies:
            usd_rate = cache.get(f"rate:crypto:{currency}:usd")
            if usd_rate:
                rates[currency] = {
                    "usd": float(usd_rate),
                    "kes": round(float(usd_rate) * float(usd_kes), 2) if usd_kes else None,
                }

        return rates
