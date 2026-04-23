# CryptoPay — Production Readiness Checklist

**Last updated:** 2026-04-22

## 🆕 Security pass 2026-04-22 — status

### Done (landed in code this release)

- **D6** SECRET_KEY-derived wallet seed fallback removed; `_assert_production_env` fails boot if no KMS/mnemonic/hex seed is configured.
- **A1 + A27** `rest_framework_simplejwt.token_blacklist` installed + migration 0012 applied; `/api/v1/auth/logout/` ships; `HardenedTokenRefreshView` re-checks `is_active`/`is_suspended` on every refresh.
- **A3** Google OAuth auto-link refuses when the email already belongs to a phone-registered account; prompts for a one-time SMS code on the registered phone before linking.
- **A14** All five chain broadcast paths (Tron, Ethereum, Polygon, Solana, Bitcoin) now load keys just-in-time via `apps/blockchain/secure_keys.py` and `wipe()` the backing `bytearray` in `finally`. Production rejects plaintext keys unless `ALLOW_PLAINTEXT_HOT_WALLET=True`.
- **A20** `LoginView.pin_otp_verified` gate · device / IP-change challenge can no longer be bypassed by submitting any non-empty `otp` string.
- **C1** Web clients receive `HttpOnly; Secure; SameSite=Strict` cookies when the request carries `X-Cpay-Web: 1`. Native keeps Bearer. CSRF token is mirrored to `X-CSRFToken` for mutations. Logout wipes cookies + blacklists the refresh.
- **C2** Mobile uses `authApi.signReceipt()` → 60-second HMAC-signed URL. The raw JWT no longer rides in any `?token=` query string.
- **D2 + D21** `docker-compose.yml` requires `${POSTGRES_PASSWORD:?}` at boot. Postgres + Redis bind to `127.0.0.1` only. Redis accepts `--requirepass` when `REDIS_PASSWORD` is set.
- **D4** `ProtectedMediaView` with per-subtree ACL (KYC uploads owner-only, receipts signed-URL-only). Production uses `X-Accel-Redirect` to hand off to nginx. The old `django.views.static.serve` mount is gone.
- **D10** `ADMIN_URL` env-obfuscated; `AdminIPAllowListMiddleware` 403s admin requests outside `ADMIN_IP_ALLOWLIST` CIDR set.
- **D22** `TrustedProxyMiddleware` strips `X-Forwarded-*` and `CF-Connecting-IP` when peer is not in Cloudflare's published IP ranges (gated by `CLOUDFLARE_ONLY_ORIGIN=True`).
- **User preferences** persisted server-side: `User.language` + `notify_email/sms/push/marketing_enabled`. Profile API accepts + saves them. Welcome SMS and transaction-notification dispatcher honour both the language and the opt-out flags.
- **Tests** 245/245 pytest pass (226 pre-existing + 19 new Critical/High regression tests in `apps/accounts/test_security_criticals.py`).

### Pending for ops (not code — put on the next deploy)

| # | Area | What to do | Owner |
|---|------|------------|-------|
| P1 | **EXPO_TOKEN rotation** | Revoke old token `8uhy…InEn` at [expo.dev/accounts/settings/access-tokens](https://expo.dev/accounts/settings/access-tokens). Put the new one in `/root/.android_env` on WSL and on the VPS if used. | Kevin |
| P2 | **VPS firewall ↔ Cloudflare-only** | `ufw allow from <cf-range> to any port 443` for every Cloudflare IP range (https://www.cloudflare.com/ips/). Then `ufw deny 443`. With `CLOUDFLARE_ONLY_ORIGIN=True` in `.env.production`, any accidental direct-origin hit will be 403'd at middleware too. | Kevin |
| P3 | **`.env.production` updates** | Add/confirm: `ADMIN_URL=<random-slug>/`, `ADMIN_IP_ALLOWLIST=<office-cidr,vpn-cidr>`, `CLOUDFLARE_ONLY_ORIGIN=True`, `USE_X_ACCEL_REDIRECT=True`, `AUTH_COOKIE_DOMAIN=cpay.co.ke`, `POSTGRES_PASSWORD=<strong>`, `REDIS_PASSWORD=<strong>`, and KMS-encrypted hot-wallet keys (`TRON_HOT_WALLET_ENCRYPTED`, `ETH_HOT_WALLET_ENCRYPTED`, `POLYGON_HOT_WALLET_ENCRYPTED`, `SOL_HOT_WALLET_ENCRYPTED`, `BTC_HOT_WALLET_ENCRYPTED`) once KMS is wired. | Kevin |
| P4 | **nginx protected-media block** | Production nginx needs:<br>`location /protected-media/ { internal; alias /var/www/cpay-media/; }`<br>so `X-Accel-Redirect` from Django can hand off the file without streaming through Django. | Kevin |
| P5 | **django_otp for admin** | Code-level `ADMIN_REQUIRE_TOTP` knob exists but the `django_otp` enrolment UI is not wired. Follow-up: `pip install django-otp qrcode` + add TOTPDevice enrolment to the staff onboarding flow. | Follow-up sprint |
| P6 | **C1 · drop JSON tokens from login body** | Login/register responses still carry `{tokens: {access, refresh}}` in JSON for backwards compat with older Expo builds. After ~2 weeks of the cookie cycle being live (enough time for all user devices to update), drop the JSON copy. | 2 weeks post-deploy |
| P7 | **Credentials rotation from the handoff archive** | The 2026-04-20 `Cpay-handoff-resources/` archive contained Safaricom Consumer Key/Secret, TronGrid key, Alchemy key, Google OAuth client secret, `MPESA_INITIATOR_PASSWORD`. Archive is gitignored now, but rotate each at the provider before going public-beta. | Kevin |
| P8 | **SMS + email i18n coverage** | `apps/core/i18n.py` has the catalog; `send_welcome_sms` + `send_transaction_notifications` use it. Remaining: `send_otp_to_email`, `send_security_alert`, `send_pin_change_alert`, `send_failed_transaction_alert_task`. Mechanical migration. | Follow-up sprint |
| P9 | **COLD_WALLET env vars + seeding** | Generate cold-storage receive addresses on air-gapped device (TRON, ETH, Polygon, BTC, SOL). Set `COLD_WALLET_TRON/ETH/POLYGON/BTC/SOL` in `.env.production`. Deploy. Run `docker compose exec web python manage.py init_custody_tiers`. Once set, `check_custody_thresholds` beat task begins auto-sweeping excess hot balance direct to cold (skips warm) every 15 min. | Kevin |
| P10 | ~~APK build: CMake/NDK failure~~ | ✅ **Resolved 2026-04-22 21:22 EAT**. After killing stale gradle/kotlin daemons + wiping `/root/eas-sandbox`, a fresh `eas build --profile preview --local` produced `cryptopay-20260422-210255.apk` (110 MB) on WSL Ubuntu. Uploaded to `/var/www/cpay-downloads/cryptopay.apk`. | Done |
| P11 | ~~KMS test fixtures~~ | ✅ **Resolved 2026-04-22**. Root cause was NOT a SECRET_KEY rotation but a real `encrypt_seed`/`decrypt_seed` double-base64 bug in `apps/blockchain/kms.py` — the local Fernet token was base64-encoded twice on encrypt but only decoded once on decrypt, so round-trip had never worked. Also fixed `rotate_data_key` mis-classifying AWS network errors. Full suite now **316/316 pass · 0 fail · 0 skip**. | Done |
| P12 | **Replace ActivityIndicator with branded Spinner across app** | 20 app-side files still import React Native's `ActivityIndicator` instead of the branded `<Spinner />` from `mobile/src/components/brand/Spinner.tsx`. Design components (Arc, Coin-C, Dots variants) already exist — this is pure search-and-replace. Files: `(tabs)/pay.tsx`, `(tabs)/wallet.tsx`, `auth/login.tsx`, `auth/register.tsx`, `auth/approve-login/[id].tsx`, `auth/google-complete-profile.tsx`, `auth/set-initial-pin.tsx`, `payment/buy-crypto.tsx`, `payment/deposit.tsx`, `payment/detail.tsx`, 10× `settings/*.tsx`. | Follow-up sprint |
| P13 | **Replace unDraw illustrations on landing.tsx** | Four `undraw.co` references remain: `mobile/app/landing.tsx` (multiple), `mobile/src/components/brand/Illustrations.tsx`, `mobile/src/components/landing/HowItWorksMockup.tsx`. Design team's 1:1 mapping (unDraw → in-brand component) is in `cpay/chats/chat1.md` §"Consolidated mapping". | Follow-up sprint |

### Runtime bugs fixed in the same deploy cycle

| Bug | Symptom | Fix | Commit |
|---|---|---|---|
| Bottom-tab labels clipped on mobile viewport | "Home / Pay / Wallet / Me" letters cut off at baseline | Removed custom icon bounding box; switched to idiomatic `tabBarIcon`/`tabBarLabel` split; `justifyContent: flex-start`; bumped content height 64→70 | `d46b6dc` |
| `ReferenceError: formatKes is not defined` on dashboard | Red ErrorBoundary "Something went wrong" after login/hard-refresh | `CryptoPriceChartsSection` + `MobileCryptoCharts` now destructure `useDisplayCurrency()` in their own scope instead of relying on `HomeScreenContent`'s closure | `4e9194f` |
| APK splash wordmark clipped to "Cpa" + dead strip under bottom tabs | Android clipped the `y` descender because `letterSpacing: -0.4` + missing `includeFontPadding`; tab-bar `Math.max(insets.bottom, 8)` floor added a phantom 8 px strip on 3-button nav | Swapped splash wordmark to `<Wordmark/>` component (proper DM Sans metrics); dropped the Android padding floor so tab-bar height honours real `insets.bottom` exactly | 2026-04-23 |
| KMS local-fallback encrypt/decrypt round-trip failed | Every `LocalKMSManagerTest` raised `KMSDecryptionError: Failed to decrypt local data key` | Root-caused to `encrypt_seed` double-base64-encoding an already-base64 Fernet token; `decrypt_seed` only unwraps one layer. Removed the extra `base64.b64encode` pass | 2026-04-23 |
| Referral history rows rendered as "·" + 0 KES | Backend serializer emitted `referee_display` / `reward_kes`; mobile destructured `referee_masked_name` / `referee_masked_phone` / `status_display` / `reward_amount_kes` | Expanded `ReferralHistoryItemSerializer` to emit both the new canonical names and the legacy aliases; pinned the contract in the docstring | 2026-04-23 |
| `can_invite_more` monthly cap never triggered | `rewarded_at__month__gte=1` is trivially true on every month — cap was moot | Replaced with a real "start of current calendar month" bound in EAT | 2026-04-23 |
| Daily summary email stamped "N/A" for new users | Queried `User.date_joined`, field doesn't exist on our `AbstractBaseUser` subclass (uses `created_at`); `except Exception` silently swallowed the `FieldError` | Switched to `created_at`, widened email to Users + Logins + Activity + Transactions sections, dropped the `[Django]` subject prefix via `EMAIL_SUBJECT_PREFIX=""`, swapped section header colour from `#0f172a` (near-black on navy bg) to brand emerald | 2026-04-22 |
| Splash/auth flows lacked motion | "Signing in…" / "Creating your account…" were static text | Wired `<Spinner variant="arc">` (design-pixel-exact — 14 % thickness, 28 % arc, emerald-translucent track) alongside each CTA label | 2026-04-23 |

### Audit cycle 2 · 2026-04-23 · 5 findings closed + CI/staging

| Finding | Fix | Regression tests |
|---|---|---|
| **A1** · Welcome / OTP / security / KYC emails bypassed `notify_email_enabled` + `user.language` | `core/email.py` gained `_email_allowed(user, kind)` with an explicit allow-list of security-critical kinds (`otp`, `pin_change`, `pin_reset`, `security_alert`, `kyc_status`) that always send even when the user has opted out. Transactional senders (welcome, receipt, deposit-confirmed) now gate on `notify_email_enabled`. Subjects localise via `user.language`; template lookup tries `f"email/welcome.{locale}.html"` then falls back to en. | 8 tests in `apps/core/test_email_gating.py` |
| **A2** · Quote `fee_kes` under-reported the real platform fee by `PLATFORM_SPREAD_PERCENT × kes_amount` — KRA excise reconciliation risk | `rates/services.py`: `fee_kes` now equals the TOTAL platform fee (spread + flat); new explicit fields `flat_fee_kes`, `spread_revenue_kes`, `platform_fee_kes` surface the breakdown for receipts + admin dashboards. | — |
| **A3** · DepositQuoteView promises a fee the saga never takes | **False positive.** Verified `apps/mpesa/tasks.py:279` applies `DEPOSIT_FEE_PERCENTAGE` on C2B. No change. | — |
| **A4** · No clawback when a qualifying deposit was reversed — abuse vector (deposit 500 → trigger 50 bonus → reverse via M-Pesa support) | `referrals/signals.py` listens for `Transaction.status == REVERSED` on the referral's `qualifying_transaction` and enqueues `claw_back_reward`. Falls back to in-process execution if the Celery broker is unreachable so the clawback can't be silently lost. | 4 tests in `apps/referrals/test_clawback.py` |
| **A5** · `C2BValidationView` leaked the 30 s per-user daily-limit Redis lock — every Paybill user self-locked for 30 s | Switched to context-manager form `with check_daily_limit(user, kes_amount):` so the lock releases on scope exit (the actual Transaction is created by the separate confirmation callback). | 2 tests in `apps/mpesa/test_c2b_lock_release.py` |

### Testing pipeline + staging (new · 2026-04-23)

The "don't push bad code to production" contract:

| Piece | Location | What it enforces |
|---|---|---|
| **Secret scanner (CI)** | `.github/workflows/ci.yml` job `secret-scan` | Fails PR / push if the diff contains an Android keystore manifest blob, a private-key PEM, an AWS/Expo/GitHub token, or a committed `.env` file. Runs first; backend + frontend jobs `needs: secret-scan`. |
| **Deploy gate (CI)** | Same file, job `deploy-gate` | Single green-light job that depends on every other job. Only fires on `push` to `main`. The VPS deploy script checks this conclusion via the GitHub API before pulling. |
| **Staging overlay** | `docker-compose.staging.yml` | Same image as prod, isolated DB (`cryptopay_staging`), listens on `127.0.0.1:8800` so the smoke script can curl directly. Uses `.env.staging` with sandbox payment endpoints and the **backup** BlockCypher token so stray requests never burn prod rate-limit budget. |
| **Staging smoke** | `scripts/smoke-staging.sh` | 6 fail-fast checks: health endpoint, migrations applied, `/apk/` 302, admin metrics gated, rates API returns a real KES number, and any `@pytest.mark.staging_smoke` tests. Exit 1 aborts the prod deploy. |
| **Production runbook** | `scripts/deploy-production.sh` | Refuses to deploy unless (a) GitHub `deploy-gate` is `conclusion=success` for the target SHA AND (b) `smoke-staging.sh` exits 0. Then migrates, rebuilds, restarts, and post-deploy pings `cpay.co.ke/health/`. |

### Decision doc · balance-lock feature

`docs/research/BALANCE-LOCK.md` — 2,400-word viability assessment. **Verdict: red-light the hedge; green-light a stop-loss order instead.** Five independent disqualifying dimensions (actuarial upside-down, no hedge instrument, Kenyan regulatory exposure, custody/concentration risk, user problem already solved by swap-to-USDT / swap-to-KES / stop-loss). Recommended build order: stop-loss order (2-3 engineer-weeks, zero capital risk), then educational USDT "Stable" badge, revisit hedge only if (a) VASP derivative scope crystallises favourably, (b) liquid KES-denominated options venue emerges, (c) stop-loss usage data shows real unmet demand.

### New capabilities shipped this cycle

| Capability | What it does | Files touched |
|---|---|---|
| APK download counter | Short URL `/apk/` increments a Redis counter then 302s to the nginx-served binary; admin dashboard renders the running total in the user-list header | `backend/apps/core/views.py` (`ApkDownloadView`, `ApkDownloadMetricsView`), `config/urls.py`, `mobile/app/landing.tsx`, `mobile/app/settings/admin-users.tsx` |
| Platform fingerprint per user | Heartbeat middleware parses User-Agent + `X-Cpay-Web` sentinel; persists `apk` / `ios` / `web_mobile` / `web_desktop` on `User.last_platform`. Admin user list renders a tiny Ionicons glyph per row so ops can see at a glance how each user connects | `apps/accounts/models.py` (+migration `0016_user_last_platform`), `apps/core/middleware.py`, `apps/accounts/views.py`, `mobile/app/settings/admin-users.tsx` |
| Hot → Cold custody on-chain sweep | Already shipped 2026-04-22 (see Security row 23); COLD_WALLET_<CHAIN> env vars declared, `init_custody_tiers` mgmt command seeds SystemWallet rows, `check_custody_thresholds` beat task now broadcasts on-chain when excess hot balance is swept | `apps/wallets/custody.py`, `apps/wallets/tasks.py`, `apps/wallets/views.py` |
| BlockCypher token rotation slot | `BLOCKCYPHER_API_TOKEN_BACKUP` env slot declared so an emergency rotation is a one-line env swap + restart, not a code change | `backend/config/settings/base.py`, `backend/.env.example` |

### Live deploy coordinates (end of 2026-04-22 pass)

- **Backend HEAD:** `baf3bd4` → container rebuilt, `accounts.0015_user_language_notify_prefs` + 11 × `token_blacklist.*` migrations applied, `cryptopay_web` / `cryptopay_celery` reporting healthy.
- **Web bundle:** `entry-e1ff873a3e36e0f86368bafb60832be8.js` (4.2 MB) served from `/var/www/cpay/` via nginx + Cloudflare.
- **APK:** build in flight in WSL from `scripts/_build-apk-wsl.sh` at 2026-04-22 19:59:13 UTC · output will land at `/var/www/cpay-downloads/cryptopay.apk` · old 2026-04-18 build still serving until swap.

---

Items needed before the app can go live with real users and money.

---

## 🔴 MUST HAVE — Before Any Real Transactions

### API Keys & Credentials
| # | Item | Status | How to Get |
|---|------|--------|------------|
| 1 | **SMS Provider (eSMS Africa)** | ✅ Configured | eSMS Africa API key + account ID set in production .env |
| 2 | **SasaPay Payment API** | ✅ Live (sandbox) | Sandbox tested with real STK Push. Merchant 600980. Needs production merchant account after business registration |
| 3 | **M-Pesa Daraja (alternative)** | ⚠️ Sandbox only | Sandbox keys configured. Production needs business shortcode + VASP license |
| 4 | **Smile Identity (KYC)** | ❌ Need API key | Sign up at usesmileid.com → KES 50-100 per ID check |
| 5 | **CoinGecko API** | ✅ Configured | Demo key `CG-zJVrCfUcwus46BCr8TXJff9M` set. Attribution required. |
| 6 | **Wallet Master Seed** | ✅ Generated | BIP-39 mnemonic generated, HD keys derived for all 5 chains. Stored in VPS .env |
| 7 | **Django SECRET_KEY** | ✅ Set | Production SECRET_KEY configured in .env |
| 8 | **Google OAuth Client IDs** | ✅ Configured | Web + Android client IDs set in app.json |
| 9 | **Resend Email** | ✅ Working | Emails sending (receipts, rate alerts, notifications) |
| 10 | **Expo/EAS Token** | ✅ Configured | Local WSL APK builds working |
| 11 | **TronGrid API** | ✅ Configured | Key set, Tron listener running |
| 12 | **Alchemy (ETH + SOL)** | ✅ Configured | RPC URLs set for both chains |
| 13 | **BlockCypher (BTC)** | ❌ Signup pending | Email verification not received. Need for BTC monitoring |
| 14 | **Yellow Card API** | ❌ Need keys | Contact paymentsapi@yellowcard.io for B2B rebalancing |

### Infrastructure
| # | Item | Status | Details |
|---|------|--------|---------|
| 8 | **VPS / Cloud Server** | ✅ Live | Contabo VPS 173.249.4.109, Docker Compose, nginx + Cloudflare |
| 9 | **Domain Name** | ✅ Live | cpay.co.ke with Cloudflare CDN + SSL |
| 10 | **SSL Certificate** | ✅ Live | Cloudflare handles TLS termination |
| 11 | **Production Database** | ✅ Running | PostgreSQL 16 in Docker, 6 days uptime |
| 12 | **Email Provider** | ✅ Working | Resend SMTP — receipts, alerts, notifications all sending |
| 13 | **Monitoring** | ✅ Running | Prometheus + Grafana + exporters (Redis, Postgres, Node) |

### Legal & Compliance
| # | Item | Status | Details |
|---|------|--------|---------|
| 13 | **VASP Registration** | ⚠️ Comment period | Draft regulations published. Public comment deadline **April 10, 2026** |
| 14 | **Business Registration** | ⚠️ Pending | Submitted on eCitizen, awaiting approval |
| 15 | **Privacy Policy** | ✅ Live | `mobile/app/privacy.tsx` ships with the app; hosted at `https://cpay.co.ke/privacy` for store reviews |
| 16 | **Terms of Service** | ✅ Live | `mobile/app/terms.tsx` ships with the app; hosted at `https://cpay.co.ke/terms` |
| 17 | **Excise Duty Compliance** | ✅ Implemented | 10% excise on platform fees per VASP Act |

### Security (Penetration Tested 2026-03-21)
| # | Item | Status | Details |
|---|------|--------|---------|
| 18 | **Auth bypass protection** | ✅ Passed | All endpoints return 401 without valid JWT |
| 19 | **JWT tampering** | ✅ Passed | Forged tokens rejected |
| 20 | **SQL injection** | ✅ Passed | Django ORM parameterized queries |
| 21 | **XSS** | ✅ Passed | Input validation returns 400 |
| 22 | **CORS** | ✅ Passed | Evil origins blocked |
| 23 | **IDOR** | ✅ Passed | Cross-user data access blocked |
| 24 | **Rate limiting** | ✅ Working | Login throttled at 24 requests |
| 25 | **Sensitive data masking** | ✅ Done | Phone numbers, M-Pesa receipts masked in API |
| 26 | **Swagger disabled** | ✅ Done | OpenAPI/docs return 404 in production |
| 27 | **TOTP secret hidden** | ✅ Done | Only provisioning_uri returned, not raw secret |

---

## 🟡 SHOULD HAVE — Before Public Beta

### Monitoring & Reliability
| # | Item | Status | Details |
|---|------|--------|---------|
| 18 | **Sentry Error Tracking** | ⚠️ Configured | Settings ready, just needs `SENTRY_DSN` env var. Sign up at sentry.io (free tier: 5K events/month) |
| 19 | **Prometheus + Grafana** | ❌ Not deployed | `django-prometheus` middleware ready. Need to add Docker services |
| 20 | **Database Backups** | ✅ Script ready | `scripts/backup-db.sh` exists. Need to add to cron (daily recommended) |
| 21 | **Log Aggregation** | ⚠️ Basic | JSON logging configured. Consider Loki/ELK for production |
| 22 | **Uptime Monitoring** | ❌ Need external | UptimeRobot (free) or Better Uptime. Monitor `/health/` endpoint |

### Security
| # | Item | Status | Details |
|---|------|--------|---------|
| 23 | **Hot/Warm/Cold Wallets** | ⚠️ Real sweep wired 2026-04-22 | `apps/wallets/custody.py` + `check_custody_thresholds` beat task broadcast on-chain from HOT to COLD when hot balance exceeds `hot_max_threshold`; COLD is receive-only (no key on server). Admin confirms cold→hot releases via `POST /wallets/custody/transfers/<id>/confirm/` after air-gapped broadcast. **To activate in prod**: (1) set `COLD_WALLET_TRON/ETH/POLYGON/BTC/SOL` env vars to pre-generated cold-storage receive addresses, (2) `docker compose exec web python manage.py init_custody_tiers`, (3) verify in `/wallets/custody/report/`. Covered by 16 regression tests in `apps/wallets/test_custody_tiering.py`. |
| 24 | **Rate Limiting Tuning** | ✅ Configured | Nginx + Django throttling. May need tuning based on real traffic |
| 25 | **Penetration Testing** | ❌ Recommended | Hire security auditor before handling real funds |
| 26 | **M-Pesa IP Whitelist** | ✅ Implemented | Safaricom IP ranges configured in middleware |

### App Stores
| # | Item | Status | Details |
|---|------|--------|---------|
| 27 | **Apple Developer Account** | ❌ Need ($99/year) | developer.apple.com — required for iOS App Store |
| 28 | **Google Play Console** | ❌ Need ($25 one-time) | play.google.com/console — required for Play Store |
| 29 | **EAS Production Build** | ✅ Configured | `eas.json` has production profile. Run `eas build --platform all --profile production` |
| 30 | **App Store Screenshots** | ❌ Need to create | Required for both stores. Use simulator screenshots |

---

## 🟢 NICE TO HAVE — Post-Launch

| # | Item | Status | Details |
|---|------|--------|---------|
| 31 | **Solana SPL Listener** | ❌ | Helius API ($49/mo). Only needed when SOL deposits are enabled |
| 32 | **WalletConnect** | ❌ | Reown AppKit for external wallet connections (MetaMask, Trust, Phantom) |
| 33 | **Off-Ramp API** | ❌ | Yellow Card or Kotani Pay for automated USDT→KES exchange |
| 34 | **Push Notifications** | ✅ Ready | Expo Push API integrated. Works on native builds |
| 35 | **Analytics** | ❌ | Mixpanel or PostHog for user behavior tracking |

---

## Quick Start — Minimum Viable Deployment

To get the app running with real money on a VPS:

```bash
# 1. Provision VPS and point domain
# 2. Clone repo and create .env with all required keys
# 3. Deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 4. Run migrations
docker compose exec web python manage.py migrate

# 5. Create admin user
docker compose exec web python manage.py create_admin

# 6. Set up SSL
certbot --nginx -d yourdomain.com

# 7. Build mobile apps
cd mobile && eas build --platform all --profile production
```

**Estimated cost to launch:**
- VPS: ~$20-40/mo (4GB RAM)
- Domain: ~$15/year (.co.ke)
- Africa's Talking SMS: ~KES 0.8/SMS (pay as you go)
- Smile Identity KYC: ~KES 50-100/check
- Apple Developer: $99/year
- Google Play: $25 one-time
- **Total first month: ~$180-250**
