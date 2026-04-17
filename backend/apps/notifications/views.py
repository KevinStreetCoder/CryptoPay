"""Notification API views — admin broadcast + user inbox."""

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.db.models import Q, Count, Sum, Case, When, FloatField, Value
from django.db.models.functions import Coalesce
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.core.email import send_sms

from .models import AdminNotification, UserNotification
from .serializers import (
    AdminNotificationSerializer,
    AdminNotificationDetailSerializer,
    BroadcastSerializer,
    UserNotificationSerializer,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Admin: Broadcast Notification
# ---------------------------------------------------------------------------


class AdminBroadcastView(APIView):
    """POST /api/v1/admin/notifications/broadcast/ — Create and send a broadcast."""

    permission_classes = [IsAdminUser]

    def post(self, request):
        serializer = BroadcastSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Determine target users
        target = data["target"]
        target_user_ids = data.get("target_user_ids", [])

        if target == "all":
            users = User.objects.filter(is_active=True)
        elif target == "kyc_verified":
            users = User.objects.filter(is_active=True, kyc_status="verified")
        elif target == "kyc_pending":
            users = User.objects.filter(is_active=True, kyc_status="pending")
        elif target == "specific" and target_user_ids:
            users = User.objects.filter(id__in=target_user_ids, is_active=True)
        else:
            users = User.objects.filter(is_active=True)

        # Create the admin notification record
        notification = AdminNotification.objects.create(
            title=data["title"],
            body=data["body"],
            category=data["category"],
            priority=data["priority"],
            channels=data["channels"],
            target=target,
            target_user_ids=[str(uid) for uid in target_user_ids],
            created_by=request.user,
            recipient_count=users.count(),
        )

        channels = data["channels"]
        email_count = 0
        sms_count = 0
        in_app_count = 0

        # Process each user
        for user in users.iterator():
            # Always create in-app notification
            if "in_app" in channels:
                UserNotification.objects.create(
                    user=user,
                    notification=notification,
                    delivered_via="in_app",
                )
                in_app_count += 1

            # Send email
            if "email" in channels and user.email:
                try:
                    html = render_to_string("email/broadcast_notification.html", {
                        "full_name": user.full_name or "there",
                        "title": data["title"],
                        "body": data["body"],
                        "category": data["category"],
                        "priority": data["priority"],
                    })
                    send_mail(
                        f"CryptoPay — {data['title']}",
                        "",
                        settings.DEFAULT_FROM_EMAIL,
                        [user.email],
                        html_message=html,
                        fail_silently=True,
                    )
                    email_count += 1
                except Exception as e:
                    logger.error(f"Broadcast email to {user.email} failed: {e}")

            # Send SMS
            if "sms" in channels and user.phone:
                try:
                    sms_body = f"CryptoPay: {data['title']} — {data['body'][:120]}"
                    send_sms(user.phone, sms_body)
                    sms_count += 1
                except Exception as e:
                    logger.error(f"Broadcast SMS to {user.phone} failed: {e}")

        logger.info(
            f"Broadcast '{notification.title}' sent by {request.user.phone}: "
            f"{in_app_count} in-app, {email_count} emails, {sms_count} SMS"
        )

        return Response(
            {
                "id": str(notification.id),
                "title": notification.title,
                "recipient_count": notification.recipient_count,
                "delivered": {
                    "in_app": in_app_count,
                    "email": email_count,
                    "sms": sms_count,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class AdminNotificationListView(ListAPIView):
    """GET /api/v1/notifications/admin/ — List all broadcasts (admin only)."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminNotificationSerializer
    queryset = AdminNotification.objects.select_related("created_by").all()


class AdminNotificationDetailListView(ListAPIView):
    """GET /api/v1/notifications/admin/list/ — List broadcasts with delivery/read stats."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminNotificationDetailSerializer

    def get_queryset(self):
        return (
            AdminNotification.objects.select_related("created_by")
            .annotate(
                total_recipients=Count("deliveries", distinct=True),
                read_count=Count(
                    "deliveries",
                    filter=Q(deliveries__read=True),
                    distinct=True,
                ),
            )
            .order_by("-created_at")
        )


class AdminNotificationStatsView(APIView):
    """GET /api/v1/notifications/admin/stats/ — Aggregate broadcast stats."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        total_broadcasts = AdminNotification.objects.count()
        total_recipients = UserNotification.objects.count()
        total_read = UserNotification.objects.filter(read=True).count()
        read_rate = round(total_read / total_recipients * 100, 1) if total_recipients else 0

        # Unique users reached
        unique_users = UserNotification.objects.values("user").distinct().count()

        # Channel breakdown across all notifications
        channel_counts = (
            UserNotification.objects.values("delivered_via")
            .annotate(count=Count("id"))
        )
        channels = {row["delivered_via"]: row["count"] for row in channel_counts}

        # By-category breakdown
        by_category = list(
            AdminNotification.objects.values("category")
            .annotate(
                count=Count("id"),
                recipients=Coalesce(Sum("recipient_count"), 0),
            )
            .order_by("-count")
        )

        return Response({
            "total_broadcasts": total_broadcasts,
            "total_recipients": total_recipients,
            "total_read": total_read,
            "read_rate_percent": read_rate,
            "unique_users_reached": unique_users,
            "channels": channels,
            "by_category": by_category,
        })


# ---------------------------------------------------------------------------
# User: Notification Inbox
# ---------------------------------------------------------------------------


class UserNotificationListView(ListAPIView):
    """GET /api/v1/notifications/ — List current user's notifications (paginated)."""

    permission_classes = [IsAuthenticated]
    serializer_class = UserNotificationSerializer

    def get_queryset(self):
        qs = UserNotification.objects.filter(
            user=self.request.user,
        ).select_related("notification")

        # Optional category filter
        category = self.request.query_params.get("category")
        if category and category in dict(AdminNotification.Category.choices):
            qs = qs.filter(notification__category=category)

        return qs


class MarkNotificationReadView(APIView):
    """POST /api/v1/notifications/<id>/read/ — Mark a single notification as read."""

    permission_classes = [IsAuthenticated]

    def post(self, request, notification_id):
        try:
            notif = UserNotification.objects.get(
                id=notification_id,
                user=request.user,
            )
        except UserNotification.DoesNotExist:
            return Response(
                {"error": "Notification not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not notif.read:
            notif.read = True
            notif.read_at = timezone.now()
            notif.save(update_fields=["read", "read_at"])

        return Response({"status": "ok"})


class MarkAllReadView(APIView):
    """POST /api/v1/notifications/read-all/ — Mark all user notifications as read."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        updated = UserNotification.objects.filter(
            user=request.user,
            read=False,
        ).update(read=True, read_at=timezone.now())

        return Response({"status": "ok", "marked": updated})


class UnreadCountView(APIView):
    """GET /api/v1/notifications/unread-count/ — Return unread count."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        count = UserNotification.objects.filter(
            user=request.user,
            read=False,
        ).count()
        return Response({"unread_count": count})


class UserNotificationDetailView(APIView):
    """GET /api/v1/notifications/<id>/ — Full details for the modal.

    Also records an "opened" event on first fetch (or increments open_count
    on subsequent opens). This is what powers the admin "X users opened
    vs. Y read" stat separation.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, notification_id):
        try:
            notif = UserNotification.objects.select_related(
                "notification", "notification__created_by"
            ).get(id=notification_id, user=request.user)
        except UserNotification.DoesNotExist:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        # Mark read + opened atomically. `read` is implicit on detail view,
        # `opened_at` tracks deliberate engagement (tapped card).
        updates = []
        now = timezone.now()
        if not notif.read:
            notif.read = True
            notif.read_at = now
            updates += ["read", "read_at"]
        if notif.opened_at is None:
            notif.opened_at = now
            updates.append("opened_at")
        notif.open_count = (notif.open_count or 0) + 1
        updates.append("open_count")
        notif.save(update_fields=updates)

        src = notif.notification
        return Response({
            "id": str(notif.id),
            "title": src.title,
            "body": src.body,
            "category": src.category,
            "priority": src.priority,
            "read": notif.read,
            "read_at": notif.read_at,
            "opened_at": notif.opened_at,
            "open_count": notif.open_count,
            "delivered_via": notif.delivered_via,
            "created_at": notif.created_at,
            "sent_at": src.created_at,
            "sender_name": (src.created_by.full_name or src.created_by.phone)
            if src.created_by else "CryptoPay Team",
            "is_edited": src.edit_count > 0,
            "last_edited_at": src.updated_at if src.edit_count > 0 else None,
        })


# ---------------------------------------------------------------------------
# Admin: Per-notification stats + Edit
# ---------------------------------------------------------------------------


class AdminNotificationStatsDetailView(APIView):
    """GET /api/v1/notifications/admin/<id>/stats/ — Per-broadcast stats.

    Returns read / opened / open_count across the recipient pool so admins
    can distinguish "scrolled past in the list" (read=True via list render)
    from "actually tapped into the content" (opened_at != null).
    """

    permission_classes = [IsAdminUser]

    def get(self, request, notification_id):
        try:
            broadcast = AdminNotification.objects.select_related("created_by").get(
                id=notification_id
            )
        except AdminNotification.DoesNotExist:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        deliveries = UserNotification.objects.filter(notification=broadcast)
        total = deliveries.count()
        read = deliveries.filter(read=True).count()
        opened = deliveries.exclude(opened_at__isnull=True).count()
        total_opens = deliveries.aggregate(s=Sum("open_count"))["s"] or 0

        # Channel mix
        channel_counts = (
            deliveries.values("delivered_via")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        return Response({
            "id": str(broadcast.id),
            "title": broadcast.title,
            "body": broadcast.body,
            "category": broadcast.category,
            "priority": broadcast.priority,
            "created_at": broadcast.created_at,
            "updated_at": broadcast.updated_at,
            "edit_count": broadcast.edit_count,
            "created_by": (broadcast.created_by.full_name or broadcast.created_by.phone)
            if broadcast.created_by else None,
            "totals": {
                "recipients": total,
                "read": read,
                "opened": opened,
                "total_opens": total_opens,
                "read_rate_percent": round(read / total * 100, 1) if total else 0,
                "open_rate_percent": round(opened / total * 100, 1) if total else 0,
            },
            "channels": [
                {"channel": r["delivered_via"], "count": r["count"]}
                for r in channel_counts
            ],
        })


class AdminNotificationEditView(APIView):
    """PATCH /api/v1/notifications/admin/<id>/ — Edit title/body/category/priority.

    Edits propagate automatically to every UserNotification record via the
    ForeignKey join — no need to touch the per-user rows. We bump
    `edit_count` + `last_edited_by` so admins see an audit trail. Email /
    SMS deliveries already sent are NOT re-sent (unsafe to spam users with
    revisions); the edit surfaces in the in-app notification detail view.
    """

    permission_classes = [IsAdminUser]

    ALLOWED = {"title", "body", "category", "priority"}

    def patch(self, request, notification_id):
        try:
            broadcast = AdminNotification.objects.get(id=notification_id)
        except AdminNotification.DoesNotExist:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        changed = []
        for key in self.ALLOWED:
            if key in request.data:
                new_val = request.data[key]
                # Validate category / priority choices
                if key == "category" and new_val not in dict(AdminNotification.Category.choices):
                    return Response({"error": f"Invalid category: {new_val}"}, status=400)
                if key == "priority" and new_val not in dict(AdminNotification.Priority.choices):
                    return Response({"error": f"Invalid priority: {new_val}"}, status=400)
                if getattr(broadcast, key) != new_val:
                    setattr(broadcast, key, new_val)
                    changed.append(key)

        if not changed:
            return Response({"status": "no_changes", "id": str(broadcast.id)})

        broadcast.edit_count = (broadcast.edit_count or 0) + 1
        broadcast.last_edited_by = request.user
        broadcast.save(update_fields=[*changed, "edit_count", "last_edited_by", "updated_at"])

        logger.info(
            "notification.edited",
            extra={
                "notification_id": str(broadcast.id),
                "edited_by": str(request.user.id),
                "changed_fields": changed,
            },
        )

        return Response({
            "status": "ok",
            "id": str(broadcast.id),
            "edit_count": broadcast.edit_count,
            "changed_fields": changed,
            "updated_at": broadcast.updated_at,
        })
