"""
Expo Push Notification service.

Sends push notifications to user devices via the Expo Push API.
Automatically cleans up invalid tokens (DeviceNotRegistered).
"""

import logging
from typing import Optional

import requests

from apps.accounts.models import PushToken

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def send_push_notification(
    user_id: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> list[dict]:
    """
    Send a push notification to all registered devices for a user.

    Args:
        user_id: UUID of the target user.
        title: Notification title.
        body: Notification body text.
        data: Optional JSON-serializable data payload.

    Returns:
        List of Expo push ticket responses.
    """
    tokens = PushToken.objects.filter(user_id=user_id).values_list("token", flat=True)

    if not tokens:
        logger.info(f"No push tokens found for user {user_id}")
        return []

    messages = [
        {
            "to": token,
            "sound": "default",
            "title": title,
            "body": body,
            "data": data or {},
        }
        for token in tokens
    ]

    try:
        response = requests.post(
            EXPO_PUSH_URL,
            json=messages,
            headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate",
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        response.raise_for_status()
        result = response.json()
    except requests.RequestException as e:
        logger.error(f"Expo push API request failed for user {user_id}: {e}")
        return []

    # Process tickets — remove tokens that are no longer valid
    tickets = result.get("data", [])
    tokens_list = list(tokens)

    for i, ticket in enumerate(tickets):
        if i >= len(tokens_list):
            break

        if ticket.get("status") == "error":
            error_type = ticket.get("details", {}).get("error", "")

            if error_type == "DeviceNotRegistered":
                # Token is no longer valid — delete it
                deleted_count, _ = PushToken.objects.filter(
                    user_id=user_id, token=tokens_list[i]
                ).delete()
                logger.info(
                    f"Removed invalid push token for user {user_id}: "
                    f"{tokens_list[i][:20]}... (DeviceNotRegistered)"
                )
            else:
                logger.warning(
                    f"Push notification error for user {user_id}, "
                    f"token {tokens_list[i][:20]}...: {ticket}"
                )

    return tickets
