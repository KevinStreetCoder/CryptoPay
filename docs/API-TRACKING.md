# External API tracking

Every third-party API the production app depends on. Purpose, current
status, what breaks if it's down, and an owner.

Legend: ✅ live & healthy · 🟡 degraded but working · 🔴 blocked · ⚪ not signed up

---

## Payment rails

| Provider | Purpose | Status | Fallback | Config |
|---|---|---|---|---|
| **M-Pesa Daraja** | STK Push, B2B, B2C, reversal, status polling | ✅ Sandbox live, awaiting VASP-license to switch production shortcode | SasaPay (below) | `apps.mpesa.client.DarajaClient` · env: `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY` |
| **SasaPay** | Alternative STK + B2C; cheaper than Daraja for some tiers | ✅ Live-tested with real KSh 52.05 STK Push, merchant 600980 | Daraja | `apps.mpesa.sasapay_client` · env: `SASAPAY_CLIENT_ID`, `SASAPAY_CLIENT_SECRET`, `SASAPAY_MERCHANT_CODE` |

## Rate / pricing

| Provider | Purpose | Status | Fallback | Config |
|---|---|---|---|---|
| **CoinGecko** | crypto/USD prices for USDT, USDC, BTC, ETH, SOL | 🟡 Demo tier, sporadic 429s | CryptoCompare (below) | env: `COINGECKO_API_KEY` (demo key `CG-zJVrCfUcwus46BCr8TXJff9M`) |
| **CryptoCompare** | batch crypto/USD fallback | ✅ No key used, public endpoint works | Stale Redis → last DB row | no env needed; optional `CRYPTOCOMPARE_API_KEY` |
| **ExchangeRate-API** | USD/KES | ✅ Primary, free tier | Open Exchange Rates → Fixer → DB → hardcoded 120.00 | optional `EXCHANGERATE_API_KEY` |
| **Open Exchange Rates** | USD/KES fallback | ⚪ Not signed up | next provider in chain | env: `OPEN_EXCHANGE_RATES_APP_ID` |
| **Fixer.io** | USD/KES second fallback | ⚪ Not signed up | DB last-known-good → hardcoded | env: `FIXER_API_KEY` |

## Blockchain indexers + RPC

| Provider | Purpose | Status | Fallback | Config |
|---|---|---|---|---|
| **TronGrid** | USDT-TRC20 deposits, balance | ✅ Configured | (none — single source) | env: `TRONGRID_API_KEY` |
| **Alchemy (Ethereum)** | ETH + ERC-20 + Polygon RPC | ✅ Configured | (none — single source) | env: `ETH_RPC_URL`, `POLYGON_RPC_URL` |
| **Alchemy (Solana)** | SPL deposits & SOL balances | ✅ Configured | fallback to Helius (not set up) | env: `SOL_RPC_URL` |
| **Blockstream Esplora** | BTC deposit polling | ✅ Live, no key needed, used as PRIMARY | mempool.space for broadcast | public endpoint `https://blockstream.info/api` |
| **BlockCypher** | BTC withdrawal tx construction + broadcast | 🟡 Free tier (200 req/hr); signup pending email verification | Blockstream + mempool.space broadcast chain (`bc44105`) | env: `BLOCKCYPHER_API_TOKEN` |
| **mempool.space** | BTC broadcast secondary fallback | ✅ No key needed | BlockCypher final | public endpoint |
| **Helius (Solana)** | SPL indexer for scale ($49/mo) | ⚪ Post-beta only | Alchemy handles v1 volume | env: `HELIUS_API_KEY` |

## KYC

| Provider | Purpose | Status | Fallback | Config |
|---|---|---|---|---|
| **Smile Identity** | ID + selfie verification for tier 1+ | 🔴 **Not signed up — beta blocker** | (none) | env: `SMILE_API_KEY`, `SMILE_PARTNER_ID` · sandbox at https://usesmileid.com |

## Messaging

| Provider | Purpose | Status | Fallback | Config |
|---|---|---|---|---|
| **eSMS Africa** | OTP + transactional SMS, primary | 🟡 Silent drops on some MSISDNs despite "restoration" email 2026-04-17 | Africa's Talking (next row) | env: `ESMS_API_KEY`, `ESMS_ACCOUNT_ID`, `ESMS_SENDER_ID` |
| **Africa's Talking** | SMS fallback + verified delivery to +254701961618 tonight | ✅ Live | Email OTP | env: `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID` |
| **Resend** | Transactional email (receipts, rate alerts, email OTP) | ✅ Live | Django console backend in dev | env: `RESEND_API_KEY` |
| **Expo Push** | Mobile push notifications + push-2FA challenges | ✅ Live (post push-2FA ship 2026-04-17) | SMS OTP handles 2FA if push fails | env: `EXPO_ACCESS_TOKEN` |

## Authentication / ID

| Provider | Purpose | Status | Fallback | Config |
|---|---|---|---|---|
| **Google OAuth** | Social sign-in | ✅ Live with 4 authorised redirect URIs configured in Google Console | phone+PIN | `mobile/src/hooks/useGoogleAuth.ts` · env: `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID` |
| **Expo/EAS** | APK signing + build pipeline | ✅ Local WSL builds working (toolchain reinstalled 2026-04-17) | EAS cloud (rate-limited) | env: `EXPO_TOKEN` |

## Infrastructure

| Provider | Purpose | Status | Fallback | Config |
|---|---|---|---|---|
| **Contabo VPS** | Production host | ✅ 4 GB, 6+ weeks uptime | (none) | `173.249.4.109`, `/home/deploy/cpay` |
| **Cloudflare** | DNS, TLS termination, CDN | ✅ Live | (none) | zone: `cpay.co.ke` |
| **Sentry** | Error tracking | 🟡 Settings wired; `SENTRY_DSN` env var not set | stderr logs | env: `SENTRY_DSN` — sign up at sentry.io (free 5k/mo) |
| **UptimeRobot** | External `/health/` monitoring | 🔴 Not set up — 5 min to configure, free tier | internal Prometheus alerting exists | uptimerobot.com |
| **Prometheus + Grafana** | Metrics + dashboards | ✅ Running on VPS | (none) | ports 9090 (prom), 3001 (grafana) |

## Treasury / off-ramp

| Provider | Purpose | Status | Fallback | Config |
|---|---|---|---|---|
| **Yellow Card** | Automated USDT → KES B2B off-ramp, treasury rebalancing | 🔴 No keys yet — email `paymentsapi@yellowcard.io` | Manual treasury management | env: `YELLOW_CARD_API_KEY`, `YELLOW_CARD_API_SECRET` |
| **Binance Pay** | Alternative B2B crypto cash-out | ⚪ Not integrated | Yellow Card primary | — |

---

## Missing-API summary for pre-beta

These block opening beta:

| # | Provider | Why it blocks | Next step |
|---|---|---|---|
| A-01 | Smile Identity | Without sandbox keys we can't test the KYC flow end-to-end; users can't reach tier 1+ | Sign up at https://usesmileid.com |
| A-02 | Sentry DSN | Without it, prod errors disappear into stderr. Not a functional blocker but a beta reliability one | Sign up at https://sentry.io (free tier 5k events/mo) |
| A-03 | UptimeRobot | External health monitoring — 5-min setup | https://uptimerobot.com, free |

Nice-to-have (post-beta):

| # | Provider | Why | When |
|---|---|---|---|
| A-04 | Yellow Card | Automated off-ramp — without it treasury rebalancing is manual | First real KES → USDT conversion volume justifies it |
| A-05 | BlockCypher key | Raises BTC broadcast from 200 → 2000 req/hr. Esplora + mempool.space handle 99% anyway. | Only if we see BTC broadcast rate-limit errors |
| A-06 | Open Exchange Rates / Fixer | USD/KES chain already 4-deep; these would be 2nd + 3rd | Only if exchangerate-api sees prolonged outages |
