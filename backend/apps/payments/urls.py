from django.urls import path

from . import views

app_name = "payments"

urlpatterns = [
    path("pay-bill/", views.PayBillView.as_view(), name="pay-bill"),
    path("pay-till/", views.PayTillView.as_view(), name="pay-till"),
    path("history/", views.TransactionHistoryView.as_view(), name="history"),
]
