from datetime import timedelta

from .base import *  # noqa: F401, F403

DEBUG = True

# Longer token lifetimes for dev — avoids 401s on every rebuild
SIMPLE_JWT = {
    **SIMPLE_JWT,  # noqa: F405
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=24),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
}
