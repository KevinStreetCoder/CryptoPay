# M-Crypto

**Pay any Kenyan bill with cryptocurrency — instantly.**

M-Crypto bridges cryptocurrency and Kenya's M-Pesa ecosystem, enabling users to pay Paybill numbers, Till numbers, and send money using USDT, BTC, ETH, and SOL. No more selling crypto on P2P, waiting for KES, then manually paying bills.

```
Paybill Number → Amount (KES) → Select Crypto → Done ✅
```

---

## The Problem

Kenya has **40M+ M-Pesa users** and a rapidly growing crypto community (**733K+ users**). Yet paying a simple electricity bill with crypto requires:

1. List crypto on P2P exchange
2. Wait for buyer (5-30 min)
3. Receive KES to M-Pesa
4. Manually pay the bill

**That's 3-8% in fees and 30+ minutes of friction.**

## The Solution

M-Crypto reduces this to **one step, 30 seconds, 1.5% fee**:

- Enter your Paybill/Till number and amount
- We lock the exchange rate for 30 seconds
- Your crypto is converted and the bill is paid via M-Pesa
- You get an M-Pesa receipt instantly

---

## Features

### For Users
- **Pay Any Bill** — KPLC, DSTV, Water, Internet, NHIF, KRA, and 1000+ Paybill merchants
- **Buy Goods** — Pay any merchant via Till number
- **Multi-Crypto** — USDT, BTC, ETH, SOL support
- **Real-Time Rates** — Live crypto/KES rates with transparent 1.5% spread
- **Rate Locking** — 30-second guaranteed quote, no slippage
- **KES-First Display** — Always shows amounts in KES (what Kenyans think in)
- **Instant M-Pesa Receipt** — Standard M-Pesa confirmation SMS

### Security
- **Phone + PIN Authentication** — Familiar M-Pesa-style security
- **Biometric Login** — Fingerprint and Face ID support
- **Progressive Lockout** — Automatic lockout after failed PIN attempts
- **KYC Tiered Limits** — Transaction limits based on verification level
- **Double-Entry Ledger** — Every transaction is auditable and balanced
- **Idempotency Protection** — No duplicate payments, ever

### Technical
- **Saga Pattern** — Distributed transactions with automatic rollback
- **Real-Time Monitoring** — Health checks, structured logging, error tracking
- **Enterprise Admin** — Full transaction management dashboard

---

## Architecture

```
┌─────────────────────┐
│   Mobile App        │  React Native + Expo
│   (iOS / Android)   │  NativeWind, TanStack Query
└─────────┬───────────┘
          │ HTTPS + JWT
┌─────────▼───────────┐
│   REST API          │  Django 5 + DRF
│   /api/v1/*         │  gunicorn, WhiteNoise
└─────────┬───────────┘
          │
  ┌───────┼────────────────┐
  │       │                │
┌─▼──┐ ┌─▼───┐ ┌──────────▼──────┐
│ PG │ │Redis│ │ Celery Workers   │
│ 16 │ │  7  │ │ Rate refresh     │
│    │ │     │ │ Payment monitor  │
│    │ │     │ │ Blockchain watch  │
└────┘ └─────┘ └──────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Mobile** | React Native, Expo SDK 55, TypeScript |
| **Styling** | NativeWind (Tailwind CSS for RN) |
| **Navigation** | expo-router (file-based) |
| **State** | TanStack Query, expo-secure-store |
| **Backend** | Django 5.1, Django REST Framework |
| **Database** | PostgreSQL 16 |
| **Cache/Queue** | Redis 7 |
| **Task Queue** | Celery 5.4 + Celery Beat |
| **Auth** | JWT (SimpleJWT), bcrypt PIN, Google OAuth |
| **Payments** | Safaricom Daraja API (M-Pesa) |
| **Rates** | CoinGecko API + forex |
| **Infrastructure** | Docker Compose, gunicorn, WhiteNoise |
| **Monitoring** | Sentry, structured JSON logging |

---

## Getting Started

### Prerequisites

- Docker & Docker Compose
- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- Expo Go app (for mobile testing)

### Backend

```bash
# Clone the repository
git clone https://github.com/KevinStreetCoder/CryptoPay.git
cd CryptoPay

# Start all services (PostgreSQL, Redis, Django, Celery)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# In another terminal — run migrations
docker compose exec web python manage.py migrate

# Create admin user
docker compose exec web python manage.py createsuperuser

# Seed system wallets
docker compose exec web python manage.py seed_system_wallets

# API is now running at http://localhost:8000
# Admin panel at http://localhost:8000/admin/
# Health check at http://localhost:8000/health/
```

### Mobile App

```bash
cd mobile

# Install dependencies
npm install --legacy-peer-deps

# Start Expo dev server
npx expo start

# Scan QR code with Expo Go (Android) or Camera (iOS)
```

### Run Tests

```bash
# Backend tests
docker compose exec web pytest -v

# TypeScript check (mobile)
cd mobile && npx tsc --noEmit
```

---

## API Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health/` | GET | System health check |
| `/api/v1/auth/otp/` | POST | Request SMS OTP |
| `/api/v1/auth/register/` | POST | Create account |
| `/api/v1/auth/login/` | POST | Phone + PIN login |
| `/api/v1/auth/google/` | POST | Google OAuth login |
| `/api/v1/auth/profile/` | GET | User profile |
| `/api/v1/wallets/` | GET | List user wallets |
| `/api/v1/rates/` | GET | Get crypto/KES rate |
| `/api/v1/rates/quote/` | POST | Lock rate (30s) |
| `/api/v1/payments/pay-bill/` | POST | Pay a Paybill |
| `/api/v1/payments/pay-till/` | POST | Pay a Till |
| `/api/v1/payments/history/` | GET | Transaction history |

---

## Project Structure

```
CryptoPay/
├── backend/
│   ├── apps/
│   │   ├── accounts/     # Auth, users, KYC, devices
│   │   ├── wallets/      # Multi-currency wallets, ledger
│   │   ├── payments/     # Transactions, saga, idempotency
│   │   ├── mpesa/        # Daraja API client, callbacks
│   │   ├── rates/        # Price feeds, rate locking
│   │   ├── blockchain/   # Deposit monitoring
│   │   └── core/         # Base models, middleware, health
│   ├── config/           # Django settings, URLs, Celery
│   ├── certs/            # M-Pesa certificates (not in git)
│   └── Dockerfile
├── mobile/
│   ├── app/
│   │   ├── (tabs)/       # Home, Pay, Wallet, Profile
│   │   ├── auth/         # Login, Register
│   │   └── payment/      # PayBill, Till, Confirm, Success
│   └── src/
│       ├── api/          # Axios client, typed endpoints
│       ├── components/   # Reusable UI components
│       ├── constants/    # Theme, config
│       ├── hooks/        # Custom React hooks
│       └── stores/       # Auth state management
├── docs/                 # System design, research, checklist
├── docker-compose.yml    # Production compose
└── docker-compose.dev.yml # Dev overrides
```

---

## Design

Built with a dark-mode-first fintech design language inspired by M-Pesa, Cash App, and Revolut.

| Element | Value |
|---------|-------|
| Primary | `#0D9F6E` (Teal green — M-Pesa familiarity) |
| Background | `#0F172A` (Dark navy) |
| Card | `#1E293B` |
| Accent | `#F59E0B` (Amber/gold) |
| Success | `#10B981` |
| Error | `#EF4444` |
| Font | Inter (Regular, Medium, SemiBold, Bold) |

**Design Principles:**
- KES-first display (amounts always in Kenyan Shillings)
- M-Pesa-identical payment flow (familiar to 40M Kenyans)
- 48px+ touch targets
- 4-tab navigation: Home, Pay, Wallet, Profile

---

## Regulatory

M-Crypto is designed for compliance with Kenya's **Virtual Asset Service Providers (VASP) Act 2025**:

- KYC tiered verification (phone → ID → KRA PIN → enhanced DD)
- AML transaction monitoring and daily limits
- Immutable audit trail for all financial operations
- Double-entry bookkeeping for regulatory reporting

---

## Roadmap

- [x] **Phase 1** — MVP: USDT Paybill payments, phone+PIN auth
- [ ] **Phase 2** — Multi-crypto, Till payments, buy/sell flows, KYC tiers
- [ ] **Phase 3** — VASP licensing, USSD channel, merchant QR codes, web dashboard

---

## Contributing

This project is in active development. Contributions are welcome.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## License

This project is proprietary software. All rights reserved.

---

## Contact

- **GitHub**: [@KevinStreetCoder](https://github.com/KevinStreetCoder)
- **Project**: [CryptoPay](https://github.com/KevinStreetCoder/CryptoPay)

---

*Built for Kenya's crypto community* 🇰🇪
