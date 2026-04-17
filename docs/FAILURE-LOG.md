# Failure log

Running postmortem file. Every production incident, every failing audit
item, every "this fell over once" — captured here with timestamp, blast
radius, root cause, and the fix that closed it out.

Format per entry:

```
### YYYY-MM-DD HH:MM TZ — <one-line summary>
- **Blast radius**: who/what was affected and for how long.
- **Symptoms**: what did users see / what did the logs show.
- **Root cause**: one paragraph.
- **Fix**: the change, with commit hash.
- **Prevention**: what we did so it can't happen the same way again.
```

---

## Open items (still failing or at-risk)

| # | Area | Symptom | Owner | Severity | Workaround |
|---|---|---|---|---|---|
| F-01 | eSMS Africa | HTTP 5xx / silent drops for some MSISDNs despite their "restoration" email 2026-04-17 | provider | Medium | Africa's Talking fallback auto-handles; structured `sms.dispatch` log surfaces per-send outcome |
| F-02 | CoinGecko demo tier | Sporadic 429 even under the documented 10k/mo limit | provider | Low | CryptoCompare batch fallback takes over within 10s; verified on tonight's deploy |
| F-03 | EAS local-build startup | `request to https://api.expo.dev/graphql failed` intermittently at cold start | tooling | Low | Re-run the build; transient network flake, works second time |
| F-04 | Zero-downtime deploy | `docker compose up -d --force-recreate web` has a ~60s window where nginx returns 502 to live users | infra | **High during live usage** | 502 retry shipped 2026-04-17 (`2e8f510`); proper fix is 2 web replicas with health-check routing |
| F-05 | BlockCypher free tier | 200 req/hour ceiling if our key never arrives | provider | Medium | Esplora + mempool.space broadcast fallback already live (`bc44105`) |
| F-06 | Sandbox-default env vars in base settings | If `.env.production` forgets `MPESA_ENVIRONMENT`, `SASAPAY_ENVIRONMENT`, `AT_USERNAME`, or `MPESA_CERT_PATH`, the app silently uses sandbox in production | us | **Critical** | `production.py::_assert_production_env()` now logs ERROR for each sandbox leak; set `REQUIRE_PROD_ENV_STRICT=True` in .env to crashloop instead of silently misconfiguring |
| F-07 | Yellow Card rebalance | `get_sell_quote`/`execute_sell`/`check_settlement` raise `NotImplementedError` | us | Medium | `REBALANCE_EXECUTION_MODE=manual` (the default) — admin rebalances through the dashboard rather than the API; documented as such |
| F-08 | SasaPay reversal | `apps/mpesa/provider.py` reversal path raises `NotImplementedError` | us | Low | Admin reverses through the SasaPay merchant portal; needs manual SOP doc |

## Non-issues confirmed by audit 2026-04-17

The two code audits flagged a handful of "BETA BLOCKERS" that turned
out to be false positives after manual inspection:

- **`onPress={() => {}}` on admin modals** (admin-users.tsx:892,
  admin-user-detail.tsx:996, admin-rebalance.tsx:1440) — these are the
  **intentional tap-propagation blockers** on the modal body
  `<Pressable>`. Without them a tap inside the modal would bubble up
  to the backdrop's `onPress` and close the modal. Every modal in the
  codebase follows this pattern.
- **`apps/blockchain/kms.py:99-120` `NotImplementedError`** — this is
  the abstract `KMSManager` base class. Concrete subclasses
  (`LocalKMSManager`, `AWSKMSManager`) implement the methods; the base
  exists only for typing.
- **`apps/payments/saga.py` DEBUG/sandbox auto-complete** — only fires
  when both `DEBUG=True` AND `MPESA_ENVIRONMENT=sandbox`. Production
  has `DEBUG=False` hard-coded in `production.py`. The F-06 env check
  now guards against the sandbox half of this condition.

Documented so future audits don't re-raise them.

---

## Incidents

### 2026-04-17 22:55 EAT — 60-second 502 flood after sidebar/admin deploy
- **Blast radius**: Every live session saw red error cascades for ~60s.
  Logged-in users saw 502s on `/wallets/`, `/payments/*`, `/rates/*`,
  `/notifications/unread-count/`.
- **Symptoms**: `GET https://cpay.co.ke/api/v1/wallets/ 502 (Bad Gateway)`
  repeated across ~25 endpoints in the browser console.
- **Root cause**: I ran `docker compose up -d --force-recreate web` to
  redeploy the activity-heartbeat middleware. `--force-recreate` stops
  the old container *before* the new one passes health check; nginx's
  upstream is briefly absent → 502 on every proxied request.
  Docker events confirm: `container stop …exitCode=0` at 21:56:12,
  `container start …` at 21:56:13, `daphne Starting server` at 22:56:39
  after `warm_rate_cache` finished. ~60s gap in total.
- **Fix**: transient-retry in `mobile/src/api/client.ts` — 502/503/504
  plus `ECONNABORTED`/`ERR_NETWORK` now retry twice with 700ms/1600ms
  backoff before surfacing the error. Commit `2e8f510`.
- **Prevention (follow-up)**: Move to a 2-replica web service with
  nginx upstream health checks so `docker compose up -d` rolls one
  replica at a time. Scope: ~50 LOC in
  `deploy/docker-compose.prod.yml` + `deploy/nginx/cpay.conf`.
  Tracked as item **D-01** in BETA-LAUNCH-TRACKER.md.

### 2026-04-17 19:13 EAT — EAS local-build `request to api.expo.dev/graphql failed`
- **Blast radius**: me only; first APK-v4 attempt failed at boot.
- **Symptoms**: `Error: GraphQL request failed.` immediately after `eas build` invocation.
- **Root cause**: Transient network flake from WSL → Expo's API edge.
  Curl from the same shell at T+60s returned HTTP 200. Probably a
  DNS hiccup or short-lived TLS handshake failure.
- **Fix**: re-ran with the same command. Second attempt reached
  `INSTALL_DEPENDENCIES`.
- **Prevention**: none needed — expected provider noise. If it
  recurs often, wrap the initial `eas build` call in a 3-attempt
  backoff loop inside `build-apk.sh`.

### 2026-04-17 early — "730K+ Kenyans" fabricated stat on landing
- **Blast radius**: landing page; credibility risk.
- **Symptoms**: an unsourced user-count animated counter claiming "730K+
  Kenyans use crypto".
- **Root cause**: placeholder data left in from an earlier draft.
- **Fix**: removed counter, replaced hero copy and stat tile with
  verifiable CPay-product metrics (90s rate lock, live USDT/KES, <30s
  payment, 1.5% spread). Commit `725b10d`.
- **Prevention**: new **anti-AI-slop checklist** in
  `docs/LANDING-PAGE-DESIGN.md` explicitly rules out unsourced stat
  counters.

### 2026-04-17 — WSL toolchain missing (Java/Node/Android SDK)
- **Blast radius**: me only; APK build path broken.
- **Symptoms**: `ls /root/android` → empty, `java` / `node` / `eas`
  missing.
- **Root cause**: WSL Ubuntu was reset between sessions. Memory file
  `reference_wsl_build.md` was stale.
- **Fix**: reinstalled Java 17, Node 20.20.2, EAS CLI 18.7.0, Android
  SDK platforms 34/35, build-tools 34/35, NDK 27.1, CMake 3.22 via
  `C:\Users\Street Coder\AppData\Local\Temp\wsl-setup.sh`. Wrote
  `/root/.android_env`.
- **Prevention**: keep `wsl-setup.sh` checked into `docs/` (TODO).

### 2026-04-17 — BTC_NETWORK=testnet leaked to production
- **Blast radius**: would have leaked testnet BTC addresses to real
  users if BTC withdrawals had been on.
- **Symptoms**: Boot-time check in `apps.blockchain.apps.BlockchainConfig.ready()`
  logged `btc.config.testnet_in_production` on first deploy after
  setting `BTC_NETWORK=main` as default.
- **Root cause**: `deploy/.env.production` had a duplicate
  `BTC_NETWORK=testnet` line below `BTC_NETWORK=main`; the second
  entry won in dotenv precedence.
- **Fix**: scrubbed the duplicate via `sed -i '/^BTC_NETWORK=testnet$/d'`;
  added `BTC_WITHDRAWALS_ENABLED=False` feature flag so even a repeat
  misconfig can't broadcast funds.
- **Prevention**: boot-time check catches it on container start and
  logs an ERROR.
