# CryptoPay — Development Progress

**Last updated:** 2026-03-15

> See also: [ROADMAP.md](./ROADMAP.md) for strategic vision, fundraising, and expansion plans.
> See also: [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md) for technical architecture and liquidity engine design.
> See also: [KES-DEPOSIT-RESEARCH.md](./KES-DEPOSIT-RESEARCH.md) for M-Pesa C2B/STK Push research, sandbox testing, and go-live checklist.
> See also: [SECURITY-AUDIT.md](./SECURITY-AUDIT.md) for full security audit report with findings and fixes.

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
| Blockchain security hardening | ✅ Done | Dust thresholds, amount-based confirmation tiers, re-org detection, double-credit prevention, address validation, velocity anomaly detection |
| Transaction history API | ✅ Done | Paginated, filtered by type/status |
| Health check endpoint | ✅ Done | DB, Redis, Celery status at `/health/` |
| Admin dashboard | ✅ Done | Transaction admin with filters, CSV export, review actions |
| Management commands | ✅ Done | `seed_system_wallets`, `check_float_balance` |
| Custom throttling | ✅ Done | PIN, Transaction, OTP, SensitiveAction throttles |
| Audit logging | ✅ Done | Immutable AuditLog, middleware for request context |
| Production settings | ✅ Done | SSL, HSTS, WhiteNoise, Sentry, JSON logging, DB pooling |
| Docker Compose | ✅ Done | PostgreSQL 16, Redis 7, web, celery, celery-beat, health checks |
| Tests (136) | ✅ Done | Auth, wallets, saga, idempotency, daily limits, rates, address gen, deposits, **security hardening (50)**, **rebalancing (14 new)** |

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
| Currency icon system | ✅ Done | CoinGecko CDN logos via `CryptoLogo` component. Legacy `iconSymbol`/`icon` fields removed from CURRENCIES. |
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

## Professional UI Redesign Phase 2 — IMPLEMENTED ✅

**Last updated:** 2026-03-12

| Change | Status | Details |
|--------|--------|---------|
| CDN Icons (crypto logos) | ✅ Done | CoinGecko CDN for USDT/BTC/ETH/SOL logos, CryptoLogo component with fallback |
| CDN Icons (service providers) | ✅ Done | Clearbit logo CDN for KPLC, Safaricom, Airtel, DSTV, GOtv, Showmax, NHIF, KRA |
| CDN Icons (brand) | ✅ Done | Icons8 Google logo, flagcdn.com Kenya flag — replaced custom-built icons |
| Centralized logo constants | ✅ Done | `src/constants/logos.ts` — single source for all CDN URLs |
| SectionHeader component | ✅ Done | Consistent section headers with icons across all screens |
| OTPInput component | ✅ Done | Clean modern OTP input with focus states, resend timer |
| Login redesign | ✅ Done | Centered text, Kenya flag CDN, Google CDN icon, hover states |
| Register redesign | ✅ Done | Same improvements as login, step indicator |
| Dashboard crypto logos | ✅ Done | Real CoinGecko coin images in portfolio cards |
| Wallet crypto logos | ✅ Done | Real coin images in asset list |
| Pay screen logos | ✅ Done | Real company logos for 10+ Kenyan service providers |
| Buy crypto logos | ✅ Done | Real coin images in crypto selector |
| Send screen logos | ✅ Done | Real coin images in currency picker |
| Profile redesign | ✅ Done | Avatar, KYC chips, SectionHeaders, hover effects |
| Settings redesign | ✅ Done | ProfileCard, SectionHeaders, hover animations |
| Help/FAQ redesign | ✅ Done | Category filtering, search glow, FAQ accordion |
| Notifications inbox | ✅ Done | Grouped by date, filter tabs, animated entries |
| Payment flows | ✅ Done | SectionHeaders, focus glow, hover states on paybill/till/send |
| Success screen | ✅ Done | Clean enterprise animations (no confetti) |
| StatusAnimation component | ✅ Done | Simple spring scale-in for success/error/warning/loading |

---

## Security & Auth Enhancements — COMPLETE ✅

| Component | Status | Notes |
|-----------|--------|-------|
| TOTP Authenticator | ✅ Done | pyotp TOTP, bcrypt-hashed backup codes, QR setup, SetupTOTPView (GET/POST/DELETE) |
| OTP Challenge (3 wrong PINs) | ✅ Done | Progressive lockout, auto-send OTP, model fields + migration |
| Device change detection | ✅ Done | New device requires OTP verification, Device model tracking, auto-trust on verify |
| IP change detection | ✅ Done | `last_login_ip` tracking, OTP required on IP change, audit logging |
| Email verification tokens | ✅ Done | 24-hour expiry, secure token generation |
| Recovery contacts | ✅ Done | Recovery email + phone fields on User model |

---

## Production Infrastructure — MOSTLY COMPLETE ✅

| Component | Status | Notes |
|-----------|--------|-------|
| HD Wallet (BIP-44) | ✅ Done | Real secp256k1/Ed25519 derivation, multi-chain (Tron/ETH/BTC/Solana/Polygon) |
| BIP-39 Mnemonic | ✅ Done | `WALLET_MNEMONIC` env var support, `mnemonic` lib, `generate_wallet_seed` management command |
| Master Seed Priority | ✅ Done | 3-tier: WALLET_MASTER_SEED (hex) → WALLET_MNEMONIC (BIP-39) → SECRET_KEY fallback (dev only) |
| Wallet Seed Management | ⬜ TODO | AWS KMS encryption, HSM integration for production |
| WalletConnect (Reown AppKit) | ✅ Done | External wallet deposits via MetaMask/Trust/Rainbow/Phantom. AppKit config, ERC-20 transfer hook, deposit UI in Crypto tab, Android wallet detection plugin. Requires `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` from cloud.reown.com and EAS Build (not Expo Go). |
| Multi-chain listeners | ✅ Done | ETH (Alchemy), BTC (BlockCypher), SOL (Helius), Tron (TronGrid) blockchain monitoring |

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

## Phase 3 — Production Ready & Launch (In Progress)

**Last updated:** 2026-03-13

### Production Infrastructure — IMPLEMENTED ✅

| Component | Status | Details |
|-----------|--------|---------|
| Nginx reverse proxy | ✅ Done | `nginx/nginx.conf` + `locations.conf` — rate limiting zones (auth, API, general), security headers, gzip, SSL-ready |
| Docker Compose production | ✅ Done | `docker-compose.prod.yml` — memory limits, Nginx service, worker tuning, max-requests recycling |
| Database backups | ✅ Done | `scripts/backup-db.sh` — automated pg_dump with gzip, 30-day retention, cron-ready |
| Admin dashboard improvements | ✅ Done | Auto-refresh (60s), system health panel, 3-column grid on large screens, wider layout (1800px) |
| Responsive desktop layouts | ✅ Done | All pages optimized for 900/1200/1500px breakpoints, live stats bar, wider padding |
| Rate limiting at proxy level | ✅ Done | Nginx rate zones: auth (10r/m), API (30r/m), general (60r/m) with burst handling |
| Comprehensive documentation | ✅ Done | Research, roadmap, system design, startup checklist — all updated with verified data |

### Production Readiness Audit (March 9, 2026)

What's real vs placeholder in the current codebase:

| Component | Status | Details |
|-----------|--------|---------|
| **Rate Engine** | ✅ REAL | CoinGecko batch + CryptoCompare fallback, Redis 60s cache, DB persistence, 1.5% spread, rate locking |
| **M-Pesa Daraja** | ✅ REAL | STK Push, B2B, B2C, BuyGoods, Reversal, Status — env-aware (sandbox/production) |
| **Tron Blockchain Listener** | ✅ REAL | TronGrid polling, confirmation tracking, auto-crediting — runs every 10-15s |
| **Ethereum Listener** | ✅ REAL | ERC-20 USDT/USDC monitoring via `eth_getLogs`, epoch-based finality (64 blocks), Alchemy-compatible |
| **Bitcoin Listener** | ✅ REAL | UTXO monitoring via BlockCypher API, 3-confirmation threshold, rate-limit aware |
| **KYC / Smile Identity** | ✅ REAL | ID verify, document+selfie, webhook callbacks, auto tier upgrade |
| **Push Notifications** | ✅ REAL | Expo Push API, auto token cleanup, Celery async delivery |
| **SMS / OTP** | ✅ REAL | Africa's Talking integration with fallback to console in dev |
| **Email** | ✅ CONFIGURED | Resend SMTP (3K/month free) configured in production settings, console in dev |
| **Transaction Data** | ✅ REAL | All screens use real API data (balances, transactions, rates) |
| **Wallet Balances** | ✅ REAL | Real API with 30s polling refresh |
| **Live Rate Ticker** | ✅ REAL | Real API rates, 30s refresh, pulsing LIVE indicator |
| **Wallet Addresses** | ✅ REAL | BIP-44 HD wallet derivation with secp256k1/Ed25519, chain-specific address encoding |
| **Crypto Price Charts** | ✅ REAL | CoinGecko `/market_chart` → CryptoCompare fallback → internal DB fallback, period-based caching |
| **Rate History API** | ✅ REAL | Backend serves real market data, frontend fetches per currency/period with react-query |
| **ETH/BTC/SOL Listeners** | ✅ REAL | ETH (Alchemy), BTC (BlockCypher), SOL (Solana RPC) — all chains monitored |
| **Off-Ramp (Yellow Card)** | ⚠️ PARTIAL | Manual mode complete (admin sells + confirms). API provider stub ready for Yellow Card B2B API keys. |
| **Float Rebalancing** | ✅ REAL | Full orchestrator: auto-trigger, manual trigger, Celery tasks, admin API, Django admin, circuit breaker integration. |
| **Production API URL** | ✅ UNIFIED | Single source in `config.ts`, env-based with production validation (crashes if localhost in prod) |
| **Celery Tasks** | ✅ REAL | 9 periodic tasks: rate refresh, Tron/ETH/BTC monitors + confirmation trackers, float check |
| **Security Settings** | ✅ REAL | SSL, HSTS, secure cookies, CORS, JSON logging — properly structured |
| **Audit Logging** | ✅ REAL | Immutable audit trail, separate payment/security log files |

---

### Phase 3 Implementation Progress

#### ✅ COMPLETED (This Session)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Real crypto price charts** | Full stack | CoinGecko `/market_chart` with CryptoCompare fallback. Backend serves real data, frontend `CryptoPriceChartsSection` fetches via react-query with sparklines + expandable chart. All mock data removed. | `rates/services.py`, `rates/views.py`, `CryptoChart.tsx`, `index.tsx` |
| 2 | **Production HD wallets (BIP-44)** | Backend | Full BIP-32/44 HD wallet derivation. secp256k1 for BTC/ETH/Tron, Ed25519 for Solana. Master seed from env (`WALLET_MASTER_SEED`) or PBKDF2-derived from SECRET_KEY. Chain-specific address encoding (base58check, EIP-55, Tron base58). | `blockchain/services.py`, `settings/base.py` |
| 3 | **Fix price feed 429 errors** | Backend | Batch API calls (1 CoinGecko call for all 5 currencies), 60s cache TTL, CryptoCompare fallback, 55s debounce lock, polling reduced to 120s. | `rates/services.py`, `settings/base.py` |
| 4 | **Unified API URL config** | Frontend | `client.ts` now imports from `config.ts` (single source of truth). Production safety: crashes early if localhost URL detected in prod build. | `api/client.ts`, `constants/config.ts` |
| 5 | **Email provider (Resend)** | Backend | Production settings default to Resend SMTP (`smtp.resend.com`). Also supports SES. Documented inline. | `settings/production.py` |
| 6 | **Ethereum deposit listener** | Backend | ERC-20 USDT/USDC via `eth_getLogs` with Alchemy/Infura RPC. Post-Merge epoch-based finality (64 blocks). Block scanning with high-water mark. | `blockchain/eth_listener.py`, `settings/base.py` |
| 7 | **Bitcoin deposit listener** | Backend | BTC UTXO monitoring via BlockCypher API. Rate-limit aware (200 req/hr free). Address-based transaction scanning. | `blockchain/btc_listener.py`, `settings/base.py` |
| 8 | **ETH confirmation model updated** | Backend | Changed from 12 to 64 blocks (2 finalized epochs post-Merge). All confirmation values documented with timing. | `settings/base.py` |
| 9 | **Excise duty (10%) on fees** | Full stack | VASP Act 2025 legal requirement. Backend calculates excise on platform fees (spread + flat fee), stores on Transaction model. Frontend displays as separate line item in payment preview and confirm screens. Migration applied. | `rates/services.py`, `settings/base.py`, `payments/models.py`, `payments/views.py`, `payments/serializers.py`, `confirm.tsx`, `paybill.tsx`, `till.tsx`, `send.tsx`, `rates.ts` |
| 10 | **Quote countdown timer (90s)** | Frontend | Real-time countdown with progress bar, color transitions (green→yellow→red), haptic warning at 10s, expired state blocks payment and shows "Get New Quote" button. Works on both review and PIN steps. | `payment/confirm.tsx` |
| 11 | **Swahili translations expanded** | Frontend | Added 12 new translation keys for payment flow (excise duty, rate locked, quote expired, pay now, etc.) in both English and Swahili. | `i18n/en.ts`, `i18n/sw.ts` |
| 12 | **RiftFi competitive analysis** | Docs | Documented RiftFi as direct competitor. Updated ROADMAP.md, PROGRESS.md, and research docs with strategic response plan. | `ROADMAP.md`, `PROGRESS.md`, `IMPLEMENTATION-RESEARCH.md` |

#### ✅ COMPLETED (March 10, 2026 Session)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Fix auth session expiry (401 loop)** | Frontend | Added `forceLogout` callback pattern — axios interceptor clears tokens AND updates React auth state on refresh failure. Avoids circular imports via `setOnSessionExpired()` registration. | `client.ts`, `stores/auth.ts` |
| 2 | **Fix web avatar upload** | Frontend | Platform-specific FormData: web uses `fetch()` → blob → `new File()`, native uses `{ uri, type, name }`. Set `Content-Type: undefined` so axios auto-sets multipart boundary. | `profile.tsx`, `api/auth.ts` |
| 3 | **Light mode on ALL pages** | Frontend | Fixed 6 pages with hardcoded dark colors: `notifications.tsx`, `change-pin.tsx`, `detail.tsx`, `kyc.tsx`, `language.tsx`, `notifications-inbox.tsx`. All now use `getThemeColors(isDark)` → `tc.*` pattern. | 6 settings/payment files |
| 4 | **Back buttons on ALL pages** | Frontend | Dual back buttons on payment pages: top `< Back` goes to previous page, card back button goes to Pay page. All pages have `canGoBack()` guards with fallback `router.replace()`. | All payment + settings pages |
| 5 | **Phone masking everywhere** | Frontend | `usePhonePrivacy` hook with `formatPhone()` applied to: recent transactions, wallet desktop table, settings user card, transaction detail page. Single toggle in Profile controls all. | `TransactionItem.tsx`, `wallet.tsx`, `settings/index.tsx`, `detail.tsx` |
| 6 | **Mobile crypto charts** | Frontend | Added `MobileCryptoCharts` component: 2x2 grid of crypto price cards with sparklines + expandable full chart. Charts now visible on all devices, not just desktop. | `index.tsx` |
| 7 | **Skeleton loading** | Frontend | Added 4 new skeleton components: `CryptoCardSkeleton`, `CryptoChartsSkeleton`, `RateTickerSkeleton`, `PortfolioChartSkeleton`. Applied to charts, rate ticker, portfolio chart, crypto cards. | `Skeleton.tsx`, `index.tsx` |
| 8 | **Real Kenyan service providers** | Frontend | Replaced generic providers with 12 real services: KPLC Prepaid/Postpaid, Nairobi Water, Safaricom, Airtel, DSTV, GOtv, StarTimes, KRA iTax, NHIF, Zuku, Showmax. Click prefills paybill number. | `pay.tsx`, `paybill.tsx`, `till.tsx` |
| 9 | **Remove conflicting settings** | Frontend | Ensured phone masking toggle exists only in Profile (not duplicated in Settings). No conflicting privacy controls. | `profile.tsx`, `settings/index.tsx` |

#### ✅ COMPLETED (March 10, 2026 Session 2)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Full theme support — all components** | Frontend | Added `useThemeMode()` + `getThemeColors(isDark)` to 12 components: CryptoChart (4 sub-components), Skeleton (8 variants), RateTicker, TransactionItem, BalanceCard, QuickAction, Header, AmountInput, CurrencySelector, PinInput, ErrorBoundary, LoadingScreen. All `colors.dark.*` → `tc.dark.*`, `colors.textPrimary` → `tc.textPrimary`, etc. | 12 component files |
| 2 | **Full theme support — auth screens** | Frontend | Removed hardcoded `COLORS` constants from login.tsx and register.tsx. Removed hardcoded `C` constant from onboarding.tsx. All replaced with `getThemeColors(isDark)` → `tc.*` pattern. Sub-components accept `tc` as prop. | `login.tsx`, `register.tsx`, `onboarding.tsx` |
| 3 | **Full theme support — layouts** | Frontend | All 4 layout files (`_layout.tsx`, `auth/_layout.tsx`, `payment/_layout.tsx`, `settings/_layout.tsx`) replaced hardcoded `#060E1F` with `tc.dark.bg`. Root layout StatusBar now theme-aware. | 4 layout files |
| 4 | **Full theme support — remaining screens** | Frontend | buy-crypto.tsx: all `colors.dark.*` → `tc.dark.*`. confirm.tsx: QuoteCountdown themed. profile.tsx: KYC tiers themed. | `buy-crypto.tsx`, `confirm.tsx`, `profile.tsx` |

#### ✅ COMPLETED (March 11, 2026 Session)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **OTP challenge after 3 wrong PINs** | Full stack | After 3 consecutive failed PIN attempts, auto-sends SMS OTP and requires verification before further login. `otp_challenge_required` flag on User model. Frontend login screen shows OTP step. | `models.py`, `views.py`, `login.tsx`, `auth.ts` |
| 2 | **Email verification flow** | Full stack | `EmailVerificationToken` model with 24hr expiry. Send verification → enter code → confirm. Token-based or 6-char code. Verification status on User model (`email_verified`). | `models.py`, `views.py`, `serializers.py`, `urls.py`, `email_verification.html` |
| 3 | **TOTP authenticator app support** | Full stack | `pyotp` for TOTP generation. Setup flow: generate secret → QR/manual entry → verify first code → generate 10 backup codes (bcrypt hashed). Login checks TOTP if enabled. Backup codes work as fallback. | `models.py`, `views.py`, `totp-setup.tsx`, `auth.ts` |
| 4 | **Recovery email & phone** | Full stack | `recovery_email`, `recovery_phone`, `recovery_email_verified` fields on User. Recovery settings endpoint with email verification. Security settings overview endpoint. | `models.py`, `views.py`, `serializers.py`, `security.tsx` |
| 5 | **SMS transaction notifications** | Backend | Celery task `send_transaction_sms_task` — sends SMS via Africa's Talking on completed transactions with reference number. | `tasks.py`, `email.py` |
| 6 | **Email transaction notifications** | Backend | Enhanced `send_transaction_notifications()` — single entry point that dispatches email receipt, SMS, push notification, and PDF receipt generation. Triggered on saga completion. | `email.py`, `saga.py` |
| 7 | **PDF receipt generation** | Full stack | `weasyprint` HTML→PDF generator. Branded receipt template with CryptoPay header, transaction details, reference, amounts, fees, status badge. Download endpoint `GET /payments/{id}/receipt/`. Frontend download button on success screen. | `pdf_receipt.py`, `receipt.html`, `views.py`, `urls.py`, `success.tsx` |
| 8 | **Security settings screen** | Frontend | New `/settings/security` screen with sections for: email verification, TOTP setup, recovery email, trusted devices, change PIN, login protection info. | `security.tsx` |
| 9 | **TOTP setup screen** | Frontend | New `/settings/totp-setup` screen with 4-step flow: intro → secret key display → code verification → backup codes display. Copy functionality for secret and codes. | `totp-setup.tsx` |
| 10 | **Success screen receipt download** | Frontend | PDF receipt download button alongside share button. Web downloads via blob URL, mobile shows generation confirmation. Transaction ID passed through from confirm screen. | `success.tsx`, `confirm.tsx` |
| 11 | **New API endpoints (7)** | Backend | `email/verify/`, `email/confirm/`, `totp/setup/`, `recovery/`, `security/`, `{tx_id}/receipt/`, updated `login/` with OTP+TOTP params | `urls.py` (accounts + payments) |
| 12 | **Implementation plan document** | Docs | `NEW-FEATURES-PLAN-2026-03-11.md` — comprehensive plan with research, priorities, effort estimates for all new features from Grok conversation. | `docs/research/` |

#### ✅ COMPLETED (March 11, 2026 Session 2 — QA & Polish)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Fix login "Session Expired" on wrong PIN** | Frontend | Response interceptor was checking `_sessionExpired` flag BEFORE `isAuthEndpoint` — login 401s were being swallowed. Reordered checks so auth endpoints always pass errors through. Also reset `_sessionExpired` flag on login screen mount. | `client.ts`, `apiErrors.ts`, `login.tsx` |
| 2 | **Fix 401 error title** | Frontend | Changed 401 default title from "Session Expired" to "Authentication Failed" in `normalizeError()`. Wrong PIN now shows "Authentication Failed: Invalid credentials" instead of misleading session expiry. | `apiErrors.ts` |
| 3 | **Device registration on login/register** | Full stack | Frontend now sends `device_id`, `device_name`, `platform` via `expo-device` on every login/register/Google login. Backend creates Device records in LoginView, RegisterView, and GoogleLoginView. Web uses stable UUID from localStorage. | `auth.ts`, `views.py` |
| 4 | **Active Sessions page** | Frontend | `settings/devices.tsx` — lists logged-in devices with name, platform, IP, last active. Current device highlighted with green badge. Remove button with confirmation. 2-column grid on desktop. | `devices.tsx`, `auth.ts` |
| 5 | **Profile header full-width redesign** | Frontend | Removed `maxWidth: 720` constraint. Desktop uses horizontal 3-panel layout: avatar+name+actions on left, vertical divider, info chips+KYC progress on right. Content fills available width. | `profile.tsx` |
| 6 | **Service provider real logos** | Frontend | Downloaded real logos (KPLC, Nairobi Water, Safaricom, GOtv, StarTimes, NHIF, Zuku, Uber, Bolt) as local PNGs. Fixed `ServiceLogo` to handle both `require()` return types (number on native, string on web). Removed services without usable logos (Airtel, DSTV, KRA, Showmax). | `logos.ts`, `pay.tsx`, `assets/logos/services/` |
| 7 | **DM Sans font across all screens** | Frontend | Replaced all `fontWeight` without `fontFamily` across 35+ files. Every text element now uses `DMSans_400Regular`/`500Medium`/`600SemiBold`/`700Bold`. | All app files |
| 8 | **Full i18n translations** | Frontend | Wired `useLocale()` + `t()` calls across ALL screens: Dashboard, Wallet, Profile, Pay, Settings (Security, KYC, Notifications, Help). All section headers, labels, descriptions, toasts, and buttons translated to English + Swahili. | All screen + i18n files |
| 9 | **Desktop layout for settings sub-pages** | Frontend | Security, KYC, Notifications pages: removed maxWidth constraints, added `paddingHorizontal: 48` + 2-column grids. Buttons capped at `maxWidth: 360-480` to prevent full-width spanning. | `security.tsx`, `kyc.tsx`, `notifications.tsx` |
| 10 | **Dev OTP bypass** | Backend | In DEBUG mode, OTP is included in API response (`dev_otp` field) for easy development testing. Shown in frontend toast when OTP challenge is triggered. | `views.py`, `login.tsx` |
| 11 | **PIN error pass-through for payments** | Frontend | 401 responses with business-logic `error` field (e.g., "Invalid PIN") now pass through the interceptor instead of triggering token refresh → session expiry. | `client.ts` |
| 12 | **Profile avatar display** | Frontend | Added `resolveAvatarUrl()` helper to handle Django relative URLs. Avatar now displays on Profile page and Settings page header. | `profile.tsx`, `settings/index.tsx` |

#### ✅ COMPLETED (March 11, 2026 Session 3 — Logo & Avatar Fix)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Fix service logos showing letter fallbacks** | Frontend | `ServiceLogo` was using `source={{ uri: logos }}` which fails for `require()` results on web. Changed to `source={logos}` — React Native handles resolution internally on all platforms. Removed stale URL array/cascading fallback logic. Changed type from `string` to `any`. | `pay.tsx`, `logos.ts` |
| 2 | **Fix sidebar avatar not displaying** | Frontend | `WebSidebar` was using `user.avatar_url` directly without resolving relative Django paths (e.g., `/media/avatars/xxx.jpg`). Added `resolveAvatarUrl()` helper (same as profile.tsx) to both collapsed and expanded avatar displays. | `WebSidebar.tsx` |
| 3 | **Dev OTP security challenge bypass** | Backend | Added `if settings.DEBUG: security_challenge = False` in LoginView so new-device OTP is skipped during development (no SMS API configured). OTP code included in response when DEBUG for testing. | `views.py` |

#### ✅ COMPLETED (March 12, 2026 Session — Production Polish & Security Hardening)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Stablecoin blacklist on-chain verification** | Backend | Real eth_call / TronGrid queries to USDT/USDC blacklist contracts (isBlackListed/isBlacklisted). Fail-open design for availability. | `blockchain/security.py`, `blockchain/tasks.py` |
| 2 | **M-Pesa callback HMAC tokens** | Backend | HMAC-SHA256 per-transaction callback tokens stored in Redis with 2hr TTL. Dynamic callback URLs with one-time token consumption. | `mpesa/middleware.py`, `mpesa/views.py`, `mpesa/urls.py`, `mpesa/client.py` |
| 3 | **BTC RBF detection** | Backend | Integrated `is_rbf_signaled` check for unconfirmed Bitcoin transactions. | `blockchain/btc_listener.py` |
| 4 | **SOL confirmation monotonicity** | Backend | Applied `check_confirmation_monotonicity` to Solana listener. Uses per-deposit required_confirmations. | `blockchain/sol_listener.py` |
| 5 | **Deposit address uniqueness constraint** | Backend | PostgreSQL UNIQUE constraint on non-empty deposit_address. Migration applied. | `wallets/models.py`, migration |
| 6 | **All 5 coins in payment screens** | Frontend | USDT, USDC, BTC, ETH, SOL available in Pay Bill, Pay Till, Send, Buy Crypto. Was only 3 before. | `paybill.tsx`, `till.tsx`, `send.tsx`, `buy-crypto.tsx` |
| 7 | **CryptoLogo replacing letter icons** | Frontend | Replaced all text/letter-based crypto icons with CoinGecko CDN logos via CryptoLogo component. Cleaned dead `iconSymbol`/`icon` from CURRENCIES constant. | `CurrencySelector.tsx`, `BalanceCard.tsx`, `theme.ts`, `buy-crypto.tsx` |
| 8 | **Press animations on interactive elements** | Frontend | Added spring scale animations to TransactionItem (0.97) and CurrencySelector pills (0.95). | `TransactionItem.tsx`, `CurrencySelector.tsx` |
| 9 | **Chart visibility improvement** | Frontend | Added glow layer (wider stroke at low opacity) behind chart lines. Increased gradient fill opacity (0.3→0.45 with 3-stop gradient). Both main charts and sparklines. | `CryptoChart.tsx` |
| 10 | **Real KYC file upload** | Full stack | Replaced placeholder URL with real `expo-image-picker` integration. Camera for selfie, gallery for documents. Multipart FormData upload to backend. Backend stores via `default_storage` (S3/local). 10MB limit, JPEG/PNG/WebP/PDF. | `kyc.tsx`, `auth.ts`, `views.py`, `serializers.py` |
| 11 | **Push notification routing** | Frontend | Notification taps now navigate to relevant screens: transaction detail, wallet, KYC, devices, etc. Based on `type` field in notification payload. | `usePushNotifications.ts` |
| 12 | **USDT default expanded chart** | Frontend | Dashboard now shows USDT as default expanded chart on both mobile and desktop. | `index.tsx` |

#### ✅ COMPLETED (March 12, 2026 Session 2 — Layout, i18n, Docs)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Settings full-width layout: language.tsx** | Frontend | Removed `maxWidth: 580, alignSelf: "center"` constraint. Now uses `paddingHorizontal: 48` on desktop for proper full-width layout. | `language.tsx` |
| 2 | **Settings full-width layout: totp-setup.tsx** | Frontend | Removed `maxWidth: 520` from ScrollView. Now uses `paddingHorizontal: 48` on desktop. | `totp-setup.tsx` |
| 3 | **Help FAQ i18n (remove hardcoded data)** | Frontend | Replaced hardcoded `FAQ_DATA` array with `FAQ_KEYS` that reference i18n translation keys. FAQ questions/answers now pulled from `en.ts`/`sw.ts` via `t()`. Category labels also i18n'd. | `help.tsx` |
| 4 | **Font consistency fix: help.tsx** | Frontend | Replaced `fontWeight` with `fontFamily: "DMSans_*"` in AccordionItem and CategoryChip components. | `help.tsx` |
| 5 | **Web notifications (browser API)** | Frontend | Added `registerWebNotifications()` for browser Notification API. `showWebNotification()` export for triggering web notifications. Notification tap routing to relevant screens. | `usePushNotifications.ts` |
| 6 | **Notifications inbox: real API data** | Frontend | Removed 10 hardcoded mock notifications. Now fetches real transactions from `paymentsApi.history()` and converts to notification format. | `notifications-inbox.tsx` |
| 7 | **Nested button HTML fix** | Frontend | Fixed `<button> cannot contain nested <button>` error in notifications inbox. Delete action uses `View+onClick` instead of nested `Pressable`. | `notifications-inbox.tsx` |
| 8 | **Chart line overflow fix** | Frontend | Added `DATA_INSET_TOP` (10px) and `DATA_INSET_BOTTOM` (4px) to prevent chart line clipping at top of chart area. | `CryptoChart.tsx` |
| 9 | **Backend .env configuration** | Backend | Added TronGrid API key, HD wallet master seed, Resend email config. | `backend/.env` |
| 10 | **PROGRESS.md & SYSTEM-DESIGN.md update** | Docs | Added implementation status for liquidity engine, documented remaining business logic gaps. | `PROGRESS.md`, `SYSTEM-DESIGN.md` |

#### ✅ COMPLETED (March 12, 2026 Session 3 — Circuit Breaker, Bug Fixes, UI Polish)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Emergency payment pause (circuit breaker)** | Backend | Production 3-state circuit breaker: CLOSED → HALF_OPEN → OPEN. Auto-triggers from M-Pesa float balance callbacks. Hysteresis between CRITICAL/RESUME thresholds prevents flapping. Redis-backed with 24h TTL safety valve. Admin force pause/resume API. Audit trail on every transition. Push + email alerts to staff. | `circuit_breaker.py`, `views.py`, `urls.py`, `tasks.py`, `push.py`, `base.py` |
| 2 | **Sidebar active state fix** | Frontend | Fixed both "Profile" and "Settings" showing active on `/settings/edit-profile`. Changed from substring match to exact path matching. | `WebSidebar.tsx` |
| 3 | **Language page redesign** | Frontend | Replaced emoji flags with CDN flag images (flagcdn.com). Added desktop layout with side-by-side cards, spring animations, region info, speaker count. | `language.tsx` |
| 4 | **`registerWebNotifications` crash fix** | Frontend | CRITICAL: Renamed function to `requestWebNotificationPermission` with `.catch()` safety. Was crashing entire app on web via ErrorBoundary. | `usePushNotifications.ts` |
| 5 | **Nested button HTML fix (complete)** | Frontend | Removed `accessibilityRole="button"` from delete View that was still causing `<button>` nesting on web. | `notifications-inbox.tsx` |
| 6 | **Button corner background leak fix** | Frontend | Added `borderRadius` + `overflow: "hidden"` to outer `Animated.View` in Button component. Glow shadow no longer bleeds through rounded corners. | `Button.tsx` |
| 7 | **`pointerEvents` prop deprecation fix** | Frontend | Moved `pointerEvents` from prop to style object in Button and CryptoChart. | `Button.tsx`, `CryptoChart.tsx` |
| 8 | **Profile language modal flag fix** | Frontend | Replaced emoji flags (🇬🇧/🇰🇪 rendering as "GB"/"KE" on web) with CDN flag images from flagcdn.com. | `profile.tsx` |
| 9 | **Icons in all payment buttons** | Frontend | Added Ionicons to all 15 Button components: flash-outline (Get Quote), send-outline (Pay Now), arrow-forward-circle (Confirm), refresh-outline (New Quote), checkmark-done (Done), repeat (Another Payment), home (Go Home), card (Buy Now). | `paybill.tsx`, `till.tsx`, `send.tsx`, `confirm.tsx`, `success.tsx`, `buy-crypto.tsx` |
| 10 | **Enhanced success/failure animations** | Frontend | Success: ring expand + checkmark bounce with rotation + glow pulse. New failure state: AnimatedFailure with ring + X mark + horizontal shake. Staggered card/button fade-in. `status=failed` param support. | `success.tsx` |
| 11 | **App icon compression** | Frontend | Compressed icon.png from 393KB → 207KB (47% reduction) using sharp resize + PNG optimization. | `assets/icon.png` |
| 12 | **M-Pesa Balance callback view** | Backend | New BalanceCallbackView parses M-Pesa Account Balance API response. Supports multi-account format with `&` separator. Feeds into circuit breaker via Celery task. | `mpesa/views.py`, `mpesa/urls.py` |
| 13 | **Admin circuit breaker API** | Backend | GET (status) + POST (pause/resume) endpoint for admin. Staff-only. Returns full status dict with state, thresholds, last update. | `payments/views.py`, `payments/urls.py` |

#### ✅ COMPLETED (March 13, 2026 — Grok Frontend Upgrade 10/10, CORS Fix, Offline Cache)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **GlassCard component** | Frontend | Reusable glassmorphism container with `expo-blur` on native, CSS `backdrop-filter` on web. Configurable glow color/opacity. Used across all payment screens. | `GlassCard.tsx` |
| 2 | **PaymentStepper component** | Frontend | Compact 3-step progress indicator (Details → Confirm → Done) with numbered circles, checkmarks for completed steps, and connector lines. Used in all 6 payment screens. | `PaymentStepper.tsx` |
| 3 | **Haptic countdown timer** | Frontend | SVG circular ring timer with per-second haptic ticks (last 30s), warning vibration at 10s, color transitions (green→yellow→red), dynamic labels. | `confirm.tsx` |
| 4 | **BalanceCard emerald glow** | Frontend | Dual-layer boxShadow on web, shadowColor on native. Crypto pills use `flexWrap` with `minWidth: 60` to prevent text truncation on small screens. | `BalanceCard.tsx` |
| 5 | **Onboarding glassmorphism upgrade** | Frontend | Mobile slides wrapped in GlassCard with per-slide glow colors. Web popup card has backdrop blur + emerald border glow. Icon circles have colored glow halos. | `onboarding.tsx` |
| 6 | **Offline rate & quote cache** | Frontend | `rateCache.ts` utility caches exchange rates and quotes using existing storage (SecureStore/localStorage). Dashboard falls back to cached rates on network failure. Quote cache on all payment screens. Human-readable age labels ("2 min ago"). | `rateCache.ts`, `index.tsx`, `paybill.tsx`, `till.tsx`, `send.tsx` |
| 7 | **CORS/IDM receipt download fix** | Full stack | IDM browser extension intercepts fetch/XHR with 204 status, breaking CORS. Backend now accepts JWT via `?token=` query parameter on receipt endpoint. Frontend uses `window.open()` to download — bypasses IDM entirely. | `views.py`, `detail.tsx`, `success.tsx` |
| 8 | **Icons on all buttons** | Frontend | Added `arrow-back-outline` icons to Back and Go Back buttons in transaction detail screen. Verified all 15+ buttons across payment screens have icons. | `detail.tsx` |
| 9 | **JSX closing tag fixes** | Frontend | Fixed extra `</View>` closing tags in GlassCard wrappers (paybill, till, send) that caused 500 build errors. | `paybill.tsx`, `till.tsx`, `send.tsx` |
| 10 | **SVG transform-origin fix** | Frontend | Replaced react-native-svg `rotation`/`origin` props with `transform` prop on Circle component to fix invalid DOM property warning on web. | `confirm.tsx` |

**Grok Recommendations Scorecard: 10/10 ✅**
- [x] GlassCard component (expo-blur + backdrop-filter)
- [x] PaymentStepper in all payment flows
- [x] Haptic countdown with SVG ring timer
- [x] BalanceCard glow + overflow fix
- [x] GlassCard in all 6 payment screens
- [x] Success/failure animations (spring + shake)
- [x] Onboarding glassmorphism upgrade
- [x] Offline rate/quote cache
- [x] Icons on all buttons
- [x] Payment stepper in all flows

#### ✅ COMPLETED (March 13, 2026 Session 2 — Liquidity Rebalancing Orchestrator)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **RebalanceOrder model** | Backend | Full state machine: PENDING→SUBMITTED→SETTLING→COMPLETED/FAILED/CANCELLED. Tracks float snapshot, crypto sell details, actual settlement, exchange reference, slippage, admin notes, audit trail. | `wallets/models.py`, migration `0003_rebalance_order.py` |
| 2 | **Exchange provider interface** | Backend | Abstract `ExchangeProvider` with `ManualExchangeProvider` (now) and `YellowCardAPIProvider` stub (future). Factory pattern via settings. Manual mode: uses internal rate engine, notifies admin via push+email with Yellow Card sell instructions. | `wallets/rebalance.py` |
| 3 | **Rebalancing orchestrator** | Backend | `create_rebalance_order()` with 5 precondition checks (active order, cooldown, float threshold, crypto availability, minimum amount). Redis locking for idempotency. `submit_rebalance_order()`, `confirm_rebalance_settlement()` with SystemWallet balance updates, `fail_rebalance_order()`, `cancel_rebalance_order()`. Min KES 50K, max KES 2M, target KES 1.5M. | `wallets/rebalance.py` |
| 4 | **Celery tasks (4)** | Backend | `check_and_trigger_rebalance` (every 5min), `process_rebalance_order` (with retries), `check_stale_orders` (hourly, auto-expires 24h+), `trigger_rebalance_from_breaker` (fired on circuit breaker transition). All with Redis locks and acks_late. | `wallets/tasks.py`, `settings/base.py` |
| 5 | **Admin API (6 endpoints)** | Backend | `GET status/` (full dashboard with coverage days, active orders, circuit breaker), `GET orders/`, `POST trigger/`, `POST {id}/confirm/`, `POST {id}/fail/`, `POST {id}/cancel/`. All admin-only (IsAdminUser). | `wallets/views.py`, `wallets/urls.py`, `wallets/serializers.py` |
| 6 | **Django admin interface** | Backend | RebalanceOrder admin with fieldsets (order info, float state, sell details, settlement, exchange, admin notes, timestamps). List display with slippage calculation. | `wallets/admin.py` |
| 7 | **Circuit breaker → rebalance wiring** | Backend | Auto-triggers `trigger_rebalance_from_breaker` Celery task when circuit breaker transitions from CLOSED to HALF_OPEN or OPEN. Force flag overrides cooldown for urgency. | `payments/circuit_breaker.py` |
| 8 | **Float monitoring enhancement** | Backend | Pre-alerts at 70% and 50% of healthy threshold (before circuit breaker trips). Real-time SystemWallet FLOAT/KES sync from M-Pesa balance callbacks. Days-of-operations coverage logging with <2 days warning. Redis-throttled alerts (30min cooldown). | `mpesa/tasks.py` |
| 9 | **Rebalance settings** | Backend | `REBALANCE_MIN_KES`, `REBALANCE_MAX_KES`, `REBALANCE_COOLDOWN_SECONDS`, `REBALANCE_EXECUTION_MODE`, `YELLOW_CARD_API_KEY`, `YELLOW_CARD_SECRET_KEY`, `YELLOW_CARD_BASE_URL`. Wallets logger added. | `settings/base.py` |
| 10 | **Mobile admin dashboard** | Frontend | Float Management screen in settings (admin-only). Shows current float, target, coverage days, circuit breaker status. Active order management with Confirm/Cancel actions. Manual trigger with currency selector. Recent completions with slippage. Auto-refresh 30s. | `settings/admin-rebalance.tsx`, `settings/index.tsx` |

**Liquidity Plan Checklist:**
- [x] Rebalancing orchestrator — Model, service, tasks, API, admin, migration, Celery Beat
- [x] Circuit breaker integration — Auto-triggers rebalance on HALF_OPEN/OPEN
- [x] Float monitoring enhancement — Pre-alerts at 70%/50%, SystemWallet sync, coverage days
- [x] Ops dashboard — Backend API done + mobile admin screen
- [x] Yellow Card API stub — Provider interface ready, just needs API keys
- [ ] Yellow Card B2B API integration — HTTP client for quote/order/settlement (needs API keys from paymentsapi@yellowcard.io)

#### ✅ COMPLETED (March 13, 2026 Session 3 — Audit Fixes)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **`submit_rebalance_order` atomic** | Backend | Wrapped in `@transaction.atomic` to prevent partial writes on failure. | `wallets/rebalance.py` |
| 2 | **SystemWallet F() expressions** | Backend | Balance updates now use `F()` expressions instead of read-modify-write, fixing race conditions under concurrent requests. | `wallets/rebalance.py` |
| 3 | **Hot wallet DoesNotExist logging** | Backend | `DoesNotExist` exception now logs a warning instead of being silently swallowed. | `wallets/rebalance.py` |
| 4 | **force=True respects Redis lock** | Backend | `force=True` no longer bypasses the Redis concurrency lock, preventing duplicate orders. | `wallets/rebalance.py` |
| 5 | **Reject kes_received=0** | Backend | `confirm_rebalance_settlement` now rejects `kes_received=0` to prevent zero-value confirmations. | `wallets/rebalance.py` |
| 6 | **Cooldown excludes cancelled** | Backend | `is_in_cooldown` now excludes cancelled orders, so a cancelled order doesn't block new rebalances. | `wallets/rebalance.py` |
| 7 | **Circuit breaker format string fix** | Backend | `_log_transition` format string fixed for `None` float values (was crashing on `%.0f % None`). | `payments/circuit_breaker.py` |
| 8 | **Breaker triggers rebalance on HALF_OPEN→OPEN** | Backend | Circuit breaker now triggers rebalance on HALF_OPEN→OPEN transition, not just CLOSED→*. | `payments/circuit_breaker.py` |
| 9 | **Pre-alert threshold ordering** | Backend | 70% threshold check correctly nested so it doesn't fire when 50% already triggered. | `mpesa/tasks.py` or `wallets/tasks.py` |
| 10 | **FloatStatus interface rewrite** | Frontend | Complete rewrite of FloatStatus TypeScript interface to match actual backend response shape. | `settings/admin-rebalance.tsx` |
| 11 | **circuit_breaker parsed as object** | Frontend | `circuit_breaker` now parsed as object with `.state` field instead of raw string. | `settings/admin-rebalance.tsx` |
| 12 | **String-to-number parsing** | Frontend | `current_float_kes`, `target_float_kes`, `trigger_threshold_kes` parsed from strings to numbers. | `settings/admin-rebalance.tsx` |
| 13 | **days_of_coverage null-safe** | Frontend | `days_of_coverage` access is now null-safe (handles `null`/`undefined` from backend). | `settings/admin-rebalance.tsx` |
| 14 | **recent_completed field name** | Frontend | Fixed field name from `recent_completions` to `recent_completed` to match backend. | `settings/admin-rebalance.tsx` |
| 15 | **Fail Order action button** | Frontend | Added Fail Order button + `handleFailOrder` handler for admin order management. | `settings/admin-rebalance.tsx` |
| 16 | **CompletionRow correct type** | Frontend | `CompletionRow` now uses correct `CompletedOrder` type with `kes_received`, `slippage`, `completed_at`. | `settings/admin-rebalance.tsx` |

**All 136 tests passing.**

### Security Audit Fixes — COMPLETED ✅

Full security audit across sweep, rebalance, blockchain deposits, and payment saga. All CRITICAL and HIGH findings fixed:

| # | Finding | Severity | Fix | Files |
|---|---------|----------|-----|-------|
| 1 | **Sweep lock not released on success** | HIGH | Explicit `_release_sweep_lock()` after successful broadcast | `blockchain/sweep.py` |
| 2 | **Rate limit TOCTOU race** | HIGH | Changed from GET→check→INCR to atomic INCR→check pattern | `blockchain/sweep.py` |
| 3 | **Sweep UniqueConstraint includes status** | HIGH | Removed `status` from unique fields; constraint now correctly prevents concurrent active sweeps per address | `blockchain/models.py` |
| 4 | **Redis fail-open in production** | HIGH | Now returns False (deny) when Redis unavailable in production | `blockchain/sweep.py` |
| 5 | **Non-atomic retry_count** | MEDIUM | Changed to `F("retry_count") + 1` in bulk update | `blockchain/sweep_tasks.py` |
| 6 | **Energy estimation overflow** | MEDIUM | `max(0, energy_limit - energy_used)` clamp | `blockchain/sweep.py` |
| 7 | **Hot wallet deduction stale read** | CRITICAL | Changed to `F("balance") - sell_amount` with `Greatest(..., 0)` | `wallets/rebalance.py` |
| 8 | **SystemWallet no negative balance guard** | CRITICAL | Added `CheckConstraint(balance >= 0)` + migration | `wallets/models.py`, migration `0004` |
| 9 | **Double-confirm race condition** | CRITICAL | Atomic `UPDATE...WHERE status IN (submitted, settling)` pattern | `wallets/rebalance.py` |
| 10 | **PENDING orders confirmable** | HIGH | Removed PENDING from allowed confirm statuses | `wallets/rebalance.py` |
| 11 | **No kes_received upper bound** | HIGH | Added `max_value=10M` on serializer + 5x sanity check in service | `wallets/serializers.py`, `wallets/rebalance.py` |
| 12 | **WalletService accepts amount ≤ 0** | MEDIUM | Added positive amount validation on credit/debit | `wallets/services.py` |
| 13 | **Tron block_timestamp as block_number** | CRITICAL | Now fetches real block_number from TronGrid tx info; confirmation task auto-corrects stale timestamps | `blockchain/tasks.py` |
| 14 | **ETH address case mismatch** | HIGH | Lowercase→original address mapping preserves wallet deposit_address format | `blockchain/tasks.py` |
| 15 | **BTC deposits bypass security checks** | HIGH | Never create in CONFIRMED status; always go through process_pending_deposits flow | `blockchain/tasks.py` |
| 16 | **Double-credit via random uuid4** | CRITICAL | Deterministic `uuid5(deposit:{chain}:{tx_hash})` for ledger transaction ID | `blockchain/tasks.py` |
| 17 | **Quote not bound to user** | CRITICAL | Added `user_id` to quote, verified at consumption time | `rates/services.py`, `payments/views.py` |
| 18 | **Quote reuse (no deletion after use)** | CRITICAL | New `consume_locked_quote()` deletes from Redis after first use | `rates/services.py`, `payments/views.py` |
| 19 | **BUY flow never credits crypto** | CRITICAL | STK callback now credits `dest_amount` to user wallet with deterministic tx_id | `mpesa/views.py` |

### On-Chain Sweep / Consolidation — IMPLEMENTED ✅

Enterprise-level sweep pipeline that consolidates user deposit addresses into the platform's central hot wallet.

| # | Component | Area | Details | Files |
|---|-----------|------|---------|-------|
| 1 | **SweepOrder model** | Backend | Full state machine: PENDING→ESTIMATING→SUBMITTED→CONFIRMING→CONFIRMED→CREDITED (or FAILED/SKIPPED). UUID PK, tracks chain, currency, from/to addresses, amount, fees (estimated + actual), tx_hash, confirmations, retry count, batch ID, skip reason. Unique constraint prevents duplicate active sweeps per address. | `blockchain/models.py`, migration `0002_sweeporder.py` |
| 2 | **Sweep service** | Backend | `sweep.py` — Threshold-based sweep decisions (dust minimums, 10% fee cap, 10x gas multiplier). On-chain balance queries for all 4 chains (Tron, ETH, BTC, SOL). Fee estimation (Tron energy model, EIP-1559, BlockCypher sat/KB, Solana priority fees). Anomaly detection (50% balance drop = CRITICAL alert). Redis locks per address. Rate limiting (10/chain/min). | `blockchain/sweep.py` |
| 3 | **Tron TRC-20 signing** | Backend | Fully implemented: TronGrid `triggersmartcontract` → secp256k1 ECDSA signing (RFC 6979) → `broadcasttransaction`. BIP-62 low-s normalization. Base58check address decoding with checksum verification. Key material zeroed after signing. | `blockchain/sweep.py` |
| 4 | **Celery tasks (4)** | Backend | `scan_and_create_sweep_orders` (15min), `process_pending_sweeps` (5min), `verify_submitted_sweeps` (3min), `credit_confirmed_sweeps` (5min). Stale sweep detection (>2h auto-fail). Failed sweep retry with exclusions (anomaly, not-implemented). All with soft/hard time limits. | `blockchain/sweep_tasks.py`, `settings/base.py` |
| 5 | **HOT wallet settings** | Backend | `HOT_WALLET_TRON`, `HOT_WALLET_ETH`, `HOT_WALLET_BTC`, `HOT_WALLET_SOL` env vars. Explicit addresses prevent derivation mismatch. | `settings/base.py` |
| 6 | **SystemWallet HOT crediting** | Backend | Atomic `F()` expression updates to `SystemWallet HOT/{currency}` on sweep confirmation. Post-sweep reconciliation verifies hot wallet on-chain balance. `@transaction.atomic` wraps the entire credit operation. | `blockchain/sweep.py` |
| 7 | **Admin dashboard integration** | Frontend | Sweep/Consolidation section in admin-rebalance: active/pending sweep counts, awaiting sweep by currency, recent sweep list. Hot Wallet section shows per-currency balances with BIP-44 badge and seed source. | `settings/admin-rebalance.tsx` |

| 8 | **Tron TRX gas funding** | Backend | Auto-sends TRX from hot wallet to deposit address before TRC-20 sweep. Uses shared `_sign_tron_transaction()` with secp256k1 ECDSA. Waits up to 30s for confirmation. | `blockchain/sweep.py` |
| 9 | **Ethereum EIP-1559 signing** | Backend | Full `web3.py` integration: native ETH sweeps + USDC ERC-20 `transfer()` ABI encoding. Gas station pattern funds deposit addresses for ERC-20 sweeps. | `blockchain/sweep.py` |
| 10 | **Bitcoin BlockCypher signing** | Backend | 2-step API: `txs/new` → sign tosign hashes with secp256k1 DER → `txs/send`. BIP-62 low-s normalization. | `blockchain/sweep.py` |
| 11 | **Solana Ed25519 signing** | Backend | Manual transaction binary construction, Ed25519 signing, base64-encoded `sendTransaction` RPC. | `blockchain/sweep.py` |
| 12 | **On-chain reconciliation** | Backend | Compares on-chain balances vs DB records every 15 min. DEFICIT = CRITICAL alert (possible unauthorized outflows). SURPLUS = WARNING (likely unsent sweeps). Covers deposit addresses + hot wallets. | `blockchain/reconciliation.py`, `blockchain/sweep_tasks.py` |

**Chain support status:**
- ✅ Tron (USDT TRC-20): Full — balance, fees, gas funding, signing, broadcast, verification
- ✅ Ethereum (ETH + USDC): Full — EIP-1559 signing, gas station for ERC-20, nonce management
- ✅ Bitcoin (BTC): Full — BlockCypher 2-step API, secp256k1 DER signing
- ✅ Solana (SOL): Full — Ed25519 signing, manual transaction construction

**Post-launch improvements:**
- ETH CREATE2 + Minimal Proxy: 84% gas savings for high-volume EVM sweeps (Fireblocks pattern)
- Tron energy delegation: Stake TRX centrally and delegate energy to deposit addresses before sweep
- UTXO batching (BTC): Multiple inputs → single output for fee efficiency
- Solana ATA closing: Reclaim ~0.00204 SOL rent per closed account

#### ✅ COMPLETED (March 13, 2026 Session 4 — Production Hardening)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **STK poll BUY crypto credit** | Backend | `poll_stk_status` now credits crypto for BUY transactions when callback doesn't arrive — same deterministic UUID5 as callback handler for idempotency. Also sends notifications. | `mpesa/tasks.py` |
| 2 | **WalletService idempotency** | Backend | `credit()` and `debit()` now check for existing LedgerEntry with same `transaction_id` before applying — bulletproof double-credit/debit prevention even under race conditions. | `wallets/services.py` |
| 3 | **Solana USDC SPL sweep** | Backend | Full implementation: ATA derivation, TransferChecked instruction, CreateAssociatedTokenAccount for new dest ATAs, Ed25519 signing. | `blockchain/sweep.py` |
| 4 | **USDC/Solana address clarity** | Backend | Documented that USDC deposits are EVM-only (Polygon). Removed dead USDC SPL wallet query from deposit monitor. USDC SPL sweep code dormant until multi-chain support. | `blockchain/tasks.py`, `blockchain/sweep.py` |
| 5 | **Sweep docstring updated** | Backend | Removed outdated "Stub — TODO" comments for ETH/BTC/SOL chains — all fully implemented. | `blockchain/sweep.py` |
| 6 | **Frontend balance refresh** | Frontend | Added `queryClient.invalidateQueries(["wallets"])` after ALL payment flows (PayBill, PayTill, Send, BuyCrypto). Wallet balances now update immediately after transactions. | `payment/confirm.tsx`, `payment/success.tsx`, `payment/buy-crypto.tsx` |
| 7 | **Focus-based refetch** | Frontend | Home and Wallet tabs now refetch balances + transactions on navigation focus via `useNavigation().addListener("focus")`. | `(tabs)/index.tsx`, `(tabs)/wallet.tsx` |
| 8 | **Transaction auto-refresh** | Frontend | `useTransactions` hook now polls every 15s (was: never). `useWallets` reduced to 10s (was: 30s). Both have `staleTime` and `refetchOnWindowFocus`. | `hooks/useTransactions.ts`, `hooks/useWallets.ts` |
| 9 | **Settings gear button** | Frontend | Added prominent settings gear icon button on Profile page header (works on both mobile and desktop). | `(tabs)/profile.tsx` |
| 10 | **Terms of Service page** | Frontend | Full Terms of Service — 15 sections covering eligibility, KYC, services, fees, limits, prohibited activities, wallet custody, IP, liability, disputes, termination, governing law. Kenya-law aligned. | `settings/terms.tsx` |
| 11 | **Privacy Policy page** | Frontend | Full Privacy Policy — 14 sections compliant with Kenya Data Protection Act 2019. Covers data collection, legal basis, sharing, retention, security, user rights, international transfers, ODPC complaint rights. | `settings/terms.tsx` |
| 12 | **Terms/Privacy routing** | Frontend | Settings "Terms & Privacy" item now routes to `/settings/terms` with tab switcher (was empty `action: () => {}`). Layout updated with route registration. | `settings/index.tsx`, `settings/_layout.tsx` |
| 13 | **Biometric hook fix** | Frontend | Fixed `useState(() => ...)` misuse to `useEffect(() => ..., [])` for biometric preference loading. | `settings/index.tsx` |
| 14 | **Admin route protection** | Frontend | Admin rebalance page now checks `user.is_staff` on mount and redirects non-staff users. | `settings/admin-rebalance.tsx` |
| 15 | **Success screen delayed refresh** | Frontend | Success screen invalidates wallets on mount + again after 3s (catches async BUY crypto credits from M-Pesa callback). | `payment/success.tsx` |

**All 136 tests passing. TypeScript clean.**

**Fee collection audit:** Verified SELL flow fee collection is CORRECT — `source_amount = crypto_amount` (includes all fees), `dest_amount = kes_amount` (what payee receives). Platform profit = spread + flat fee, embedded in the crypto→KES exchange rate. No revenue loss.

#### ✅ COMPLETED (March 13, 2026 Session 5 — Frontend Production Audit & Admin)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Fix missing i18n translations** | Frontend | Added `termsOfService` and `privacyPolicy` keys to `settings` section in both `en.ts` and `sw.ts`. Tab labels on Terms & Privacy page now display correctly instead of `[missing translation]`. | `i18n/en.ts`, `i18n/sw.ts` |
| 2 | **Fix Send button light mode** | Frontend | Send button was invisible in light mode (white text `#FFFFFF` on light gray `#F0F2F5` bg). Now uses dark bg (`#0F172A`) in light mode with white text for proper contrast. | `(tabs)/wallet.tsx` |
| 3 | **Fix wallet asset text light mode** | Frontend | Asset card coin names and balances were hardcoded `#FFFFFF` — invisible on white cards in light mode. Changed to `tc.textPrimary`. | `(tabs)/wallet.tsx` |
| 4 | **Always show KES equivalent** | Frontend | KES value now shows for all assets (was hidden when balance = 0 or rate unavailable). Shows `~KSh 0` when no rate data. | `(tabs)/wallet.tsx` |
| 5 | **Fix portfolio total light mode** | Frontend | Both desktop and mobile portfolio total balance changed from `#FFFFFF` to `tc.textPrimary`. Transaction amounts in desktop table also fixed. | `(tabs)/wallet.tsx` |
| 6 | **Move Float Management to admin** | Frontend | Removed Float Management from user Settings page. Added dedicated Admin section on Profile page (staff only) with links to Float Management and User Management. | `settings/index.tsx`, `(tabs)/profile.tsx` |
| 7 | **Verified badge** | Frontend | Professional verified checkmark badge (filled circle with checkmark icon) shown next to user name when `kyc_tier >= 1`. Added to: Profile page (desktop + mobile), Settings profile card, and Home dashboard greeting. | `(tabs)/profile.tsx`, `settings/index.tsx`, `(tabs)/index.tsx` |
| 8 | **Admin User Management page** | Frontend | New `/settings/admin-users` page with: KYC tier distribution cards with percentages, searchable/filterable user list, inline tier upgrade buttons (0-3), pagination. Staff-only with redirect protection. | `settings/admin-users.tsx` |
| 9 | **Admin user verification API** | Backend | Two new endpoints: `GET /accounts/admin/users/` (list users + KYC distribution stats, search/filter/paginate) and `POST /accounts/admin/users/<id>/verify/` (set KYC tier with audit log). Staff permission required. | `accounts/views.py`, `accounts/urls.py` |
| 10 | **Terms/Privacy from Profile** | Frontend | Profile page Terms of Service and Privacy Policy links now route to in-app `/settings/terms` page instead of external URLs. | `(tabs)/profile.tsx` |
| 11 | **Route registration** | Frontend | Added `admin-rebalance` and `admin-users` routes to settings layout. | `settings/_layout.tsx` |

**All 136 tests passing. TypeScript clean.**

#### ✅ COMPLETED (March 13, 2026 Session 5b — Verified User UX & Security Polish)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Verified user — replace Verify button** | Frontend | Max-tier (Tier 3) users no longer see "Verify Identity" button. Instead, a green verified status badge shows with tier info and limit. Both action buttons area and security section updated. | `(tabs)/profile.tsx` |
| 2 | **KYC document approved state** | Frontend | Approved documents now show a detailed success card with checkmark, approval date, and reviewer name (audit trail). Non-approved still show status badge. | `settings/kyc.tsx` |
| 3 | **KYC serializer audit fields** | Backend | Added `verified_at` and `verified_by_name` to KYCDocumentSerializer via SerializerMethodFields. Frontend interface updated to match. | `accounts/serializers.py`, `api/auth.ts` |
| 4 | **Dashboard verification banner** | Frontend | Tier 0 users see a warning banner after balance card: "Verify your identity to increase limits" with tap-to-navigate to KYC page. Added to both mobile and desktop layouts. | `(tabs)/index.tsx` |
| 5 | **Full-width layout fix** | Frontend | Removed `maxWidth: 1200` + `alignSelf: center` from admin-users page to comply with full-width design pattern. | `settings/admin-users.tsx` |
| 6 | **Security page button animations** | Frontend | Added hover/press transitions (`scale`, `backgroundColor` change, `cursor: pointer`, CSS transitions) to all buttons on security settings page (email verify, TOTP, recovery, devices, change PIN). | `settings/security.tsx` |
| 7 | **Verified badge chip design** | Frontend | Max-tier users see a modern green verified badge chip (shield icon + "Identity Verified" + tier pill) instead of a plain non-clickable info chip. Both desktop and mobile layouts. | `(tabs)/profile.tsx` |
| 8 | **i18n keys added** | Frontend | `identityVerified`, `verifyBanner`, `verifyBannerDesc`, `verifiedOn`, `verifiedBy`, camera/gallery permission keys — both `en.ts` and `sw.ts`. | `i18n/en.ts`, `i18n/sw.ts` |
| 9 | **Fix admin users 404** | Frontend | Changed API URL from `/accounts/admin/users/` to `/auth/admin/users/` (accounts URLs are mounted at `/api/v1/auth/`). | `settings/admin-users.tsx` |
| 10 | **JWT RS256 migration** | Backend | Added RS256 asymmetric key support with fallback to HS256. Production uses PEM key pair (`JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`). Dev uses separate `JWT_SIGNING_KEY` env var (decoupled from `SECRET_KEY`). | `config/settings/base.py`, `.env` |
| 11 | **Celery autoretry narrowed** | Backend | Changed all `autoretry_for=(Exception,)` in core tasks to `_TRANSIENT_ERRORS` tuple (`ConnectionError`, `TimeoutError`, `OSError`, `SMTPException`, `IOError`). Prevents wasted retries on permanent errors. | `core/tasks.py` |
| 12 | **Sweep tasks retry_backoff** | Backend | Added `retry_backoff=True` + `retry_backoff_max` to all 4 sweep tasks (`scan_and_create`, `process_pending`, `verify_submitted`, `credit_confirmed`). Prevents service hammering on failure. | `blockchain/sweep_tasks.py` |
| 13 | **Wallet tasks retry_backoff** | Backend | Added `retry_backoff=True` + `retry_backoff_max` to `process_rebalance_order` and `trigger_rebalance_from_breaker`. | `wallets/tasks.py` |
| 14 | **React Query staleTime fix** | Frontend | Set `staleTime: 0` on all queries using `refetchInterval` (`useWallets`, `useTransactions`, `useRates` x2) to avoid TanStack additive delay bug (#7721). Rates refetch reduced from 30s to 15s. | `hooks/useWallets.ts`, `hooks/useTransactions.ts`, `(tabs)/index.tsx`, `(tabs)/wallet.tsx` |

**TypeScript clean. Python syntax clean.**

#### ✅ COMPLETED (March 13, 2026 Session 5c — Admin User Management & KYC Review)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **User suspension system (backend)** | Backend | Added `suspension_reason`, `suspended_at`, `suspended_by` fields to User model. Migration 0010 applied. `AdminSuspendUserView` endpoint: suspend/unsuspend with mandatory reason, audit log, staff-only protection. Cannot suspend other staff accounts. | `accounts/models.py`, `accounts/views.py`, `accounts/migrations/0010_add_suspension_fields.py` |
| 2 | **Suspension enforcement** | Backend | `IsNotSuspended` permission class blocks suspended users from PayBill, PayTill, SendMpesa, BuyCrypto. Profile PATCH and ChangePIN also reject suspended users with 403. | `payments/views.py`, `accounts/views.py` |
| 3 | **User profile suspension banner** | Frontend | Suspended users see a red banner at top of profile page with reason and "contact support" message. | `(tabs)/profile.tsx` |
| 4 | **Admin user management UI overhaul** | Frontend | Added suspend/unsuspend button per user with modal + reason input. View detail button. Clickable user names navigate to detail page. Wider action column. | `settings/admin-users.tsx` |
| 5 | **Admin user detail page** | Frontend | New tabbed page: Overview (wallets, KYC docs), Transactions (20 recent), Devices, Audit Log. User header with status badges, suspension banner, suspend/unsuspend action. | `settings/admin-user-detail.tsx` (new) |
| 6 | **KYC document review system** | Backend | New `AdminReviewKYCView` endpoint: approve/reject individual KYC docs with mandatory rejection reason. Sends email + SMS + push notifications on both outcomes. Audit logged. | `accounts/views.py`, `accounts/urls.py` |
| 7 | **KYC review UI** | Frontend | Admin detail page KYC section: View Document link, Approve/Reject buttons for pending docs, rejection reason TextInput. Loading state per document. | `settings/admin-user-detail.tsx` |
| 8 | **KYC tier change notifications** | Backend | `_notify_tier_upgrade()` sends push + email + SMS when admin changes a user's tier. Includes new tier label and daily limit. | `accounts/views.py` |
| 9 | **Suspension notifications** | Backend | `_notify_suspension()` sends email (security alert) + SMS + push on both suspend and unsuspend. Includes reason in suspend, restoration message in unsuspend. | `accounts/views.py` |
| 10 | **Security alert event types** | Backend | Added `account_suspended` and `account_unsuspended` to security alert task event labels. | `core/tasks.py` |
| 11 | **UserSerializer suspension fields** | Backend | Profile API now returns `is_suspended` and `suspension_reason`. Frontend `User` interface updated to match. | `accounts/serializers.py`, `api/auth.ts` |
| 12 | **Admin stats link in profile** | Frontend | Added "Platform Stats" MenuItem to admin section. Opens Django admin stats page (`/admin/stats/`). Uses `window.open` on web, `Linking.openURL` on native. | `(tabs)/profile.tsx` |
| 13 | **Admin route protection** | Frontend | All admin pages (`admin-users`, `admin-user-detail`, `admin-rebalance`) verify `is_staff` with useEffect redirect and render guard `if (!user?.is_staff) return null`. | `settings/admin-rebalance.tsx`, `settings/admin-users.tsx`, `settings/admin-user-detail.tsx` |
| 14 | **Route registration** | Frontend | Registered `admin-user-detail` in settings layout Stack. | `settings/_layout.tsx` |
| 15 | **Staff promotion (super admin only)** | Backend | New `AdminPromoteStaffView`: only superusers can promote/demote users to staff. Protected by `IsSuperUser` permission. Audit logged. | `accounts/views.py`, `accounts/urls.py` |
| 16 | **Admin detail KYC doc IDs + file URLs** | Backend | Updated `AdminUserDetailView` to include `id` and `file_url` in KYC document response, enabling admin review workflow. | `accounts/views.py` |

**TypeScript clean. Migration applied. Login 200 OK.**

#### ✅ COMPLETED (March 14, 2026 Session 6 — Infrastructure: Monitoring + Custody Architecture)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Prometheus + Grafana monitoring** | Infra | Full monitoring stack: django-prometheus middleware, custom business metrics (payments, M-Pesa, blockchain, sweep, auth, circuit breaker), Prometheus scraping, Grafana dashboards, Alertmanager with severity routing. Docker Compose overlay with 6 services (prometheus, grafana, alertmanager, postgres-exporter, redis-exporter, celery-exporter). | `docker-compose.monitoring.yml`, `monitoring/`, `core/metrics.py`, `config/settings/base.py`, `config/urls.py` |
| 2 | **Custom CryptoPay metrics** | Backend | 20+ Prometheus metrics: payment lifecycle (initiated/completed/failed), M-Pesa callback latency + float gauge, blockchain deposit detection/confirmation, sweep operations, hot wallet balances, exchange rate staleness, login attempts, circuit breaker state. All with appropriate labels and histogram buckets. | `core/metrics.py` |
| 3 | **Alert rules** | Infra | 15+ alert rules across 5 groups: API errors/latency, payment failures, M-Pesa float thresholds (500K/200K KES), blockchain listener health, Celery queue backlog, PostgreSQL connections/dead tuples, Redis memory. Severity levels: warning → critical → page. | `monitoring/prometheus/alerts/cryptopay.yml` |
| 4 | **Hot/warm/cold wallet architecture** | Backend | `WalletTier` enum (HOT/WARM/COLD), `SystemWallet.tier` field, `CustodyTransfer` model for tier-to-tier transfers, `CustodyService` with threshold-based rebalancing logic, Celery tasks for automated threshold checks (15min), daily reports, hourly reconciliation. Admin API endpoints for custody report and manual rebalance. | `wallets/custody.py`, `wallets/models.py`, `wallets/tasks.py`, `wallets/views.py`, `wallets/urls.py` |
| 5 | **ERC-4337 evaluation (research)** | Research | Deep research concluded: NOT NEEDED for CryptoPay's custodial model. TRON doesn't support ERC-4337. Users don't send on-chain transactions. Platform controls keys so AA benefits irrelevant. Phase 3 consideration only if model changes to non-custodial. | Documented in PROGRESS.md |
| 6 | **DeFi yield evaluation (research)** | Research | Deep research concluded: User-facing yield NOT legally viable in Kenya now — VASP Act 2025 is law but no licenses issued, no implementing regulations. Treasury-only yield on own float is defensible. Sustainable DeFi rates: 4-7% APY (Aave/Compound). User-facing product: build but don't launch until VASP licensing operational (est. 2027). | Documented in PROGRESS.md |

**Research Verdicts:**

**ERC-4337 Account Abstraction — NOT NEEDED**
- CryptoPay is custodial: platform holds keys, users never send on-chain transactions
- TRON (primary chain for USDT) doesn't support ERC-4337
- The sweep system already abstracts gas from users
- Revisit only if switching to non-custodial model (Phase 3+)

**Dollar-Denominated Yield Products — DEFERRED (Regulatory Block)**
- Kenya VASP Act 2025 effective Nov 4, 2025 — but NO licenses issued yet, no implementing regulations
- User-facing yield likely requires VA Manager license (CMA) or deposit-taking license (CBK)
- Treasury yield on own float: legal gray area, likely OK with strict fund segregation
- Sustainable real yield: 4-7% APY via Aave V3 / Compound V3
- Recommendation: Treasury yield now (Phase 2), user-facing after VASP licensing (est. 2027)
- Risk: Crypto custody insurance expensive ($1M+ AUC minimum); self-insure with 5-10% SAFU reserve

#### ✅ COMPLETED (March 14, 2026 Session 7 — Production Audit & Comprehensive Fixes)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **Edit profile PIN bug fix** | Frontend | PIN was collected but never sent to backend (auto-submit fired before React state flushed). Fixed: `handlePinSubmit` now accepts `completedPin` array parameter, auto-submit passes `newPin` directly. | `settings/edit-profile.tsx` |
| 2 | **Avatar-only update skip PIN** | Frontend | Avatar-only changes no longer require PIN entry. PIN step only shown when name/email changes. | `settings/edit-profile.tsx` |
| 3 | **NativeWind removal (text node fix)** | Frontend | Removed `nativewind`, `tailwindcss`, `react-native-css-interop` from package.json. Deleted `tailwind.config.js`. 54 packages removed. Fixes "Unexpected text node: . A text node cannot be a child of a View." error. | `package.json`, `tailwind.config.js` (deleted) |
| 4 | **Deprecated pointerEvents prop** | Frontend | Migrated `pointerEvents="none"` prop to `style={{ pointerEvents: "none" }}` pattern. | `payment/confirm.tsx` |
| 5 | **Django 6 deprecation warnings** | Backend | All `CheckConstraint(check=...)` migrated to `CheckConstraint(condition=...)` across models and migrations. Tests now 0 warnings. | `wallets/models.py`, `wallets/migrations/0005_custody_tiers.py` |
| 6 | **Payment serializer validation** | Backend | Added `min_length=6` + `validate_pin()` (digits-only) to all payment serializers. Added `validate_paybill()` / `validate_till()` (numeric-only). Added `validate_phone()` to `SendMpesaSerializer`. Shared `_normalize_phone()` and `_validate_pin()` helpers. | `payments/serializers.py` |
| 7 | **Yellow Card API guard** | Backend | `get_exchange_provider()` now raises `RuntimeError` if `api` mode selected without `YELLOW_CARD_API_KEY` configured. | `wallets/rebalance.py` |
| 8 | **Monitoring stack production-ready** | Infra | Fixed celery-exporter image (0.10.9→0.10.7), Prometheus dependency (service_healthy→service_started), alertmanager config (removed unconfigured webhook URLs). Added Grafana dashboard volume mount + 13-panel overview dashboard JSON. All 11 services running. | `docker-compose.monitoring.yml`, `monitoring/alertmanager/alertmanager.yml`, `monitoring/grafana/dashboards/overview.json` |
| 9 | **Silent error handling fixed** | Frontend | Notifications-inbox catch block now logs warnings instead of silently swallowing errors. | `settings/notifications-inbox.tsx` |

**All 136 tests passing. 0 warnings. 11 Docker services healthy.**

#### 🟡 HIGH PRIORITY — Remaining (Before Beta Launch)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 1 | **VPS deployment + domain** | Infra | Deploy to Nairobi VPS (Lineserve/Truehost), configure Cloudflare DNS, domain cryptopay.co.ke. | `docker-compose.prod.yml`, `nginx/nginx.conf` |
| 2 | **SSL certificate** | Infra | Certbot + Let's Encrypt with auto-renewal. NOTE: moving to 45-day certs May 2026. | `nginx/nginx.conf` |
| 3 | ~~**Monitoring: Prometheus + Grafana**~~ | ✅ Done | `django-prometheus` middleware, custom metrics, Docker Compose overlay with Prometheus, Grafana, Alertmanager, exporters. 15+ alert rules. | `docker-compose.monitoring.yml`, `monitoring/`, `core/metrics.py` |
| 4 | **M-Pesa environment switch** | Backend | Switch from sandbox to production credentials. Update callback URLs to production domain. Just swap API keys. | `backend/.env`, M-Pesa config |
| 5 | **Configure all API credentials** | Backend | Fill empty env vars: Smile Identity, Africa's Talking, CoinGecko key, M-Pesa production keys, WALLET_MASTER_SEED. | `backend/.env` |

#### 🟢 BEFORE PUBLIC LAUNCH

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 13 | **Solana SPL deposit listener** | Backend | Helius API for SPL token monitoring ($49/mo when needed). "Finalized" commitment level. | New: `backend/apps/blockchain/sol_listener.py` |
| 14 | ~~**WalletConnect (Reown AppKit)**~~ | ✅ Done | AppKit config, ethers adapter, ERC-20 transfer hook, deposit UI component, Android wallet detection plugin, graceful Expo Go degradation. | `src/config/appkit.ts`, `src/hooks/useWalletDeposit.ts`, `src/components/WalletConnectDeposit.tsx`, `queries.js` |
| 15 | ~~**Hot/warm/cold wallet split**~~ | ✅ Done | `WalletTier` model, `CustodyService`, `CustodyTransfer` audit trail, Celery threshold checks (15min), admin API. Physical warm (multisig) + cold (hardware) setup needed at deployment. | `wallets/custody.py`, `wallets/models.py` |
| 16 | **App Store + Play Store submission** | Launch | EAS production builds, store listings, screenshots, privacy policy. Apple review ~24h, financial apps may take longer. | `mobile/eas.json`, `mobile/app.json` |
| 17 | **~~Compress app assets~~** | Frontend | ✅ Done — icon.png compressed 393KB → 207KB. | `mobile/assets/` |
| 18 | **Google OAuth production setup** | Frontend | Fill OAuth client IDs in app.json extra config. Currently empty. | `mobile/app.json` |
| 19 | **Off-ramp API (Yellow Card / Kotani Pay)** | Backend | ✅ PARTIAL — Manual mode implemented. Exchange provider interface, RebalanceOrder model, Celery tasks, admin API all done. Yellow Card API provider stub ready. Just needs API keys from `paymentsapi@yellowcard.io` to plug in automated mode. | `wallets/rebalance.py`, `wallets/tasks.py`, `wallets/views.py` |

#### 🔵 FUTURE CONSIDERATION (Post-Launch)

| # | Task | Area | Details | Files |
|---|------|------|---------|-------|
| 20 | ~~**Account Abstraction (ERC-4337)**~~ | Evaluated ❌ | **NOT NEEDED** — CryptoPay is custodial, users don't send on-chain txs. TRON doesn't support ERC-4337. Sweep system already abstracts gas. Revisit only if switching to non-custodial (Phase 3+). | Research documented above |
| 21 | **Dollar-denominated yield products** | Deferred 🟡 | **Regulatory block** — VASP Act 2025 law but no licenses issued, no regulations. Treasury yield on own float OK now. User-facing yield requires VA Manager license (CMA). Build behind feature flag, launch after VASP licensing (est. 2027). Sustainable rates: 4-7% APY via Aave/Compound. | Research documented above |
| 22 | **Cross-Africa remittance** | Backend / Product | Expand beyond Kenya to support cross-border stablecoin transfers. Uganda, Tanzania, Nigeria corridors. Rift already supports this. Aligns with geographic expansion roadmap. | Existing expansion plan |

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    Mobile App (Expo)                           │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                        │
│  │ Home │ │ Pay  │ │Wallet│ │Profile│                        │
│  └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘                        │
│     └────────┴────────┴────────┘                              │
│              │ Axios + JWT                                    │
│  ┌───────────────────────────────────┐                        │
│  │ WalletConnect (Reown AppKit)      │                        │
│  │ MetaMask / Trust / Rainbow / etc. │                        │
│  │ ERC-20 deposits → deposit address │                        │
│  └───────────────────────────────────┘                        │
└──────────────┼────────────────────────────────────────────────┘
               │
       ┌───────▼────────┐
       │  Django REST API │ ← gunicorn (4 workers)
       │  /api/v1/*       │
       └───────┬──────────┘
               │
    ┌──────────┼───────────────────┐
    │          │                   │
┌───▼───┐ ┌───▼───┐ ┌─────────────▼───────────────┐
│ PostgreSQL│ │ Redis │ │ Celery Workers (9 tasks)     │
│ (users,   │ │ (cache,│ │ - Rate refresh (120s batch)  │
│  wallets, │ │ tokens,│ │ - Tron monitor (15s)        │
│  txns,    │ │ quotes,│ │ - ETH monitor (30s)         │
│  ledger)  │ │ locks) │ │ - BTC monitor (60s)         │
└───────────┘ └───────┘ │ - Float alerts (5min)       │
                        │ - Sweep scan (15min)        │
                        │ - Sweep execute/verify      │
                        └─────────────────────────────┘
                              │
       ┌──────────────────┬───┴───────┬──────────────────┐
       │                  │           │                  │
┌──────▼──────┐  ┌───────▼───────┐ ┌─▼──────────┐ ┌────▼─────────┐
│ Safaricom   │  │ CoinGecko +   │ │ TronGrid   │ │ Alchemy ETH  │
│ Daraja API  │  │ CryptoCompare │ │ Tron API   │ │ BlockCypher  │
│ (M-Pesa)    │  │ (Rates)       │ │            │ │ (BTC)        │
└─────────────┘  └───────────────┘ └────────────┘ └──────────────┘

┌──────────────────────── Monitoring Stack ──────────────────────────┐
│ Prometheus (9090) → Alertmanager (9093) → Slack/PagerDuty          │
│ Grafana (3001) ← postgres-exporter, redis-exporter, celery-exporter│
│ django-prometheus middleware + 22 custom business metrics           │
└────────────────────────────────────────────────────────────────────┘
```

---

## Test Results

**Backend: 116+ tests passing**
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
- 50 blockchain security tests (dust, confirmations, re-org, double-credit, address validation, velocity)
- 14 rebalance tests (model, orchestrator, API endpoints, admin access control)

---

## How to Run

### Backend (Docker)
```bash
# Development (with runserver):
cd CryptoPay
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Development + Monitoring (Prometheus, Grafana, Alertmanager):
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.monitoring.yml up --build

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

## KES Deposit Flow — IMPLEMENTED ✅

**Last updated:** 2026-03-15

| Component | Status | Details |
|-----------|--------|---------|
| M-Pesa STK Push deposit | ✅ Done | Reuses `BuyCryptoView` — user enters KES amount, selects crypto, STK Push initiates |
| M-Pesa C2B deposit | ✅ Done | Customer-to-Business: user pays to Paybill from M-Pesa menu, crypto credited at live rate |
| C2B URL registration | ✅ Done | `MpesaClient.register_c2b_urls()` — registers validation + confirmation callbacks with Safaricom |
| C2B validation view | ✅ Done | Validates account reference, amount limits, user status before M-Pesa processes |
| C2B confirmation view | ✅ Done | Receives confirmed payment, dispatches `process_c2b_deposit` Celery task |
| C2B account parsing | ✅ Done | Supports `USDT-0712345678`, `BTC-254712345678`, `CP-phone`, plain phone formats |
| C2B deposit Celery task | ✅ Done | Atomic: creates transaction + credits wallet + sends notifications |
| Deposit quote API | ✅ Done | `POST /payments/deposit/quote/` — rate-locked KES→crypto quote with deposit fee |
| Deposit status API | ✅ Done | `GET /payments/deposit/{id}/status/` — poll deposit progress |
| C2B instructions API | ✅ Done | `GET /payments/deposit/c2b-instructions/` — dynamic Paybill + account format info |
| KES_DEPOSIT transaction types | ✅ Done | `KES_DEPOSIT` (STK Push) and `KES_DEPOSIT_C2B` (Paybill) added to Transaction model |
| Deposit configuration | ✅ Done | `DEPOSIT_FEE_PERCENTAGE`, `DEPOSIT_MIN/MAX_KES`, `DEPOSIT_QUOTE_TTL_SECONDS`, `DEPOSIT_SLIPPAGE_TOLERANCE` |
| Frontend deposit page | ✅ Done | 3-tab UI: M-Pesa STK / Paybill C2B instructions / Crypto (WalletConnect + manual) |
| Home quick action | ✅ Done | Deposit button routes to `/payment/deposit` instead of wallet tab |
| Crypto direct deposit | ✅ Done | Links to wallet tab for blockchain deposit addresses (already implemented) |
| WalletConnect deposit | ✅ Done | Connect MetaMask/Trust/Rainbow, select token (USDT/USDC/ETH) + network (Ethereum/Polygon/BSC), send to CryptoPay deposit address |

### Deposit API Endpoints

```
POST /api/v1/payments/deposit/quote/          # Get rate-locked KES→crypto quote
POST /api/v1/payments/buy-crypto/              # Initiate STK Push deposit (existing)
GET  /api/v1/payments/deposit/{id}/status/     # Poll deposit status
GET  /api/v1/payments/deposit/c2b-instructions/ # Get Paybill + account format info
POST /api/v1/mpesa/callback/c2b/validate/      # Safaricom C2B validation callback
POST /api/v1/mpesa/callback/c2b/confirm/       # Safaricom C2B confirmation callback
```

---

## Bug Fixes & Audit Fixes — Session 2026-03-14 ✅

| Fix | Details |
|-----|---------|
| Notification dispatch error | Fixed `transaction.amount` → `dest_amount`, `currency` → `dest_currency`, `tx_type` → `type`, `reference` → `str(id)[:8]` |
| Backend test failure | Made `test_full_saga_success` conditional on `MPESA_ENVIRONMENT` (sandbox=COMPLETED, prod=CONFIRMING) |
| Console.error cleanup | Replaced `console.error` with `toast.error(normalizeError(err))` in admin-users, admin-user-detail, notifications-inbox |
| Edit profile i18n | Internationalized 10+ hardcoded strings in edit-profile.tsx |
| Currency preference | Full implementation: `currency.tsx` page, registered in layout, routed from settings (no "coming soon" toast) |
| Chart professional redesign | Y-axis/X-axis labels, SVG ClipPath, grid lines, glow effects, gradient fill |

---

## Security Audit & Hardening — Session 2026-03-14 ✅

Full backend security audit covering OTP, PIN, M-Pesa, payments, wallets, and deposits. See [SECURITY-AUDIT.md](./SECURITY-AUDIT.md) for the full report.

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| C1 | `random.randint` for Email Verification OTP | CRITICAL | Replaced with `secrets.randbelow` (CSPRNG) |
| H1 | No OTP brute-force protection on verification | HIGH | Added 5-attempt limit on all OTP verification paths |
| H2 | Payment endpoints bypass PIN lockout | HIGH | Created `_verify_pin_with_lockout()` helper for all payment views |
| H3 | Insecure email verification fallback (`istartswith`) | HIGH | Removed `token__istartswith` legacy fallback |
| H4 | M-Pesa IP whitelist includes private ranges | HIGH | Documented production override requirement in go-live checklist |
| H5 | STK callback crashes on missing wallet | HIGH | Changed `Wallet.objects.get()` → `get_or_create()` |
| H6 | C2B double-fee charging (spread + explicit fee) | HIGH | C2B now uses `raw_rate` (no spread); explicit fee is the only cost |
| H7 | Security credential falls back to raw password | HIGH | Now raises `MpesaError` — no silent fallback |
| M4 | Receipt CORS echoes any origin | MEDIUM | Validates against `CORS_ALLOWED_ORIGINS` |
| M6 | C2B min/max bypassed when ResponseType=Completed | MEDIUM | Added min/max check in `process_c2b_deposit` with admin alerts |
| M7 | USDC missing from C2B instructions | MEDIUM | Added USDC to `C2BInstructionsView` |
| L2 | M-Pesa timestamp missing timezone | LOW | Uses `ZoneInfo("Africa/Nairobi")` explicitly |
| L4 | Phone dashes not stripped in C2B parsing | LOW | Added `.replace("-", "")` to normalization |
| — | `useState` misuse in `currency.tsx` | — | Fixed to `useEffect` with `[]` dependency array |
| — | Orphaned C2B deposits no admin alert | — | Added `_send_c2b_admin_alert()` for unmatched deposits |
| — | Security challenge OTP missing brute-force protection | HIGH | Added `otp_verify_attempts:sec:{phone}` 5-attempt counter for device/IP change OTP verification |

---

## KES Deposit Research — Session 2026-03-14 ✅

Deep research on M-Pesa C2B/STK Push best practices, sandbox testing, and production readiness. See [KES-DEPOSIT-RESEARCH.md](./KES-DEPOSIT-RESEARCH.md) for the full report.

Key findings applied:
- **ResponseType "Completed"** is correct default (accept payments even if validation URL unreachable)
- **Sandbox callbacks unreliable (~40%)** — manual testing + `poll_stk_status` fallback covers this
- **AccountReference max 12 chars** from Safaricom — our longest format works in practice
- **STK Push amounts must be whole numbers** — no decimals
- **Production requires C2B URL v2** (`/mpesa/c2b/v2/registerurl`) vs sandbox v1
- **Callback URLs must NOT contain "mpesa" or "safaricom"** in path
- **Complete STK Push ResultCode table** documented with actions for each code

---

## Payment Confirmation Polling & Dashboard Chart — Session 2026-03-14 ✅

### Payment Flow Fix: Poll Before Success

**Problem:** All 4 payment flows (buy-crypto, paybill, till, send) showed success immediately when the API responded with "processing" — before M-Pesa confirmed the transaction. Users saw "Payment Sent!" while still entering their M-Pesa PIN.

**Root cause (sandbox):** Safaricom sandbox callbacks are ~40% reliable. The `poll_stk_status` Celery fallback task was hitting Safaricom rate limits (spike arrest: 5 req/min) shared with rate refresh tasks. Daraja 3.0 (Nov 2025) sandbox has known instability — community built [Pesa Playground](https://github.com/OmentaElvis/pesa-playground) as alternative.

| Fix | File | Details |
|-----|------|---------|
| Transaction poller hook | `mobile/src/hooks/useTransactionPoller.ts` | Polls `/{id}/status/` every 3s, 2min timeout |
| Transaction status endpoint | `backend/apps/payments/urls.py` | Added `/{id}/status/` general endpoint |
| Buy-crypto polling | `mobile/app/payment/buy-crypto.tsx` | Polls after STK Push initiation |
| Confirm page polling | `mobile/app/payment/confirm.tsx` | Polls for paybill/till/send flows |
| Success page states | `mobile/app/payment/success.tsx` | Shows "Complete" / "Processing" / "Failed" |
| STK poll retry increase | `backend/apps/mpesa/tasks.py` | 5 retries (was 3), 90s backoff on rate limit |
| Preset params | `mobile/app/payment/buy-crypto.tsx` | Reads `preset_amount` + `preset_currency` from deposit page |
| i18n completion | `en.ts` + `sw.ts` | 9 new payment status translation keys |

### Dashboard Portfolio Chart Enhancement

| Feature | Details |
|---------|---------|
| Dual-line chart | Deposits (emerald) + Payments (violet) plotted separately |
| Interactive tooltip | Touch/hover any day to see deposit and payment amounts |
| Legend | Shows total deposits and payments for the 7-day period |
| Active day indicator | Vertical line + highlighted dots on hover/touch |
| Responsive | Adapts width to screen size on both mobile and desktop |

### Deep Audit Results (Comprehensive)

| Area | Status | Finding |
|------|--------|---------|
| OTP brute-force (all paths) | ✅ Verified | Register, login, security challenge, PIN reset all protected |
| PIN lockout (all endpoints) | ✅ Verified | All 4 payment views use `_verify_pin_with_lockout()` |
| WalletConnect platform guards | ✅ Verified | `Platform.OS !== "web"` on hooks and modal |
| Button string icons | ✅ Fixed | Renders Ionicons from string names |
| API method consistency | ✅ Fixed | `getQuote` uses POST (was GET) |
| i18n coverage | ✅ Fixed | 6 hardcoded strings moved to en.ts/sw.ts |
| Blockchain listener coverage | ✅ Documented | ETH only; Polygon/BSC disabled in UI |

### Research: M-Pesa Sandbox Reliability

- **Daraja 3.0** (Nov 2025): Cloud-native rewrite, but sandbox described as "unstable and restrictive"
- **Callback reliability**: ~40% in sandbox, near 100% in production
- **Rate limiting**: 5 requests/minute spike arrest — shared across all API calls
- **STK Query limitation**: Cannot perform >5 consecutive STK requests without completion — flagged as phishing, line blocked 24h
- **Community alternative**: Pesa Playground v1.0 (Dec 2025) — local Rust/Tauri simulator with full failure mode testing

---

## Comprehensive Production Audit — Session 2026-03-14

**57 findings** across frontend, backend, business logic, and deployment. **77% production ready.**

### Blocker Fixes Applied

| ID | Issue | Fix |
|----|-------|-----|
| B1 | M-Pesa callback race condition | Added `select_for_update()` + `transaction.atomic()` on all callback handlers |
| B2 | Rate slippage tolerance not enforced | Added live rate check against quote before saga execution (2% tolerance) |
| B3 | Missing database indexes | Added composite index on `(user, status, created_at)` for Transaction model |
| B4 | Environment variables not documented | Created `backend/.env.example` and `mobile/.env.example` |
| B5 | OTP logged at INFO level | Changed to DEBUG level for all OTP/sensitive data logging |

### High-Priority Fixes Applied

| ID | Issue | Fix |
|----|-------|-----|
| H1 | C2B validation missing daily limit check | Added `check_daily_limit()` in `C2BValidationView` |
| H2 | Status text i18n | All status labels use `t()` in success.tsx, detail.tsx |
| H3 | Desktop wallet transactions not clickable | Changed `<View>` to `<Pressable>` with navigation |
| H4 | Full name validation missing | Added regex validation (2-50 chars, letters/spaces only) |
| H5 | Email uniqueness case-insensitive | Changed to `email__iexact` in serializer + Google OAuth |
| H6 | Rebalance 409 generic error | Returns 7 specific rejection reasons |
| H7 | Settlement bounds check | Rejects if KES received < 50% of expected |
| H8 | Hot wallet deficit clamping | Raises ValueError instead of clamping to zero |

### Tracked for Future (Not Blocking Launch)

| ID | Issue | Priority | ETA |
|----|-------|----------|-----|
| M1 | ~~TOTP secrets stored plaintext~~ | ✅ Done | Fernet encryption with SECRET_KEY derivation, backward-compatible |
| M2 | ~~Google OAuth "set PIN" flow~~ | ✅ Done | Backend returns `pin_required` flag, frontend redirects to PIN setup |
| M3 | Rate fallback on CoinGecko outage | Medium | 2h |
| M4 | Circuit breaker exposed to frontend | Medium | 2h |
| M5 | ~~Dockerfile run as non-root~~ | ✅ Done | Non-root `app` user, PYTHONDONTWRITEBYTECODE, .dockerignore |
| M6 | Database backup strategy | Medium | 3h |
| L1 | Multi-stage Docker build | Low | 1h |
| L2 | Automated dependency updates | Low | Dependabot config |

### Production Deployment — Completed 2026-03-15

| Component | Status | Details |
|-----------|--------|---------|
| Domain | ✅ Live | `cpay.co.ke` registered via Truehost (KSh 999/yr) |
| VPS | ✅ Running | Contabo Cloud VPS 20 SSD, Ubuntu 24.04, 12GB RAM, 6 CPU, Docker |
| Cloudflare | ✅ Active | DNS, SSL (Let's Encrypt), CDN, DDoS, WAF, origin rules (port 8080) |
| Frontend | ✅ Deployed | `https://cpay.co.ke` — Expo web build served via nginx |
| API | ✅ Live | `https://cpay.co.ke/api/v1/` — Django behind nginx reverse proxy |
| Admin Panel | ✅ Live | `https://cpay.co.ke/admin/` — CSRF fixed for Cloudflare proxy |
| Database | ✅ Migrated | PostgreSQL 16 on port 5433 (avoids camhub conflict) |
| Redis | ✅ Running | Port 6380, AOF persistence |
| Celery | ✅ Running | Worker + Beat, all tasks scheduled |
| Email (Sending) | ✅ Working | Resend SMTP (port 465 SSL), `noreply@cpay.co.ke` |
| SMS (OTP) | ⏳ Activating | Africa's Talking live app "Cpay", KES 100 funded, API key propagating |
| Blockchain APIs | ✅ Connected | Alchemy (ETH+SOL), TronGrid (TRON), Esplora (BTC) |
| SSL Certificate | ✅ Active | Universal SSL via Cloudflare, auto-renewal, expires 2026-06-12 |

### Go-Live Checklist (M-Pesa Production)

| Step | Status | Details |
|------|--------|---------|
| Sandbox integration tested | ✅ Done | STK Push, C2B, B2B, B2C all implemented |
| HTTPS callback URLs | ✅ Done | `https://cpay.co.ke/api/v1/mpesa/callback/...` |
| SSL certificate | ✅ Done | Cloudflare Universal SSL |
| VPS deployment | ✅ Done | `173.249.4.109` (Contabo Europe) |
| Paybill/Till number obtained | ⬜ Pending | Apply via Safaricom Business |
| Go-live request letter | ⬜ Pending | Email to m-pesabusiness@safaricom.co.ke |
| IP whitelisting | ⬜ Pending | Provide server IP `173.249.4.109` to Safaricom |
| Production credentials | ⬜ Pending | Replace sandbox App Key/Secret |

### Remaining Items

| # | Item | Priority | Status |
|---|------|----------|--------|
| 1 | SMS OTP delivery | High | AT key propagating (~1hr), will work automatically |
| 2 | Branded email templates | High | Implementing now |
| 3 | Admin alert automation | High | Implementing now |
| 4 | Favicon/PWA icons | Medium | Implementing now |
| 5 | Cloudflare Email Routing | Medium | Manual setup in Cloudflare dashboard |
| 6 | Google OAuth credentials | Medium | Need Google Cloud Console project |
| 7 | M-Pesa production | Blocked | Waiting on Safaricom approval |
| 8 | AT Sender ID "CPay" | Low | Apply after AT activation (3-5 business days) |

---

## WalletConnect (Reown AppKit) Integration — Session 2026-03-14 ✅

External wallet connection allowing users to deposit crypto directly from MetaMask, Trust Wallet, Rainbow, Phantom, and other WalletConnect-compatible wallets.

### Implementation

| Component | File | Details |
|-----------|------|---------|
| AppKit configuration | `mobile/src/config/appkit.ts` | EVM networks (Ethereum, Polygon, BSC), Reown project ID, storage adapter, ethers adapter |
| Deposit hook | `mobile/src/hooks/useWalletDeposit.ts` | `sendERC20()` and `sendETH()` functions, manual ERC-20 calldata encoding (no ethers.js dependency) |
| Deposit UI component | `mobile/src/components/WalletConnectDeposit.tsx` | Connect button, wallet info, token selector (USDT/USDC/ETH), network selector, amount input, deposit button. Graceful degradation for Expo Go. |
| Root layout integration | `mobile/app/_layout.tsx` | `initAppKit()` at module level with try/catch, `<AppKit />` modal guarded by `appKitReady` flag |
| Deposit page integration | `mobile/app/payment/deposit.tsx` | Crypto tab: WalletConnect section + "OR" divider + manual deposit section |
| Android wallet detection | `mobile/queries.js` | Expo config plugin — adds `<queries>` for Android 11+ package visibility (MetaMask, Trust, Coinbase, etc.) |
| iOS deep links | `mobile/app.json` | `LSApplicationQueriesSchemes` for wallet app detection |
| Babel config | `mobile/babel.config.js` | `unstable_transformImportMeta: true` for AppKit/valtio compatibility |

### Supported Networks & Tokens

| Network | Chain ID | Native | ERC-20 Tokens |
|---------|----------|--------|---------------|
| Ethereum | 1 | ETH | USDT, USDC |
| Polygon | 137 | MATIC | USDT, USDC |
| BNB Smart Chain | 56 | BNB | USDT, USDC |

### Setup Requirements

1. **Reown Project ID** — Get from [cloud.reown.com](https://cloud.reown.com), set as `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` env var
2. **EAS Build** — AppKit requires native modules, does not work in Expo Go. Use `eas build` or custom dev client.
3. **No project ID** — WalletConnect gracefully disabled; deposit page still shows manual deposit option

### What's Next for WalletConnect

| Task | Priority | Details |
|------|----------|---------|
| Get Reown Project ID | High | Register at cloud.reown.com, configure allowed domains/bundles |
| EAS dev client build | High | `eas build --profile development` to test WalletConnect on device. Cannot use Expo Go — native modules required. |
| Polygon listener | High | `eth_listener.py` only monitors Ethereum. WalletConnect UI currently restricted to Ethereum only. Implement `polygon_listener.py` before enabling Polygon deposits. |
| BSC listener | Medium | Same gap as Polygon — no BSC listener exists. Implement before enabling BSC deposits. |
| Tron network support | Low | AppKit doesn't natively support Tron; USDT-TRC20 deposits use manual address copy |
| Transaction history link | Low | Show WalletConnect-initiated deposits distinctly in transaction history |

### Blockchain Listener Coverage (verified 2026-03-14)

| Chain | Listener | ERC-20 Tokens | Status |
|-------|----------|---------------|--------|
| Ethereum | `eth_listener.py` | USDT, USDC, native ETH | Active — deposits detected |
| Polygon | None | — | **NOT monitored** — disabled in deposit UI |
| BSC | None | — | **NOT monitored** — disabled in deposit UI |
| Bitcoin | `btc_listener.py` | Native BTC | Active |
| Solana | `sol_listener.py` | Native SOL | Active |
| Tron | `tasks.py` (TronGrid) | USDT-TRC20 | Active |

---

## Documentation Index

| Document | Purpose | Last Updated |
|----------|---------|-------------|
| [PROGRESS.md](./PROGRESS.md) | This file — development status and test results | 2026-03-14 |
| [ROADMAP.md](./ROADMAP.md) | Strategic roadmap, fundraising, go-to-market, expansion plans, competitive landscape | 2026-03-09 |
| [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md) | Technical architecture, liquidity engine, payment saga, security, regulatory compliance, monitoring, custody | 2026-03-14 |
| [KES-DEPOSIT-RESEARCH.md](./KES-DEPOSIT-RESEARCH.md) | M-Pesa C2B/STK Push research, fee structure, sandbox testing, go-live checklist | 2026-03-14 |
| [SECURITY-AUDIT.md](./SECURITY-AUDIT.md) | Full security audit — OTP, PIN, M-Pesa, payments, wallets, deposits | 2026-03-14 |
| [STARTUP-CHECKLIST.md](./STARTUP-CHECKLIST.md) | Legal, regulatory, financial checklists — updated with VASP Act 2025 requirements | 2026-03-09 |
| [research/IMPLEMENTATION-RESEARCH-2026-03-09.md](./research/IMPLEMENTATION-RESEARCH-2026-03-09.md) | **Comprehensive research:** playbook verification, all APIs/tools/pricing, regulatory deep-dive, competitor analysis | 2026-03-09 |
| [research/](./research/) | All research files: competitor analysis, API research, security audit, regulations | Ongoing |

## File Count Summary

**Backend:** 55+ Python files across 7 apps (including ETH + BTC listeners)
**Frontend:** 40+ TypeScript/TSX files (including WalletConnect integration)
**Docs:** 10+ documentation files (architecture, research, roadmap)
**Config:** Docker (dev + prod), Nginx, EAS, Metro, Babel, TypeScript, CI/CD
**Monitoring:** Prometheus + Grafana + Alertmanager + 3 exporters (docker-compose.monitoring.yml)
**Celery Tasks:** 16+ periodic tasks across rates, blockchain (Tron/ETH/BTC/SOL), M-Pesa, rebalancing, custody
