# CryptoPay — Development Progress

**Last updated:** 2026-03-09

> See also: [ROADMAP.md](./ROADMAP.md) for strategic vision, fundraising, and expansion plans.
> See also: [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md) for technical architecture and liquidity engine design.

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
| Tests (66) | ✅ Done | Auth, wallets, saga, idempotency, daily limits, rates, address gen, deposits |

### Frontend (React Native + Expo) — COMPLETE ✅

| Component | Status | Notes |
|-----------|--------|-------|
| Expo project setup | ✅ Done | Expo SDK 55, TypeScript, expo-router |
| ~~NativeWind~~ Inline styles | ✅ Done | NativeWind removed (caused text node errors on web), all styles are inline |
| EAS Build config | ✅ Done | Development, preview, production profiles |
| Design system | ✅ Done | Premium dark theme, emerald primary (#10B981), glassmorphism, Inter font |
| API client (axios) | ✅ Done | JWT auto-refresh, platform-aware base URLs |
| Auth store | ✅ Done | SecureStore tokens, login/register/logout |
| Error boundary | ✅ Done | Friendly error UI with retry |
| Network status banner | ✅ Done | Offline detection with connectivity check |
| Loading screen | ✅ Done | Branded splash with animated logo |
| Auth gate | ✅ Done | Redirect to login if unauthenticated |
| **Home screen** | ✅ Done | Premium balance card, glass cards, rate ticker with pulsing LIVE indicator, quick actions with spring animations |
| **Pay screen** | ✅ Done | Glass payment cards with press animations, "how it works" timeline, provider pills |
| **Wallet screen** | ✅ Done | Glass portfolio card, crypto brand color icons (no emoji), deposit modal, copy address |
| **Profile screen** | ✅ Done | Premium user card, KYC tier progress, colored icon menu items |
| **Login screen** | ✅ Done | Phone → PIN two-step flow, KE badge (no emoji flag), glow logo |
| **Register screen** | ✅ Done | Phone → OTP → Name → PIN with premium step indicator, KE badge |
| **Pay Bill flow** | ✅ Done | Paybill + account + amount + crypto selector + rate lock |
| **Pay Till flow** | ✅ Done | Till number + amount + crypto selector + rate lock |
| **Confirm payment** | ✅ Done | Glass receipt card + PIN confirmation with glow shadows |
| **Success screen** | ✅ Done | 3-layer animated checkmark, glass receipt card |
| Reusable components | ✅ Done | PinInput, BalanceCard, TransactionItem, Button (with glow shadows), QuickAction (spring press), AmountInput, CurrencySelector, StatusBadge, Header, RateTicker (pulsing LIVE dot) |
| Biometric auth hook | ✅ Done | expo-local-authentication wrapper |

---

## Frontend Production Audit — IMPLEMENTED ✅

| Finding | Status | Implementation |
|---------|--------|---------------|
| Skeleton loaders | ✅ Done | `Skeleton.tsx` — BalanceCardSkeleton, TransactionSkeleton, WalletCardSkeleton with smooth 1500ms shimmer |
| Toast notification system | ✅ Done | `Toast.tsx` — ToastProvider + useToast() hook with success/error/warning/info types, haptic feedback, auto-dismiss |
| API error normalization | ✅ Done | `apiErrors.ts` — `normalizeError()` extracts structured errors from Axios, network errors, timeouts, field validation |
| Alert.alert → Toast migration | ✅ Done | All screens (login, register, paybill, till, confirm) now use Toast instead of Alert.alert |
| Accessibility labels | ✅ Done | `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, `accessibilityState` on all interactive elements |
| Font scaling support | ✅ Done | `maxFontSizeMultiplier={1.2-1.3}` on all text and inputs to prevent layout breaks |
| Screenshot prevention | ✅ Done | `useScreenSecurity` hook — prevents screenshots on PIN entry and sensitive screens |
| Clipboard security | ✅ Done | Auto-clear clipboard 30s after copying deposit addresses |
| Console.log stripping | ✅ Done | `babel-plugin-transform-remove-console` in production (preserves console.error/warn) |
| testID props | ✅ Done | Added `testID` on all interactive elements for E2E testing readiness |
| Min touch targets | ✅ Done | `minHeight: 48` on buttons, `minWidth/minHeight: 44` on icon buttons |
| Button accessibility states | ✅ Done | `accessibilityState={{ disabled, busy }}` on all Button components |
| Progress indicator a11y | ✅ Done | Step indicators in register screen have `accessibilityRole="progressbar"` with value |

---

## Premium UI/UX Redesign — IMPLEMENTED ✅

**Last updated:** 2026-03-08

| Change | Status | Details |
|--------|--------|---------|
| Deep premium color palette | ✅ Done | Background `#060E1F`, card `#0C1A2E`, elevated `#162742`, border `#1E3350` — richer, deeper navy |
| Glassmorphism effects | ✅ Done | Glass bg/border/highlight tokens, semi-transparent surfaces with 8-14% white borders |
| Primary color upgrade | ✅ Done | Vibrant emerald `#10B981` (500) with full 50-900 scale |
| Shadow system | ✅ Done | `shadows.sm/md/lg/glow()` presets with platform-aware shadow/elevation |
| Emoji removal | ✅ Done | Flag emoji `🇰🇪` replaced with styled "KE" text badge. Currency emoji `💵/◎` replaced with Unicode symbols |
| Currency icon system | ✅ Done | `CURRENCIES[x].iconSymbol` (₿, Ξ, $, S, K) rendered in crypto-brand-colored circles |
| Tab bar glassmorphism | ✅ Done | Semi-transparent tab bar with pill-shaped active indicator |
| Button glow shadows | ✅ Done | Primary buttons have `shadows.glow()` effect, spring-based press animation `scale(0.97)` |
| Press micro-animations | ✅ Done | All interactive cards: `scale(0.98)`, `opacity(0.85)` on press via Animated spring |
| QuickAction spring press | ✅ Done | `scale(0.92)` spring animation, 52x52 icon containers with colored borders |
| RateTicker LIVE pulse | ✅ Done | Pulsing green dot animation, smoother crossfade, colored change pills |
| Transaction status pills | ✅ Done | Colored dot + label in tinted background pill |
| Premium balance card | ✅ Done | `borderRadius: 28`, decorative circles, uppercase label, crypto dot indicators |
| Premium portfolio card | ✅ Done | Glass borders, accent top line, glow shadow on Receive button |
| Glass receipt card | ✅ Done | Confirm screen: 60px payment icon, dashed dividers, green "Paying with" pill |
| 3-layer success animation | ✅ Done | Pulsing glow rings (140/110/92px) with spring bounce checkmark |
| Premium auth screens | ✅ Done | 3-ring logo glow, glass input borders, glow shadow on focused inputs |
| Step indicator upgrade | ✅ Done | Colored circles with glass connectors, completed checkmarks |
| OTP input boxes | ✅ Done | 50x58 rounded-xl, themed fill states, green success indicator |
| PinInput redesign | ✅ Done | 50x58 rounded-xl boxes, green dot indicators, themed fill states |
| Profile menu icons | ✅ Done | 42x42 colored icon containers (shield=green, lock=blue, fingerprint=amber) |
| Splash/config colors | ✅ Done | `app.json` splash bg updated to `#060E1F` |

---

## Web Platform & Error Handling Fixes — IMPLEMENTED ✅

**Last updated:** 2026-03-08

| Change | Status | Details |
|--------|--------|---------|
| CORS configuration | ✅ Fixed | Added `localhost:8081`, `:19006`, `127.0.0.1:8081` to allowed origins |
| SSL redirect for dev | ✅ Fixed | Made `SECURE_SSL_REDIRECT` env-configurable, disabled in local `.env` |
| NetworkStatus false positive | ✅ Fixed | Module-level dev detection — returns `null` on localhost, no hooks mounted |
| PinInput error reset | ✅ Fixed | Auto-clears PIN on error, re-focuses input. Error borders only show when empty |
| Wallet API pagination | ✅ Fixed | `useWallets` hook handles both paginated `{results:[]}` and direct array responses |
| BalanceCard defensive | ✅ Fixed | Added `Array.isArray()` guard — prevents `wallets.find is not a function` crash |
| ErrorBoundary redesign | ✅ Done | Updated to new theme colors `#060E1F`, debug info panel, spring retry button |
| Auth split layout (web) | ✅ Done | Desktop ≥900px: BrandPanel (logo + features) on left, form card on right |
| ~~WebContainer~~ DashboardLayout | ✅ Done | WebContainer removed, replaced with DashboardLayout (collapsible sidebar) at root layout |
| Profile logout (web) | ✅ Fixed | Custom overlay confirm dialog on web (Alert.alert doesn't work on web) |
| Haptics web safety | ✅ Fixed | All `Haptics.*` calls wrapped in `Platform.OS !== "web"` check |
| Auth layout bg color | ✅ Fixed | Updated from `#0F172A` to `#060E1F` |
| Payment layout bg color | ✅ Fixed | Updated from `#0F172A` to `#060E1F` |

---

## Web Dashboard & Data Integrity — IMPLEMENTED ✅

**Last updated:** 2026-03-08

| Change | Status | Details |
|--------|--------|---------|
| Collapsible sidebar | ✅ Done | `WebSidebar.tsx` — 260px expanded / 68px collapsed, CSS transition, tooltips in collapsed mode |
| DashboardLayout at root | ✅ Done | Wraps all authenticated screens, sidebar persists across navigation |
| Desktop Home dashboard | ✅ Done | Two-column grid: BalanceCard + PortfolioChart, QuickActions, RateTicker, Transactions + TransactionSummary |
| Portfolio chart (real data) | ✅ Done | View-based line chart derived from real transaction history (last 7 days) |
| Dynamic 24h change % | ✅ Done | Computed from real transaction volumes, no more hardcoded "+4.2%" |
| Transaction categorization | ✅ Done | Groups by Payments/Deposits/Conversions with counts and KES totals |
| Desktop Wallet redesign | ✅ Done | Portfolio + Actions grid (60/40), 2-column assets, table-like transactions |
| Desktop Profile two-column | ✅ Done | User card + KYC on left, Security + Support on right |
| Transaction detail screen | ✅ Done | `payment/detail.tsx` — full detail view with type icon, status badge, receipt info |
| TransactionItem navigation | ✅ Done | Clicking a transaction navigates to detail screen |
| Transaction interface aligned | ✅ Done | Frontend `Transaction` type matches backend serializer fields exactly |
| Payment API interfaces aligned | ✅ Done | `PayBillData`, `PayTillData` match backend `PayBillSerializer`, `PayTillSerializer` |
| Helper functions | ✅ Done | `getTxKesAmount()`, `getTxCrypto()`, `getTxRecipient()` for field abstraction |
| All mock data removed | ✅ Done | No more `Math.random()`, hardcoded chart points, or placeholder values |
| Quote interface aligned | ✅ Done | Frontend `Quote` matches backend: `exchange_rate`, `fee_kes`, `crypto_amount`, `total_kes` |
| API URL mismatch fixed | ✅ Done | Frontend `/payments/paybill/` → `/payments/pay-bill/` (matching backend hyphenated URLs) |
| Web input focus styling | ✅ Done | Custom focus glow (`boxShadow`), transitions, `outlineStyle: none` across all inputs |
| PIN input web glow | ✅ Done | Active/filled/error states with `boxShadow` glow, smooth CSS transitions, larger boxes on web |
| Auth screen input styling | ✅ Done | Login/register inputs with focus glow and outline removal on web |
| NativeWind removed | ✅ Done | Was causing "Unexpected text node: ." errors on web |
| Cross-platform shadows | ✅ Done | `makeShadow()` utility — `boxShadow` on web, `shadow*` props on native |
| useNativeDriver fixed | ✅ Done | `Platform.OS !== "web"` across all 13+ animated components |
| pointerEvents fixed | ✅ Done | Moved from prop to style object |
| Profile handlers implemented | ✅ Done | Verify Identity (toast), Biometric (platform-aware toast), Help (mailto), Terms/Privacy (URLs) |
| Web logout dialog | ✅ Done | Custom overlay dialog on web (Alert.alert doesn't work on web) |
| Share receipt (web) | ✅ Done | Clipboard copy on web, native Share API on mobile |
| Toast web improvements | ✅ Done | Centered, max-width 440px, backdrop blur, web-safe haptics |

---

## Deposit/Receive Flow — IMPLEMENTED ✅

**Last updated:** 2026-03-08

| Change | Status | Details |
|--------|--------|---------|
| Address generation service | ✅ Done | Deterministic HMAC-SHA256 derivation per user/currency/index, realistic chain-specific formats |
| Generate address endpoint | ✅ Done | `POST /wallets/{id}/generate-address/` — on-demand address generation, idempotent |
| Deposit history endpoint | ✅ Done | `GET /wallets/deposits/` — paginated list of user's blockchain deposits with status |
| BlockchainDeposit serializer | ✅ Done | Full serialization: chain, tx_hash, amount, confirmations, status, timestamps |
| TronGrid listener | ✅ Done | `monitor_tron_deposits()` — polls TRC-20 USDT transfers via TronGrid API |
| Confirmation tracker | ✅ Done | `update_tron_confirmations()` — queries current block, calculates confirmations |
| Deposit crediting | ✅ Done | `process_pending_deposits()` — credits wallet via WalletService when confirmed |
| QR code deposit modal | ✅ Done | `react-native-qrcode-svg` — QR code displayed in both desktop and mobile deposit modals |
| On-demand address generation | ✅ Done | Receive button generates address if none exists, with loading spinner |
| Generate Address button | ✅ Done | Asset cards show "Generate Deposit Address" dashed button when no address |
| NativeWind cleanup | ✅ Done | Removed `nativewind-env.d.ts`, cleaned `tsconfig.json` and `tailwind.config.js` |
| Shadow deprecation fixes | ✅ Done | All `shadow*` props wrapped in Platform guards, `boxShadow` on web |
| Tests (15 new) | ✅ Done | Address generation (7), API endpoints (5), deposit list (3) — total 66 tests |

---

## Production Hardening — IMPLEMENTED ✅

**Last updated:** 2026-03-08

| Component | Status | Details |
|-----------|--------|---------|
| Admin test balances | ✅ Done | `create_admin` seeds USDT 500, BTC 0.05, ETH 1.5, KES 50,000 via WalletService.credit() |
| Celery Beat schedule | ✅ Done | 5 periodic tasks: rate refresh (30s), Tron monitor (15s), confirmations (10s), deposits (10s), float check (5min) |
| Swagger/OpenAPI docs | ✅ Done | `drf-spectacular` at `/api/docs/` (Swagger) and `/api/redoc/` (ReDoc) |
| M-Pesa STK Push buy flow | ✅ Done | `BuyCryptoView` with PIN verify, idempotency, quote validation, daily limits, fallback poll |
| M-Pesa task polling | ✅ Done | `poll_stk_status` Celery task with 3 retries at 30s intervals |
| Biometric unlock | ✅ Done | App launch: if biometric enabled, authenticateAsync before loading profile |
| Biometric toggle | ✅ Done | Profile screen Switch component, saves preference to storage |
| KYC document upload API | ✅ Done | `POST /api/v1/auth/kyc/documents/` — upload, replace pending, reject if approved |
| KYC verification screen | ✅ Done | `settings/kyc.tsx` — 5 document types, upload/re-upload, status badges |
| Google Sign-In (mobile) | ✅ Done | `expo-auth-session` Google provider, login + register screens, auth store |
| Admin stats dashboard | ✅ Done | D3.js v7 charts at `/admin/stats/` — users, transactions, KYC, regions, crypto holdings |
| Settings: Change PIN | ✅ Done | `settings/change-pin` screen with current/new PIN flow |

---

## Phase 2 — IMPLEMENTED ✅

**Last updated:** 2026-03-08

| Component | Status | Details |
|-----------|--------|---------|
| Push notifications | ✅ Done | Expo push tokens, `PushToken` model, backend registration API, Celery send task, auto-cleanup of invalid tokens |
| Buy crypto screen | ✅ Done | `payment/buy-crypto.tsx` — 3-step flow (form → preview → PIN), live rate quotes with debounce, STK Push |
| Smile Identity KYC | ✅ Done | `kyc_service.py` — ID verify, document+selfie verify, webhook callback, auto tier upgrade |
| Email notifications | ✅ Done | 4 email types (welcome, receipt, KYC status, security alert), HTML templates, Celery tasks with retry |
| CI/CD pipeline | ✅ Done | `.github/workflows/ci.yml` — backend tests + deploy check, frontend TS + web build, Docker build |
| Onboarding tour | ✅ Done | Popup modal onboarding with animated pagination, stored completion flag |
| Localization | ✅ Done | English + Swahili (i18n-js + expo-localization), language picker in profile |
| Notification preferences | ✅ Done | `settings/notifications.tsx` — 5 toggle categories, stored in local storage |
| Google Sign-In | ✅ Done | `expo-auth-session` Google provider, login + register screens, auth store |
| Biometric unlock | ✅ Done | App launch biometric gate, toggle in profile, `expo-local-authentication` |
| Settings: Change PIN | ✅ Done | `settings/change-pin` screen with current/new PIN verification flow |
| Settings: KYC verification | ✅ Done | `settings/kyc.tsx` — 5 document types, upload/re-upload, status badges |
| Admin stats dashboard | ✅ Done | D3.js v7 charts at `/admin/stats/` — users, transactions, KYC, regions, crypto holdings |
| Swagger/OpenAPI docs | ✅ Done | `drf-spectacular` at `/api/docs/` (Swagger) and `/api/redoc/` (ReDoc) |
| Settings hub | ✅ Done | Unified settings screen with notifications, KYC, change PIN, language, and help sections |
| Help & support | ✅ Done | Help screen with FAQ, mailto support link, and terms/privacy URLs |
| Notification inbox | ✅ Done | In-app notification list with read/unread state, category filtering, and push integration |

### Phase 2 Design Improvements ✅

| Change | Status | Details |
|--------|--------|---------|
| BrandedSpinner | ✅ Done | Custom loading spinner component for all loading states |
| Button hover/ripple animations | ✅ Done | Hover effects and ripple feedback on interactive elements |
| Desktop glass card PIN entry | ✅ Done | Glassmorphism-styled PIN input for desktop web |
| Wallet page redesign | ✅ Done | Merged portfolio + actions sections, removed visual clutter |
| Balance hide/show toggle | ✅ Done | Session-based toggle, default hidden for privacy |
| Receive modal with wallet switcher | ✅ Done | Currency selector within the receive/deposit modal |
| Stagger fade-in animations | ✅ Done | Sequential fade-in on list items and dashboard cards |
| Responsive desktop layouts | ✅ Done | Adaptive grid layouts for desktop-width viewports |

---

## Phase 3 — Infrastructure & Launch (In Progress)

**Last updated:** 2026-03-09

### Production Infrastructure — IMPLEMENTED ✅

| Component | Status | Details |
|-----------|--------|---------|
| Nginx reverse proxy | ✅ Done | `nginx/nginx.conf` + `locations.conf` — rate limiting zones (auth, API, general), security headers, gzip, SSL-ready |
| Docker Compose production | ✅ Done | `docker-compose.prod.yml` — memory limits, Nginx service, worker tuning, max-requests recycling |
| Database backups | ✅ Done | `scripts/backup-db.sh` — automated pg_dump with gzip, 30-day retention, cron-ready |
| Admin dashboard improvements | ✅ Done | Auto-refresh (60s), system health panel, 3-column grid on large screens, wider layout (1800px) |
| Responsive desktop layouts | ✅ Done | All pages optimized for 900/1200/1500px breakpoints, live stats bar, wider padding |
| Rate limiting at proxy level | ✅ Done | Nginx rate zones: auth (10r/m), API (30r/m), general (60r/m) with burst handling |

### Remaining Phase 3 Items

#### Backend / Blockchain
- [ ] **Production HD wallets** — Replace HMAC derivation with BIP-32/44 or Fireblocks custody API
- [ ] **External wallet connection** — WalletConnect / Phantom deep link integration
- [ ] **SOL/ETH/BTC deposit monitoring** — Only Tron deposit listener implemented so far

#### Infrastructure
- [ ] **VPS deployment + SSL + domain** — Hetzner/Contabo, Let's Encrypt, cryptopay.co.ke
- [ ] **Monitoring dashboards** — Sentry configured, add Grafana/Prometheus for metrics
- [ ] **SSL certificate provisioning** — Certbot automation with Nginx

#### Launch
- [ ] **App Store / Play Store submission** — EAS production builds, store listings, review

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

**Backend: 66 tests passing**
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
- 7 address generation tests (chain formats, determinism, uniqueness)
- 5 generate-address API tests (success, idempotent, KES rejection, auth)
- 3 deposit list API tests (empty, user deposits, isolation)

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

## Documentation Index

| Document | Purpose |
|----------|---------|
| [PROGRESS.md](./PROGRESS.md) | This file — development status and test results |
| [ROADMAP.md](./ROADMAP.md) | Strategic roadmap, fundraising, go-to-market, expansion plans |
| [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md) | Technical architecture, liquidity engine, payment saga, security |
| [STARTUP-CHECKLIST.md](./STARTUP-CHECKLIST.md) | Legal, regulatory, financial checklists |
| [research/](./research/) | Competitor analysis, API research, security audit, regulations |

## File Count Summary

**Backend:** 50+ Python files across 7 apps
**Frontend:** 35+ TypeScript/TSX files
**Docs:** 10+ documentation files (architecture, research, roadmap)
**Config:** Docker (dev + prod), Nginx, EAS, Metro, Babel, TypeScript, CI/CD
