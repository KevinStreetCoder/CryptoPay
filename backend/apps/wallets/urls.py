from django.urls import path

from . import views

app_name = "wallets"

urlpatterns = [
    path("", views.WalletListView.as_view(), name="wallet-list"),
    path(
        "<uuid:wallet_id>/generate-address/",
        views.GenerateDepositAddressView.as_view(),
        name="generate-deposit-address",
    ),
    path("deposits/", views.DepositListView.as_view(), name="deposit-list"),
]
