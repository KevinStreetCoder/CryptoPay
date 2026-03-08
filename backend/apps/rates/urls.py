from django.urls import path

from . import views

app_name = "rates"

urlpatterns = [
    path("", views.RateView.as_view(), name="rate"),
    path("quote/", views.QuoteView.as_view(), name="quote"),
]
