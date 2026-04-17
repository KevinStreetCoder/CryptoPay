# Beta Launch Tracker

**Last updated:** 2026-04-17

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

**Blockers for beta launch**
| # | Item | Severity | Fix |
|---|---|---|---|
| B1 | Address format is **legacy P2PKH** (starts with `1`), not native SegWit P2WPKH (`bc1...`). Higher fees for senders; may confuse experienced BTC users. Docstring at `services.py:10` wrongly claims P2WPKH-P2SH. | Medium | Switch to bech32 P2WPKH in `_generate_btc_address()`. Keep legacy on existing wallets; new wallets use bech32. |
| B2 | `BTC_NETWORK = env("BTC_NETWORK", default="test3")` — **defaults to testnet**. Easy to miss in prod .env. | **High** | Change default to `"main"`. Add boot-time check that logs a warning if mainnet seed is used with testnet config (or vice versa). |
| B3 | 100% BlockCypher-dependent for withdrawals. Free tier: 200 requests/hour. Outage = all BTC withdrawals stall. | Medium | Add Blockstream Esplora + Mempool.space as broadcast fallbacks. Keep signing local. |
| B4 | BlockCypher API key — signup pending email verification (per `PRODUCTION-CHECKLIST.md` item 13). Without it we're on 200 req/hr. | Medium | Complete BlockCypher signup. |
| B5 | No pytest coverage for BTC sweep / withdrawal / fee estimation. Only address-validation and confirmation-tier tests. | Medium | Mock BlockCypher, add 3-5 unit tests. |
| B6 | No explicit Celery Beat schedule for `monitor_btc_deposits` / `update_btc_confirmations`. Must confirm they're in the beat schedule in production. | **High** | Audit `CELERY_BEAT_SCHEDULE` in `config/settings/base.py`, add BTC tasks if missing. |

**Bitcoin beta recommendation:** Keep BTC deposits live (they work), but
gate BTC withdrawals behind a feature flag until B1, B2, B6 are closed.
Users can still buy / hold / use the USDT + USDC + ETH + SOL side.

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

**Issues for beta**
| # | Item | Severity | Fix |
|---|---|---|---|
| C1 | **Cold-start 10 s stall**: if Redis is empty (after restart) and no Celery Beat tick has run, first user waits ~10 s for the synchronous batch fetch. | **High** | Add a management command `warm_rate_cache` that runs on container startup via `docker-compose` `command:` override, or on the web service's entrypoint. |
| C2 | USD → KES conversion comes from a **separate provider (ExchangeRate-API)** with no fallback. If it's slow or down, quote endpoint stalls. | **High** | Add a second forex source (Fixer, Open Exchange Rates, or the ECB reference file). Hardcode a worst-case rate as last-resort fallback (e.g. 1 USD = 140 KES → refuse quotes above $1,000 until fresh rate restored). |
| C3 | `RateAlert` model missing **USDC** in choices. Users can't set USDC alerts even though the wallet is live. | Low | Add USDC to `apps/rates/models.py:30-34`. |
| C4 | Spread is baked into the cached rate. A whale quote doesn't get price-impact-adjusted. | Medium | Post-beta — add tiered spread above 500k KES. |
| C5 | Stale-flag only surfaces *after* the user requests a quote. | Low | Expose `GET /api/v1/rates/health/` returning `{stale: bool, last_refresh: ts}` so the frontend can show a "rates may be stale" banner before the user types an amount. |

**CoinGecko beta recommendation:** Close C1 and C2 before opening beta
(both are production-stability issues under even mild load). C3-C5 can
slip to post-beta.

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
| Redis cache warmed on boot | 🔴 | Mandatory | Add `warm_rate_cache` management command to entrypoint |
| Forex fallback provider | 🔴 | Mandatory | Add Open Exchange Rates or Fixer |
| BTC deposit listener scheduled | 🟡 | Confirmed daily | Verify `CELERY_BEAT_SCHEDULE` |
| BTC withdrawal feature flag | 🔴 | Off by default | Add `BTC_WITHDRAWALS_ENABLED` env flag until P2WPKH + mainnet default shipped |
| Database backup verified | 🟡 | Weekly restore drill | Script exists, no scheduled cron yet |
| Health monitoring | 🔴 | UptimeRobot on `/health/` | 5 min to configure |
| Circuit breaker float monitoring | ✅ | Already live | Push notifications to staff on low float |

---

## Pre-beta critical path (hard blockers only)

If every one of these is green, we can open beta.

1. 🔴 **Close C1 (Redis cold-start)** — add `warm_rate_cache` to web container entrypoint.
2. 🔴 **Close C2 (forex fallback)** — add second USD/KES source.
3. 🔴 **Close B2 (BTC mainnet default)** — flip default or gate BTC withdrawals behind a feature flag.
4. 🔴 **Confirm B6 (BTC Celery Beat schedule live)**.
5. 🔴 **Sign up for Smile Identity** — at least dev-sandbox keys so KYC flow is testable end-to-end.
6. 🔴 **Set up UptimeRobot** on `/health/`.
7. 🔴 **Finalise Terms of Service + Privacy Policy** with lawyer, add beta-program disclosure clause.
8. 🟡 **Bank letter** (tomorrow).
9. 🟡 **Certificate of Registration of Business Name** (awaiting BRS).

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
