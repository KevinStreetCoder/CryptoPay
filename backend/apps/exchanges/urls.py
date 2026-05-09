"""URL routing for the exchanges app.

Mounted at `/api/v1/exchanges/` by config/urls.py.
"""
from django.urls import path

from . import views


app_name = "exchanges"


urlpatterns = [
    # Discovery / list
    path("", views.ExchangeListView.as_view(), name="list"),
    path("providers/", views.ExchangeProvidersView.as_view(), name="providers"),

    # Binance · paste API key
    path("binance/link/", views.BinanceLinkView.as_view(), name="binance-link"),

    # Coinbase OAuth
    path(
        "coinbase/oauth/start/",
        views.CoinbaseOAuthStartView.as_view(),
        name="coinbase-oauth-start",
    ),
    path(
        "coinbase/oauth/complete/",
        views.CoinbaseOAuthCompleteView.as_view(),
        name="coinbase-oauth-complete",
    ),

    # Noones OAuth
    path(
        "noones/oauth/start/",
        views.NoonesOAuthStartView.as_view(),
        name="noones-oauth-start",
    ),
    path(
        "noones/oauth/complete/",
        views.NoonesOAuthCompleteView.as_view(),
        name="noones-oauth-complete",
    ),

    # Withdraw / pull
    path(
        "withdrawals/",
        views.ExchangeWithdrawalListView.as_view(),
        name="withdrawal-list",
    ),
    path(
        "withdrawals/<uuid:withdrawal_id>/",
        views.ExchangeWithdrawalStatusView.as_view(),
        name="withdrawal-status",
    ),
    path(
        "<str:provider>/withdraw/",
        views.ExchangeWithdrawInitiateView.as_view(),
        name="withdraw",
    ),

    # Unlink (must come after specific routes to avoid swallowing
    # /coinbase/oauth/start/ etc.)
    path(
        "<str:provider>/",
        views.ExchangeUnlinkView.as_view(),
        name="unlink",
    ),
]
