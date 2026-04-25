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
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
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

# --- Disable browsable API and Swagger in production ---
REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = (  # noqa: F405
    "rest_framework.renderers.JSONRenderer",
)

# --- Database connection pooling ---
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=600)  # noqa: F405
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True  # noqa: F405
DATABASES["default"]["OPTIONS"] = {  # noqa: F405
    "connect_timeout": 10,
}

# --- Sentry ---
# Audit H7 · explicit opt-in for MX-record validation on signup. Production
# enables it; dev/CI defaults remain off (controlled in `email_validation.py`).
EMAIL_VALIDATION_REQUIRE_MX = True

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
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")  # noqa: F405
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)  # noqa: F405
EMAIL_USE_SSL = env.bool("EMAIL_USE_SSL", default=True)  # noqa: F405

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
    "https://app.cpay.co.ke",
]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Email branding
DEFAULT_FROM_EMAIL = "CryptoPay <noreply@cpay.co.ke>"
SERVER_EMAIL = "CryptoPay Alerts <admin@cpay.co.ke>"

# Admin email notifications
ADMINS = [(env("ADMIN_NAME", default="Admin"), env("ADMIN_EMAIL", default="kevinisaackareithi@gmail.com"))]
MANAGERS = ADMINS

# Africa's Talking SMS (sandbox for testing, production later)
AT_API_KEY = env("AT_API_KEY", default="")
AT_USERNAME = env("AT_USERNAME", default="Cpay")
AT_SENDER_ID = env("AT_SENDER_ID", default="")

# Admin email for OTP fallback (when SMS not available)
ADMIN_OTP_EMAIL = env("ADMIN_OTP_EMAIL", default="kevinisaackareithi@gmail.com")

# Google OAuth
GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID", default="")


# ---------------------------------------------------------------------------
# Production safety checks — fail loud if a sandbox default leaked.
# ---------------------------------------------------------------------------
# The base settings keep "sandbox" as the default for payment providers so
# local dev boots without touching real APIs. In production, the operator
# must explicitly set each *_ENVIRONMENT env var. We log an ERROR (not a
# crash) for each missing override so the box boots and operators can see
# the problem rather than a hard-fail cascade during a bad deploy.

import logging as _prod_logging

_prod_logger = _prod_logging.getLogger("apps.core.production_checks")


def _assert_production_env():
    issues = []

    # Payment rail — if the active provider's environment is still sandbox,
    # stop the app from processing real payments. The audit flagged this as
    # the top beta blocker: a missing env var would silently route every
    # M-Pesa payment to sandbox.
    payment_provider = (globals().get("PAYMENT_PROVIDER", "daraja") or "daraja").lower()
    if payment_provider == "daraja":
        if MPESA_ENVIRONMENT != "production":  # noqa: F405
            issues.append(
                f"MPESA_ENVIRONMENT={MPESA_ENVIRONMENT!r} in production — set to 'production' in .env.production"
            )
        # Audit HIGH-2: callback HMAC must NOT fall back to SECRET_KEY.
        # See apps/mpesa/middleware.py::_callback_hmac_key for the full
        # rationale.
        mpesa_hmac_key = globals().get("MPESA_CALLBACK_HMAC_KEY", "")
        if not mpesa_hmac_key:
            issues.append(
                "MPESA_CALLBACK_HMAC_KEY is not set. The Daraja callback "
                "URL would be HMAC-signed with SECRET_KEY, which collapses "
                "every pending payment's integrity onto a single key. "
                "Generate with: python -c \"import secrets; "
                "print(secrets.token_hex(32))\" and set in .env.production."
            )
        elif len(mpesa_hmac_key) < 32:
            issues.append(
                f"MPESA_CALLBACK_HMAC_KEY is only {len(mpesa_hmac_key)} chars · "
                "use at least 32 hex chars (256 bits)."
            )
    elif payment_provider == "sasapay":
        if SASAPAY_ENVIRONMENT != "production":  # noqa: F405
            issues.append(
                f"SASAPAY_ENVIRONMENT={SASAPAY_ENVIRONMENT!r} in production — set to 'production' in .env.production"
            )
        # Audit CRITICAL-1: SasaPay callbacks are unauthenticated unless
        # SASAPAY_WEBHOOK_SECRET (header HMAC) or SASAPAY_CALLBACK_HMAC_KEY
        # (per-tx URL token) is set. With neither, the IP allow-list is
        # the only barrier · a known-leaky control. Refuse the configuration.
        webhook_secret = globals().get("SASAPAY_WEBHOOK_SECRET", "")
        url_hmac_key = globals().get("SASAPAY_CALLBACK_HMAC_KEY", "")
        if not (webhook_secret or url_hmac_key):
            issues.append(
                "PAYMENT_PROVIDER=sasapay but neither SASAPAY_WEBHOOK_SECRET "
                "nor SASAPAY_CALLBACK_HMAC_KEY is set. Callbacks would be "
                "unauthenticated (IP allow-list only). Set at least one."
            )
        # Audit CRITICAL-1: SASAPAY_ALLOWED_IPS must not contain private
        # CIDRs in production · those let any same-VPC container forge
        # callbacks. Default base.py value is private-only for dev; prod
        # operator must override.
        sasapay_ips = globals().get("SASAPAY_ALLOWED_IPS", []) or []
        bad_cidrs = [
            ip for ip in sasapay_ips
            if ip.startswith(("10.", "127.", "172.16.", "172.17.", "172.18.",
                              "172.19.", "172.20.", "172.21.", "172.22.",
                              "172.23.", "172.24.", "172.25.", "172.26.",
                              "172.27.", "172.28.", "172.29.", "172.30.",
                              "172.31.", "192.168.", "169.254."))
        ]
        if bad_cidrs:
            issues.append(
                f"SASAPAY_ALLOWED_IPS contains private CIDRs in production: "
                f"{bad_cidrs}. Override with the SasaPay-documented public "
                "source IPs only."
            )
    elif payment_provider:
        issues.append(
            f"PAYMENT_PROVIDER={payment_provider!r} is not supported. "
            "Use 'daraja' or 'sasapay'."
        )

    # Audit HIGH-1: TOTP secret encryption key must NOT fall back to
    # SECRET_KEY. A single SECRET_KEY leak otherwise decrypts every
    # user's authenticator-app seed and disables 2FA wholesale.
    totp_key = globals().get("TOTP_ENCRYPTION_KEY", "")
    if not totp_key:
        issues.append(
            "TOTP_ENCRYPTION_KEY is not set. TOTP secrets would be "
            "encrypted with SECRET_KEY-derived Fernet, collapsing 2FA "
            "for every user onto a single secret. Generate with: "
            "python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\" and set in "
            ".env.production. After deploying, run "
            "`python manage.py migrate_totp_encryption` to re-encrypt "
            "any rows previously written under the old key."
        )

    # Africa's Talking sandbox username would try to send real SMS through
    # the AT sandbox endpoint and silently fail. Either a real username or
    # the sandbox must be intentional.
    if AT_USERNAME == "sandbox":  # noqa: F405
        issues.append("AT_USERNAME='sandbox' in production — set to your real AT username")

    # Yellow Card base URL — only relevant once the API is live, but if an
    # operator sets the key without the prod URL we'd leak transfers to the
    # sandbox environment.
    yc_url = globals().get("YELLOW_CARD_BASE_URL", "")
    if "sandbox" in yc_url and globals().get("YELLOW_CARD_API_KEY"):  # noqa: F405
        issues.append(
            f"YELLOW_CARD_BASE_URL={yc_url!r} is sandbox but a key is set — override with production URL"
        )

    # Mpesa production cert — if the cert path still points at the sandbox
    # pem bundled with the repo, B2B/B2C RSA crypto will talk to the wrong
    # Safaricom edge.
    if "sandbox" in str(MPESA_CERT_PATH):  # noqa: F405
        issues.append(
            f"MPESA_CERT_PATH={MPESA_CERT_PATH!r} — set to the production pem path"
        )

    # D6: wallet seed must come from KMS or an explicit env var in production.
    # A SECRET_KEY-derived seed would make any SECRET_KEY leak a full wallet
    # compromise. No seed source = refuse to serve.
    kms_enabled = globals().get("KMS_ENABLED", False)
    wallet_mnemonic = globals().get("WALLET_MNEMONIC", "")
    wallet_seed = globals().get("WALLET_MASTER_SEED", "")
    wallet_encrypted_seed = globals().get("WALLET_ENCRYPTED_SEED", "")
    if not any([
        kms_enabled and wallet_encrypted_seed,
        bool(wallet_mnemonic),
        bool(wallet_seed),
    ]):
        issues.append(
            "No wallet seed source configured. Set KMS_ENABLED=True + "
            "WALLET_ENCRYPTED_SEED, or WALLET_MNEMONIC, or WALLET_MASTER_SEED"
        )

    # Audit HIGH-3: KMS_ENABLED=False in production silently re-routes every
    # encrypted blob (wallet seed, *_HOT_WALLET_ENCRYPTED) through
    # LocalKMSManager, which derives its Fernet key from SECRET_KEY via PBKDF2.
    # That collapses the platform's entire key hierarchy into a single
    # SECRET_KEY · a leak there decrypts every wallet. Refuse the
    # configuration outright.
    if not kms_enabled:
        issues.append(
            "KMS_ENABLED=False in production. The LocalKMSManager fallback "
            "derives every data-encryption key from SECRET_KEY, which makes "
            "the wallet seed and hot-wallet keys decryptable from a single "
            "leaked secret. Set KMS_ENABLED=True and provision an AWS KMS "
            "key (see docs/KMS-SETUP.md)."
        )

    # When KMS is enabled, the cloud-side configuration must be complete or
    # the first encrypt/decrypt call will crash with a CredentialError. Catch
    # this at boot rather than at the first signing attempt.
    if kms_enabled:
        kms_provider = (globals().get("KMS_PROVIDER", "aws") or "aws").lower()

        if kms_provider == "aws":
            kms_key_id = globals().get("KMS_KEY_ID", "")
            if not kms_key_id:
                issues.append(
                    "KMS_PROVIDER=aws but KMS_KEY_ID is not set. Provide "
                    "the AWS KMS key ARN or alias (e.g. alias/cpay-prod or "
                    "arn:aws:kms:af-south-1:<account>:key/<uuid>)."
                )
            has_access_key = bool(os.environ.get("AWS_ACCESS_KEY_ID"))
            has_iam_role = bool(os.environ.get("AWS_ROLE_ARN")) or os.path.exists(
                "/var/run/secrets/eks.amazonaws.com/serviceaccount/token"
            )
            if not (has_access_key or has_iam_role):
                _prod_logger.warning(
                    "production.kms_credential_check",
                    extra={
                        "issue": (
                            "KMS_PROVIDER=aws but neither AWS_ACCESS_KEY_ID "
                            "nor an IAM role token was detected. boto3 will "
                            "try the default credential chain at first use; "
                            "failures will surface as KMSCredentialError."
                        )
                    },
                )

        elif kms_provider == "gcp":
            kms_key_resource = globals().get("KMS_KEY_RESOURCE", "")
            if not kms_key_resource:
                issues.append(
                    "KMS_PROVIDER=gcp but KMS_KEY_RESOURCE is not set. "
                    "Format: projects/<project>/locations/<loc>/keyRings/"
                    "<ring>/cryptoKeys/<key>"
                )
            elif not kms_key_resource.startswith("projects/"):
                issues.append(
                    f"KMS_KEY_RESOURCE={kms_key_resource!r} is malformed. "
                    "Must start with 'projects/...'."
                )
            has_app_creds = bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"))
            # GCE / Cloud Run / GKE expose a metadata server reachable at
            # 169.254.169.254 · we don't probe it here (boot-time network
            # call is too fragile) but we trust the operator if they've
            # set the credentials env explicitly.
            if not has_app_creds:
                _prod_logger.warning(
                    "production.kms_credential_check",
                    extra={
                        "issue": (
                            "KMS_PROVIDER=gcp but GOOGLE_APPLICATION_CREDENTIALS "
                            "is unset. The library will fall back to ADC "
                            "auto-discovery; failures surface as "
                            "KMSCredentialError. On a plain VPS, set "
                            "GOOGLE_APPLICATION_CREDENTIALS to a service "
                            "account JSON path."
                        )
                    },
                )

        else:
            issues.append(
                f"KMS_PROVIDER={kms_provider!r} is not supported. "
                "Use 'aws' or 'gcp'."
            )

    # D22: SECURE_PROXY_SSL_HEADER is trusted unconditionally in Django; we
    # need at least one of a TrustedProxyMiddleware, firewall to CF ranges,
    # or an origin TLS terminator. Flag when all three are absent in prod.
    if not globals().get("CLOUDFLARE_ONLY_ORIGIN", False):
        issues.append(
            "CLOUDFLARE_ONLY_ORIGIN is not set to True. Either firewall the "
            "origin to Cloudflare IP ranges or terminate TLS at origin; do "
            "not trust X-Forwarded-Proto from arbitrary clients"
        )

    for issue in issues:
        _prod_logger.error("production.env_check_failed", extra={"issue": issue})

    if issues and env.bool("REQUIRE_PROD_ENV_STRICT", default=False):  # noqa: F405
        # Opt-in fail-fast: set REQUIRE_PROD_ENV_STRICT=True in .env for
        # deploys where we'd rather crashloop than serve sandbox payments.
        raise ImproperlyConfigured(
            "Refusing to boot in production with sandbox env: " + "; ".join(issues)
        )


from django.core.exceptions import ImproperlyConfigured  # noqa: E402

_assert_production_env()
