import uuid

import bcrypt
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models

from .managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    class KYCStatus(models.TextChoices):
        PENDING = "pending"
        VERIFIED = "verified"
        REJECTED = "rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=15, unique=True, db_index=True)
    email = models.EmailField(blank=True, null=True, unique=True)
    pin_hash = models.CharField(max_length=255, blank=True)
    kyc_tier = models.SmallIntegerField(default=0)
    kyc_status = models.CharField(
        max_length=20,
        choices=KYCStatus.choices,
        default=KYCStatus.PENDING,
    )
    is_active = models.BooleanField(default=True)
    is_suspended = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)
    pin_attempts = models.SmallIntegerField(default=0)
    pin_locked_until = models.DateTimeField(null=True, blank=True)
    device_id = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = []

    class Meta:
        db_table = "users"

    def __str__(self):
        return self.phone

    def set_pin(self, raw_pin: str):
        self.pin_hash = bcrypt.hashpw(
            raw_pin.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

    def check_pin(self, raw_pin: str) -> bool:
        if not self.pin_hash:
            return False
        return bcrypt.checkpw(
            raw_pin.encode("utf-8"), self.pin_hash.encode("utf-8")
        )


class KYCDocument(models.Model):
    class DocumentType(models.TextChoices):
        NATIONAL_ID = "national_id"
        PASSPORT = "passport"
        SELFIE = "selfie"
        KRA_PIN = "kra_pin"
        PROOF_OF_ADDRESS = "proof_of_address"

    class Status(models.TextChoices):
        PENDING = "pending"
        APPROVED = "approved"
        REJECTED = "rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="kyc_documents")
    document_type = models.CharField(max_length=30, choices=DocumentType.choices)
    file_url = models.URLField(max_length=500)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    rejection_reason = models.TextField(blank=True)
    verified_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="verified_documents"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "kyc_documents"

    def __str__(self):
        return f"{self.user.phone} - {self.document_type}"


class Device(models.Model):
    """Registered devices for a user. New devices require OTP verification."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="devices")
    device_id = models.CharField(max_length=255, db_index=True)
    device_name = models.CharField(max_length=255, blank=True)
    platform = models.CharField(max_length=50, blank=True)
    os_version = models.CharField(max_length=50, blank=True)
    is_trusted = models.BooleanField(default=False)
    last_seen = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "devices"
        unique_together = ("user", "device_id")

    def __str__(self):
        return f"{self.user.phone} - {self.device_name or self.device_id}"


class AuditLog(models.Model):
    """Immutable audit trail for all actions."""

    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=50, db_index=True)
    entity_type = models.CharField(max_length=30, blank=True)
    entity_id = models.CharField(max_length=50, blank=True)
    details = models.JSONField(default=dict)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "audit_log"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} by {self.user} at {self.created_at}"
