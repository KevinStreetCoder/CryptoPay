from django.urls import path

from . import views

app_name = "wallets"

urlpatterns = [
    # User-facing wallet endpoints
    path("", views.WalletListView.as_view(), name="wallet-list"),
    path(
        "<uuid:wallet_id>/generate-address/",
        views.GenerateDepositAddressView.as_view(),
        name="generate-deposit-address",
    ),
    path("deposits/", views.DepositListView.as_view(), name="deposit-list"),

    # Admin rebalance endpoints
    path("admin/rebalance/status/", views.RebalanceStatusView.as_view(), name="rebalance-status"),
    path("admin/rebalance/orders/", views.RebalanceOrderListView.as_view(), name="rebalance-orders"),
    path("admin/rebalance/trigger/", views.TriggerRebalanceView.as_view(), name="rebalance-trigger"),
    path(
        "admin/rebalance/<uuid:order_id>/confirm/",
        views.ConfirmRebalanceView.as_view(),
        name="rebalance-confirm",
    ),
    path(
        "admin/rebalance/<uuid:order_id>/fail/",
        views.FailRebalanceView.as_view(),
        name="rebalance-fail",
    ),
    path(
        "admin/rebalance/<uuid:order_id>/cancel/",
        views.CancelRebalanceView.as_view(),
        name="rebalance-cancel",
    ),

    # Custody tier endpoints
    path("custody/report/", views.CustodyReportView.as_view(), name="custody-report"),
    path("custody/rebalance/", views.CustodyRebalanceView.as_view(), name="custody-rebalance"),
]
