from .base import *  # noqa: F401, F403

import os

DEBUG = False

# --- Security ---
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)  # noqa: F405
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = "DENY"

# --- Hosts ---
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[])  # noqa: F405

# --- CORS ---
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])  # noqa: F405
CORS_ALLOW_CREDENTIALS = True

# --- Static files with WhiteNoise ---
MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")  # noqa: F405
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# --- Database connection pooling ---
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=600)  # noqa: F405
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True  # noqa: F405
DATABASES["default"]["OPTIONS"] = {  # noqa: F405
    "connect_timeout": 10,
}

# --- Sentry ---
SENTRY_DSN = env("SENTRY_DSN", default="")  # noqa: F405
if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration
    from sentry_sdk.integrations.redis import RedisIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[
            DjangoIntegration(),
            CeleryIntegration(),
            RedisIntegration(),
        ],
        traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.1),  # noqa: F405
        send_default_pii=False,
        environment=env("SENTRY_ENVIRONMENT", default="production"),  # noqa: F405
    )

# --- Email ---
# Supports Resend (recommended, 3K/month free), Amazon SES, or any SMTP provider.
# Resend: EMAIL_HOST=smtp.resend.com, EMAIL_HOST_USER=resend, EMAIL_HOST_PASSWORD=re_xxxxx
# SES:    EMAIL_HOST=email-smtp.eu-west-1.amazonaws.com, EMAIL_HOST_USER=AKIA..., EMAIL_HOST_PASSWORD=...
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("EMAIL_HOST", default="smtp.resend.com")  # noqa: F405
EMAIL_PORT = env.int("EMAIL_PORT", default=465)  # noqa: F405
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="resend")  # noqa: F405
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="re_CojuPUB8_LzVcTtJyFrHArxopmx5JP2Jm")  # noqa: F405
EMAIL_USE_TLS = False
EMAIL_USE_SSL = True  # noqa: F405

# --- Production Logging Override ---
# Use JSON formatter for all handlers in production (better for log aggregation)
LOGGING["formatters"]["json"] = {  # noqa: F405
    "format": '{{"time":"{asctime}","level":"{levelname}","logger":"{name}","module":"{module}","func":"{funcName}","line":{lineno},"message":"{message}"}}',
    "style": "{",
    "datefmt": "%Y-%m-%dT%H:%M:%S%z",
}
LOGGING["handlers"]["console"]["formatter"] = "json"  # noqa: F405
for handler_name in ("file_app", "file_error", "file_payments", "file_security"):
    if handler_name in LOGGING["handlers"]:  # noqa: F405
        LOGGING["handlers"][handler_name]["formatter"] = "json"  # noqa: F405

# --- M-Pesa Certificate ---
MPESA_CERT_PATH = env(  # noqa: F405
    "MPESA_CERT_PATH",
    default=str(BASE_DIR / "certs" / "production.pem"),  # noqa: F405
)

# --- Google OAuth ---
GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID", default="")  # noqa: F405

# Cloudflare proxy CSRF + SSL trust
CSRF_TRUSTED_ORIGINS = [
    "https://cpay.co.ke",
    "https://www.cpay.co.ke",
    "https://api.cpay.co.ke",
    "http://localhost:8000",
    "http://localhost:8081",
]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Email branding
DEFAULT_FROM_EMAIL = "CPay <noreply@cpay.co.ke>"
SERVER_EMAIL = "CPay Alerts <admin@cpay.co.ke>"

# Admin email notifications
ADMINS = [("Kevin", "kevinisaackareithi@gmail.com")]
MANAGERS = ADMINS

# Africa's Talking SMS (sandbox for testing, production later)
AT_API_KEY = env("AT_API_KEY", default="atsk_0a0010aac91f1796b4bee68316e338b704b0eb1d74ade3ae31b06f7670260bea076f53b2")
AT_USERNAME = env("AT_USERNAME", default="Cpay")
AT_SENDER_ID = env("AT_SENDER_ID", default="")

# Admin email for OTP fallback (when SMS not available)
ADMIN_OTP_EMAIL = "kevinisaackareithi@gmail.com"
