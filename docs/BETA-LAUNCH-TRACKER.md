# Beta Launch Tracker

**Last updated:** 2026-04-17 (late session — all code blockers closed)

## Change log
- **2026-04-17 late** — C1 / C2 / C3 / B1 / B2 / B3 / B5 all closed and
  deployed. BTC_WITHDRAWALS_ENABLED flag live (off by default). 164/164
  tests green. Landing-page credibility fixes shipped (no more fabricated
  user counts, clarified free-tier offer, honest VASP language).

Single source of truth for everything that must be true before we open beta
to real users. Supersedes the "Quick Start" section of
`PRODUCTION-CHECKLIST.md` — that doc is the comprehensive list; this one is
the focused beta gate.

Legend: ✅ done • 🟡 in progress • 🔴 blocker • ⚪ nice-to-have

---

## Infrastructure & deploy (complete)

| Item | Status | Notes |
|---|---|---|
| Contabo VPS + Docker Compose | ✅ | `173.249.4.109`, 4 GB RAM, 6 weeks uptime |
| Domain + Cloudflare + SSL | ✅ | `cpay.co.ke`, proxied, TLS via Cloudflare |
| PostgreSQL 16 | ✅ | In Docker, daily `scripts/backup-db.sh` |
| Redis 7 | ✅ | Rate cache, idempotency, push challenges |
| Celery + Beat | ✅ | Worker listens on `celery,blockchain,notifications` |
| Prometheus + Grafana + exporters | ✅ | Node, Redis, Postgres, Celery exporters |
| Nginx host + backend proxy | ✅ | TLS terminated at CF, origin plain HTTP |
| APK download URL | ✅ | `https://cpay.co.ke/download/cryptopay.apk` |
| Web build via tarball | ✅ | See `feedback_deploy_method.md` |
| Sentry | 🟡 | Settings wired, `SENTRY_DSN` not set in `.env.production` |

---

## Currencies — deposit and withdrawal matrix

Wallet creation is live for all 6 currencies (USDT, USDC, ETH, BTC, SOL,
KES) per `apps/wallets/services.py:124-135`. Detail per chain:

| Currency | Chain | Deposits | Withdrawals | Notes / blockers |
|---|---|---|---|---|
| USDT | Tron | ✅ | ✅ | TronGrid listener; tested via testnet |
| USDT | Ethereum | ✅ | ✅ | Alchemy RPC; EIP-1559 gas |
| USDT | Polygon | ✅ | ✅ | Alchemy RPC; shares BIP-44 path with ETH |
| USDC | Ethereum | ✅ | ✅ | Shares ETH deposit address (same BIP-44 coin type) |
| USDC | Polygon | ✅ | ✅ | — |
| ETH | Ethereum | ✅ | ✅ | — |
| BTC | Bitcoin | 🟡 | 🟡 | **See "Bitcoin readiness" below** |
| SOL | Solana | ✅ | ✅ | — |
| KES | M-Pesa (Daraja) | ✅ | ✅ | Sandbox — production shortcode needs VASP license |
| KES | M-Pesa (SasaPay) | ✅ | ✅ | Live-tested with real STK Push, merchant 600980 |

### Bitcoin readiness — detail (audited 2026-04-17)

**What works**
- BIP-44 HD wallet derivation, hardened paths, proper coin type 0
  (`services.py:358-363`).
- Deposit detection via **Blockstream Esplora** (free, no API key needed),
  polling in `btc_listener.py:46-249`.
- Amount-based confirmation tiers (2 confs &lt;$1K, 3 &lt;$10K, 6 ≥$100K).
- Re-org detection (`check_confirmation_monotonicity()`).
- Withdrawal/sweep via **BlockCypher two-step API**: `/txs/new` → sign
  locally (secp256k1 ECDSA + BIP-62 low-s) → `/txs/send`
  (`sweep.py:1440-1550`).

**Blockers — status after 2026-04-17 late session**

| # | Item | Severity | Status |
|---|---|---|---|
| B1 | Addresses were legacy P2PKH, not native SegWit. Docstring wrongly claimed P2WPKH-P2SH. | Medium | ✅ **Closed** — Full BIP-173 bech32 implementation shipped in `services.py`. Addresses now `bc1q…` on mainnet, `tb1q…` on testnet. Docstring corrected. |
| B2 | `BTC_NETWORK` defaulted to `test3`. | **High** | ✅ **Closed** — Default flipped to `"main"`. Duplicate `BTC_NETWORK=testnet` line in prod `.env.production` scrubbed. Boot-time check in `apps/blockchain/apps.py` logs an ERROR if testnet is configured with DEBUG=False. |
| B3 | 100% BlockCypher for broadcast. | Medium | ✅ **Closed** — New `_broadcast_raw_tx_with_fallback()` in `sweep.py` tries Blockstream Esplora → mempool.space → BlockCypher. 4xx hard-rejected so we don't paper over signing bugs. |
| B4 | BlockCypher API key signup pending. | Medium | 🟡 Still pending email verification. Non-blocking — Esplora + mempool.space are keyless so we're no longer single-provider anyway. |
| B5 | No pytest for BTC sweep/withdrawal. | Medium | ✅ **Closed** — 6 new unit tests (`BitcoinBech32AddressTest` x 4, `BitcoinWithdrawalFeatureFlagTest` x 2). 164/164 suite green. |
| B6 | BTC Celery Beat schedule missing. | **High** | ✅ **Closed** — Already present in `base.py` lines 190-194 (`monitor-btc-deposits` @ 60 s, `update-btc-confirmations`). Verified during audit. |
| Flag | Feature flag to gate BTC withdrawals | — | ✅ **Shipped** — `BTC_WITHDRAWALS_ENABLED` env var (default `False`). Both `_execute_btc_sweep()` and legacy `_broadcast_bitcoin()` raise when disabled. Set explicitly to `False` in prod `.env.production`. |

**Bitcoin beta recommendation:** BTC deposits are fully live on mainnet
with bech32 P2WPKH addresses. BTC withdrawals remain gated by
`BTC_WITHDRAWALS_ENABLED=False` until we verify the native-SegWit signer
against a real mainnet transaction. Flip to `True` in `.env.production`
only after that end-to-end test.

---

## CoinGecko — performance and correctness (audited 2026-04-17)

**What works**
- Tiered fallback: **CoinGecko → CryptoCompare → stale Redis cache → DB**
  (`apps/rates/services.py`).
- Celery Beat warms the cache every 120 s → steady-state users hit
  Redis, never CoinGecko directly.
- Atomic quote lock, 90 s TTL, unique `quote_id` — prevents double-spend.
- 1.5 % spread + flat KES 10 fee + 10 % excise duty (VASP Act) all
  applied correctly.
- Demo key (`CG-zJVrCfUcwus46BCr8TXJff9M`) at ~720 calls/month against
  10,000 limit → massive headroom.

**Issues — status after 2026-04-17 late session**

| # | Item | Severity | Status |
|---|---|---|---|
| C1 | Cold-start 10 s stall on empty Redis. | **High** | ✅ **Closed** — New `warm_rate_cache` management command (`apps/rates/management/commands/warm_rate_cache.py`). Wired into prod web container entrypoint (`deploy/docker-compose.prod.yml` — migrate → collectstatic → warm → daphne). Verified on tonight's deploy: CoinGecko returned 429, CryptoCompare fallback warmed the cache in under 2 s, daphne started with warm rates. |
| C2 | Single-source forex. | **High** | ✅ **Closed** — New `apps/rates/forex.py` chain: exchangerate-api → openexchangerates → fixer → DB → hard-coded `FOREX_FALLBACK_USD_KES` (default 120). Each provider 3 s timeout. Stale sources get 60 s cache TTL so live providers retry sooner. Guaranteed non-zero result — quote endpoint cannot hang. 2 unit tests pass. |
| C3 | RateAlert missing USDC. | Low | ✅ **Closed** — Added to `Currency` enum + migration `0005_alter_ratealert_currency`. Applied in prod. |
| C4 | Spread baked into cached rate, no slippage adjustment for whale quotes. | Medium | 🟡 Deferred — post-beta; current daily limit ceiling (KES 1 M for KYC-verified) caps impact. |
| C5 | Stale flag only surfaces after quote request. | Low | 🟡 Deferred — `rate_stale` still returned in quote payload; frontend can surface. |

**CoinGecko beta recommendation:** C1 / C2 / C3 closed. C4 / C5 are
post-beta polish items.

---

## Missing or pending API accounts

| # | Provider | Status | Needed for | Cost | Action |
|---|---|---|---|---|---|
| 1 | **Smile Identity** (KYC) | 🔴 Not signed up | KYC tier 1+ (ID doc + selfie) | KES 50–100 per check | Sign up at https://usesmileid.com — dev dashboard access, API key for callback |
| 2 | **BlockCypher API key** | 🟡 Email verification pending | BTC withdrawals at scale (raise from 200 to 2000 req/hr) | Free tier works | Chase email, or use disposable mailbox if original bounced |
| 3 | **Yellow Card** | 🔴 No keys | Automated USDT → KES treasury rebalancing (B2B off-ramp) | B2B pricing | Email `paymentsapi@yellowcard.io` for onboarding |
| 4 | **CoinGecko Pro** | ⚪ Optional | Only if we exceed 10K calls/month (unlikely before 10k+ MAU) | $129/mo | Skip until needed |
| 5 | **Sentry DSN** | 🟡 Configured, not set | Error tracking in prod | Free tier 5K events/mo | Sign up, paste DSN into `.env.production` |
| 6 | **Apple Developer** | 🔴 | iOS TestFlight + App Store | $99/year | Post-beta, Android-only for v1 launch |
| 7 | **Google Play Console** | 🔴 | Play Store listing | $25 one-time | Needed before v1 public launch; beta can ship via sideloaded APK |
| 8 | **UptimeRobot** | 🔴 | External uptime monitoring on `/health/` | Free tier | 5 min — done in an afternoon |

---

## Security audit

All MEDIUM findings closed. Penetration-tested 2026-03-21 (auth bypass,
JWT tampering, SQLi, XSS, CORS, IDOR, path traversal — all pass).
TOTP enabled with Fernet encryption. Session durability upgraded
2026-04-17 (refresh TTL, trusted-device IP immunity). Push 2FA deployed
2026-04-17.

No outstanding security blockers for beta.

---

## Legal & business (2026-04-17)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Business name reservation | ✅ | "CPAY TECHNOLOGIES" reserved 2026-03-25, ref `BN-B8S6JP89`, expires 2026-04-24 |
| 2 | Certificate of Registration of Business Name | 🟡 | Awaiting BRS approval — check eCitizen daily |
| 3 | **Bank letter** | 🟡 | **Picking up from bank tomorrow (2026-04-18)** |
| 4 | KRA PIN (company) | 🔴 | Requires item 2 first |
| 5 | Business bank account (Equity) | 🔴 | Requires items 2 + 4 |
| 6 | Privacy policy | 🟡 | Draft + page live at `/privacy`, needs lawyer review |
| 7 | Terms of Service | 🟡 | Draft + page live at `/terms`, needs lawyer review |
| 8 | VASP public comment submission | 🔴 | Deadline **2026-04-10 already passed** — file a late submission if possible; otherwise monitor final regs |
| 9 | Kenyan fintech lawyer engagement | 🔴 | Needed for VASP license filing. Shortlist: Bowmans, AMG, Njaga, KDS Advocates |
| 10 | VASP license itself | 🔴 | KES 50M capital requirement; post-beta (won't block a closed beta with disclosure) |

**Beta strategy around licensing:** Run a **closed beta** with a small
allow-list of users (100–500) with clear disclosure that the service is
pre-licensing. VASP Act allows sandbox / pre-license operations with
disclosure, per current draft. Document this in the Terms of Service
and the beta invite email.

---

## Load & resilience

| Item | Status | Target | Action |
|---|---|---|---|
| Redis cache warmed on boot | ✅ | Mandatory | `warm_rate_cache` runs in web entrypoint |
| Forex fallback provider | ✅ | Mandatory | 3-tier chain + hard-coded fallback in `apps/rates/forex.py` |
| BTC deposit listener scheduled | ✅ | Confirmed | Verified in `CELERY_BEAT_SCHEDULE` (60 s polling, 30 s confirmations) |
| BTC withdrawal feature flag | ✅ | Off by default | `BTC_WITHDRAWALS_ENABLED=False` in prod .env |
| Database backup verified | 🟡 | Weekly restore drill | Script exists, no scheduled cron yet |
| Health monitoring | 🔴 | UptimeRobot on `/health/` | 5 min to configure |
| Circuit breaker float monitoring | ✅ | Already live | Push notifications to staff on low float |

---

## Pre-beta critical path (hard blockers only)

Status as of 2026-04-17 late session:

1. ✅ **C1 (Redis cold-start)** — warm_rate_cache shipped & verified in prod.
2. ✅ **C2 (forex fallback)** — 3-tier chain + hard-coded fallback live.
3. ✅ **B2 (BTC mainnet)** — default flipped; prod .env fixed; feature flag gates withdrawals.
4. ✅ **B6 (BTC Celery Beat)** — already scheduled.
5. 🔴 **Sign up for Smile Identity** — at least dev-sandbox keys so KYC flow is testable end-to-end.
6. 🔴 **Set up UptimeRobot** on `/health/` — 5 min.
7. 🔴 **Finalise Terms of Service + Privacy Policy** with lawyer, add beta-program disclosure clause.
8. 🟡 **Bank letter** (tomorrow).
9. 🟡 **Certificate of Registration of Business Name** (awaiting BRS).

**Code blockers: all closed.** Remaining items are business / ops / legal.

Soft targets (ship-post-beta):
- Yellow Card API (auto rebalance)
- CoinGecko Pro (only if needed)
- Apple Developer + Play Console
- Full BTC P2WPKH migration

---

## Post-beta roadmap (first 30 days after opening)

- Mobile push-2FA real-device integration testing (2 devices)
- Hot / warm / cold wallet tiering (security)
- Landing page priority-2 polish items (see `LANDING-PAGE-DESIGN.md`)
- WalletConnect full support (MetaMask / Trust / Phantom)
- Helius API for Solana SPL ($49/mo — only if SOL deposits take off)
- Server-rendered Next.js landing (SEO) — when we need paid ads or organic growth
