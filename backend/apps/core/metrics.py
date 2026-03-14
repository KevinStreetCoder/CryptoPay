"""
Custom Prometheus metrics for CryptoPay.

Import and use these counters/histograms/gauges from any Django app:

    from apps.core.metrics import PAYMENT_INITIATED
    PAYMENT_INITIATED.labels(currency="BTC", payment_type="paybill").inc()

All metrics are prefixed with `cryptopay_` to avoid collisions with
django-prometheus built-in metrics.
"""

from prometheus_client import Counter, Gauge, Histogram

# ── Payment Pipeline ──────────────────────────────────────────

PAYMENT_INITIATED = Counter(
    "cryptopay_payment_initiated_total",
    "Payments initiated by users",
    ["currency", "payment_type"],
)

PAYMENT_COMPLETED = Counter(
    "cryptopay_payment_completed_total",
    "Payments successfully completed",
    ["currency", "payment_type"],
)

PAYMENT_FAILED = Counter(
    "cryptopay_payment_failed_total",
    "Payments that failed",
    ["currency", "payment_type", "reason"],
)

PAYMENT_AMOUNT_KES = Histogram(
    "cryptopay_payment_amount_kes",
    "Payment amounts in KES",
    ["currency", "payment_type"],
    buckets=[100, 500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000],
)

PAYMENT_PROCESSING_TIME = Histogram(
    "cryptopay_payment_processing_seconds",
    "End-to-end payment processing time in seconds",
    ["currency", "payment_type"],
    buckets=[0.5, 1, 2, 5, 10, 15, 30, 60, 120],
)

# ── M-Pesa ────────────────────────────────────────────────────

MPESA_CALLBACK_LATENCY = Histogram(
    "cryptopay_mpesa_callback_latency_seconds",
    "Time between M-Pesa API call and callback receipt",
    ["api_type"],
    buckets=[1, 2, 5, 10, 15, 30, 60, 120, 300],
)

MPESA_API_CALLS = Counter(
    "cryptopay_mpesa_api_calls_total",
    "M-Pesa API calls made",
    ["api_type", "status"],
)

MPESA_FLOAT_BALANCE = Gauge(
    "cryptopay_mpesa_float_balance_kes",
    "Current M-Pesa float balance in KES",
)

# ── Blockchain Deposits ──────────────────────────────────────

BLOCKCHAIN_DEPOSIT_DETECTED = Counter(
    "cryptopay_blockchain_deposit_detected_total",
    "Blockchain deposits detected on-chain",
    ["currency", "network"],
)

BLOCKCHAIN_DEPOSIT_CONFIRMED = Counter(
    "cryptopay_blockchain_deposit_confirmed_total",
    "Blockchain deposits that reached required confirmations",
    ["currency", "network"],
)

BLOCKCHAIN_CONFIRMATION_TIME = Histogram(
    "cryptopay_blockchain_confirmation_seconds",
    "Time from deposit detection to full confirmation",
    ["currency", "network"],
    buckets=[10, 30, 60, 120, 300, 600, 1800, 3600],
)

BLOCKCHAIN_DEPOSIT_AMOUNT = Histogram(
    "cryptopay_blockchain_deposit_amount_usd",
    "Deposit amounts in USD equivalent",
    ["currency"],
    buckets=[1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000],
)

# ── Sweep / Consolidation ────────────────────────────────────

SWEEP_INITIATED = Counter(
    "cryptopay_sweep_initiated_total",
    "Sweep (consolidation) transactions initiated",
    ["currency"],
)

SWEEP_COMPLETED = Counter(
    "cryptopay_sweep_completed_total",
    "Sweep transactions confirmed on-chain",
    ["currency"],
)

SWEEP_FAILED = Counter(
    "cryptopay_sweep_failed_total",
    "Sweep transactions that failed",
    ["currency", "reason"],
)

# ── Wallet ────────────────────────────────────────────────────

HOT_WALLET_BALANCE = Gauge(
    "cryptopay_hot_wallet_balance",
    "Hot wallet balance in native currency units",
    ["currency"],
)

REBALANCE_ORDERS = Counter(
    "cryptopay_rebalance_orders_total",
    "Rebalance orders created",
    ["currency", "direction"],
)

# ── Exchange Rates ────────────────────────────────────────────

EXCHANGE_RATE_REFRESH_TIME = Histogram(
    "cryptopay_exchange_rate_refresh_seconds",
    "Time to refresh exchange rates from feed",
    ["provider"],
    buckets=[0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
)

EXCHANGE_RATE_STALE = Gauge(
    "cryptopay_exchange_rate_stale",
    "Whether exchange rates are stale (1=stale, 0=fresh)",
)

# ── Auth ──────────────────────────────────────────────────────

LOGIN_ATTEMPTS = Counter(
    "cryptopay_login_attempts_total",
    "Login attempts",
    ["result"],  # success, wrong_pin, locked, otp_required
)

OTP_CHALLENGES = Counter(
    "cryptopay_otp_challenges_total",
    "OTP challenges issued",
    ["trigger"],  # login, new_device, new_ip, manual
)

# ── Circuit Breaker ──────────────────────────────────────────

CIRCUIT_BREAKER_STATE = Gauge(
    "cryptopay_circuit_breaker_state",
    "Circuit breaker state (0=closed, 1=half-open, 2=open)",
)

CIRCUIT_BREAKER_TRIPS = Counter(
    "cryptopay_circuit_breaker_trips_total",
    "Number of times the circuit breaker has tripped to OPEN",
)
