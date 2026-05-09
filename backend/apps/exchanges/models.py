"""External-exchange integration models.

A user can link a custodial exchange (Binance / Coinbase) or a P2P
marketplace (Noones) to their Cpay profile. The link stores either
an OAuth refresh token (Coinbase / Noones) or per-user API key +
secret (Binance), all encrypted at rest with the same Fernet master
that protects TOTP secrets and the recovery_email/recovery_phone
PII columns. Rotating the master rotates all of them.

The withdraw flow is a separate model so we can record every pull
attempt (idempotent on (link_id, request_id)) and have a clean
audit trail of "Cpay initiated this on the user's behalf at this
time, the exchange returned this transaction ID".

Design doc: docs/research/EXCHANGE-OAUTH-INTEGRATION-2026-05-09.md
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from django.db import models

from apps.accounts.models import User
from apps.core import pii as _pii


class ExchangeLink(models.Model):
    """A linked external exchange account belonging to one user.

    For Coinbase / Noones we store the OAuth refresh token. For
    Binance we store the API key + secret. Both are Fernet-encrypted
    via PIIEncryptedField · the column type stays TEXT, encryption
    is transparent on read/write.
    """

    PROVIDER_BINANCE = "binance"
    PROVIDER_COINBASE = "coinbase"
    PROVIDER_NOONES = "noones"
    PROVIDER_CHOICES = [
        (PROVIDER_BINANCE, "Binance"),
        (PROVIDER_COINBASE, "Coinbase"),
        (PROVIDER_NOONES, "Noones"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="exchange_links",
    )
    provider = models.CharField(max_length=24, choices=PROVIDER_CHOICES)

    # Coinbase / Noones · OAuth credentials. Refresh token is
    # long-lived (Coinbase ~10 yr, Noones varies) and can be exchanged
    # for a short-lived access token by the client at withdraw time.
    refresh_token = _pii.PIIEncryptedField(blank=True, null=True)
    # Coinbase issues an access token alongside the refresh; we cache
    # it in the model so we don't refresh on every request, but the
    # client always falls back to refresh + retry on 401.
    access_token = _pii.PIIEncryptedField(blank=True, null=True)
    access_token_expires_at = models.DateTimeField(blank=True, null=True)

    # Binance · API key + secret. The API key is non-sensitive (only
    # identifies the user's Binance account) and we store it plain
    # for ops/debug. The secret is Fernet-encrypted.
    api_key = models.CharField(max_length=128, blank=True, default="")
    api_secret = _pii.PIIEncryptedField(blank=True, null=True)

    # Granted scopes (Coinbase: wallet:user:read,
    # wallet:transactions:send · Noones: read_balance · Binance: a
    # synthetic ['withdraw'] after we confirm the API key is
    # withdraw-only).
    scopes = models.JSONField(default=list, blank=True)

    verified_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(blank=True, null=True)
    revoked_at = models.DateTimeField(blank=True, null=True)

    # Audit · which IP / device initiated the link. Helps detect
    # account-takeover attempts ("a new exchange link was added from
    # an IP we've never seen the user log in from").
    linked_from_ip = models.GenericIPAddressField(blank=True, null=True)
    linked_user_agent = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "exchange_links"
        constraints = [
            # One ACTIVE link per (user, provider). When revoked we
            # null this out via revoked_at and allow a fresh re-link.
            models.UniqueConstraint(
                fields=["user", "provider"],
                condition=models.Q(revoked_at__isnull=True),
                name="exchange_links_one_active_per_provider",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "provider"]),
            models.Index(fields=["provider", "verified_at"]),
        ]

    def __str__(self) -> str:
        suffix = " (revoked)" if self.revoked_at else ""
        return f"{self.user.phone} · {self.provider}{suffix}"

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None


class ExchangeWithdrawal(models.Model):
    """Record of a Cpay-initiated withdrawal from a linked exchange.

    Idempotent on `(link, request_id)` · re-submitting the same
    request returns the existing row instead of creating a duplicate.
    The state machine matches the lifecycle observable from the
    exchange's status API:

      pending     · Cpay submitted the withdraw request, waiting
                    for the exchange to acknowledge
      confirming  · exchange acknowledged, on-chain tx pending
      done        · funds credited to the Cpay deposit address
                    (saga can now run)
      failed      · exchange rejected, or on-chain tx never landed
    """

    STATUS_PENDING = "pending"
    STATUS_CONFIRMING = "confirming"
    STATUS_DONE = "done"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_CONFIRMING, "Confirming"),
        (STATUS_DONE, "Done"),
        (STATUS_FAILED, "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="exchange_withdrawals",
    )
    link = models.ForeignKey(
        ExchangeLink,
        on_delete=models.PROTECT,
        related_name="withdrawals",
    )
    # Client-supplied UUID for idempotency. The mobile client mints
    # this before the request so a network retry doesn't double-pull.
    request_id = models.CharField(max_length=64)

    currency = models.CharField(max_length=8)        # USDT / USDC / BTC / ETH
    network = models.CharField(max_length=24)        # TRX / ERC20 / BEP20 / BTC / ETH
    amount = models.DecimalField(max_digits=20, decimal_places=8)
    destination_address = models.CharField(max_length=128)

    # The exchange's own withdrawId (varies per provider).
    exchange_tx_id = models.CharField(max_length=128, blank=True, default="")
    # The on-chain transaction hash, populated once we observe it.
    on_chain_tx = models.CharField(max_length=128, blank=True, default="")

    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING,
    )
    error_code = models.CharField(max_length=64, blank=True, default="")
    error_message = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = "exchange_withdrawals"
        constraints = [
            models.UniqueConstraint(
                fields=["link", "request_id"],
                name="exchange_withdrawals_idempotency",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "status"]),
            models.Index(fields=["link", "status"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self) -> str:
        return (
            f"{self.user.phone} · {self.link.provider} · "
            f"{self.amount} {self.currency} → {self.status}"
        )

    @property
    def is_terminal(self) -> bool:
        return self.status in (self.STATUS_DONE, self.STATUS_FAILED)
