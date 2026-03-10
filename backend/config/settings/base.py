import os
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
env.read_env(os.path.join(BASE_DIR, ".env"))

SECRET_KEY = env("SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# --- Apps ---
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "corsheaders",
    "django_filters",
    "django_celery_beat",
    "drf_spectacular",
]

LOCAL_APPS = [
    "apps.core",
    "apps.accounts",
    "apps.wallets",
    "apps.payments",
    "apps.mpesa",
    "apps.blockchain",
    "apps.rates",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# --- Middleware ---
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.AuditMiddleware",
    "apps.mpesa.middleware.MpesaIPWhitelistMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# --- Database ---
DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://cryptopay:cryptopay@localhost:5432/cryptopay"),
}

# --- Auth ---
AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
]

# --- Internationalization ---
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Nairobi"
USE_I18N = True
USE_TZ = True

# --- Static ---
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Redis ---
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        },
    }
}

# --- Celery ---
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://localhost:6379/1")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "Africa/Nairobi"
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
CELERY_BEAT_SCHEDULE = {
    "refresh-exchange-rates": {
        "task": "apps.rates.tasks.refresh_rates",
        "schedule": 120.0,  # Every 2 minutes (CoinGecko free tier rate limit)
    },
    "monitor-tron-deposits": {
        "task": "apps.blockchain.tasks.monitor_tron_deposits",
        "schedule": 15.0,  # Every 15 seconds
    },
    "update-tron-confirmations": {
        "task": "apps.blockchain.tasks.update_tron_confirmations",
        "schedule": 10.0,  # Every 10 seconds
    },
    "process-pending-deposits": {
        "task": "apps.blockchain.tasks.process_pending_deposits",
        "schedule": 10.0,  # Every 10 seconds
    },
    "check-float-balance": {
        "task": "apps.mpesa.tasks.check_float_balance",
        "schedule": 300.0,  # Every 5 minutes
    },
    "monitor-eth-deposits": {
        "task": "apps.blockchain.eth_listener.monitor_eth_deposits",
        "schedule": 30.0,  # Every 30 seconds (Alchemy-friendly)
    },
    "update-eth-confirmations": {
        "task": "apps.blockchain.eth_listener.update_eth_confirmations",
        "schedule": 20.0,  # Every 20 seconds
    },
    "monitor-btc-deposits": {
        "task": "apps.blockchain.btc_listener.monitor_btc_deposits",
        "schedule": 60.0,  # Every 60 seconds (BlockCypher 200 req/hr limit)
    },
    "update-btc-confirmations": {
        "task": "apps.blockchain.btc_listener.update_btc_confirmations",
        "schedule": 60.0,  # Every 60 seconds
    },
}

# --- DRF ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": "30/minute",
        "user": "120/minute",
    },
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

# --- OpenAPI / Swagger ---
SPECTACULAR_SETTINGS = {
    "TITLE": "CryptoPay API",
    "DESCRIPTION": "Crypto-to-M-Pesa payment platform API. Pay any Paybill or Till number directly from cryptocurrency.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "TAGS": [
        {"name": "Auth", "description": "Authentication, registration, OTP, PIN management"},
        {"name": "Wallets", "description": "Multi-currency wallets, deposit addresses, blockchain deposits"},
        {"name": "Payments", "description": "Paybill, Till, M-Pesa send, transaction history"},
        {"name": "Rates", "description": "Exchange rates and payment quotes"},
        {"name": "KYC", "description": "Identity verification and document upload"},
    ],
}

# --- JWT ---
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": "HS256",
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# --- CORS ---
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=[
        "http://localhost:3000",
        "http://localhost:8081",
        "http://localhost:19006",
        "http://127.0.0.1:8081",
        "http://127.0.0.1:19006",
    ],
)
CORS_ALLOW_CREDENTIALS = True

# --- M-Pesa ---
MPESA_ENVIRONMENT = env("MPESA_ENVIRONMENT", default="sandbox")
MPESA_CONSUMER_KEY = env("MPESA_CONSUMER_KEY", default="")
MPESA_CONSUMER_SECRET = env("MPESA_CONSUMER_SECRET", default="")
MPESA_SHORTCODE = env("MPESA_SHORTCODE", default="174379")
MPESA_PASSKEY = env("MPESA_PASSKEY", default="")
MPESA_INITIATOR_NAME = env("MPESA_INITIATOR_NAME", default="")
MPESA_INITIATOR_PASSWORD = env("MPESA_INITIATOR_PASSWORD", default="")
MPESA_B2C_SHORTCODE = env("MPESA_B2C_SHORTCODE", default="")
MPESA_CALLBACK_BASE_URL = env("MPESA_CALLBACK_BASE_URL", default="https://localhost")
MPESA_CERT_PATH = env("MPESA_CERT_PATH", default=str(BASE_DIR / "certs" / "sandbox.pem"))
MPESA_ALLOWED_IPS = env.list("MPESA_ALLOWED_IPS", default=[
    "196.201.214.0/24",
    "196.201.213.0/24",
    "196.201.212.0/24",
    "192.168.0.0/16",
    "127.0.0.0/8",
])

# --- Africa's Talking ---
AT_API_KEY = env("AT_API_KEY", default="")
AT_USERNAME = env("AT_USERNAME", default="sandbox")
AT_SENDER_ID = env("AT_SENDER_ID", default="CryptoPay")

# --- Price Feed APIs ---
COINGECKO_API_KEY = env("COINGECKO_API_KEY", default="")
CRYPTOCOMPARE_API_KEY = env("CRYPTOCOMPARE_API_KEY", default="")  # Fallback provider

# --- Google OAuth ---
GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID", default="")

# --- Rate Engine ---
RATE_LOCK_TTL_SECONDS = 90
PLATFORM_SPREAD_PERCENT = 1.5
FLAT_FEE_KES = 10
EXCISE_DUTY_PERCENT = 10  # 10% excise duty on VASP fees/commissions (VASP Act 2025)

# --- Blockchain ---
TRON_API_KEY = env("TRON_API_KEY", default="")
TRON_NETWORK = env("TRON_NETWORK", default="shasta")

# --- Ethereum ---
ETH_RPC_URL = env("ETH_RPC_URL", default="")  # Alchemy/Infura URL, e.g. https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETH_NETWORK = env("ETH_NETWORK", default="sepolia")  # mainnet or sepolia (testnet)

# --- Bitcoin ---
BTC_NETWORK = env("BTC_NETWORK", default="test3")  # main or test3 (testnet)
BLOCKCYPHER_API_TOKEN = env("BLOCKCYPHER_API_TOKEN", default="")  # Free: 200 req/hr, with token: 2000 req/hr

# HD Wallet master seed (hex-encoded 64 bytes from BIP-39 mnemonic)
# CRITICAL: In production, generate from a secure mnemonic and store in KMS/HSM
# Generate with: python -c "from mnemonic import Mnemonic; m=Mnemonic('english'); print(m.generate(256))"
# Then derive seed: python -c "from mnemonic import Mnemonic; m=Mnemonic('english'); print(m.to_seed('your mnemonic words').hex())"
WALLET_MASTER_SEED = env("WALLET_MASTER_SEED", default="")

REQUIRED_CONFIRMATIONS = {
    "tron": 19,         # ~1 min (3s blocks)
    "ethereum": 64,     # 2 finalized epochs (~12.8 min post-Merge)
    "polygon": 128,     # ~5 min (2s blocks)
    "bitcoin": 3,       # ~30 min (for <$10K; use 6 for large amounts)
    "solana": 32,       # "finalized" commitment level
}

# --- Logging ---
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "[{asctime}] {levelname} {name} {module}.{funcName}:{lineno} — {message}",
            "style": "{",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
        "simple": {
            "format": "[{asctime}] {levelname} {name} — {message}",
            "style": "{",
            "datefmt": "%H:%M:%S",
        },
        "json": {
            "format": '{{"time":"{asctime}","level":"{levelname}","logger":"{name}","module":"{module}","func":"{funcName}","line":{lineno},"message":"{message}"}}',
            "style": "{",
            "datefmt": "%Y-%m-%dT%H:%M:%S%z",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "simple",
            "level": "DEBUG",
        },
        "file_app": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(LOG_DIR / "app.log"),
            "maxBytes": 10 * 1024 * 1024,  # 10 MB
            "backupCount": 5,
            "formatter": "verbose",
            "level": "INFO",
            "encoding": "utf-8",
        },
        "file_error": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(LOG_DIR / "error.log"),
            "maxBytes": 10 * 1024 * 1024,
            "backupCount": 5,
            "formatter": "verbose",
            "level": "ERROR",
            "encoding": "utf-8",
        },
        "file_payments": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(LOG_DIR / "payments.log"),
            "maxBytes": 10 * 1024 * 1024,
            "backupCount": 5,
            "formatter": "verbose",
            "level": "INFO",
            "encoding": "utf-8",
        },
        "file_security": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(LOG_DIR / "security.log"),
            "maxBytes": 10 * 1024 * 1024,
            "backupCount": 5,
            "formatter": "verbose",
            "level": "INFO",
            "encoding": "utf-8",
        },
    },
    "root": {
        "handlers": ["console", "file_app", "file_error"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console", "file_app"],
            "level": "WARNING",
            "propagate": False,
        },
        "django.request": {
            "handlers": ["console", "file_app", "file_error"],
            "level": "INFO",
            "propagate": False,
        },
        "django.security": {
            "handlers": ["console", "file_security", "file_error"],
            "level": "INFO",
            "propagate": False,
        },
        "apps": {
            "handlers": ["console", "file_app", "file_error"],
            "level": "INFO",
            "propagate": False,
        },
        "apps.payments": {
            "handlers": ["console", "file_payments", "file_error"],
            "level": "INFO",
            "propagate": False,
        },
        "apps.mpesa": {
            "handlers": ["console", "file_payments", "file_error"],
            "level": "INFO",
            "propagate": False,
        },
        "apps.accounts": {
            "handlers": ["console", "file_security", "file_error"],
            "level": "INFO",
            "propagate": False,
        },
        "apps.rates": {
            "handlers": ["console", "file_app", "file_error"],
            "level": "INFO",
            "propagate": False,
        },
        "apps.blockchain": {
            "handlers": ["console", "file_payments", "file_error"],
            "level": "INFO",
            "propagate": False,
        },
        "celery": {
            "handlers": ["console", "file_app"],
            "level": "INFO",
            "propagate": False,
        },
    },
}

# --- Email ---
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = "CryptoPay <noreply@cryptopay.co.ke>"
SERVER_EMAIL = "CryptoPay Alerts <alerts@cryptopay.co.ke>"

# --- Smile Identity KYC ---
SMILE_IDENTITY_PARTNER_ID = env("SMILE_IDENTITY_PARTNER_ID", default="")
SMILE_IDENTITY_API_KEY = env("SMILE_IDENTITY_API_KEY", default="")
SMILE_IDENTITY_CALLBACK_URL = env("SMILE_IDENTITY_CALLBACK_URL", default="")

# --- KYC Tiers ---
KYC_DAILY_LIMITS = {
    0: 5_000,       # KES - phone only
    1: 50_000,      # KES - ID verified
    2: 250_000,     # KES - KRA PIN
    3: 1_000_000,   # KES - enhanced DD
}
