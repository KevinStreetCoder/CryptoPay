from django.urls import path

from . import views

app_name = "payments"

urlpatterns = [
    path("pay-bill/", views.PayBillView.as_view(), name="pay-bill"),
    path("pay-till/", views.PayTillView.as_view(), name="pay-till"),
    path("send-mpesa/", views.SendMpesaView.as_view(), name="send-mpesa"),
    path("buy-crypto/", views.BuyCryptoView.as_view(), name="buy-crypto"),
    path("deposit/quote/", views.DepositQuoteView.as_view(), name="deposit-quote"),
    path("deposit/<uuid:transaction_id>/status/", views.DepositStatusView.as_view(), name="deposit-status"),
    path("<uuid:transaction_id>/status/", views.DepositStatusView.as_view(), name="transaction-status"),
    path("deposit/c2b-instructions/", views.C2BInstructionsView.as_view(), name="c2b-instructions"),
    path("withdraw/", views.WithdrawView.as_view(), name="withdraw"),
    path("withdraw/<uuid:transaction_id>/status/", views.WithdrawStatusView.as_view(), name="withdraw-status"),
    path("withdraw/fee/", views.WithdrawFeeView.as_view(), name="withdraw-fee"),
    path("history/", views.TransactionHistoryView.as_view(), name="history"),
    path("activity/", views.UnifiedActivityView.as_view(), name="activity"),
    path("<uuid:transaction_id>/receipt/", views.TransactionReceiptView.as_view(), name="transaction-receipt"),
    path("circuit-breaker/", views.CircuitBreakerStatusView.as_view(), name="circuit-breaker"),
]
