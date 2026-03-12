from django.urls import path

from . import views

app_name = "payments"

urlpatterns = [
    path("pay-bill/", views.PayBillView.as_view(), name="pay-bill"),
    path("pay-till/", views.PayTillView.as_view(), name="pay-till"),
    path("send-mpesa/", views.SendMpesaView.as_view(), name="send-mpesa"),
    path("buy-crypto/", views.BuyCryptoView.as_view(), name="buy-crypto"),
    path("history/", views.TransactionHistoryView.as_view(), name="history"),
    path("<uuid:transaction_id>/receipt/", views.TransactionReceiptView.as_view(), name="transaction-receipt"),
    path("circuit-breaker/", views.CircuitBreakerStatusView.as_view(), name="circuit-breaker"),
]
