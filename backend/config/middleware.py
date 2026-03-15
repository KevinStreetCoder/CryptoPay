"""
Custom Channels middleware for JWT authentication on WebSocket connections.

Usage:
    ws://host/ws/wallets/?token=<jwt_access_token>

Public endpoints (like ws/rates/) work without a token — scope["user"]
will be AnonymousUser.
"""

import logging
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken

logger = logging.getLogger(__name__)


@database_sync_to_async
def get_user_from_token(token_str: str):
    """Validate a JWT access token and return the associated user."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    try:
        token = AccessToken(token_str)
        user_id = token["user_id"]
        return User.objects.get(id=user_id)
    except Exception as e:
        logger.debug(f"WebSocket JWT auth failed: {e}")
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """
    Extract JWT from query string and attach user to scope.

    Allows unauthenticated connections (for public endpoints like rates).
    Individual consumers should check scope["user"].is_authenticated
    if they require auth.
    """

    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode("utf-8")
        params = parse_qs(query_string)
        token_list = params.get("token", [])

        if token_list:
            scope["user"] = await get_user_from_token(token_list[0])
        else:
            scope["user"] = AnonymousUser()

        return await super().__call__(scope, receive, send)
