import uuid

from django.conf import settings
from django.db import models


class AdminNotification(models.Model):
    """A broadcast notification created by an admin."""

    class Category(models.TextChoices):
        SECURITY = "security", "Security"
        UPDATE = "update", "Update"
        PROMOTION = "promotion", "Promotion"
        MAINTENANCE = "maintenance", "Maintenance"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    body = models.TextField()
    category = models.CharField(
        max_length=20,
        choices=Category.choices,
        default=Category.UPDATE,
    )
    priority = models.CharField(
        max_length=10,
        choices=Priority.choices,
        default=Priority.NORMAL,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_notifications",
    )
    channels = models.JSONField(
        default=list,
        help_text="List of delivery channels: email, sms, in_app",
    )
    target = models.CharField(
        max_length=20,
        default="all",
        help_text="Target audience: all, or specific filter",
    )
    target_user_ids = models.JSONField(
        default=list,
        blank=True,
        help_text="Optional list of specific user UUIDs to target",
    )
    recipient_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Admin Notification"
        verbose_name_plural = "Admin Notifications"

    def __str__(self):
        return f"[{self.category}] {self.title}"


class UserNotification(models.Model):
    """Per-user delivery record for a broadcast notification."""

    class DeliveryChannel(models.TextChoices):
        EMAIL = "email", "Email"
        SMS = "sms", "SMS"
        PUSH = "push", "Push"
        IN_APP = "in_app", "In-App"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    notification = models.ForeignKey(
        AdminNotification,
        on_delete=models.CASCADE,
        related_name="deliveries",
    )
    read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    delivered_via = models.CharField(
        max_length=10,
        choices=DeliveryChannel.choices,
        default=DeliveryChannel.IN_APP,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = [("user", "notification")]
        verbose_name = "User Notification"
        verbose_name_plural = "User Notifications"

    def __str__(self):
        return f"{self.user} — {self.notification.title} ({self.delivered_via})"
