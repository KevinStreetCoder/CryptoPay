from django.urls import path

from . import views

app_name = "notifications"

urlpatterns = [
    # User endpoints
    path("", views.UserNotificationListView.as_view(), name="list"),
    path("<uuid:notification_id>/", views.UserNotificationDetailView.as_view(), name="detail"),
    path("<uuid:notification_id>/read/", views.MarkNotificationReadView.as_view(), name="mark-read"),
    path("read-all/", views.MarkAllReadView.as_view(), name="mark-all-read"),
    path("unread-count/", views.UnreadCountView.as_view(), name="unread-count"),
    # Admin endpoints
    path("admin/broadcast/", views.AdminBroadcastView.as_view(), name="admin-broadcast"),
    path("admin/list/", views.AdminNotificationDetailListView.as_view(), name="admin-detail-list"),
    path("admin/stats/", views.AdminNotificationStatsView.as_view(), name="admin-stats"),
    path("admin/<uuid:notification_id>/stats/", views.AdminNotificationStatsDetailView.as_view(), name="admin-stats-detail"),
    path("admin/<uuid:notification_id>/", views.AdminNotificationEditView.as_view(), name="admin-edit"),
    path("admin/", views.AdminNotificationListView.as_view(), name="admin-list"),
]
