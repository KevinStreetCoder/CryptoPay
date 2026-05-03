"""Cookie-aware JWT authentication for the web client.

The web bundle (cpay.co.ke) authenticates via HttpOnly cookies set by
LoginView / RegisterView / HardenedTokenRefreshView when the request
carries `X-Cpay-Web: 1`. The native app sends `Authorization: Bearer`.

SimpleJWT's stock `JWTAuthentication` only reads the Authorization
header, which means the entire cookies-only flow returned 401 on every
authenticated GET. This subclass falls through to `cpay_access` when no
Bearer is present, preserving native compatibility while making the web
contract actually work.
"""
from __future__ import annotations

from rest_framework_simplejwt.authentication import JWTAuthentication


COOKIE_NAME = "cpay_access"


class CookieJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        header = self.get_header(request)
        raw_token = self.get_raw_token(header) if header is not None else None
        if raw_token is None:
            cookie = request.COOKIES.get(COOKIE_NAME)
            if not cookie:
                return None
            raw_token = cookie.encode("utf-8") if isinstance(cookie, str) else cookie
        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token


# drf-spectacular OpenAPI scheme · without this `manage.py check --deploy
# --fail-level WARNING` fails because the schema generator can't introspect
# our custom auth class. Wrapped in try/except so the module still imports
# in environments where drf-spectacular isn't installed (e.g. minimal
# scripts).
try:
    from drf_spectacular.extensions import OpenApiAuthenticationExtension

    class CookieJWTScheme(OpenApiAuthenticationExtension):
        target_class = "apps.accounts.authentication.CookieJWTAuthentication"
        name = "cookieJWT"
        match_subclasses = False

        def get_security_definition(self, auto_schema):
            return {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "JWT",
                "description": (
                    "Bearer JWT in Authorization header (native clients), "
                    "or `cpay_access` HttpOnly cookie (web client)."
                ),
            }
except ImportError:  # pragma: no cover
    pass
