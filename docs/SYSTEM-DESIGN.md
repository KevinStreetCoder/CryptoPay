# CryptoPay: Crypto-to-M-Pesa Payment Platform — System Design

## Executive Summary

CryptoPay is a Kenyan fintech platform that lets users **pay any M-Pesa Paybill or Till number directly from cryptocurrency** — in one step. No P2P trading, no manual cash-out, no app-switching. Send USDT, BTC, ETH, or SOL and the recipient gets KES instantly via M-Pesa.

**The Gap**: As of March 2026, zero platforms in Kenya offer direct crypto-to-Paybill/Till payment. Every competitor (Binance P2P, Yellow Card, ZendWallet, Kotani Pay) requires users to first convert crypto to M-Pesa balance, then manually pay bills. CryptoPay eliminates this friction entirely.

**Market**: 733K+ crypto users in Kenya, all using M-Pesa (91% mobile money penetration). KES 40 trillion transacted on M-Pesa annually. Africa's crypto volume hit $205B in 2025 (+52% YoY). Stablecoins dominate (99% of Yellow Card volume).

---

## 1. Product Vision

### Core User Flow (The "One-Step Pay")

```
User opens CryptoPay
    → Selects "Pay Bill" or "Send to Till"
    → Enters Paybill/Till number + account number + amount in KES
    → Selects crypto to pay with (USDT, BTC, ETH, SOL, etc.)
    → Sees exact crypto amount (with live rate + fee breakdown)
    → Confirms with PIN/biometric
    → Crypto deducted from CryptoPay wallet
    → Backend converts crypto → KES in <5 seconds
    → M-Pesa B2B/STK Push pays the Paybill/Till
    → User gets instant confirmation + M-Pesa receipt
```

### Secondary Flows

1. **Buy Crypto**: M-Pesa STK Push → KES received → Crypto credited to wallet
2. **Sell Crypto**: Crypto → KES → B2C to user's M-Pesa
3. **Send Crypto**: Wallet-to-wallet (internal) or on-chain withdrawal
4. **Receive Crypto**: Deposit to personal wallet address
5. **Send to M-Pesa**: Quick send KES to any phone number (B2C)
6. **Pay Merchant**: Scan QR code at Till, pay with crypto

### KYC Tiers

| Tier | Verification | Daily Limit | Features |
|------|-------------|-------------|----------|
| Tier 0 | Phone + OTP only | KES 5,000 | View rates, receive only |
| Tier 1 | National ID/Passport + Selfie | KES 50,000 | Full buy/sell/pay |
| Tier 2 | KRA PIN + Proof of Address | KES 250,000 | Higher limits |
| Tier 3 | Enhanced DD (source of funds) | KES 1,000,000+ | Business/institutional |

---

## 2. Technical Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                   │
│   Mobile App (React Native)  │  Web App (Next.js)  │  USSD     │
└──────────────┬───────────────┴──────────┬───────────┴───────────┘
               │              HTTPS/WSS   │
┌──────────────▼──────────────────────────▼───────────────────────┐
│                     API GATEWAY (Kong/Nginx)                     │
│   Rate Limiting │ WAF │ Auth │ Request Signing │ DDoS Protection│
└──────────────┬──────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────────┐
│                    APPLICATION LAYER                              │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Auth Service │  │ Payment      │  │ Wallet Service         │  │
│  │ (Users,KYC,  │  │ Orchestrator │  │ (Balances, Deposits,   │  │
│  │  Sessions)   │  │ (Saga)       │  │  Withdrawals, HD keys) │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Rate Engine  │  │ M-Pesa       │  │ Blockchain Listener    │  │
│  │ (Pricing,    │  │ Service      │  │ (Deposit detection,    │  │
│  │  FX, Spread) │  │ (Daraja API) │  │  Confirmations)        │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Fraud       │  │ Notification │  │ Admin / Compliance     │  │
│  │ Detection   │  │ Service      │  │ Dashboard              │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
└──────────────┬──────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────────┐
│                      DATA LAYER                                  │
│                                                                  │
│  PostgreSQL     │  Redis        │  Kafka/RabbitMQ  │  S3        │
│  (Users,        │  (Sessions,   │  (Event Bus,     │  (KYC      │
│   Transactions, │   Rate Cache, │   Tx Events,     │   Docs,    │
│   Ledger)       │   Locks,      │   Notifications) │   Audit    │
│                 │   Idempotency)│                   │   Logs)    │
└─────────────────────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────────┐
│                   EXTERNAL INTEGRATIONS                          │
│                                                                  │
│  Safaricom       │  Yellow Card  │  Blockchain     │  Smile     │
│  Daraja API      │  API (KES     │  Nodes (BTC,    │  Identity  │
│  (STK Push,      │  off-ramp,    │  ETH, Tron,     │  (KYC      │
│   B2C, B2B,      │  liquidity)   │  Solana)        │  Provider) │
│   C2B)           │               │                 │            │
│                  │  CoinGecko    │  Fireblocks     │  KRA       │
│                  │  (Price feeds) │  (Custody @     │  (Tax      │
│                  │               │   scale)        │  Reporting)│
└─────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Mobile App** | React Native + Expo | Cross-platform (iOS + Android), large Kenyan dev community |
| **Web App** | Next.js 14 (App Router) | SSR for SEO, shared React components with mobile web |
| **API Gateway** | Kong or Nginx + rate limiting | Request auth, rate limits, WAF, API versioning |
| **Backend** | Django 5 + DRF | Proven fintech framework, excellent ORM, admin panel |
| **Task Queue** | Celery + Redis | Async M-Pesa callbacks, blockchain monitoring, notifications |
| **Event Bus** | RabbitMQ (MVP) → Kafka (scale) | Transaction events, audit trail, service decoupling |
| **Database** | PostgreSQL 16 | ACID transactions, double-entry ledger, JSON support |
| **Cache** | Redis 7 | Rate caching, session store, distributed locks, idempotency |
| **Blockchain** | ethers.js, bitcoinjs-lib, tronweb | HD wallet generation, transaction signing, balance monitoring |
| **KYC** | Smile Identity API | Africa-focused, ID verification, liveness checks, selfie match |
| **Monitoring** | Prometheus + Grafana + Sentry | Metrics, dashboards, error tracking |
| **Infrastructure** | Docker + Kubernetes (prod) | Container orchestration, auto-scaling |
| **CI/CD** | GitHub Actions | Automated testing, staging, production deploys |

### Why Django (Not Go/Rust/NestJS)?

1. **Speed to market** — Django's admin, ORM, auth, and DRF give us 50% of the backend for free
2. **You already know it** — same stack as TopPerformers, no learning curve
3. **Python ecosystem** — Celery, CCXT, web3.py, fraud detection ML all native
4. **Good enough performance** — Gunicorn + async views handle thousands of RPS; M-Pesa's rate limits are the bottleneck, not Django
5. **Migrate later if needed** — Extract the payment engine to Go/Rust only if profiling shows Django is the bottleneck (it won't be for years)

---

## 3. Database Schema (Core Tables)

### Double-Entry Ledger

Every financial operation creates balanced debit/credit entries. This is non-negotiable for a financial platform — it provides audit trail, reconciliation, and fraud detection.

```sql
-- Users
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           VARCHAR(15) UNIQUE NOT NULL,  -- +254...
    email           VARCHAR(255) UNIQUE,
    pin_hash        VARCHAR(255) NOT NULL,
    kyc_tier        SMALLINT DEFAULT 0,
    kyc_status      VARCHAR(20) DEFAULT 'pending', -- pending, verified, rejected
    is_active       BOOLEAN DEFAULT TRUE,
    is_suspended    BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets (one per user per currency)
CREATE TABLE wallets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    currency        VARCHAR(10) NOT NULL,  -- USDT, BTC, ETH, SOL, KES
    balance         DECIMAL(28,8) DEFAULT 0 CHECK (balance >= 0),
    locked_balance  DECIMAL(28,8) DEFAULT 0 CHECK (locked_balance >= 0),
    deposit_address VARCHAR(255),  -- blockchain address for crypto wallets
    address_index   INTEGER,       -- HD wallet derivation index
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, currency)
);

-- Ledger Entries (double-entry bookkeeping)
CREATE TABLE ledger_entries (
    id              BIGSERIAL PRIMARY KEY,
    transaction_id  UUID NOT NULL,
    wallet_id       UUID REFERENCES wallets(id),
    entry_type      VARCHAR(10) NOT NULL,  -- DEBIT or CREDIT
    amount          DECIMAL(28,8) NOT NULL CHECK (amount > 0),
    balance_after   DECIMAL(28,8) NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions (the core record)
CREATE TABLE transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(64) UNIQUE NOT NULL,
    user_id         UUID REFERENCES users(id),
    type            VARCHAR(30) NOT NULL,
    -- Types: DEPOSIT, WITHDRAWAL, BUY, SELL, PAYBILL_PAYMENT,
    --        TILL_PAYMENT, SEND_MPESA, INTERNAL_TRANSFER, FEE
    status          VARCHAR(20) DEFAULT 'pending',
    -- Status: pending → processing → confirming → completed / failed / reversed
    source_currency VARCHAR(10),
    source_amount   DECIMAL(28,8),
    dest_currency   VARCHAR(10),
    dest_amount     DECIMAL(28,8),
    exchange_rate   DECIMAL(18,8),
    fee_amount      DECIMAL(28,8) DEFAULT 0,
    fee_currency    VARCHAR(10),
    -- M-Pesa specific
    mpesa_paybill   VARCHAR(20),
    mpesa_till      VARCHAR(20),
    mpesa_account   VARCHAR(50),
    mpesa_phone     VARCHAR(15),
    mpesa_receipt   VARCHAR(30),
    -- Blockchain specific
    chain           VARCHAR(20),
    tx_hash         VARCHAR(100),
    confirmations   INTEGER DEFAULT 0,
    -- Metadata
    ip_address      INET,
    device_id       VARCHAR(100),
    risk_score      DECIMAL(3,2),
    failure_reason  TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- M-Pesa Callback Records
CREATE TABLE mpesa_callbacks (
    id                  BIGSERIAL PRIMARY KEY,
    transaction_id      UUID REFERENCES transactions(id),
    merchant_request_id VARCHAR(50),
    checkout_request_id VARCHAR(50),
    result_code         INTEGER,
    result_desc         TEXT,
    mpesa_receipt       VARCHAR(30),
    phone               VARCHAR(15),
    amount              DECIMAL(18,2),
    raw_payload         JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Blockchain Deposits (detected by listener)
CREATE TABLE blockchain_deposits (
    id              BIGSERIAL PRIMARY KEY,
    chain           VARCHAR(20) NOT NULL,
    tx_hash         VARCHAR(100) NOT NULL,
    from_address    VARCHAR(100),
    to_address      VARCHAR(100) NOT NULL,
    amount          DECIMAL(28,8) NOT NULL,
    currency        VARCHAR(10) NOT NULL,
    confirmations   INTEGER DEFAULT 0,
    required_confirmations INTEGER NOT NULL,
    status          VARCHAR(20) DEFAULT 'detecting',
    -- detecting → confirming → confirmed → credited
    credited_at     TIMESTAMPTZ,
    block_number    BIGINT,
    block_hash      VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(chain, tx_hash)
);

-- Audit Log (immutable)
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID,
    action          VARCHAR(50) NOT NULL,
    entity_type     VARCHAR(30),
    entity_id       VARCHAR(50),
    details         JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- KYC Documents
CREATE TABLE kyc_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    document_type   VARCHAR(30), -- national_id, passport, selfie, kra_pin, proof_of_address
    file_url        VARCHAR(500),
    status          VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    rejection_reason TEXT,
    verified_by     UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Payment Orchestration (Saga Pattern)

The Paybill payment is a distributed transaction spanning crypto, internal ledger, and M-Pesa. We use the Saga pattern with compensating transactions:

```
PAYBILL PAYMENT SAGA:

Step 1: LOCK CRYPTO
  → Deduct crypto from user wallet, add to locked_balance
  → Compensate: Return locked crypto to user balance

Step 2: CONVERT CRYPTO → KES
  → Execute conversion at locked rate (via Yellow Card or internal pool)
  → Compensate: Reverse conversion, return crypto

Step 3: INITIATE M-PESA B2B PAYMENT
  → Call Daraja B2B API (BusinessPayBill CommandID)
  → Target: Paybill number + Account number
  → Amount: KES equivalent
  → Compensate: M-Pesa Reversal API (if payment succeeded but later step fails)

Step 4: AWAIT M-PESA CALLBACK
  → Daraja sends async callback with result
  → If success: Mark transaction complete, update ledger
  → If fail: Trigger compensation chain (Step 3 → 2 → 1)
  → If no callback within 60s: Query Transaction Status API

Step 5: RECORD & NOTIFY
  → Create ledger entries (debit user crypto, credit system KES, debit system KES for payment)
  → Send push notification + SMS confirmation
  → Log to audit trail
```

### KES Deposit Flow (M-Pesa → Crypto)

```
KES DEPOSIT — TWO CHANNELS:

Channel 1: STK Push (in-app initiated)
  → User enters KES amount + selects crypto in app
  → Backend creates rate-locked quote (30s TTL)
  → STK Push sent to user's phone
  → User enters M-Pesa PIN
  → Callback confirms payment
  → Crypto credited atomically (deterministic UUID for idempotency)

Channel 2: C2B Paybill (user-initiated from M-Pesa menu)
  → User opens M-Pesa → Lipa Na M-Pesa → Pay Bill
  → Enters CryptoPay shortcode + account ref (e.g., "USDT-0712345678")
  → Safaricom calls Validation URL → CryptoPay validates account + limits
  → Safaricom processes payment
  → Safaricom calls Confirmation URL → Celery task processes deposit
  → Live market rate applied (no pre-locked quote for C2B)
  → Crypto credited atomically + notifications sent

C2B Account Reference Formats:
  "USDT-0712345678"  → Deposit KES, receive USDT
  "BTC-254712345678"  → Deposit KES, receive BTC
  "ETH-0712345678"   → Deposit KES, receive ETH
  "SOL-0712345678"   → Deposit KES, receive SOL
  "CP-0712345678"    → Default: receive USDT

Security:
  - MSISDN must match registered CryptoPay phone
  - KYC-based daily deposit limits enforced
  - Idempotency on M-Pesa TransID (prevents double-credit)
  - Suspended accounts rejected at validation
  - Min/max deposit amount enforcement
```

### Timeout & Failure Handling

```
M-Pesa Callback Timeout (60s):
  → Query Transaction Status API
  → If completed: Process as success
  → If failed: Trigger compensation
  → If pending: Wait 30s more, retry status query (max 3 times)
  → If still unknown after 3 minutes: Flag for manual review, DON'T release funds

Double-Payment Prevention (3 layers):
  1. Client: Disable button after click, show spinner
  2. Redis: SET idempotency_key NX EX 300 (5 min lock)
  3. PostgreSQL: UNIQUE constraint on transactions.idempotency_key
```

---

## 5. M-Pesa Integration Details

### Endpoints We Need

| Endpoint | Purpose | When Used |
|----------|---------|-----------|
| **STK Push** | Collect KES from user (crypto buy) | User buys crypto with M-Pesa |
| **B2C** | Send KES to user's M-Pesa (crypto sell) | User sells crypto, sends to phone |
| **B2B** | Pay Paybill from our shortcode | User pays a Paybill from crypto |
| **Transaction Status** | Verify payment status | Callback timeout fallback |
| **Account Balance** | Monitor float | Automated float management |
| **Reversal** | Reverse failed payments | Compensation in saga |
| **C2B Register** | Register callback URLs | Initial setup |

### Float Management

CryptoPay needs a KES float in the Paybill account to execute B2B payments. This is the operational lifeblood:

```
Float Requirements:
  - Minimum float: KES 500,000 (~$3,800) for operations
  - Target float: KES 2,000,000 (~$15,000)
  - Auto-alert at KES 300,000 (low float warning)
  - Auto-top-up trigger at KES 200,000

Float Sources:
  1. User crypto sell orders (incoming KES from conversions)
  2. Manual bank transfer top-up
  3. Revenue from fees

Float Monitoring:
  - Check balance via Daraja Account Balance API every 5 minutes
  - Dashboard alert when below threshold
  - SMS/email alert to operations team
```

### Transaction Limits (Daraja)

```
Single B2B transaction: Max KES 250,000
Daily B2B limit: KES 500,000 per shortcode (can request increase)
STK Push: Max KES 250,000 per transaction
B2C: Max KES 250,000 per transaction
```

---

## 5.5 Liquidity Engine (Critical System)

The Liquidity Engine is CryptoPay's operational core. It manages two pools that enable instant crypto-to-KES payments without waiting for exchange settlement.

### Dual-Pool Model

```
┌──────────────────────┐    ┌──────────────────────┐
│     CRYPTO POOL       │    │      KES POOL         │
│                       │    │                       │
│  USDT: 20,000         │    │  M-Pesa Float:        │
│  BTC:  0.5            │    │  KES 2,000,000        │
│  ETH:  5.0            │    │                       │
│  SOL:  100            │    │  Bank Account:        │
│                       │    │  KES 3,000,000        │
└───────────┬───────────┘    └───────────┬───────────┘
            │                            │
            │    USER PAYS BILL          │
            │    ──────────────>         │
            │    Crypto pool +           │
            │    KES pool -              │
            │                            │
            │    USER BUYS CRYPTO        │
            │    <──────────────         │
            │    Crypto pool -           │
            │    KES pool +              │
            └────────────────────────────┘
```

### Threshold Alerts (4 Levels)

| Level | KES Float | Action |
|-------|-----------|--------|
| Healthy | > 1,500,000 | Normal operations |
| Warning | < 800,000 | Alert ops team, begin rebalance |
| Critical | < 500,000 | Auto-sell crypto, pause large payments (>50K) |
| Emergency | < 200,000 | Pause ALL outgoing payments, emergency top-up |

### Automated Rebalancing (Implemented March 13, 2026)

```
Rebalance State Machine:
  PENDING → SUBMITTED → SETTLING → COMPLETED
                                  → FAILED
                                  → CANCELLED

Trigger Sources:
  1. Periodic Celery task (every 5 min, checks float < KES 800K)
  2. Circuit breaker transition (CLOSED → HALF_OPEN/OPEN)
  3. Manual admin trigger (POST /api/v1/wallets/admin/rebalance/trigger/)

Execution Modes:
  MANUAL (current): Admin sells on Yellow Card dashboard, confirms via API
  API (future):     Automated via Yellow Card B2B API (just plug in API keys)

Flow:
  1. Float drops below KES 800K trigger
  2. Celery task creates RebalanceOrder (Redis-locked, idempotent)
  3. System calculates crypto sell amount (KES deficit / exchange rate)
  4. Admin notified via push + email with Yellow Card instructions
  5. Admin sells crypto, confirms settlement with actual KES received
  6. System updates SystemWallet (FLOAT/KES +, HOT/USDT -)
  7. Circuit breaker auto-resumes if float recovers

Safeguards:
  - Min rebalance: KES 50K | Max: KES 2M
  - 5-minute cooldown between orders
  - Auto-expire stale orders after 24h
  - Stale alerts after 4h
  - Redis lock prevents duplicate orders
  - Audit trail (AuditLog) for every state change
```

### Exchange Integration (Liquidity Sources) — Updated March 2026

| Provider | Priority | Fee | Settlement | API Docs |
|----------|----------|-----|-----------|----------|
| **Yellow Card API** | PRIMARY | 2% (M-Pesa), 1% (bank) | Real-time | docs.yellowcard.engineering |
| **Kotani Pay API** | SECONDARY | Custom | M-Pesa direct | docs.kotanipay.com |
| **Paychant** | TERTIARY | Custom | M-Pesa support | developer.paychant.com |
| **Internal pool** | INSTANT | N/A | Instant (pre-funded) | N/A |
| **OTC desks** | LARGE ORDERS | Negotiated | Same day | Contact Yellow Card OTC |

> **IMPORTANT:** Binance has NO P2P API for programmatic trading. Their P2P is manual-only with escrow. Do NOT plan to use Binance for automated off-ramp. Yellow Card API is the correct primary provider — they're Africa-native, support KES::Mobile (M-Pesa) disbursement, and process $3B+/year.
>
> **Yellow Card B2B Pivot (Jan 2026):** Yellow Card shut down their retail app Dec 31, 2025 and pivoted to enterprise/B2B only. Their API is now purpose-built for businesses like CryptoPay. Contact `paymentsapi@yellowcard.io` for KYB onboarding.
>
> **Kotani Pay:** Kenya-based, received strategic investment from Tether (Oct 2025). Supports USDT/USDC off-ramp to M-Pesa via API. Also offers USSD-based access for feature phones.

### Implementation Status (as of March 13, 2026)

| Component | Status | Details |
|-----------|--------|---------|
| **Float balance monitoring** | ✅ Implemented | `check_float_balance` Celery task every 5min + real-time SystemWallet sync |
| **SystemWallet FLOAT/KES tracking** | ✅ Implemented | M-Pesa balance synced to SystemWallet on every callback. Balance used by rebalancer. |
| **M-Pesa Account Balance API** | ✅ Implemented | Daraja integration in `mpesa/client.py`, called by float check task |
| **Threshold alerts (4 levels)** | ✅ Implemented | Circuit breaker (emergency/critical) + pre-alerts at 70%/50% of healthy threshold. Push + email to all staff. Redis-throttled (30min). |
| **Days-of-coverage monitoring** | ✅ Implemented | Computed from 24h outflow. Logged with <2 days warning. Shown in admin dashboard API. |
| **Rebalancing orchestrator** | ✅ Implemented | Full state machine, Celery tasks (periodic + breaker-triggered), Redis-locked, idempotent. Manual + API modes. |
| **RebalanceOrder model** | ✅ Implemented | Tracks: trigger, status, crypto sell details, actual settlement, slippage, exchange reference, audit trail. |
| **Admin rebalance API (6 endpoints)** | ✅ Implemented | Status, orders, trigger, confirm, fail, cancel — all admin-only. |
| **Mobile admin dashboard** | ✅ Implemented | Float Management screen with real-time status, order management, manual trigger. |
| **Circuit breaker → rebalance** | ✅ Implemented | Auto-fires `trigger_rebalance_from_breaker` Celery task on CLOSED→HALF_OPEN/OPEN. |
| **Emergency payment pause** | ✅ Implemented | 3-state circuit breaker with hysteresis, admin override, audit logging |
| **Exchange provider interface** | ✅ Implemented | Abstract interface with ManualExchangeProvider (now) and YellowCardAPIProvider stub (future) |
| **Yellow Card API integration** | ⚠️ Stub ready | Provider interface coded with full API endpoints documented. Needs API keys from `paymentsapi@yellowcard.io` |
| **Kotani Pay API integration** | ❌ Not implemented | Alternative off-ramp provider |
| **Bank account top-up flow** | ❌ Not implemented | Manual process — no API integration for bank transfers |

**Transaction Automation Status:**
1. **Deposits** (crypto in): ✅ Fully automated — 4 blockchain listeners (Tron/ETH/BTC/SOL)
2. **Payments** (crypto → M-Pesa): ✅ Fully automated — Payment Saga (Lock → Convert → B2B/B2C)
3. **Conversion** (crypto → KES): ✅ Internal pool (pre-funded KES float)
4. **Float replenishment**: ⚠️ Semi-automated — System detects low float, creates order, notifies admin. Admin sells on Yellow Card and confirms. Full automation when API keys available.

**Balance Deduction Flow (CRITICAL for production):**

When a user sends crypto via M-Pesa (B2C, B2B, or BuyGoods), the saga deducts crypto in Step 2:
```
Step 1: Lock   → wallet.locked_balance += amount (available decreases)
Step 2: Debit  → wallet.balance -= amount, locked_balance reset (actual deduction)
Step 3: M-Pesa → Initiate B2C/B2B API call, status = CONFIRMING
```

**On M-Pesa callback:**
- **Success (ResultCode=0):** Transaction marked COMPLETED, user notified.
- **Failure (any ResultCode≠0):** Transaction marked FAILED, saga `compensate_convert()` credits crypto back to user wallet.

**Test admin data uses pre-seeded balances** (set in `apps/wallets/admin.py`). In production:
- Users deposit crypto via blockchain → balance increases
- Users pay via M-Pesa → balance decreases (saga Step 2)
- Failed M-Pesa → balance restored (compensation)
- Total balance shown in app = `wallet.balance` (NOT `available_balance`)
- `available_balance = balance - locked_balance` is used for spend checks only

**Sandbox B2C Known Issues:**
- Safaricom sandbox locks initiator after ~5 failed credential attempts (ResultCode 8006)
- Lock is temporary (~30 min). No manual unlock available.
- Wrong cert = "initiator information is invalid" (ResultCode 2001)
- Always use the M-Pesa API cert (`CN=apicrypt.safaricom.co.ke`), NOT the TLS cert
- `MPESA_INITIATOR_PASSWORD=Safaricom123!!` and `MPESA_B2C_SHORTCODE=600987` for sandbox

**Financial Safety Measures (Hardened March 14, 2026):**

| Protection | Implementation | File |
|------------|---------------|------|
| **Double-credit/debit prevention** | DB unique constraint on `(transaction_id, wallet_id, entry_type)` | `wallets/models.py` |
| **Idempotent completion** | `complete()` checks tx.status before processing | `payments/saga.py` |
| **Atomic saga checkpoints** | `saga_data` writes inside same `db_transaction.atomic()` as step operations | `payments/saga.py` |
| **Callback status guards** | All M-Pesa callbacks skip already-terminal transactions | `mpesa/views.py` |
| **Atomic BUY credit** | STK callback wraps status update + crypto credit in single atomic block | `mpesa/views.py` |
| **B2C/B2B compensation** | Failed callbacks trigger `saga.compensate_convert()` to return crypto | `mpesa/views.py` |
| **Timeout recovery** | `TimeoutCallbackView` finds transaction and compensates | `mpesa/views.py` |
| **Stuck tx reconciliation** | Celery task auto-compensates CONFIRMING txns after 10 min | `payments/tasks.py` |
| **Quote consumption order** | Validate (daily limit, circuit breaker) BEFORE consuming locked quote | `payments/views.py` |
| **Address generation lock** | `select_for_update()` prevents orphaned deposit addresses | `wallets/views.py` |
| **Admin balance protection** | SystemWallet `balance` field is read-only in Django admin | `wallets/admin.py` |
| **Financial record deletion** | `has_delete_permission = False` on Wallet, SystemWallet, LedgerEntry | `wallets/admin.py` |
| **Circuit breaker safety** | Falls back to safe state (OPEN/HALF_OPEN) when Redis state missing + float low | `payments/circuit_breaker.py` |
| **Force resume warning** | Admin warned when force-resuming with float below emergency threshold | `payments/circuit_breaker.py` |
| **Hot wallet deficit alerting** | `CRITICAL` log when rebalance clamps hot wallet to zero due to deficit | `wallets/rebalance.py` |

**Known Remaining Items (deferred for production):**
- ETH/BTC blockchain listeners have duplicate task definitions in `eth_listener.py` + `tasks.py` — consolidate before production
- Blockchain high-water marks stored in volatile Redis cache — deposits may be missed after Redis restart (move to DB)
- Daily limit check has TOCTOU race under concurrent payments — acceptable for MVP, add `select_for_update` for high-volume
- Quote consumption uses non-atomic GET+DELETE — use Redis `GETDEL` or Lua script at scale

**Remaining gap for full automation:**
- Yellow Card API keys (KYB onboarding at `paymentsapi@yellowcard.io`)
- Implement `YellowCardAPIProvider.get_sell_quote()`, `execute_sell()`, `check_settlement()`
- Set `REBALANCE_EXECUTION_MODE=api` in settings
- Optional: Kotani Pay as secondary provider

### Liquidity Architecture — Where the Money Sits

Understanding where funds physically reside is key to reasoning about CryptoPay's float management:

**1. KES Float (M-Pesa Business Account)**
The KES that pays Paybills and Tills sits in the Safaricom Daraja shortcode's M-Pesa business account. `SystemWallet` with `wallet_type=FLOAT, currency=KES` is a **database mirror** of this balance, synced from M-Pesa balance callbacks. The source of truth is Safaricom; our DB tracks it for threshold checks, circuit breaker decisions, and dashboard display.

**2. Crypto Hot Wallet (HD Wallet)**
The platform's master HD wallet is derived from `WALLET_MNEMONIC` using BIP-44 derivation paths. User deposit addresses are child keys derived per-user per-currency. `SystemWallet` with `wallet_type=HOT` and `currency=USDT/BTC/ETH/SOL` tracks the platform's available crypto inventory for selling or converting.

**3. On-Chain Sweep (Deposit → HOT Consolidation)**
When a user deposits crypto to their HD-derived address, the blockchain listener credits the user's internal wallet. A separate **sweep pipeline** then consolidates those on-chain funds into the platform's central hot wallet:

1. **Scan** (every 15 min): `scan_and_create_sweep_orders` queries credited deposits, checks on-chain balances via RPC, estimates gas fees, and creates `SweepOrder` records (PENDING or SKIPPED).
2. **Execute** (every 5 min): `process_pending_sweeps` derives the BIP-44 private key in memory, signs the sweep transaction, broadcasts it, and zeros the key material.
3. **Verify** (every 3 min): `verify_submitted_sweeps` polls chain RPCs for confirmation counts. Stale sweeps (>2h unconfirmed) are auto-failed for investigation.
4. **Credit** (every 5 min): `credit_confirmed_sweeps` atomically increments `SystemWallet HOT/{currency}` via `F()` expressions and marks the order as CREDITED.

**Sweep decision criteria:**
- Balance must exceed dust minimum per currency (BTC: 0.0001, ETH: 0.005, USDT/USDC: $5, SOL: 0.1)
- Gas fees must not exceed 10% of balance
- Balance must be ≥10x the gas cost (for native token sweeps)
- No active sweep already in progress for the address (Redis lock + DB constraint)

**Security:** Private keys are derived in-memory from the HD seed (`WALLET_MNEMONIC`) using the same BIP-44 derivation path as deposit address generation. Keys are zeroed after signing. Rate limiting (10 sweeps/chain/min) and anomaly detection (50% balance drop triggers CRITICAL alert) provide additional safeguards.

**Supported chains:** Tron TRC-20 (fully implemented), Ethereum/Bitcoin/Solana (balance queries + fee estimation + verification implemented; signing stubs ready for web3.py/blockcypher/solders integration).

**Model:** `SweepOrder` tracks the full lifecycle: PENDING → ESTIMATING → SUBMITTED → CONFIRMING → CONFIRMED → CREDITED (or FAILED/SKIPPED). Unique constraint prevents duplicate active sweeps per address.

**4. Rebalance Flow (Crypto → KES)**
When the KES float drops below threshold:
1. System detects low float (Celery task or circuit breaker transition)
2. Creates a `RebalanceOrder` to sell crypto from HOT wallet
3. Admin sells on exchange (Yellow Card) — or future API automation does it
4. KES arrives in M-Pesa business account
5. `SystemWallet FLOAT/KES` incremented, `SystemWallet HOT/{crypto}` decremented (using `F()` expressions for atomicity)

**5. Double-Entry Tracking**
`SystemWallet` tracks platform-level pool balances (FLOAT and HOT). `LedgerEntry` provides a per-user audit trail with balanced DEBIT/CREDIT entries for every wallet mutation. Together they ensure every KES and every satoshi is accounted for at both the system and user level.

### CRITICAL Security Rule

**Never trust frontend transaction hashes.** CryptoPay MUST detect deposits itself via blockchain listener.

```
BAD:  User submits tx hash → Backend executes payment (ATTACKABLE)
GOOD: Blockchain listener detects tx → Verify address → Wait confirmations → Execute payment
```

Attack vectors this prevents: fake hashes, replace-by-fee attacks, dropped transactions.

---

## 5.6 Developer / B2B API (Phase 4)

Third-party developers will integrate CryptoPay payments via REST API:

### Endpoints

```
POST /api/v1/b2b/paybill
{
  "asset": "USDT",
  "amount_kes": 1500,
  "paybill": "888880",
  "account": "123456",
  "callback_url": "https://merchant.com/callback"
}

POST /api/v1/b2b/invoice
{
  "amount_kes": 5000,
  "asset": "USDT",
  "description": "School Fees - Term 2",
  "expires_in": 3600
}
→ Returns: deposit address, QR code, amount_crypto, expiry

POST /api/v1/b2b/payout
{
  "asset": "USDT",
  "amount_kes": 3000,
  "phone": "+254700000000"
}
→ Triggers B2C payout to user's M-Pesa
```

### API Pricing Tiers

| Tier | Monthly Volume | Fee |
|------|---------------|-----|
| Starter | < $10K | 2.0% |
| Growth | $10K-100K | 1.5% |
| Enterprise | > $100K | Negotiated |

---

## 6. Crypto Wallet Architecture

### HD Wallet System

Each user gets a unique deposit address per supported chain, derived from a master seed using BIP-32/44 hierarchy:

```
Master Seed (stored in HSM / encrypted at rest)
  └─ m/44'/0'/0'/0/0  → User 1 BTC address
  └─ m/44'/0'/0'/0/1  → User 2 BTC address
  └─ m/44'/60'/0'/0/0 → User 1 ETH/ERC-20 address
  └─ m/44'/60'/0'/0/1 → User 2 ETH/ERC-20 address
  └─ m/44'/195'/0'/0/0 → User 1 Tron/TRC-20 address
  └─ m/44'/501'/0'/0/0 → User 1 Solana address
```

### Hot / Warm / Cold Wallet Split

```
Hot Wallet (2-5% of total assets):
  - Automated, handles withdrawals and payments
  - Private keys in encrypted KMS (AWS KMS or Hashicorp Vault)
  - Max single tx: $5,000 equivalent
  - Auto-refill from warm wallet when below threshold

Warm Wallet (10-20% of total assets):
  - Multi-sig (2-of-3) — requires 2 team members to sign
  - Refills hot wallet on schedule or trigger
  - Max single tx: $50,000

Cold Wallet (75-90% of total assets):
  - Air-gapped, hardware wallet (Ledger/Trezor)
  - Multi-sig (3-of-5) — requires 3 of 5 key holders
  - Manual process for moving to warm wallet
  - Monthly rebalancing
```

### Supported Chains (Phased)

| Phase | Chains | Tokens | Rationale |
|-------|--------|--------|-----------|
| **MVP** | Tron, Polygon | USDT (TRC-20), USDC (Polygon) | Cheapest fees, highest African usage |
| **Phase 2** | Ethereum, Bitcoin | USDT/USDC (ERC-20), BTC | Major assets, higher fees |
| **Phase 3** | Solana, BSC, Arbitrum | SOL, USDT, various | Broader ecosystem |

### Blockchain Listener

```python
# Pseudocode for deposit detection
async def monitor_deposits():
    for chain in SUPPORTED_CHAINS:
        latest_block = get_latest_block(chain)
        our_addresses = get_all_deposit_addresses(chain)

        for tx in get_block_transactions(latest_block):
            if tx.to_address in our_addresses:
                # New deposit detected
                record_deposit(chain, tx)

        # Check confirmation progress for pending deposits
        for deposit in get_pending_deposits(chain):
            current_confirmations = latest_block - deposit.block_number + 1
            if current_confirmations >= REQUIRED_CONFIRMATIONS[chain]:
                credit_user_wallet(deposit)

# Required confirmations per chain (updated March 2026)
REQUIRED_CONFIRMATIONS = {
    'bitcoin': 3,       # ~30 min (use 6 for amounts >$10K)
    'ethereum': 'finalized',  # Post-Merge: wait for finalized epoch (~6.4 min)
                              # Old "12 blocks" rule is obsolete after PoS merge
    'tron': 19,         # ~1 min
    'polygon': 128,     # ~5 min
    'solana': 'finalized',    # Use "finalized" commitment level (~5-12.8s)
}

# Blockchain monitoring API providers
CHAIN_PROVIDERS = {
    'tron': 'TronGrid (free: 15 QPS, 100K req/day)',
    'ethereum': 'Alchemy (free: 30M CU/month) + Infura fallback',
    'bitcoin': 'BlockCypher (free: 3 req/sec, paid: $50/mo)',
    'solana': 'Helius (free: 1M credits, paid: $49/mo)',
}
```

> **NOTE (March 2026):** Ethereum confirmation counting changed after the Merge to Proof of Stake. Finality is now epoch-based, not block-count-based. Once a block is "finalized" (2 epochs, ~12.8 min), reverting it would require burning 1/3 of all staked ETH — effectively impossible. For moderate amounts, waiting for 1 finalized epoch (~6.4 min) is sufficient.

---

## 7. Rate Engine & Pricing

### Exchange Rate Composition

No exchange provides a direct crypto/KES rate. We compose it:

```
Crypto/KES Rate = Crypto/USD (CoinGecko) × USD/KES (Forex rate)

Example: USDT → KES
  USDT/USD = 1.0002 (CoinGecko)
  USD/KES = 129.50 (Yellow Card / forex API)
  Raw rate: 1.0002 × 129.50 = 129.53 KES per USDT

  + Platform spread: 1.5% = 131.47 KES
  + Network fee: 1 TRX (~0.15 KES) — absorbed for deposits
  + M-Pesa fee: KES 0-33 (passed through)

  User sees: 1 USDT = 131.47 KES (all-in rate)
```

### Fee Structure

| Operation | Fee | Notes |
|-----------|-----|-------|
| Crypto deposit | FREE | We absorb network fees |
| Crypto → Paybill/Till | 1.5% spread + KES 10 flat | Competitive vs 3-8% P2P |
| Crypto → M-Pesa (sell) | 1.5% spread | |
| M-Pesa → Crypto (buy) | 1.5% spread | |
| Internal transfer | FREE | Wallet-to-wallet |
| Crypto withdrawal | Network fee only | At-cost, no markup |

### Rate Locking

When user initiates a payment, lock the rate for 30 seconds:
```
1. User requests quote → Lock rate in Redis (TTL 30s)
2. User confirms → Check lock still valid
3. If expired → Re-quote with fresh rate
4. If valid → Execute at locked rate
```

---

## 8. Security Architecture

### Authentication Flow

```
Registration:
  Phone → OTP (SMS) → Set 6-digit PIN → Create account

Login:
  Phone + PIN → Device check → Session token (JWT)

Transaction Auth:
  PIN confirmation → Velocity check → Fraud score → Execute

High-value (>KES 50,000):
  PIN + OTP → Additional friction for safety
```

### Fraud Detection (3 tiers)

```
Tier 1 — Rule-based (Day 1):
  - Velocity: Max 5 Paybill payments per hour
  - Amount: Flag if >3x user's average transaction
  - New device: Require OTP for first transaction
  - Geographic: Flag if IP country ≠ Kenya
  - Rapid: Flag if <30s between transactions

Tier 2 — ML-based (Month 3+):
  - XGBoost model on transaction features
  - Training data: historical fraud patterns
  - Features: amount, frequency, time_of_day, device_age, kyc_tier
  - <200ms inference time requirement

Tier 3 — Graph-based (Month 6+):
  - Neo4j fraud ring detection
  - Identify connected accounts (shared devices, IPs, phone patterns)
  - Alert on suspicious clusters
```

### Double-Payment Prevention (Critical)

```
Layer 1 — Client:
  - Disable pay button after tap
  - Show "Processing..." overlay
  - Generate unique idempotency_key per payment attempt

Layer 2 — Redis:
  SET payment:{idempotency_key} "processing" NX EX 300
  If key exists → Return "Payment already in progress"

Layer 3 — PostgreSQL:
  INSERT INTO transactions (idempotency_key, ...)
  -- UNIQUE constraint prevents duplicates
  -- If violation → Return existing transaction status

Layer 4 — M-Pesa:
  - Each B2B call gets unique OriginatorConversationID
  - Check Transaction Status before retry
  - Never retry without confirming previous attempt failed
```

### Blockchain Deposit Security (Production Hardening)

**Implementation:** `apps/blockchain/security.py` + hardened `tasks.py`

#### 1. Dust Attack Prevention
Minimum deposit thresholds reject tiny transactions at detection time:

| Currency | Minimum | Rationale |
|----------|---------|-----------|
| BTC | 0.00005 BTC (~$5) | Filters UTXO dust |
| ETH | 0.002 ETH (~$5) | Blocks gas-burning attacks |
| USDT | $1.00 | Token dust filter |
| USDC | $1.00 | Token dust filter |
| SOL | 0.05 SOL (~$5) | Rent-exempt minimum |

Configurable via `MINIMUM_DEPOSIT_AMOUNTS` in settings.

#### 2. Amount-Based Confirmation Tiers
Larger deposits require more confirmations to prevent double-spend attacks:

| Chain | < $1K | < $10K | < $100K | >= $100K |
|-------|-------|--------|---------|----------|
| Bitcoin | 2 confs (~20 min) | 3 confs (~30 min) | 6 confs (~60 min) | 6 confs |
| Ethereum | 12 confs (~2.4 min) | 32 confs (~6.4 min, 1 epoch) | 64 confs (~12.8 min, 2 epochs) | 64 confs |
| Tron | 19 confs (solidified) | 19 | 19 | 19 |
| Solana | 32 slots (finalized) | 32 | 32 | 32 |

**Why fixed for Tron/Solana:** These chains have deterministic finality — once solidified/finalized, transactions cannot be reversed.

#### 3. Re-org Detection
For Ethereum deposits, the system verifies `block_hash` hasn't changed before crediting:
- If block hash mismatch detected → deposit reverted to `CONFIRMING` status
- Logged as CRITICAL alert for ops team investigation
- **Fail closed:** if verification fails, deposit is NOT credited

#### 4. Double-Credit Prevention
```
process_pending_deposits():
  1. SELECT ... FOR UPDATE on deposit row (row-level lock)
  2. Re-check status == CONFIRMED inside transaction
  3. Verify block hash (re-org detection)
  4. Validate address ownership (API response manipulation defense)
  5. Re-check dust threshold
  6. WalletService.credit() with its own SELECT FOR UPDATE
  7. Mark deposit as CREDITED atomically
```

#### 5. Address Validation
- Format validation per chain (regex patterns for Tron T-prefix, ETH 0x, BTC P2PKH/P2SH/Bech32, Solana Base58)
- Ownership verification: deposit address must exist in our `wallets` table
- Cross-chain confusion prevention

#### 6. Deposit Velocity Monitoring
- Configurable window (default: 20 deposits per 10 minutes per address)
- Detects automated spam/dust attack patterns
- Logged as CRITICAL alert, new deposits rejected until velocity normalizes

#### 7. Confirmation Monotonicity (Re-org Detection)
All 4 chain listeners (Tron, ETH, BTC, SOL) plus dedicated listeners (`eth_listener.py`, `btc_listener.py`, `sol_listener.py`) check that confirmation counts only increase. A decrease triggers:
- CRITICAL log alert with deposit ID and tx hash
- Deposit reverted to `CONFIRMING` for re-verification
- Prevents crediting during blockchain reorganizations

#### 8. Bitcoin RBF (Replace-By-Fee) Detection
BIP 125 RBF detection for unconfirmed BTC transactions:
- Checks input sequence numbers (`< 0xFFFFFFFE` = RBF signaled)
- RBF-signaled unconfirmed txs logged as WARNING
- Only matters for 0-conf; once 1+ confirmations, RBF is irrelevant
- System never credits 0-conf BTC (minimum 2 confirmations), so RBF is defense-in-depth

#### 9. Stablecoin Blacklist/Freeze Check (Production — On-Chain Verification)
USDT (Tether) and USDC (Circle) have centralized freeze capabilities:
- Tether: Frozen $3.3B+ across 7,268 addresses (as of 2025)
- Circle: Frozen $109M across 372 addresses

**Implementation:** Real on-chain contract calls via JSON-RPC/TronGrid:
- **USDT on Ethereum:** `eth_call` to `0xdAC17F958D2ee523a2206206994597C13D831ec7` → `isBlackListed(address)` (selector: `0xe47d6060`)
- **USDC on Ethereum:** `eth_call` to `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` → `isBlacklisted(address)` (selector: `0xfe575a87`)
- **USDC on Polygon:** `eth_call` to `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` → `isBlacklisted(address)` (selector: `0xfe575a87`)
- **USDT on Tron:** TronGrid `triggersmartcontract` to `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` → `isBlackListed(address)`

**Fail-open design:** If the RPC call fails, deposits are NOT blocked (availability over strictness). A false negative is acceptable; a false positive would freeze user funds. RPC failures are logged as warnings for ops monitoring.

**Future enhancement:** Integrate Chainalysis KYT or TRM Labs for OFAC/sanctions screening (see `docs/API-KEYS-AND-ACCOUNTS.md`).

#### 10. M-Pesa Callback Security (Multi-Layer Defense)

Safaricom Daraja API (v2 and v3, as of March 2026) does NOT sign callbacks. Anyone who discovers the callback URL can POST fake payment confirmations. Our defense:

| Layer | Implementation | File |
|-------|---------------|------|
| **1. IP Whitelist** | Only accept from Safaricom's `196.201.212-214.0/24` ranges | `apps/mpesa/middleware.py` |
| **2. Dynamic HMAC Tokens** | Per-transaction HMAC-SHA256 token embedded in callback URL path | `apps/mpesa/middleware.py` |
| **3. Replay Prevention** | Each token stored in Redis, consumed (deleted) on first use, 2hr TTL | `apps/mpesa/middleware.py` |
| **4. Schema Validation** | Reject payloads not matching expected Daraja format | `apps/mpesa/views.py` |
| **5. Post-Callback Verification** | Cross-verify via Transaction Status API for high-value txs | `apps/payments/saga.py` |

**Dynamic URL flow:**
```
1. initiate_payment() → generate_callback_token(tx_id, "b2b") → "a1b2c3d4..."
2. CallbackURL sent to Safaricom: /api/v1/mpesa/callback/b2b/a1b2c3d4.../
3. Callback arrives → verify_callback_token("a1b2c3d4...") → True + deletes from Redis
4. Second callback with same token → False (replay blocked)
```

#### 11. Deposit Address Uniqueness
- PostgreSQL `UniqueConstraint` on `deposit_address` (conditional: non-empty only)
- Prevents two wallets from sharing a deposit address
- Combined with BIP-44 deterministic derivation ensures address collision is impossible

---

## 8.5 Admin & User Management Architecture

### Role Hierarchy

```
Superuser (Django is_superuser)
  └── Can promote/demote staff
  └── Full platform access

Staff (is_staff = true)
  └── User management (list, search, filter)
  └── KYC document review (approve/reject with reason)
  └── KYC tier management (set 0-3)
  └── Account suspension (with mandatory reason)
  └── User detail view (wallets, transactions, devices, audit log)
  └── Float management & rebalance dashboard
  └── Platform stats (Django admin)

Regular User (is_staff = false)
  └── Standard app features
  └── Cannot access any /admin/ routes
```

### Account States

| State | Trigger | Effect | Reversible |
|-------|---------|--------|------------|
| **Active** | Default | Full access | — |
| **Suspended** | Admin action (with reason) | No transactions, no profile updates, login shows banner | Admin unsuspend |
| **Locked (PIN)** | 3+ wrong PIN attempts | OTP challenge required | Automatic on correct OTP |

### Suspension Enforcement Points

1. **Payments**: `IsNotSuspended` permission class on `PayBillView`, `PayTillView`, `SendMpesaView`, `BuyCryptoView`
2. **Profile updates**: Explicit 403 check in `ProfileView.patch()`
3. **PIN changes**: Explicit 403 check in `ChangePINView.post()`
4. **Frontend**: Red suspension banner on profile page with reason + contact support message
5. **JWT auth**: Tokens remain valid (user can log in to see status) but actions are blocked at view level

### KYC Document Review Workflow

```
User uploads document (national_id, passport, selfie, kra_pin, proof_of_address)
  → Status: "pending"
  → Admin opens user detail page → Overview tab → KYC Documents section
  → Admin clicks "View Document" to review uploaded file
  → Admin clicks "Approve" or "Reject"
    → If Reject: must enter reason (required)
  → Backend updates doc status, creates audit log
  → Notifications sent: Email + SMS + Push
    → Approved: "Your [doc] has been verified. Limits upgraded."
    → Rejected: "Your [doc] was not approved. Reason: [reason]. Please re-upload."
```

### Notification Matrix

| Event | Email | SMS | Push |
|-------|-------|-----|------|
| KYC doc approved | KYC status template | AT SMS | Expo push |
| KYC doc rejected (with reason) | KYC status template | AT SMS with reason | Expo push with reason |
| Tier upgraded | KYC status template | AT SMS with new limit | Expo push |
| Account suspended | Security alert template | AT SMS with reason | Expo push |
| Account unsuspended | Security alert template | AT SMS | Expo push |

### Admin API Endpoints

```
GET  /auth/admin/users/                    → User list + KYC distribution (staff)
POST /auth/admin/users/{id}/verify/        → Set KYC tier 0-3 (staff)
POST /auth/admin/users/{id}/suspend/       → Suspend/unsuspend with reason (staff)
GET  /auth/admin/users/{id}/detail/        → Full user detail + activity (staff)
POST /auth/admin/kyc/{doc_id}/review/      → Approve/reject KYC document (staff)
POST /auth/admin/users/{id}/promote/       → Promote/demote to staff (superuser only)
GET  /admin/stats/                         → Platform KPIs dashboard (Django admin)
```

### Frontend Admin Pages

| Page | Route | Protection | Purpose |
|------|-------|------------|---------|
| User Management | `/settings/admin-users` | `is_staff` guard + redirect | List/search/filter users, tier buttons, suspend buttons |
| User Detail | `/settings/admin-user-detail?id=` | `is_staff` guard + redirect | Tabbed view: overview, transactions, devices, audit log |
| Float Management | `/settings/admin-rebalance` | `is_staff` guard + redirect | Circuit breaker, rebalance orders, crypto balances |
| Platform Stats | External `/admin/stats/` | Django `@staff_member_required` | KPIs, system health, milestones |

All admin pages are hidden from non-staff users (not rendered in profile menu) AND protected by runtime `is_staff` checks with redirect to home.

---

## 9. Regulatory Compliance

### VASP Act 2025 (Act No. 20 of 2025) — Now Law

**Signed:** October 15, 2025 | **Gazetted:** October 21, 2025 | **Effective:** November 4, 2025

The VASP Act is Kenya's first comprehensive crypto regulation and the first in East Africa. Dual oversight:
- **CBK** — licenses stablecoins, custodial wallets, payment-related VASPs (this is CryptoPay)
- **CMA** — licenses exchanges, brokers, token issuers, market operators

**Penalties for non-compliance:** Fines up to KES 25 million (~$193,500) or imprisonment up to 5 years.

**Implementing regulations:** Being drafted by CBK/CMA as of March 2026 (expected mid-2026). Existing operators had 6-month transition window from Nov 2025.

### VASP License Requirements Checklist

| Requirement | How We Comply | Status |
|-------------|--------------|--------|
| Kenyan-incorporated company | Register "CryptoPay Technologies Ltd" via eCitizen | Required |
| Physical office in Kenya | Nairobi office (can be shared/virtual initially) | Required |
| Kenyan bank account | Open business account (Equity/KCB/NCBA) | Required |
| At least 1 Kenyan national director | Board composition requirement | Required |
| KYC/AML program | Smile Identity (36M+ Kenya ID records) + transaction monitoring | Required |
| FRC reporting | Designated Reporting Institution under POCAMLA — automated STR filing | Required |
| FATF Travel Rule | Originator/beneficiary data for transfers >$1,000 | Required |
| Cybersecurity policy + pentest | Penetration testing ($5-10K), encryption, access controls | Required |
| VASP license from CBK | Payment processor category — apply when regulations published | Required |
| Minimum paid-up capital | TBD in implementing regulations — budget KES 5-10M | Required |
| Client funds segregation | Trust account or insurance for user deposits | Required |
| Board-level governance | Compliance officer, board oversight of AML/CFT | Required |
| Regular audits | Annual compliance audit by approved auditor | Required |

### CRITICAL Legal Precedent: Lipisha/BitPesa v Safaricom (2015)

Safaricom terminated M-Pesa access for BitPesa (crypto remittance business) because BitPesa operated without CBK authorization. The Kenyan High Court upheld Safaricom's right to do so. **This means:**

1. **Get VASP license BEFORE applying for Daraja Paybill** — Safaricom will scrutinize crypto businesses
2. Position CryptoPay as "digital asset payment service" not "crypto exchange" in all applications
3. Having the VASP license in hand dramatically strengthens the Daraja go-live application
4. Without a license, Safaricom can legally terminate your Paybill at any time

The VASP Act now legitimizes crypto-M-Pesa relationships for **licensed** operators. Being among the first licensed VASPs is a significant competitive advantage.

### Tax Obligations (Updated March 2026)

| Tax | Rate | Applies To | Action |
|-----|------|-----------|--------|
| **Excise Duty** | 10% on service fees | All VASP fees/commissions | Collect from user, remit to KRA monthly |
| **Corporate Tax** | 30% on profits | Company income | Annual filing |
| **Capital Gains Tax** | 5% on crypto gains | User's responsibility | Provide tx history export |
| **Digital Asset Tax (3%)** | **REPEALED** | N/A | Was repealed effective July 1, 2025 |

```
Excise Duty Example:
  User pays KES 2,500 bill with USDT
  CryptoPay fee: 1.5% spread + KES 10 flat = KES 47.50
  Excise duty: 10% × KES 47.50 = KES 4.75
  User total fee: KES 52.25 (fee + excise)
  CryptoPay remits KES 4.75 to KRA via monthly iTax return
```

### Safaricom Daraja Requirements

```
1. Registered Kenyan business
2. Certificate of Incorporation
3. CR12 (directors/shareholders)
4. KRA PIN certificate
5. Bank account letter
6. Directors' IDs
7. Business application form
8. Signed Daraja Administrator form
9. Go-live approval: 24-72 hours typically
```

---

## 10. Brand Identity — CryptoPay

### Name Rationale
- "CryptoPay" — says exactly what it does: pay with crypto
- No trademark conflict with Safaricom's "M-" prefix
- "CryptoPay Kenya" for formal/legal use, "CryptoPay" for the app
- Short, memorable, easy to spell in English and Swahili contexts
- Domain options: cryptopay.co.ke, cryptopay.africa

### Brand Personality
- **Trustworthy**: Financial app = trust is everything. Clean, professional design
- **Simple**: Not a trading platform — it's a payment tool. Think M-Pesa, not Binance
- **Kenyan**: Designed for Kenya first. Swahili language support. Local references
- **Modern**: Fintech aesthetic — dark mode default, smooth animations, haptic feedback

### Color Palette (Premium Dark Theme v2.0)

```
Background:     #060E1F (Deep space navy — premium dark mode)
Card Surface:   #0C1A2E (Glass card base)
Elevated:       #162742 (Pressed/hover states)
Border:         #1E3350 (Subtle structural borders)

Primary:        #10B981 (Emerald 500 — vibrant, trustworthy, money-green)
Primary Light:  #34D399 (Emerald 400 — accent, active states)
Primary Dark:   #059669 (Emerald 600 — pressed primary)

Accent:         #F59E0B (Amber gold — premium, crypto association)
Info:           #3B82F6 (Blue — informational, secondary CTAs)
Error:          #EF4444 (Red — destructive, errors)
Success:        #10B981 (Same as primary — consistent success messaging)
Warning:        #F59E0B (Same as accent — alerts)

Text Primary:   #F0F4F8 (Near-white — headings, important content)
Text Secondary: #8899AA (Muted — body text, descriptions)
Text Muted:     #556B82 (Dim — hints, placeholders, captions)

Glass BG:       rgba(12, 26, 46, 0.8)  (Glassmorphism surfaces)
Glass Border:   rgba(255, 255, 255, 0.08) (Subtle card edges)
Glass Strong:   rgba(255, 255, 255, 0.14) (Focus rings, active borders)

Crypto Brands:
  USDT: #26A17B, BTC: #F7931A, ETH: #627EEA, SOL: #9945FF, KES: #10B981
```

### Typography
- **Headlines**: Inter Bold (28-38px, letter-spacing -0.5 to -1)
- **Body**: Inter Regular/Medium (14-16px)
- **Captions**: Inter Medium (11-12px, uppercase, letter-spacing 1-1.2)
- **Amounts**: Inter Bold (large sizes for financial figures)
- Font scaling: `maxFontSizeMultiplier={1.2-1.3}` to prevent layout breaks

### Logo Concept
```
   ╭─────╮
   │ C₿P  │  ← Shield shape (security + trust)
   ╰─────╯
   CryptoPay

Rendered: Wallet icon in 64x64 rounded-2xl emerald container
with 3-layer glow rings (96px, 76px, 64px) on auth screens
```

### App Design Language (Premium v2.0)
- **Glassmorphism**: Semi-transparent card surfaces with subtle white borders
- **Glass cards**: borderRadius 20-28, `rgba(255,255,255,0.08)` borders
- **Glow shadows**: Primary buttons emit green glow via `shadows.glow()`
- **Micro-animations**: Spring-based press states (scale 0.97-0.98, opacity 0.85-0.9)
- **Icon system**: Ionicons only — NO emoji characters. Kenya flag = "KE" text badge
- **Currency icons**: Unicode symbols (₿, Ξ, $, S, K) in crypto-brand-colored circles
- **Tab bar**: Glassmorphism with pill-shaped active indicator
- **Bottom navigation**: Home | Pay | Wallet | Profile (4 tabs)
- **Large touch targets**: 44-48px minimum (budget phone friendly)
- **Skeleton loading**: Smooth 1500ms shimmer pulse animations
- **Haptic feedback**: On PIN entry, transaction confirmation, clipboard copy
- **Pull-to-refresh**: On Home and Wallet screens
- **Rate ticker**: Pulsing LIVE dot, smooth crossfade between currencies

---

## 11. Mobile App Screens (Key Flows)

### Home Screen
```
┌────────────────────────────────┐
│ CryptoPay          🔔  ⚙️      │
│                                │
│ ┌────────────────────────────┐ │
│ │  Total Balance             │ │
│ │  KES 45,230.50             │ │
│ │  ≈ $349.46                 │ │
│ │                            │ │
│ │  USDT  230.50   BTC 0.002 │ │
│ │  ETH   0.15     SOL 2.4   │ │
│ └────────────────────────────┘ │
│                                │
│  [📥 Buy]  [📤 Sell]  [💳 Pay]│
│                                │
│ Quick Actions                  │
│ ┌──────┐ ┌──────┐ ┌──────┐   │
│ │ Pay  │ │ Send │ │ Buy  │   │
│ │ Bill │ │M-Pesa│ │Airtime│  │
│ └──────┘ └──────┘ └──────┘   │
│                                │
│ Recent Transactions            │
│ ├─ KPLC Prepaid  -KES 2,500  │
│ ├─ Buy USDT      +50 USDT   │
│ └─ Safaricom     -KES 1,000 │
│                                │
│ [Home] [Pay] [Wallet] [History]│
└────────────────────────────────┘
```

### Pay Bill Screen
```
┌────────────────────────────────┐
│ ←  Pay Bill                    │
│                                │
│ Paybill Number                 │
│ ┌────────────────────────────┐ │
│ │ 888880                     │ │
│ │ Kenya Power (KPLC)     ✓  │ │
│ └────────────────────────────┘ │
│                                │
│ Account Number                 │
│ ┌────────────────────────────┐ │
│ │ 12345678                   │ │
│ └────────────────────────────┘ │
│                                │
│ Amount (KES)                   │
│ ┌────────────────────────────┐ │
│ │ 2,500                      │ │
│ └────────────────────────────┘ │
│                                │
│ Pay With                       │
│ ┌────────────────────────────┐ │
│ │ 🟢 USDT (TRC-20)     ▼   │ │
│ │    Balance: 230.50 USDT    │ │
│ └────────────────────────────┘ │
│                                │
│ ┌────────────────────────────┐ │
│ │ Amount:    KES 2,500.00    │ │
│ │ Rate:      1 USDT = 131.47│ │
│ │ Crypto:    19.02 USDT     │ │
│ │ Fee:       KES 47.50      │ │
│ │ Excise:    KES 4.75       │ │
│ │ ─────────────────────────  │ │
│ │ Total:     19.42 USDT     │ │
│ └────────────────────────────┘ │
│                                │
│ ┌────────────────────────────┐ │
│ │       PAY KES 2,500        │ │
│ │   ████████████████████████ │ │
│ └────────────────────────────┘ │
│                                │
│ → Slide to pay (haptic)       │
└────────────────────────────────┘
```

### Payment Confirmation
```
┌────────────────────────────────┐
│                                │
│           ✅                   │
│     Payment Successful!        │
│                                │
│ ┌────────────────────────────┐ │
│ │ To:      Kenya Power       │ │
│ │ Paybill: 888880            │ │
│ │ Account: 12345678          │ │
│ │ Amount:  KES 2,500.00      │ │
│ │ Paid:    19.42 USDT        │ │
│ │ M-Pesa:  SHK3A7B2C1       │ │
│ │ Time:    14:32:05 EAT      │ │
│ │ Ref:     MCR-20260307-4521 │ │
│ └────────────────────────────┘ │
│                                │
│ [📋 Copy Receipt] [📤 Share]  │
│                                │
│ ┌────────────────────────────┐ │
│ │        Done                │ │
│ └────────────────────────────┘ │
└────────────────────────────────┘
```

---

## 12. Infrastructure & Deployment

### MVP Infrastructure (Month 1-3) — Updated March 2026

```
Kenyan VPS (Lineserve or Truehost, Nairobi — 8 CPU, 16GB RAM)
  - Docker Compose
  - PostgreSQL 16
  - Redis 7
  - Django + Gunicorn (4 workers)
  - Celery (2 workers: default + blockchain)
  - Celery Beat
  - Nginx reverse proxy
  - Certbot (Let's Encrypt SSL — NOTE: moving to 45-day certs May 2026)
  - Cloudflare Free in front (CDN + DDoS + DNS)
  - Prometheus + Grafana (self-hosted monitoring)
  - Sentry Free (5K errors/month)
  - UptimeRobot Free (50 monitors)

Estimated cost: $50-85/month
  - VPS: ~$30-50/mo (Nairobi DC, M-Pesa payment accepted)
  - AWS KMS: ~$2-3/mo (wallet key encryption)
  - SSL, CDN, monitoring, email, push: all free tier
  - SMS: ~$5-20/mo (Africa's Talking, KSh 0.40-0.60/SMS)

Note: Hetzner/Contabo are cheaper (~$12-20/mo) but have no Africa DC
(~150-200ms latency to Nairobi). For fintech, latency matters.
Alternative: AWS Cape Town (af-south-1) at ~$160/mo for better reliability.
```

### Production Infrastructure (Month 6+)

```
AWS Cape Town (af-south-1) or Kubernetes cluster
  - API: 3 replicas, auto-scale to 10
  - Celery workers: 2 default, 2 blockchain, 1 M-Pesa
  - Managed PostgreSQL (RDS or equivalent)
  - Managed Redis (ElastiCache)
  - S3 for KYC documents
  - Prometheus + Grafana monitoring
  - Sentry Team ($26/mo)
  - Better Stack for incident management ($24/mo)

Estimated cost: $200-500/month
```

---

## 13. Monitoring & Observability (Prometheus + Grafana)

### Stack

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| Prometheus | `prom/prometheus:v2.55.0` | 9090 | Metrics collection, alerting |
| Grafana | `grafana/grafana:11.4.0` | 3001 | Dashboards, visualization |
| Alertmanager | `prom/alertmanager:v0.28.1` | 9093 | Alert routing (Slack, PagerDuty) |
| postgres-exporter | `prometheuscommunity/postgres-exporter:v0.16.0` | 9187 | PostgreSQL metrics |
| redis-exporter | `oliver006/redis_exporter:v1.67.0` | 9121 | Redis metrics |
| celery-exporter | `danihodovic/celery-exporter:0.10.9` | 9808 | Celery task metrics |

### Django Integration

- `django-prometheus==2.3.1` middleware wraps all requests (latency, status codes, view-level metrics)
- Prometheus-instrumented DB backend (`django_prometheus.db.backends.postgresql`)
- **Critical**: Do NOT enable Django 5.1 `pool: True` with django-prometheus (GitHub issue #445 — causes severe performance degradation)
- Custom metrics in `backend/apps/core/metrics.py`: 20+ business-specific counters, gauges, histograms

### Custom Business Metrics

```
cryptopay_payment_{initiated,completed,failed}_total    — Payment lifecycle by currency/type
cryptopay_payment_amount_kes                             — Amount distribution histogram
cryptopay_payment_processing_seconds                     — End-to-end processing time
cryptopay_mpesa_float_balance_kes                        — Real-time float gauge
cryptopay_mpesa_callback_latency_seconds                 — M-Pesa API response time
cryptopay_deposit_{detected,confirmed}_total             — Blockchain deposit tracking
cryptopay_sweep_{initiated,completed,failed}_total       — Sweep pipeline health
cryptopay_hot_wallet_balance                             — Per-currency hot wallet balance
cryptopay_exchange_rate_stale                             — 1 if rates >5min old
cryptopay_circuit_breaker_state                          — 0=closed, 1=half-open, 2=open
cryptopay_login_attempts_total                           — Auth security monitoring
```

### Alert Rules (15+ rules, 5 groups)

| Alert | Condition | Severity |
|-------|-----------|----------|
| HighAPIErrorRate | >5% 5xx in 5min | critical |
| SlowAPIResponse | p95 >2s | warning |
| HighPaymentFailureRate | >10% failures in 10min | critical |
| MpesaFloatCritical | <KES 500,000 | critical |
| MpesaFloatEmergency | <KES 200,000 | page |
| ExchangeRatesStale | >5min old | critical |
| CircuitBreakerOpen | state=OPEN | critical |
| BlockchainListenerDown | 0 deposits for 1h | warning |
| CeleryWorkersDown | 0 workers alive | critical |
| PostgresConnectionsHigh | >80% of max | warning |
| RedisMemoryHigh | >85% used | warning |

### Deployment

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up --build
```

### Security

- `/metrics` endpoint should be IP-restricted in production (internal networks only)
- Grafana: `GF_USERS_ALLOW_SIGN_UP=false`, strong admin password via env var
- Prometheus/Alertmanager ports should NOT be exposed externally in production
- Use `PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus_multiproc` with gunicorn

---

## 14. Custody Architecture (Hot/Warm/Cold Wallet Split)

### Fund Distribution

| Tier | % of Funds | Access Speed | Security | Purpose |
|------|-----------|--------------|----------|---------|
| **Hot** | 2-5% | Instant | Encrypted key in Vault/KMS | Active withdrawals, M-Pesa payouts, gas fees |
| **Warm** | 10-20% | Minutes-hours | 2-of-3 multisig | Daily operational float, auto-replenishment |
| **Cold** | 75-90% | Hours-days (manual) | Hardware wallet, 3-of-5 Shamir | Long-term reserves, regulatory compliance |

### Implementation

```
Deposit Addresses → [sweep] → Hot Wallet → [threshold trigger] → Warm Wallet → [manual] → Cold Wallet
                                    ↑                                    |
                                    └──── [auto-replenish] ──────────────┘
```

**Models:**
- `SystemWallet.tier` — HOT/WARM/COLD classification
- `CustodyTransfer` — Audit trail for all tier-to-tier transfers (from_tier, to_tier, amount, status, tx_hash, initiated_by)

**Automated Thresholds (Celery Beat, every 15min):**
- Hot wallet > 150% of daily average → sweep excess to warm
- Hot wallet < 50% of daily average → replenish from warm
- Warm wallet > target allocation → alert ops for cold transfer

**Admin API:**
- `GET /wallets/custody/report/` — Full custody report (staff only)
- `POST /wallets/custody/rebalance/` — Manual rebalance trigger (staff only)

### Launch Plan

| Phase | Timeline | Action |
|-------|----------|--------|
| Phase 1 (launch) | Week 1-2 | Deploy HashiCorp Vault (Docker), migrate WALLET_MNEMONIC from env var, separate hot wallet addresses per chain |
| Phase 2 (warm) | Week 3-4 | Safe{Wallet} 2-of-3 multisig (EVM), Bitcoin/Tron native multisig |
| Phase 3 (cold) | Week 5-6 | Ledger Nano X hardware wallets, SLIP-39 Shamir backup (3-of-5 shares in separate locations) |
| Phase 4 (scale) | 6mo+ | Evaluate Dfns/Fireblocks MPC when >$100K monthly volume |

### Kenya VASP Act 2025 Compliance

- **Dual control of private keys** — multisig satisfies this requirement
- **Segregation of client assets** — separate wallets for client vs operational funds
- **Disaster recovery plans** — Shamir shares in geographically distributed locations
- **Proof of reserves** — periodic on-chain balance reconciliation (already implemented)

### Cost

| Item | Cost |
|------|------|
| HashiCorp Vault (self-hosted Docker) | $0 |
| Safe{Wallet} deployment (EVM) | Gas fees only (~$50-100) |
| 2x Ledger Nano X | ~$300 |
| Shamir backup materials (steel plates) | ~$50 |
| **Total launch cost** | **~$400 + gas** |

---

## 15. Research Verdicts

### ERC-4337 Account Abstraction — NOT NEEDED

| Factor | Assessment |
|--------|-----------|
| CryptoPay model | Custodial — platform holds keys, users never send on-chain transactions |
| TRON support | TRON (primary USDT chain) does NOT support ERC-4337 |
| Gas abstraction | Already handled by sweep system (platform pays all gas) |
| Recommendation | Phase 3+ consideration only if switching to non-custodial model |

### Dollar-Denominated Yield — DEFERRED (Regulatory Block)

| Factor | Assessment |
|--------|-----------|
| Sustainable yield | 4-7% APY real yield from Aave V3 / Compound V3 (lending demand) |
| Kenya VASP Act 2025 | Law effective Nov 4, 2025 — but NO licenses issued, NO implementing regulations |
| User-facing yield | Likely requires VA Manager license (CMA) or deposit-taking license (CBK) |
| Treasury yield | Legal gray area, likely OK with strict fund segregation |
| Timeline | Treasury yield now; user-facing after VASP licensing operational (est. 2027) |
| Risk management | Max 30% of float deployed, multi-protocol diversification, Nexus Mutual coverage |
| Insurance | Crypto custody insurance requires $1M+ AUC minimum; self-insure with 5-10% SAFU reserve |

---

## 16. Development Phases

### Phase 1: MVP (Weeks 1-8)
**Goal: Crypto → Paybill/Till payment working end-to-end**

- [ ] Django project setup with auth (phone + PIN)
- [ ] User registration with basic KYC (Tier 1)
- [ ] USDT (TRC-20) wallet — deposit detection, balance
- [ ] Rate engine (CoinGecko + forex API)
- [ ] M-Pesa Daraja integration (B2B for Paybill, STK Push for buy)
- [ ] Payment saga orchestration
- [ ] Double-payment prevention (3 layers)
- [ ] Transaction history
- [ ] React Native app — Home, Pay Bill, Wallet, History
- [ ] Web dashboard for monitoring
- [ ] Deploy to VPS

### Phase 2: Full Product (Weeks 9-16)
**Goal: Multi-crypto, sell flow, polish**

- [ ] Add USDC (Polygon), BTC, ETH support
- [ ] Sell flow (crypto → M-Pesa B2C)
- [ ] Buy flow (M-Pesa STK Push → crypto)
- [ ] Till number payments
- [ ] Send to M-Pesa (phone number)
- [ ] Buy airtime from crypto
- [ ] Push notifications
- [ ] Saved Paybills / favorites
- [ ] Full KYC tiers (Smile Identity)
- [ ] Admin compliance dashboard
- [ ] Fraud detection (rule-based)

### Phase 3: Scale (Weeks 17-24)
**Goal: Growth features, regulatory compliance**

- [ ] VASP license application
- [ ] USSD interface (feature phone users)
- [ ] Merchant QR code payments
- [ ] Referral program
- [ ] SOL, BSC chain support
- [ ] ML fraud detection
- [ ] Automated reconciliation
- [ ] KRA tax reporting integration
- [ ] Multi-language (English + Swahili)
- [ ] Kubernetes migration

---

## 17. Revenue Model

```
Primary Revenue:
  1. Spread on conversion: 1.5% (crypto ↔ KES)
     At KES 10M monthly volume → KES 150,000/month revenue
     At KES 100M monthly volume → KES 1.5M/month revenue

  2. Flat fee per Paybill/Till: KES 10-20 per transaction
     At 10,000 tx/month → KES 100,000-200,000/month

Secondary Revenue:
  3. Withdrawal fees (at-cost markup)
  4. Premium features (higher limits, priority support)
  5. B2B API (other apps use CryptoPay for crypto payments)
  6. Float yield (interest on KES float in bank account)

Cost Structure:
  - M-Pesa fees: ~0.5% per B2B transaction
  - Blockchain network fees: Variable (absorbed for deposits)
  - Liquidity provider fees: 0.1-0.5% (Yellow Card / exchange)
  - Infrastructure: $50-500/month
  - KYC provider: $0.10-0.50 per verification
  - SMS OTP: KES 0.50-1 per message
```

---

## 18. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| VASP license denied | HIGH | Start with legal counsel, regulatory sandbox, prepare documentation early |
| Safaricom blocks crypto-related Paybills | HIGH | Register Paybill under compliant fintech category, not "crypto exchange" |
| M-Pesa float runs out | HIGH | Automated monitoring, multi-source top-up, daily reconciliation |
| Exchange rate volatility during payment | MEDIUM | 30-second rate lock, instant execution, hedging for large amounts |
| Blockchain network congestion | MEDIUM | Support multiple chains (Tron+Polygon as primary — cheap+fast) |
| User account fraud/takeover | HIGH | Device binding, PIN + OTP, velocity checks, suspicious login alerts |
| Regulatory change | MEDIUM | Legal counsel on retainer, modular architecture (can pivot features) |
| Competition from Yellow Card / Luno adding bill pay | MEDIUM | First-mover advantage, focus on UX, build network effects |
| Crypto bear market | LOW | Stablecoin-first approach (USDT/USDC), not dependent on speculation |
