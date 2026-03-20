from django.urls import path

from . import views

app_name = "rates"

urlpatterns = [
    path("", views.RateView.as_view(), name="rate"),
    path("quote/", views.QuoteView.as_view(), name="quote"),
    path("history/", views.RateHistoryView.as_view(), name="rate-history"),
    # Rate Alerts
    path("alerts/", views.RateAlertListCreateView.as_view(), name="rate-alerts"),
    path("alerts/<uuid:pk>/", views.RateAlertDetailView.as_view(), name="rate-alert-detail"),
]
