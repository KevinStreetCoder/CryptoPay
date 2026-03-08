# CryptoPay — Development Progress

**Last updated:** 2026-03-08

---

## Phase 1 MVP — Status Overview

### Backend (Django 5 + DRF) — COMPLETE ✅

| Component | Status | Notes |
|-----------|--------|-------|
| Project scaffolding | ✅ Done | Django 5.1.4, DRF, Celery, Docker Compose |
| Custom User model (phone-based) | ✅ Done | UUID PK, bcrypt PIN hash, KYC tiers 0-3 |
| Phone + PIN + OTP auth | ✅ Done | Africa's Talking SMS, progressive lockout |
| Google OAuth login | ✅ Done | `google-auth` token verification, auto user creation |
| JWT tokens (access + refresh) | ✅ Done | 15min access, 1d refresh, rotation + blacklist |
| Device fingerprinting | ✅ Done | Device model, trust management, new-device detection |
| Multi-currency wallets | ✅ Done | USDT, BTC, ETH, SOL, KES per user |
| Double-entry ledger | ✅ Done | Balanced DEBIT/CREDIT entries, atomic `select_for_update` |
| Lock/unlock funds | ✅ Done | Separate `locked_balance` for pending transactions |
| Rate engine (CoinGecko + forex) | ✅ Done | Composed rate, 1.5% spread, KES 10 flat fee |
| Rate locking (30s quotes) | ✅ Done | Redis TTL, unique quote_id |
| M-Pesa Daraja client | ✅ Done | OAuth, STK Push, B2B, B2C, BuyGoods, Status, Reversal |
| RSA SecurityCredential | ✅ Done | `cryptography` lib, Safaricom cert encryption |
| Payment Saga pattern | ✅ Done | Lock → Convert → M-Pesa B2B, with compensation |
| 3-layer idempotency | ✅ Done | Client UUID → Redis SET NX → PostgreSQL UNIQUE |
| KYC daily limits | ✅ Done | Tier-based enforcement (5K/50K/250K/1M KES) |
| M-Pesa callback handlers | ✅ Done | STK, B2B, B2C, Timeout — all with audit logging |
| M-Pesa IP whitelist middleware | ✅ Done | Safaricom IP ranges, configurable via settings |
| Blockchain deposit tracking | ✅ Done | State machine: detecting → confirming → credited |
| Transaction history API | ✅ Done | Paginated, filtered by type/status |
| Health check endpoint | ✅ Done | DB, Redis, Celery status at `/health/` |
| Admin dashboard | ✅ Done | Transaction admin with filters, CSV export, review actions |
| Management commands | ✅ Done | `seed_system_wallets`, `check_float_balance` |
| Custom throttling | ✅ Done | PIN, Transaction, OTP, SensitiveAction throttles |
| Audit logging | ✅ Done | Immutable AuditLog, middleware for request context |
| Production settings | ✅ Done | SSL, HSTS, WhiteNoise, Sentry, JSON logging, DB pooling |
| Docker Compose | ✅ Done | PostgreSQL 16, Redis 7, web, celery, celery-beat, health checks |
| Tests (35+) | ✅ Done | Auth, wallets, saga, idempotency, daily limits, rates |

### Frontend (React Native + Expo) — COMPLETE ✅

| Component | Status | Notes |
|-----------|--------|-------|
| Expo project setup | ✅ Done | Expo SDK 55, TypeScript, expo-router |
| NativeWind + Tailwind | ✅ Done | Custom color palette, metro config, babel config |
| EAS Build config | ✅ Done | Development, preview, production profiles |
| Design system | ✅ Done | Dark theme, teal primary, amber accent, Inter font |
| API client (axios) | ✅ Done | JWT auto-refresh, platform-aware base URLs |
| Auth store | ✅ Done | SecureStore tokens, login/register/logout |
| Error boundary | ✅ Done | Friendly error UI with retry |
| Network status banner | ✅ Done | Offline detection with connectivity check |
| Loading screen | ✅ Done | Branded splash with animated logo |
| Auth gate | ✅ Done | Redirect to login if unauthenticated |
| **Home screen** | ✅ Done | Balance card, promo banner, rate ticker, quick actions, recent transactions |
| **Pay screen** | ✅ Done | Pay Bill, Buy Goods, Send M-Pesa options with "how it works" |
| **Wallet screen** | ✅ Done | Portfolio value, crypto cards with KES equivalent, deposit modal, QR placeholder, copy address |
| **Profile screen** | ✅ Done | User card, KYC tier display, settings menu, logout |
| **Login screen** | ✅ Done | Phone → PIN two-step flow |
| **Register screen** | ✅ Done | Phone → OTP → Name → PIN with step indicator |
| **Pay Bill flow** | ✅ Done | Paybill + account + amount + crypto selector + rate lock |
| **Pay Till flow** | ✅ Done | Till number + amount + crypto selector + rate lock |
| **Confirm payment** | ✅ Done | Review summary + PIN confirmation with haptics |
| **Success screen** | ✅ Done | Success animation with payment details |
| Reusable components | ✅ Done | PinInput, BalanceCard, TransactionItem, Button, QuickAction, AmountInput, CurrencySelector, StatusBadge, Header, RateTicker |
| Biometric auth hook | ✅ Done | expo-local-authentication wrapper |

---

## What's NOT Done Yet (Phase 1 Remaining)

### Backend
- [ ] **Blockchain listener implementation** — `monitor_tron_deposits()` is TODO (needs TronGrid API polling)
- [ ] **HD wallet derivation** — Generate deposit addresses per user (BIP-44 for BTC, Tron address derivation)
- [ ] **KYC document upload** — Model exists but no upload endpoint yet
- [ ] **KYC verification integration** — Smile Identity API integration
- [ ] **M-Pesa STK Push for deposits** — Client method exists, needs deposit flow view
- [ ] **Float monitoring alerts** — `check_float_balance` command exists, needs Celery scheduling + alerts
- [ ] **Email notifications** — No email service configured yet
- [ ] **Swagger/OpenAPI docs** — No API documentation endpoint (add `drf-spectacular`)
- [ ] **CI/CD pipeline** — No GitHub Actions yet

### Frontend
- [ ] **Google Sign-In integration** — Backend ready, mobile needs `@react-native-google-signin`
- [ ] **Biometric unlock** — Hook exists, needs integration into app launch flow
- [ ] **Push notifications** — No push notification setup yet
- [ ] **Transaction detail screen** — Clicking a transaction should show full details
- [ ] **QR code generation** — Using placeholder icon, needs `react-native-qrcode-svg`
- [ ] **Deposit flow** — Needs crypto deposit instructions + address sharing
- [ ] **KYC verification flow** — Photo capture + document upload screens
- [ ] **Settings screens** — Change PIN, biometric toggle, notification preferences
- [ ] **Onboarding tour** — First-time user walkthrough
- [ ] **Localization** — English + Swahili support

### Infrastructure
- [ ] **VPS deployment** — Hetzner/Contabo setup
- [ ] **SSL certificates** — Cloudflare or Let's Encrypt
- [ ] **Domain setup** — cryptopay.co.ke / mcrypto.co.ke
- [ ] **Monitoring** — Sentry (config ready), Grafana/Prometheus
- [ ] **Backup strategy** — PostgreSQL automated backups
- [ ] **Rate limiting at proxy** — Nginx/Cloudflare rate limiting

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Mobile App (Expo)                      │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                   │
│  │ Home │ │ Pay  │ │Wallet│ │Profile│                   │
│  └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘                   │
│     └────────┴────────┴────────┘                         │
│              │ Axios + JWT                               │
└──────────────┼───────────────────────────────────────────┘
               │
       ┌───────▼────────┐
       │  Django REST API │ ← gunicorn (4 workers)
       │  /api/v1/*       │
       └───────┬──────────┘
               │
    ┌──────────┼───────────────────┐
    │          │                   │
┌───▼───┐ ┌───▼───┐ ┌────────────▼──────────┐
│ PostgreSQL│ │ Redis │ │ Celery Workers        │
│ (users,   │ │ (cache,│ │ - Rate refresh (30s)  │
│  wallets, │ │ tokens,│ │ - M-Pesa status check │
│  txns,    │ │ quotes,│ │ - Blockchain monitor  │
│  ledger)  │ │ locks) │ │ - Float alerts        │
└───────────┘ └───────┘ └───────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
    ┌──────▼──────┐  ┌───────▼───────┐  ┌──────▼──────┐
    │ Safaricom   │  │ CoinGecko     │  │ TronGrid    │
    │ Daraja API  │  │ Rate API      │  │ Blockchain  │
    │ (M-Pesa)    │  │               │  │ Explorer    │
    └─────────────┘  └───────────────┘  └─────────────┘
```

---

## Test Results

**Backend: 35+ tests passing**
- 4 auth tests (PIN hash, normalization, superuser, lockout)
- 4 Google OAuth tests (valid token, invalid token, new user, existing user)
- 4 device tests (registration, list, duplicate, untrusted)
- 6 progressive lockout timing tests
- 7 wallet tests (credit, debit, insufficient, lock, unlock, transfer, create)
- 7 saga tests (lock, compensate, convert, full success, full failure)
- 2 double-payment tests (Redis, PostgreSQL unique)
- 5 daily limit tests (tier enforcement, failed exclusion, processing inclusion)
- 2 rate quote expiry tests
- 4 rate composition tests
- 2 spread calculation tests
- 3 quote locking tests

---

## How to Run

### Backend (Docker)
```bash
# Development (with runserver):
cd CryptoPay
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Production (with gunicorn):
docker compose up --build

# Run migrations:
docker compose exec web python manage.py migrate

# Create superuser:
docker compose exec web python manage.py createsuperuser

# Seed system wallets:
docker compose exec web python manage.py seed_system_wallets

# Run tests:
docker compose exec web pytest -v
```

### Frontend (Expo)
```bash
cd CryptoPay/mobile

# Install dependencies:
npm install --legacy-peer-deps

# Start dev server:
npx expo start

# Build for production:
eas build --platform android --profile production
eas build --platform ios --profile production
```

---

## File Count Summary

**Backend:** 50+ Python files across 7 apps
**Frontend:** 30+ TypeScript/TSX files
**Docs:** 7 documentation files
**Config:** Docker, EAS, Tailwind, Metro, Babel, TypeScript configs
