# Fintech/Crypto Payment Platform - Enterprise Security Architecture Guide

**Date**: 2026-03-07
**Purpose**: Comprehensive security design reference for building a fintech/crypto payment platform

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [Transaction Security](#2-transaction-security)
3. [Data Security](#3-data-security)
4. [Infrastructure Security](#4-infrastructure-security)
5. [Compliance & KYC/AML](#5-compliance--kycaml)
6. [Architecture Patterns](#6-architecture-patterns)
7. [Tech Stack Recommendations](#7-tech-stack-recommendations-20252026)

---

## 1. Authentication & Authorization

### 1.1 Multi-Factor Authentication (MFA)

**Tiered MFA Strategy:**

| Action | MFA Level | Methods |
|--------|-----------|---------|
| Login | Level 1 | Password + SMS OTP or TOTP |
| View balances | Level 1 | Session token (already authenticated) |
| Send payment < threshold | Level 2 | PIN + Device binding verification |
| Send payment > threshold | Level 3 | PIN + Biometric + TOTP |
| Add new recipient | Level 3 | PIN + SMS OTP + Email confirmation |
| Change security settings | Level 3 | Full re-authentication + admin delay |

**Implementation Details:**

- **SMS OTP**: Use as fallback only (vulnerable to SIM-swap). Rate-limit to 3 attempts per 10 minutes. OTP expiry: 5 minutes max. Use providers with delivery confirmation (e.g., Twilio Verify, Africa's Talking).
- **TOTP (Time-Based One-Time Password)**: Preferred second factor. Support Google Authenticator, Authy. Use RFC 6238 with 30-second windows. Store encrypted seeds in HSM/KMS, never in plaintext DB.
- **Biometric**: Use device-native biometrics (Apple Secure Enclave, Android TEE/StrongBox). Server never sees raw biometric data -- only attestation that device-level biometric check passed. Use FIDO2/WebAuthn for strongest non-repudiation.

### 1.2 Session Management for Financial Apps

```
Session Architecture:
- Access Token: JWT, 15-minute expiry, in-memory only (never localStorage)
- Refresh Token: Opaque token, 24-hour expiry, httpOnly secure cookie
- Session binding: Tied to device fingerprint + IP subnet
- Concurrent sessions: Max 3 devices, new login invalidates oldest
- Sensitive actions: Require step-up authentication (re-enter PIN/biometric)
- Idle timeout: 5 minutes for mobile, 10 minutes for web
- Absolute timeout: 24 hours regardless of activity
```

**Token Security:**
- JWTs signed with RS256 (asymmetric) -- never HS256 in production
- Include `jti` (JWT ID) claim for revocation capability
- Maintain a Redis-backed token blacklist for immediate revocation
- Rotate signing keys every 90 days

### 1.3 Device Fingerprinting & Binding

**Device Registration Flow:**
1. On first login, collect device fingerprint (browser/OS/screen/timezone/installed fonts hash)
2. Generate a device-specific key pair (using Web Crypto API or native keystore)
3. Store public key server-side, private key in device secure enclave
4. Each subsequent request includes a signed challenge proving device possession
5. Unknown device triggers mandatory full MFA + email/SMS notification

**Fingerprint Components:**
- Hardware: screen resolution, CPU cores, GPU renderer, device memory
- Software: OS version, browser version, installed plugins, timezone, language
- Network: IP geolocation, ASN, VPN/proxy detection
- Behavioral: typing cadence, touch pressure (mobile), mouse movement patterns

**Risk Scoring:**
```
device_risk_score = weighted_sum(
    ip_change=0.3,
    device_fingerprint_change=0.25,
    timezone_mismatch=0.15,
    vpn_detected=0.15,
    new_device=0.15
)
# Score > 0.7 = block + notify
# Score 0.4-0.7 = step-up authentication
# Score < 0.4 = allow with standard auth
```

### 1.4 PIN-Based Transaction Authorization

- PIN: 6 digits minimum for financial apps (4 is too weak)
- Store as bcrypt/argon2 hash with per-user salt -- never reversible
- Lock account after 5 failed PIN attempts (progressive: 1min, 5min, 15min, 1hr, lock)
- PIN entry UI: randomized keypad layout on mobile to defeat shoulder-surfing and screen recording
- PIN change requires: current PIN + SMS OTP + email confirmation
- Transaction signing: `HMAC(transaction_details + timestamp + nonce, derived_key_from_PIN)`

---

## 2. Transaction Security

### 2.1 Double-Payment Prevention

**Three-Layer Defense:**

**Layer 1 -- Client-Side Idempotency Key:**
```
// Client generates UUID v4 before submitting
POST /api/transactions/
{
    "idempotency_key": "550e8400-e29b-41d4-a716-446655440000",
    "amount": 1000,
    "currency": "KES",
    "recipient": "wallet_abc123"
}
```

**Layer 2 -- Database Unique Constraint:**
```sql
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL,
    amount DECIMAL(20,8) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_idempotency UNIQUE (user_id, idempotency_key)
);
```

**Layer 3 -- Distributed Lock (Redis):**
```python
# Before processing any transaction:
lock_key = f"txn_lock:{user_id}:{idempotency_key}"
lock = redis.lock(lock_key, timeout=30, blocking_timeout=5)
if lock.acquire():
    try:
        # Check if already processed
        existing = Transaction.objects.filter(
            user_id=user_id,
            idempotency_key=idempotency_key
        ).first()
        if existing:
            return existing  # Return cached result
        # Process new transaction
        txn = process_payment(...)
    finally:
        lock.release()
else:
    raise ConflictError("Transaction already in progress")
```

**Airbnb's Proven Pattern:**
- Each request gets a unique idempotency key from the client
- Server stores request + response keyed by idempotency key
- On retry, server returns stored response without re-executing
- Keys expire after 24 hours (configurable)
- Use database-level serializable isolation for critical sections

### 2.2 Transaction Signing & Non-Repudiation

**Digital Signature Flow:**
1. Server constructs canonical transaction string: `amount|currency|recipient|timestamp|nonce`
2. Client signs with device private key (stored in secure enclave)
3. Server verifies signature with stored public key
4. Signed transaction stored as audit evidence

**Non-Repudiation Chain:**
```
Transaction Record:
- transaction_id: UUID
- payload_hash: SHA-256 of transaction details
- client_signature: Ed25519/ECDSA signature from device key
- server_timestamp: Signed NTP-synchronized timestamp
- device_attestation: Device integrity proof
- ip_address: Client IP at time of signing
- geolocation: Lat/long (if permitted)
```

### 2.3 Rate Limiting & Velocity Checks

**Multi-Window Velocity Rules:**

| Rule | Window | Threshold | Action |
|------|--------|-----------|--------|
| Transactions per minute | 1 min | 3 | Block + alert |
| Transactions per hour | 1 hr | 20 | Require step-up auth |
| Daily transaction amount | 24 hr | KES 500,000 | Block + manual review |
| Failed attempts | 15 min | 5 | Lock 30 min |
| New recipient transfers | 24 hr | 3 | Require enhanced verification |
| Cross-border transfers | 24 hr | 2 | KYC tier check |

**Implementation with Redis Sliding Windows:**
```python
def check_velocity(user_id, amount):
    pipe = redis.pipeline()
    now = time.time()

    # Transactions per minute
    key_1m = f"velocity:{user_id}:1m"
    pipe.zremrangebyscore(key_1m, 0, now - 60)
    pipe.zcard(key_1m)

    # Daily amount
    key_daily = f"velocity:{user_id}:daily_amount"
    pipe.get(key_daily)

    results = pipe.execute()
    txn_count_1m = results[1]
    daily_amount = Decimal(results[2] or 0)

    if txn_count_1m >= 3:
        raise VelocityExceeded("Too many transactions per minute")
    if daily_amount + amount > 500000:
        raise VelocityExceeded("Daily limit exceeded")
```

### 2.4 Fraud Detection Patterns

**Rule-Based Checks (First Line):**
- Amount anomaly: Transaction > 3x user's average transaction size
- Time anomaly: Transaction outside user's normal active hours
- Location anomaly: Transaction from new country/region
- Recipient anomaly: First-time recipient + high amount
- Device anomaly: New device + high-value transaction
- Frequency anomaly: Sudden burst of small transactions (structuring detection)

**ML-Based Scoring (Second Line):**
- Feature engineering across 5-min, 1-hr, 24-hr, 7-day, 30-day windows
- Features: transaction velocity, amount variance, recipient diversity, device changes, time-of-day patterns
- Model: Gradient boosted trees (XGBoost/LightGBM) for tabular fraud data
- Real-time inference: <200ms latency target
- Score 0-100: 0-30 auto-approve, 30-70 flag for review, 70-100 auto-block

**Graph-Based Detection (Third Line):**
- Build transaction graph: users as nodes, transactions as edges
- Detect mule account networks (accounts that receive and immediately forward funds)
- Community detection algorithms to find fraud rings
- Neo4j or Amazon Neptune for graph queries

### 2.5 Hot Wallet vs Cold Wallet Architecture

```
                    +-------------------+
                    |   User Requests   |
                    +--------+----------+
                             |
                    +--------v----------+
                    |   API Gateway     |
                    |   (Rate Limited)  |
                    +--------+----------+
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+         +---------v---------+
    |    HOT WALLET     |         |   WARM WALLET     |
    |   2-5% of funds   |         |   10-20% of funds |
    |                   |         |                   |
    | - Auto-signing    |         | - Multi-sig (2/3) |
    | - Online 24/7     |         | - Semi-automated  |
    | - Rate limited    |         | - Refills hot     |
    | - Monitored       |         | - Hourly review   |
    +---------+---------+         +---------+---------+
              |                             |
              |    +-------------------+    |
              +--->| COLD STORAGE      |<---+
                   | 75-90% of funds   |
                   |                   |
                   | - Air-gapped HSM  |
                   | - Multi-sig (3/5) |
                   | - Geographic dist |
                   | - Shamir's Secret |
                   |   Sharing for keys|
                   | - Manual approval |
                   | - Weekly refill   |
                   +-------------------+
```

**Key Design Principles:**
- **Hot wallet auto-refill**: When hot wallet balance drops below threshold, warm wallet auto-tops-up (requires 2-of-3 multi-sig)
- **Withdrawal limits**: Hot wallet has per-transaction and daily withdrawal caps
- **Anomaly circuit breaker**: If withdrawal rate exceeds 2x normal, freeze hot wallet and alert ops team
- **Key management**: Use MPC (Multi-Party Computation) to split keys -- no single party ever holds a complete key
- **Cold storage ceremony**: Key generation on air-gapped machines, witnessed by 3+ authorized personnel, recorded on video
- **Insurance**: Maintain insurance coverage for hot wallet holdings (Coincover, Fireblocks, BitGo)

---

## 3. Data Security

### 3.1 Encryption at Rest and in Transit

**In Transit:**
- TLS 1.3 mandatory for all external connections
- mTLS (mutual TLS) for service-to-service communication
- Certificate pinning on mobile apps
- HSTS headers with min-age 31536000 (1 year)

**At Rest:**
- AES-256-GCM for all sensitive data at rest
- Transparent Data Encryption (TDE) at database level
- Application-level encryption for PII fields (name, phone, national ID)
- Separate encryption keys per data classification tier

**Data Classification:**
| Tier | Data Types | Encryption | Access |
|------|-----------|------------|--------|
| Critical | Private keys, PINs, passwords | HSM-wrapped AES-256 | HSM API only |
| High | National ID, bank accounts, balances | App-level AES-256-GCM | Authorized services only |
| Medium | Email, phone, transaction history | DB-level TDE | Authenticated users |
| Low | Public profile, display name | TDE (inherited) | Public |

### 3.2 PCI DSS 4.0 Considerations

**If handling card data (PCI DSS 4.0.1 -- mandatory as of March 2025):**

- **Requirement 3**: Protect stored account data -- render PAN unreadable via tokenization (preferred), truncation, or AES-256 encryption
- **Requirement 4**: Encrypt cardholder data in transit with TLS 1.2+ (TLS 1.3 preferred)
- **Requirement 6**: Develop secure software -- mandatory SAST/DAST in CI/CD pipeline
- **Requirement 8**: Strong authentication -- MFA for all administrative access, 12-character minimum passwords
- **Requirement 11**: Regular penetration testing, internal/external vulnerability scans quarterly

**Recommendation**: Use a PCI-compliant payment processor (Stripe, Flutterwave, Paystack) to handle card data. This puts you at SAQ-A level (simplest compliance). Never store raw card numbers.

### 3.3 Key Management (HSM/KMS)

**Key Hierarchy:**
```
Master Key (in HSM, never exported)
  |
  +-- Key Encryption Key (KEK) - wraps data keys
  |     |
  |     +-- Data Encryption Key (DEK) - per-table or per-tenant
  |     +-- Data Encryption Key (DEK) - rotated monthly
  |
  +-- Signing Key - for transaction signatures
  |
  +-- API Key Encryption Key - wraps partner API keys
```

**HSM Options:**
- **Cloud**: AWS CloudHSM ($1.60/hr), Azure Dedicated HSM, Google Cloud HSM
- **Cloud KMS (cheaper)**: AWS KMS ($1/key/month + $0.03/10k requests), Azure Key Vault, GCP KMS
- **On-prem**: Thales Luna, Utimaco SecurityServer (for cold wallet key ceremonies)
- **Crypto-specific**: Fireblocks MPC, BitGo, Ledger Vault

**Key Rotation Policy:**
- Master keys: Annual rotation with dual-control ceremony
- DEKs: Monthly automated rotation
- API keys: 90-day rotation
- TLS certificates: 90-day auto-renewal (Let's Encrypt / Cloudflare)
- JWT signing keys: 90-day rotation with overlap period

### 3.4 Database Encryption

```sql
-- PostgreSQL: Column-level encryption using pgcrypto
-- For application-level encryption (preferred for PII):

-- Encrypting:
UPDATE users SET
    national_id_enc = pgp_sym_encrypt(national_id, current_setting('app.encryption_key')),
    phone_enc = pgp_sym_encrypt(phone, current_setting('app.encryption_key'));

-- Better approach: encrypt/decrypt in application layer using envelope encryption
-- DB stores ciphertext + encrypted DEK
-- App requests DEK decryption from KMS, then decrypts data locally
```

**PostgreSQL Hardening:**
- Enable `ssl = on` in postgresql.conf
- Use `scram-sha-256` authentication (not md5)
- Row-Level Security (RLS) for multi-tenant data isolation
- Audit logging via `pgaudit` extension
- Connection pooling with PgBouncer (TLS between app and pool)

---

## 4. Infrastructure Security

### 4.1 Network Segmentation

```
                    INTERNET
                        |
                  +-----v------+
                  | Cloudflare |  (DDoS, WAF, CDN)
                  +-----+------+
                        |
            +-----------v-----------+
            |     DMZ / Public      |
            |  - Load Balancer      |
            |  - API Gateway        |
            |  - Rate Limiter       |
            +-----------+-----------+
                        |
            +-----------v-----------+
            |   Application Tier    |
            |  - API Servers        |
            |  - WebSocket Servers  |
            |  - Worker Processes   |
            +-----------+-----------+
                        |
         +--------------+--------------+
         |                             |
+--------v--------+          +--------v--------+
|   Data Tier     |          |  Crypto Tier    |
| - PostgreSQL    |          | - Hot Wallet    |
| - Redis         |          | - Signing Svc   |
| - Kafka         |          | - HSM           |
+-----------------+          +-----------------+
(No internet access)         (No internet access,
                              most restricted)
```

**Segmentation Rules:**
- Each tier in its own VPC subnet / security group
- Crypto tier: zero inbound internet, only accepts connections from application tier on specific ports
- Database tier: only accepts connections from application tier
- All inter-tier communication over mTLS
- No SSH access to production -- use bastion host + session recording (Teleport, AWS SSM)

### 4.2 WAF (Web Application Firewall)

**Recommended: Cloudflare WAF (already using Cloudflare)**
- OWASP Core Rule Set (CRS) for SQL injection, XSS, SSRF protection
- Custom rules for fintech:
  - Block requests with suspicious transaction patterns
  - Rate limit login endpoints (10 req/min per IP)
  - Rate limit transaction endpoints (5 req/min per IP)
  - Block known VPN/proxy IPs for high-risk transactions
  - Geo-blocking for unsupported regions
- Bot management: Challenge suspicious automated traffic
- API shield: Validate request schemas at edge

### 4.3 DDoS Protection

- **Layer 3/4**: Cloudflare automatic mitigation (included in Pro plan)
- **Layer 7**: Cloudflare rate limiting + WAF rules
- **Application level**: Redis-based rate limiting per user/IP/endpoint
- **Always-on mode**: Enable during high-risk periods (launch, promotions)
- **Failover**: Multi-region deployment with DNS failover

### 4.4 Audit Logging & Monitoring

**What to Log (Immutable, Append-Only):**
```json
{
    "event_id": "uuid",
    "timestamp": "ISO-8601 UTC",
    "event_type": "transaction.created",
    "actor": {
        "user_id": "uuid",
        "ip": "203.0.113.42",
        "device_fingerprint": "hash",
        "session_id": "uuid"
    },
    "resource": {
        "type": "transaction",
        "id": "uuid"
    },
    "action": "create",
    "details": {
        "amount": "1000.00",
        "currency": "KES",
        "recipient": "wallet_hash"
    },
    "risk_score": 15,
    "result": "success"
}
```

**Critical Events to Audit:**
- All authentication events (login, logout, MFA, failed attempts)
- All transactions (create, approve, reject, cancel)
- All admin actions (user management, config changes, key rotation)
- All API key usage
- All permission/role changes
- All data access for PII (who viewed what, when)
- All system configuration changes

**Log Infrastructure:**
- Write to append-only store (immutable)
- Ship to centralized logging: ELK Stack or Loki + Grafana
- Retain for 7 years minimum (regulatory requirement)
- Tamper detection: hash chain (each log entry includes hash of previous)
- Real-time alerts on suspicious patterns (PagerDuty/Opsgenie integration)

### 4.5 Monitoring Stack

```
Prometheus (metrics) --> Grafana (dashboards + alerts)
Application logs --> Loki/ELK --> Grafana
Traces --> Jaeger/Tempo --> Grafana
Errors --> Sentry (real-time error tracking)
Uptime --> UptimeRobot/Better Uptime (external)
```

**Key Metrics to Monitor:**
- Transaction success/failure rate (alert if failure > 5%)
- Transaction processing latency (p50, p95, p99)
- Hot wallet balance (alert if below threshold)
- Authentication failure rate (alert if spike)
- API response times
- Database connection pool utilization
- Queue depth (Kafka consumer lag)
- Certificate expiry countdown

### 4.6 Penetration Testing

- **Frequency**: Quarterly external pentest, annual full-scope (including social engineering)
- **Scope**: Web app, mobile app, API, infrastructure, wallet operations
- **Standards**: OWASP Testing Guide, PTES, NIST SP 800-115
- **Bug bounty**: Launch on HackerOne/Bugcrowd after initial hardening
- **Remediation SLA**: Critical = 24hr, High = 7 days, Medium = 30 days, Low = 90 days

---

## 5. Compliance & KYC/AML

### 5.1 KYC Tiers

**Tier System (Kenya-specific, aligned with CBK risk-based approach):**

| Tier | Verification | Limits | Requirements |
|------|-------------|--------|--------------|
| **Tier 0** (Anonymous) | Phone only | View only, no transactions | Phone OTP |
| **Tier 1** (Basic) | Phone + Name | KES 100K/day, KES 300K/month | National ID number + selfie |
| **Tier 2** (Standard) | Full KYC | KES 500K/day, KES 2M/month | National ID scan + liveness check + address proof |
| **Tier 3** (Enhanced) | Full EDD | Unlimited | All Tier 2 + source of funds + enhanced due diligence |
| **Business** | Corporate KYC | Custom | Registration docs + directors KYC + beneficial ownership |

**KYC Provider Options (Africa-focused):**
- **Smile Identity**: Pan-African ID verification, liveness detection, document verification
- **Metamap (formerly Mati)**: Global coverage, biometric verification
- **Onfido**: AI-powered document + biometric verification
- **Peleza International**: Kenya-specific, IPRS integration
- **uqudo**: Middle East + Africa, real-time ID verification

### 5.2 AML Screening

**Sanctions & PEP Screening:**
- Screen all users at onboarding against:
  - OFAC SDN List (US sanctions)
  - UN Consolidated Sanctions List
  - EU Sanctions List
  - Kenya's FRC/AML list
  - PEP (Politically Exposed Persons) databases
- Re-screen existing users: weekly batch + real-time on transactions > threshold
- Use fuzzy matching (Levenshtein distance) for name variations
- Providers: ComplyAdvantage, Refinitiv World-Check, Sanction Scanner, LexisNexis

**Transaction Monitoring Rules:**
```python
AML_RULES = {
    "structuring": {
        "description": "Multiple transactions just below reporting threshold",
        "condition": "sum(txns_24h) > KES 1M AND max(single_txn) < KES 100K AND count(txns_24h) > 10",
        "action": "flag_for_review"
    },
    "rapid_movement": {
        "description": "Funds received and immediately sent out",
        "condition": "time_between_inbound_and_outbound < 30min AND amount > KES 500K",
        "action": "flag_for_review"
    },
    "unusual_pattern": {
        "description": "Transaction pattern deviates significantly from profile",
        "condition": "amount > 5x avg_monthly AND new_recipient",
        "action": "flag_for_review"
    },
    "high_risk_jurisdiction": {
        "description": "Transaction involving FATF grey/blacklist country",
        "condition": "counterparty_country IN fatf_high_risk_list",
        "action": "enhanced_due_diligence"
    }
}
```

### 5.3 SAR Filing (Kenya)

- **Threshold**: Transactions >= KES 1,000,000 (or equivalent) require reporting to FRC
- **Suspicious Activity**: File SAR within 7 working days of detection
- **Record Retention**: All transaction records for minimum 7 years after relationship ends
- **Tipping off prohibition**: Never inform the customer that a SAR has been filed

### 5.4 Kenya-Specific Regulatory Framework (2025-2026)

- **POCAMLA** (Proceeds of Crime and Anti-Money Laundering Act): Primary AML law
- **Virtual Asset Service Providers Act (October 2025)**: New framework for crypto/digital asset providers
- **CBK regulations**: Payment Service Providers require CBK license
- **FRC (Financial Reporting Centre)**: Primary AML supervisor
- **FATF Grey List**: Kenya remains on grey list (as of Feb 2025), exit targeted by 2026 -- expect increased scrutiny
- **Penalties**: Up to KES 20 million for non-compliance
- **Data Protection Act 2019**: Kenya's GDPR equivalent -- consent required for personal data processing

---

## 6. Architecture Patterns

### 6.1 Event Sourcing for Financial Transactions

**Why Event Sourcing for Finance:**
- Complete, immutable audit trail of every state change
- Can reconstruct account balance at any point in time
- Natural fit for regulatory compliance (every change is recorded)
- Enables temporal queries: "What was the balance at 2pm yesterday?"

**Event Store Schema:**
```sql
CREATE TABLE events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id UUID NOT NULL,          -- e.g., wallet_id
    aggregate_type VARCHAR(50) NOT NULL,  -- e.g., 'wallet', 'transaction'
    event_type VARCHAR(100) NOT NULL,     -- e.g., 'funds_deposited'
    event_data JSONB NOT NULL,            -- event payload
    metadata JSONB,                       -- actor, ip, device, etc.
    version BIGINT NOT NULL,              -- optimistic concurrency
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_aggregate_version UNIQUE (aggregate_id, version)
);

CREATE INDEX idx_events_aggregate ON events (aggregate_id, version);
CREATE INDEX idx_events_type ON events (event_type, created_at);
```

**Example Events for a Wallet:**
```json
// Event 1: Wallet Created
{"event_type": "wallet_created", "data": {"user_id": "...", "currency": "KES"}}

// Event 2: Funds Deposited (M-Pesa)
{"event_type": "funds_deposited", "data": {"amount": 5000, "source": "mpesa", "ref": "QHK..."}}

// Event 3: Funds Sent
{"event_type": "funds_sent", "data": {"amount": 1000, "recipient": "wallet_xyz", "fee": 10}}

// Event 4: Funds Received
{"event_type": "funds_received", "data": {"amount": 1000, "sender": "wallet_abc"}}

// Replaying events 1-4: balance = 0 + 5000 - 1000 - 10 + 1000 = 4990 KES
```

**Selective Event Sourcing (Recommended):**
Apply event sourcing ONLY to financial transaction services (wallets, ledger, payments). Use traditional CRUD for non-financial services (user profiles, notifications, settings). This avoids unnecessary complexity where auditability isn't required.

### 6.2 CQRS (Command Query Responsibility Segregation)

```
                COMMANDS                          QUERIES
                   |                                 |
          +--------v--------+              +---------v---------+
          |  Command Handler |              |   Query Handler   |
          |  (Write Model)   |              |   (Read Model)    |
          +--------+---------+              +---------+---------+
                   |                                  |
          +--------v---------+              +---------v---------+
          |   Event Store    |--projection->|  Read Database    |
          |  (PostgreSQL)    |              |  (PostgreSQL +    |
          |  (append-only)   |              |   materialized    |
          +------------------+              |   views / Redis)  |
                                            +-------------------+
```

**Write Model (Commands):**
- Validates business rules
- Appends events to event store
- Uses optimistic concurrency (version check)
- Example: `TransferFundsCommand` -> validates balance, creates events

**Read Model (Queries):**
- Denormalized views optimized for specific queries
- Materialized views for account balances, transaction history
- Redis cache for hot data (current balances, recent transactions)
- Can have multiple read models for different query patterns

**Projection Examples:**
- `wallet_balances` -- current balance per wallet (updated on every event)
- `transaction_history` -- paginated transaction list per user
- `daily_volumes` -- aggregated daily transaction volumes for analytics
- `fraud_signals` -- real-time fraud detection features

### 6.3 Saga Pattern for Distributed Transactions

**Example: Crypto Purchase via M-Pesa**

```
User initiates: "Buy 0.01 BTC using M-Pesa"

Saga Steps (Orchestrated):
1. CREATE_ORDER        -> Order Service      (creates pending order)
2. RESERVE_CRYPTO      -> Crypto Service     (reserves BTC from liquidity pool)
3. INITIATE_PAYMENT    -> Payment Service    (sends M-Pesa STK push)
4. AWAIT_PAYMENT       -> Payment Service    (polls/webhook for M-Pesa confirmation)
5. CONFIRM_CRYPTO      -> Crypto Service     (transfers BTC to user wallet)
6. COMPLETE_ORDER      -> Order Service      (marks order complete)

Compensating Transactions (on failure):
6' FAIL_ORDER          -> Order Service      (mark failed)
5' RELEASE_CRYPTO      -> Crypto Service     (return BTC to pool)
4' REFUND_PAYMENT      -> Payment Service    (reverse M-Pesa if already paid)
3' CANCEL_PAYMENT      -> Payment Service    (cancel pending STK push)
2' RELEASE_CRYPTO      -> Crypto Service     (unreserve BTC)
1' CANCEL_ORDER        -> Order Service      (cancel order)
```

**Implementation Options:**
- **Temporal.io** (recommended): Durable workflow engine, handles retries/timeouts/compensation natively, supports Go/Python/TypeScript
- **Custom orchestrator**: State machine in PostgreSQL + Celery workers
- **Choreography with Kafka**: Each service publishes events, others react -- simpler but harder to debug

**Saga State Machine:**
```python
class OrderSaga:
    STATES = {
        'created': {'next': 'crypto_reserved', 'compensate': 'cancelled'},
        'crypto_reserved': {'next': 'payment_initiated', 'compensate': 'crypto_released'},
        'payment_initiated': {'next': 'payment_confirmed', 'compensate': 'payment_cancelled'},
        'payment_confirmed': {'next': 'crypto_transferred', 'compensate': 'payment_refunded'},
        'crypto_transferred': {'next': 'completed', 'compensate': 'crypto_reversed'},
        'completed': {'next': None, 'compensate': None},
    }
    # Each state transition is atomic, with timeout + retry
    # Failed step triggers compensate chain back to 'cancelled'
```

### 6.4 Circuit Breaker for External Services

**Critical External Dependencies:**
- M-Pesa API (Safaricom)
- Crypto exchange APIs (Binance, Kraken)
- KYC providers (Smile Identity)
- SMS providers (Africa's Talking)
- Blockchain nodes

**Circuit Breaker States:**
```
CLOSED (normal) --[failure_count > threshold]--> OPEN (fail fast)
OPEN --[timeout elapsed]--> HALF_OPEN (test with single request)
HALF_OPEN --[success]--> CLOSED
HALF_OPEN --[failure]--> OPEN
```

**Configuration per Service:**
```python
CIRCUIT_BREAKERS = {
    "mpesa": {
        "failure_threshold": 5,        # failures before opening
        "success_threshold": 3,        # successes in half-open to close
        "timeout": 60,                 # seconds before half-open
        "fallback": "queue_for_retry", # action when circuit is open
    },
    "binance": {
        "failure_threshold": 3,
        "success_threshold": 2,
        "timeout": 30,
        "fallback": "use_backup_exchange",
    },
    "kyc_provider": {
        "failure_threshold": 5,
        "success_threshold": 3,
        "timeout": 120,
        "fallback": "manual_review_queue",
    },
}
```

**Libraries**: `pybreaker` (Python), `opossum` (Node.js), `resilience4j` (Java/Kotlin)

### 6.5 Reconciliation System

**Three Types of Reconciliation:**

1. **Internal Reconciliation** (continuous):
   - Sum of all wallet balances == sum of all deposits - sum of all withdrawals + fees collected
   - Every debit has a matching credit (double-entry verification)
   - Run every 5 minutes as automated job

2. **External Reconciliation** (daily):
   - Match internal transaction records against M-Pesa settlement reports
   - Match internal crypto records against blockchain transactions
   - Identify: missing transactions, amount mismatches, duplicate entries

3. **Proof-of-Reserve** (for crypto, periodic):
   - Total user crypto balances <= actual holdings across hot + warm + cold wallets
   - Publish Merkle tree proof for transparency (optional)

**Double-Entry Ledger Schema:**
```sql
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    account_id UUID NOT NULL,
    entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
    amount DECIMAL(20,8) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) NOT NULL,
    balance_after DECIMAL(20,8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every transaction must have balanced entries:
-- SUM(credits) = SUM(debits) for each transaction_id

-- Reconciliation query:
SELECT transaction_id,
       SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debits,
       SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credits
FROM ledger_entries
GROUP BY transaction_id
HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) !=
       SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END);
-- This query should return ZERO rows. Any rows = reconciliation failure.
```

---

## 7. Tech Stack Recommendations (2025/2026)

### 7.1 Backend Framework

| Framework | Pros | Cons | Best For |
|-----------|------|------|----------|
| **Go (Gin/Echo)** | High performance, strong concurrency, compiled binary, low memory | Smaller ecosystem, verbose error handling | Core payment engine, hot wallet service |
| **Python (Django/FastAPI)** | Rapid development, huge ecosystem, excellent for ML/fraud detection | GIL limits concurrency, slower than Go/Rust | Admin panel, KYC service, fraud detection ML |
| **Node.js (NestJS)** | TypeScript safety, good async I/O, large ecosystem | Single-threaded, memory-heavy | API gateway, real-time WebSocket services |
| **Rust (Actix/Axum)** | Maximum safety + performance, no GC | Steep learning curve, slower dev velocity | Cryptographic operations, wallet signing service |
| **Elixir (Phoenix)** | Exceptional concurrency (Erlang VM), fault-tolerant | Smaller talent pool, niche ecosystem | Real-time systems, high-concurrency matching |

**Recommended Polyglot Approach:**
- **API Gateway + User-facing services**: NestJS (TypeScript) or FastAPI (Python)
- **Core payment/ledger engine**: Go -- performance-critical, handles high transaction throughput
- **Wallet/signing service**: Go or Rust -- security-critical, needs memory safety
- **Fraud detection**: Python (FastAPI) -- ML ecosystem (scikit-learn, XGBoost, PyTorch)
- **Admin dashboard**: Django (leveraging its built-in admin) or Next.js

**Monolith-First Alternative (Faster to Market):**
- Django + DRF for everything initially
- Extract hot paths into Go microservices as you scale
- This is the pragmatic approach for a startup

### 7.2 Database Choices

```
+-------------------+---------------------------+----------------------------+
|    Database       |       Use Case            |        Why                 |
+-------------------+---------------------------+----------------------------+
| PostgreSQL 16+    | Primary transactional DB  | ACID, JSON support, RLS,   |
|                   | Ledger, users, wallets    | pgaudit, battle-tested     |
+-------------------+---------------------------+----------------------------+
| TimescaleDB       | Time-series analytics     | Built on PG, hypertables,  |
|                   | Transaction metrics       | continuous aggregates      |
+-------------------+---------------------------+----------------------------+
| Redis 7+         | Caching, sessions,        | Sub-ms latency, pub/sub,   |
|                   | rate limiting, locks      | Lua scripting, streams     |
+-------------------+---------------------------+----------------------------+
| Apache Kafka      | Event streaming, CDC      | Durable, ordered, replay,  |
|                   | Audit log pipeline        | exactly-once semantics     |
+-------------------+---------------------------+----------------------------+
| ClickHouse        | Analytics, fraud detection| Columnar, fast aggregations|
|                   | reporting                 | billions of rows           |
+-------------------+---------------------------+----------------------------+
| Neo4j (optional)  | Fraud graph analysis      | Graph queries for fraud    |
|                   |                           | ring detection             |
+-------------------+---------------------------+----------------------------+
```

### 7.3 Message Queue / Event Streaming

**Kafka (Recommended for Core):**
- Durable, ordered event log -- perfect for event sourcing
- Exactly-once semantics (with idempotent producers + transactional consumers)
- Replay capability for rebuilding read models
- Use Kafka Connect for CDC (Change Data Capture) from PostgreSQL
- Topics: `transactions`, `wallet-events`, `audit-log`, `fraud-signals`, `notifications`

**RabbitMQ (for Task Queues):**
- Better for RPC-style request/reply patterns
- Priority queues for urgent notifications
- Simpler to operate than Kafka for small teams
- Use for: email sending, SMS notifications, KYC processing jobs

**Redis Streams (Lightweight Alternative):**
- If Kafka is too heavy for initial scale
- Good for real-time event processing at moderate volume
- Consumer groups for reliable processing
- Upgrade to Kafka when you outgrow Redis Streams

### 7.4 Monitoring & Observability

```
Layer           | Tool                  | Purpose
----------------|-----------------------|----------------------------------
Metrics         | Prometheus            | System + business metrics
Dashboards      | Grafana               | Visualization, alerting
Logs            | Loki + Promtail       | Centralized log aggregation
                | (or ELK Stack)        | (ELK for larger scale)
Traces          | Jaeger or Tempo       | Distributed request tracing
Errors          | Sentry                | Real-time error tracking + context
Uptime          | Better Uptime         | External endpoint monitoring
APM             | Datadog or New Relic  | Full-stack APM (if budget allows)
Alerting        | PagerDuty / Opsgenie  | On-call rotation + escalation
```

**Critical Business Dashboards:**
1. **Transaction Dashboard**: Volume, success rate, avg latency, by payment method
2. **Wallet Dashboard**: Total deposits, withdrawals, active wallets, balance distribution
3. **Fraud Dashboard**: Flagged transactions, false positive rate, blocked amount
4. **Infrastructure Dashboard**: CPU, memory, disk, DB connections, queue depth
5. **Compliance Dashboard**: KYC completion rates, AML flags, pending reviews

### 7.5 Infrastructure & Deployment

**Container Orchestration:**
- Kubernetes (EKS/GKE) for production -- auto-scaling, rolling deployments, secrets management
- Docker Compose for development/staging
- Helm charts for reproducible deployments

**CI/CD Pipeline:**
```
Code Push -> GitHub Actions / GitLab CI
  -> Lint + Type Check
  -> Unit Tests
  -> SAST (Semgrep/SonarQube)
  -> Build Docker Image
  -> Integration Tests
  -> DAST (OWASP ZAP)
  -> Security Scan (Trivy for container vulnerabilities)
  -> Deploy to Staging
  -> Smoke Tests
  -> Manual Approval (for production)
  -> Deploy to Production (blue-green / canary)
  -> Post-deploy health checks
```

**Secrets Management:**
- HashiCorp Vault or AWS Secrets Manager (never in .env files in production)
- Rotate secrets automatically
- Audit all secret access

---

## Summary: Security Priorities by Phase

### Phase 1: MVP (Month 1-3)
- [ ] TLS everywhere, basic MFA (SMS OTP + PIN)
- [ ] Idempotency keys + database unique constraints
- [ ] Basic rate limiting (Redis)
- [ ] KYC Tier 1 (phone + national ID)
- [ ] Basic AML screening (sanctions list check)
- [ ] Double-entry ledger
- [ ] Audit logging (append-only table)
- [ ] PostgreSQL + Redis stack
- [ ] Cloudflare WAF + DDoS protection
- [ ] Weekly automated vulnerability scans

### Phase 2: Growth (Month 4-6)
- [ ] TOTP/Authenticator app as MFA option
- [ ] Device fingerprinting + binding
- [ ] Full event sourcing for transactions
- [ ] Saga pattern for payment flows
- [ ] Circuit breakers for external services
- [ ] ML-based fraud scoring (basic model)
- [ ] KYC Tier 2 (document verification + liveness)
- [ ] Automated reconciliation
- [ ] Hot/warm/cold wallet separation
- [ ] Penetration test #1

### Phase 3: Scale (Month 7-12)
- [ ] Biometric authentication (FIDO2/WebAuthn)
- [ ] CQRS read model optimization
- [ ] Kafka for event streaming
- [ ] Graph-based fraud detection
- [ ] KYC Tier 3 + business accounts
- [ ] HSM for key management
- [ ] Multi-region deployment
- [ ] SOC 2 Type II certification
- [ ] Bug bounty program launch
- [ ] Proof-of-reserve system

---

## Sources

- [Fintech Cybersecurity in 2026: Risks, AI Threats & Best Practices](https://www.eccu.edu/blog/fintech-cybersecurity/)
- [Building Secure and Scalable Fintech Applications](https://dev.to/ojosolomon/building-secure-and-scalable-fintech-applications-a-technical-architecture-deep-dive-35in)
- [2025 Security Compliance Requirements for Fintech](https://www.cycoresecure.com/blogs/2025-security-compliance-requirements-for-fintech)
- [Beyond Hot and Cold: Multi-Layered Security Architecture for Crypto Exchanges 2026](https://vocal.media/01/beyond-hot-and-cold-the-multi-layered-security-architecture-every-crypto-exchange-must-implement-in-2026)
- [Cold Wallet vs Hot Wallet: 2025 Guide](https://www.cobo.com/post/cold-wallet-vs-hot-wallet-what-crypto-exchanges-and-users-need-to-know-in-2025)
- [How to Architect Wallet Infra for a Crypto Bank Platform](https://ideausher.com/blog/wallet-infra-crypto-bank-platform/)
- [Avoiding Double Payments in a Distributed Payments System (Airbnb)](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb)
- [Idempotency's Role in Financial Services](https://www.cockroachlabs.com/blog/idempotency-in-finance/)
- [Mastering Idempotency for Secure Financial Transactions](https://www.pingcap.com/article/mastering-idempotency-secure-financial-transactions/)
- [Event Sourcing, CQRS and Micro Services: Real FinTech Example](https://lukasniessen.medium.com/this-is-a-detailed-breakdown-of-a-fintech-project-from-my-consulting-career-9ec61603709c)
- [CQRS & Event Sourcing in Financial Services](https://iconsolutions.com/blog/cqrs-event-sourcing)
- [Event Sourcing Pattern - Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [Scaling Fintechs in Kenya Under Strict 2025 AML Regulations](https://peleza.com/fintechs-in-kenya-regulations/)
- [AML Compliance in Kenya: 2025 Guide](https://blog.voveid.com/aml-compliance-in-kenya-2025-guide-for-fintechs-and-regulated-businesses/)
- [Fintech Kenya 2026: Landscape Overview](https://sdk.finance/blog/fintech-kenya-2025-landscape-overview-growth-drivers-and-barriers/)
- [Fintech 2025 - Kenya (Chambers & Partners)](https://practiceguides.chambers.com/practice-guides/fintech-2025/kenya)
- [Saga Design Pattern - Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga)
- [Saga Pattern in Microservices: A Mastery Guide (Temporal)](https://temporal.io/blog/mastering-saga-patterns-for-distributed-transactions-in-microservices)
- [Building a FinTech App in 2026: Best Tech Stacks](https://medium.com/meetcyber/building-a-fintech-app-in-2026-best-tech-stacks-and-architecture-choices-f3dc7cecb350)
- [Best Fintech Technology Stack in 2025](https://svitla.com/blog/best-fintech-technology-stack-for-2025/)
- [PCI DSS Encryption Requirements 2025: Version 4.0.1](https://www.thoropass.com/blog/pci-dss-encryption-requirements)
- [PCI DSS for Fintech: Compliance Requirements](https://sprinto.com/blog/pci-dss-for-fintech/)
- [Real-Time Fraud Detection for Payment Orchestration Engines](https://www.craftingsoftware.com/real-time-fraud-monitoring-for-enterprise-fintech-stacks)
- [Comprehensive Guide to Fintech Fraud Detection (2025)](https://www.credolab.com/blog/fintech-fraud-detection)
- [TrustDecision: Velocity Check](https://trustdecision.com/riskopedia/velocity-check)
- [How to Build a Real-Time Ledger System with Double-Entry Accounting](https://finlego.com/tpost/c2pjjza3k1-designing-a-real-time-ledger-system-with)
- [Financial Reconciliation for Fintechs](https://www.properfinance.io/post/financial-reconciliation-for-fintechs)
- [The Role of WAF in Fintech and Financial Services](https://www.devopsdigest.com/the-role-of-waf-in-fintech-and-financial-services)
- [Secure Transaction Signing (OneSpan)](https://www.onespan.com/solutions/transaction-authorization)
