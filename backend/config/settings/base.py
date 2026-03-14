import os
from datetime import timedelta
from pathlib import Path

from celery.schedules import crontab
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
    "django_prometheus",
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
    "django_prometheus.middleware.PrometheusBeforeMiddleware",
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
    "django_prometheus.middleware.PrometheusAfterMiddleware",
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
DATABASES["default"]["ENGINE"] = "django_prometheus.db.backends.postgresql"

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
CELERY_WORKER_SEND_TASK_EVENTS = True
CELERY_TASK_SEND_SENT_EVENT = True
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
    "monitor-sol-deposits": {
        "task": "apps.blockchain.sol_listener.monitor_sol_deposits",
        "schedule": 15.0,  # Every 15 seconds (Solana is fast)
    },
    "update-sol-confirmations": {
        "task": "apps.blockchain.sol_listener.update_sol_confirmations",
        "schedule": 10.0,  # Every 10 seconds
    },
    "monitor-polygon-deposits": {
        "task": "apps.blockchain.polygon_listener.monitor_polygon_deposits",
        "schedule": 20.0,  # Every 20 seconds (Polygon ~2s blocks, fast finality)
    },
    "update-polygon-confirmations": {
        "task": "apps.blockchain.polygon_listener.update_polygon_confirmations",
        "schedule": 15.0,  # Every 15 seconds
    },
    # Stuck payment reconciliation
    "check-pending-mpesa-payments": {
        "task": "apps.payments.tasks.check_pending_mpesa_payments",
        "schedule": 30.0,  # Every 30 seconds — catches stuck CONFIRMING txns
    },
    # Rebalancing
    "check-and-trigger-rebalance": {
        "task": "apps.wallets.tasks.check_and_trigger_rebalance",
        "schedule": 300.0,  # Every 5 minutes
    },
    "check-stale-rebalance-orders": {
        "task": "apps.wallets.tasks.check_stale_orders",
        "schedule": 3600.0,  # Every hour
    },
    # Sweep / consolidation tasks
    "scan-and-create-sweep-orders": {
        "task": "apps.blockchain.sweep_tasks.scan_and_create_sweep_orders",
        "schedule": 900.0,  # Every 15 minutes
    },
    "process-pending-sweeps": {
        "task": "apps.blockchain.sweep_tasks.process_pending_sweeps",
        "schedule": 300.0,  # Every 5 minutes
    },
    "verify-submitted-sweeps": {
        "task": "apps.blockchain.sweep_tasks.verify_submitted_sweeps",
        "schedule": 180.0,  # Every 3 minutes
    },
    "credit-confirmed-sweeps": {
        "task": "apps.blockchain.sweep_tasks.credit_confirmed_sweeps",
        "schedule": 300.0,  # Every 5 minutes
    },
    # Reconciliation
    "reconcile-balances": {
        "task": "apps.blockchain.sweep_tasks.reconcile_balances",
        "schedule": 900.0,  # Every 15 minutes
    },
    # Custody tier management
    "check-custody-thresholds": {
        "task": "apps.wallets.tasks.check_custody_thresholds",
        "schedule": 900.0,  # Every 15 minutes
    },
    "generate-custody-report": {
        "task": "apps.wallets.tasks.generate_custody_report",
        "schedule": 86400.0,  # Every 24 hours
    },
    "reconcile-wallet-balances": {
        "task": "apps.wallets.tasks.reconcile_wallet_balances",
        "schedule": 3600.0,  # Every hour
    },
    # Database backup (daily at 2:00 AM EAT)
    "daily-database-backup": {
        "task": "apps.core.tasks.daily_database_backup",
        "schedule": crontab(hour=2, minute=0),
    },
    # Daily operations summary email to admins (8:00 AM EAT)
    "daily-summary-email": {
        "task": "apps.core.tasks.daily_summary_email",
        "schedule": crontab(hour=8, minute=0),
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

# --- JWT (RS256 asymmetric signing) ---
_jwt_private_key_path = env("JWT_PRIVATE_KEY_PATH", default="")
_jwt_public_key_path = env("JWT_PUBLIC_KEY_PATH", default="")

if _jwt_private_key_path and _jwt_public_key_path:
    # Production: RS256 with separate key pair
    with open(_jwt_private_key_path) as f:
        _JWT_SIGNING_KEY = f.read()
    with open(_jwt_public_key_path) as f:
        _JWT_VERIFYING_KEY = f.read()
    _JWT_ALGORITHM = "RS256"
else:
    # Development fallback: HS256 with dedicated signing key (NOT SECRET_KEY)
    _JWT_SIGNING_KEY = env("JWT_SIGNING_KEY", default=SECRET_KEY)
    _JWT_VERIFYING_KEY = ""
    _JWT_ALGORITHM = "HS256"

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": _JWT_ALGORITHM,
    "SIGNING_KEY": _JWT_SIGNING_KEY,
    "VERIFYING_KEY": _JWT_VERIFYING_KEY,
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

# --- Float / Circuit Breaker Thresholds (KES) ---
FLOAT_EMERGENCY_KES = env.int("FLOAT_EMERGENCY_KES", default=200_000)
FLOAT_CRITICAL_KES = env.int("FLOAT_CRITICAL_KES", default=500_000)
FLOAT_RESUME_KES = env.int("FLOAT_RESUME_KES", default=800_000)
FLOAT_HEALTHY_KES = env.int("FLOAT_HEALTHY_KES", default=1_500_000)
FLOAT_LARGE_PAYMENT_KES = env.int("FLOAT_LARGE_PAYMENT_KES", default=50_000)

# --- Rebalancing ---
REBALANCE_MIN_KES = env.int("REBALANCE_MIN_KES", default=50_000)
REBALANCE_MAX_KES = env.int("REBALANCE_MAX_KES", default=2_000_000)
REBALANCE_COOLDOWN_SECONDS = env.int("REBALANCE_COOLDOWN_SECONDS", default=300)
REBALANCE_EXECUTION_MODE = env("REBALANCE_EXECUTION_MODE", default="manual")  # "manual" or "api"

# --- Yellow Card (future API integration) ---
YELLOW_CARD_API_KEY = env("YELLOW_CARD_API_KEY", default="")
YELLOW_CARD_SECRET_KEY = env("YELLOW_CARD_SECRET_KEY", default="")
YELLOW_CARD_BASE_URL = env("YELLOW_CARD_BASE_URL", default="https://sandbox.api.yellowcard.io/business")
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

# --- Frontend URL (for email verification links) ---
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:8081")

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

# --- KES Deposit Configuration ---
DEPOSIT_FEE_PERCENTAGE = 1.5         # 1.5% deposit fee on KES→crypto
DEPOSIT_MIN_KES = 100                # Minimum KES deposit
DEPOSIT_MAX_KES = 300_000            # Maximum single deposit
DEPOSIT_QUOTE_TTL_SECONDS = 30       # Rate lock duration for deposit quotes
DEPOSIT_SLIPPAGE_TOLERANCE = 2.0     # Max 2% slippage from quoted rate

# --- C2B Configuration ---
MPESA_C2B_RESPONSE_TYPE = "Completed"  # "Completed" auto-accepts; "Cancelled" requires validation
MPESA_C2B_ACCOUNT_PREFIX = "CP"        # Account reference prefix for C2B deposits

# --- Blockchain ---
TRON_API_KEY = env("TRON_API_KEY", default="")
TRON_NETWORK = env("TRON_NETWORK", default="shasta")

# --- Ethereum ---
ETH_RPC_URL = env("ETH_RPC_URL", default="")  # Alchemy/Infura URL, e.g. https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETH_NETWORK = env("ETH_NETWORK", default="sepolia")  # mainnet or sepolia (testnet)

# --- Polygon ---
POLYGON_RPC_URL = env("POLYGON_RPC_URL", default="")  # Alchemy/Infura URL, e.g. https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_LOG_SCAN_RANGE = env.int("POLYGON_LOG_SCAN_RANGE", default=50)  # Blocks per scan (Polygon is fast)

# --- Bitcoin ---
BTC_NETWORK = env("BTC_NETWORK", default="test3")  # main or test3 (testnet)
BLOCKCYPHER_API_TOKEN = env("BLOCKCYPHER_API_TOKEN", default="")  # Free: 200 req/hr, with token: 2000 req/hr

# --- Solana ---
SOL_RPC_URL = env("SOL_RPC_URL", default="https://api.devnet.solana.com")  # Use mainnet-beta for production
SOL_NETWORK = env("SOL_NETWORK", default="devnet")  # mainnet-beta or devnet

# HD Wallet Configuration
# CRITICAL: In production, set one of these. Generate with: python manage.py generate_wallet_seed
#
# Option 1 (preferred): BIP-39 mnemonic phrase (24 words, human-readable backup)
WALLET_MNEMONIC = env("WALLET_MNEMONIC", default="")
#
# Option 2: Hex-encoded seed (64 bytes / 128 hex chars, for KMS/HSM storage)
WALLET_MASTER_SEED = env("WALLET_MASTER_SEED", default="")

# Platform hot wallet addresses (destination for on-chain sweeps).
# Derived from WALLET_MNEMONIC at index 0, but explicitly set here for
# safety — prevents funds being sent to a derivation mismatch address.
HOT_WALLET_TRON = env("HOT_WALLET_TRON", default="")
HOT_WALLET_ETH = env("HOT_WALLET_ETH", default="")
HOT_WALLET_BTC = env("HOT_WALLET_BTC", default="")
HOT_WALLET_SOL = env("HOT_WALLET_SOL", default="")

REQUIRED_CONFIRMATIONS = {
    "tron": 19,         # ~1 min (3s blocks) — 1 solidified block = finality
    "ethereum": 64,     # 2 finalized epochs (~12.8 min post-Merge, Casper FFG)
    "polygon": 128,     # ~5 min (2s blocks)
    "bitcoin": 3,       # ~30 min (baseline; amount-based tiers override this)
    "solana": 32,       # "finalized" commitment level (~13 seconds)
}

# Minimum deposit amounts per currency (dust attack prevention).
# Deposits below these thresholds are rejected at detection time.
MINIMUM_DEPOSIT_AMOUNTS = {
    "BTC": "0.00005",     # ~$5 — filters dust attacks
    "ETH": "0.002",       # ~$5
    "USDT": "1.00",       # $1 minimum
    "USDC": "1.00",       # $1 minimum
    "SOL": "0.05",        # ~$5
}

# Amount-based confirmation tiers: (max_usd_value, required_confirmations)
# Larger deposits require more confirmations to prevent double-spend attacks.
# See apps/blockchain/security.py for detailed documentation.
CONFIRMATION_TIERS = {
    "bitcoin": [
        (1_000, 2),
        (10_000, 3),
        (100_000, 6),
        (float("inf"), 6),
    ],
    "ethereum": [
        (1_000, 12),
        (10_000, 32),
        (100_000, 64),
        (float("inf"), 64),
    ],
    "tron": [
        (float("inf"), 19),  # Tron solidification is all-or-nothing
    ],
    "solana": [
        (float("inf"), 32),  # Solana finalized commitment = deterministic finality
    ],
}

# --- Logging ---
LOG_DIR = BASE_DIR / "logs"
try:
    LOG_DIR.mkdir(exist_ok=True)
except OSError:
    # Fallback for non-root user in Docker
    LOG_DIR = Path("/tmp/cryptopay-logs")
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
        "apps.wallets": {
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
DEFAULT_FROM_EMAIL = "CPay <noreply@cpay.co.ke>"
SERVER_EMAIL = "CPay Alerts <alerts@cpay.co.ke>"

# Admin email recipients (overridden in production.py)
ADMINS = [("Admin", "admin@cpay.co.ke")]
MANAGERS = ADMINS

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

# --- Prometheus ---
PROMETHEUS_MULTIPROC_DIR = env("PROMETHEUS_MULTIPROC_DIR", default="")

# CSRF trusted origins (required for admin behind Cloudflare proxy)
CSRF_TRUSTED_ORIGINS = [
    "https://cpay.co.ke",
    "https://www.cpay.co.ke",
    "https://api.cpay.co.ke",
    "http://localhost:8000",
    "http://localhost:8081",
]

# Trust X-Forwarded-Proto from Cloudflare
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
