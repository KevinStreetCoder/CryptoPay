"""WebSocket URL routing for Django Channels."""

from django.urls import path

from apps.rates.consumers import RateConsumer
from apps.wallets.consumers import WalletBalanceConsumer

websocket_urlpatterns = [
    path("ws/rates/", RateConsumer.as_asgi()),
    path("ws/wallets/", WalletBalanceConsumer.as_asgi()),
]
