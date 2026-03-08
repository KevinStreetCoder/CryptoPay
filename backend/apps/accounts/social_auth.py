"""
Google OAuth token verification.

Verifies Google ID tokens using google-auth library.
Used by the mobile app: user signs in with Google on the client,
sends the idToken to our backend, and we verify + create/find the user.
"""

import logging

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from django.conf import settings

logger = logging.getLogger(__name__)


class GoogleAuthError(Exception):
    pass


def verify_google_token(token: str) -> dict:
    """
    Verify a Google ID token and return the user info.

    Returns:
        {
            "sub": "google-user-id",
            "email": "user@gmail.com",
            "name": "User Name",
            "picture": "https://...",
            "email_verified": True,
        }

    Raises:
        GoogleAuthError if the token is invalid or expired.
    """
    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            getattr(settings, "GOOGLE_CLIENT_ID", ""),
        )

        # Verify issuer
        if idinfo["iss"] not in ("accounts.google.com", "https://accounts.google.com"):
            raise GoogleAuthError("Invalid token issuer")

        if not idinfo.get("email_verified", False):
            raise GoogleAuthError("Google email not verified")

        return {
            "sub": idinfo["sub"],
            "email": idinfo["email"],
            "name": idinfo.get("name", ""),
            "picture": idinfo.get("picture", ""),
            "email_verified": idinfo.get("email_verified", False),
        }

    except ValueError as e:
        logger.warning(f"Google token verification failed: {e}")
        raise GoogleAuthError(f"Invalid Google token: {e}")
