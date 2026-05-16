"""Service helpers for creating per-user in-app notifications from
system events (vs the admin-broadcast path that AdminNotification was
originally designed for).

2026-05-16 · `notify_money_received` was the first concrete consumer ·
when a Cpay-to-Cpay transfer credits the recipient's wallet we also
drop a row into their inbox so they see "Money received from Jane D."
the next time they open the app, even if the push notification was
dismissed or the SMS / email got buried.

Why we re-use AdminNotification (rather than spinning up a new model):
  - The UserNotification join already powers the mobile inbox UI, the
    unread-count badge, the mark-read / opened-at engagement signals,
    and the read receipts in admin tooling. Adding a parallel "system
    notification" table would mean duplicating every one of those.
  - AdminNotification has `created_by` (nullable) · system events just
    leave it null. The admin tooling already filters by
    `created_by isnull` so system rows don't clutter the human-curated
    broadcast list.
  - One AdminNotification per tx is fine for the volume we expect
    (peer-to-peer transfers, not 1M+ deposit credits).
"""
from __future__ import annotations

from typing import Iterable

from django.contrib.auth import get_user_model

from .models import AdminNotification, UserNotification


User = get_user_model()


def notify_money_received(
    recipient,
    *,
    sender_label: str,
    amount: str,
    currency: str,
    transaction_id: str,
    memo: str = "",
) -> UserNotification | None:
    """Drop a "money received" row into `recipient`'s inbox.

    Idempotent · re-running with the same `transaction_id` reuses the
    existing AdminNotification row instead of creating a duplicate.
    Returns the UserNotification (or None if the recipient already has
    one for this transaction).
    """
    title = f"You received {amount} {currency}"
    body = (
        f"From {sender_label}"
        + (f" — \"{memo}\"" if memo else "")
        + ". Tap to view in your wallet."
    )

    # Use the transaction_id as a stable parent key so a retry of the
    # saga's `_notify_recipient` doesn't create duplicate rows in the
    # admin notification table. AdminNotification has no `tx_id` field;
    # we encode it as a sentinel in `target_user_ids` which is JSON and
    # easy to filter on.
    parent, _ = AdminNotification.objects.get_or_create(
        category=AdminNotification.Category.UPDATE,
        priority=AdminNotification.Priority.NORMAL,
        title=title,
        # The dedup contract is (category, priority, title, this list).
        # Embedding transaction_id is enough because tx UUIDs are unique.
        target_user_ids=[str(transaction_id)],
        defaults={
            "body": body,
            "channels": ["in_app"],
            "target": "user",
            "created_by": None,  # system-generated
            "recipient_count": 1,
        },
    )

    user_notif, created = UserNotification.objects.get_or_create(
        user=recipient,
        notification=parent,
        defaults={
            "delivered_via": UserNotification.DeliveryChannel.IN_APP,
        },
    )
    return user_notif if created else None


def notify_users(
    recipients: Iterable,
    *,
    title: str,
    body: str,
    category: str = AdminNotification.Category.UPDATE,
    priority: str = AdminNotification.Priority.NORMAL,
    channel: str = UserNotification.DeliveryChannel.IN_APP,
    transaction_id: str | None = None,
) -> int:
    """Generic helper for "system → many users" delivery. Creates one
    AdminNotification + N UserNotification rows. Returns the number of
    NEW UserNotification rows actually created (excludes existing dupes).

    `transaction_id` (when supplied) is recorded in `target_user_ids`
    for dedup · same idempotency contract as notify_money_received.
    """
    parent_kwargs = dict(
        category=category, priority=priority, title=title,
        defaults=dict(
            body=body,
            channels=[channel],
            target="user",
            created_by=None,
        ),
    )
    if transaction_id is not None:
        parent_kwargs["target_user_ids"] = [str(transaction_id)]
    else:
        parent_kwargs["defaults"]["target_user_ids"] = []
    parent, _ = AdminNotification.objects.get_or_create(**parent_kwargs)

    created_count = 0
    for r in recipients:
        _, was_new = UserNotification.objects.get_or_create(
            user=r, notification=parent,
            defaults={"delivered_via": channel},
        )
        if was_new:
            created_count += 1
    return created_count
