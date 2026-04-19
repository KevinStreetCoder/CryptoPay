from django.urls import path

from . import views

app_name = "referrals"

urlpatterns = [
    path("me/", views.MyReferralView.as_view(), name="me"),
    path("history/", views.ReferralHistoryView.as_view(), name="history"),
    path("share-event/", views.ShareEventView.as_view(), name="share_event"),
    path("validate/", views.ValidateCodeView.as_view(), name="validate"),
    path("admin/", views.AdminReferralListView.as_view(), name="admin_list"),
    path("admin/<uuid:referral_id>/clawback/", views.AdminClawbackView.as_view(), name="admin_clawback"),
]
