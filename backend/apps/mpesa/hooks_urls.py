"""
Alternate callback URL paths that avoid "mpesa" in the URL.

Safaricom's C2B URL registration rejects callback URLs containing "mpesa"
or "safaricom" in the path. These routes provide identical endpoints under
/api/v1/hooks/ instead of /api/v1/mpesa/callback/.
"""

from django.urls import path

from . import views

urlpatterns = [
    path("c2b/validate/", views.C2BValidationView.as_view(), name="hooks-c2b-validate"),
    path("c2b/confirm/", views.C2BConfirmationView.as_view(), name="hooks-c2b-confirm"),
]
