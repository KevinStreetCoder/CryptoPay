# Beta-readiness audit · 2026-05-09 (24-hour delta)

Follow-up to `BETA-READINESS-AUDIT-2026-05-08.md`. Same shape; rows that haven't changed are omitted. Only deltas.

## Gate-row deltas

| Gate | 2026-05-08 | 2026-05-09 | Notes |
|---|---|---|---|
| GCP KMS billing | 🔴 disabled | ✅ enabled | Phase 1+2 active |
| SasaPay prod env vars | 🟡 not set | ✅ live on VPS | OAuth 200, account-validation 200, B2C 400 (min KES 10) confirmed |
| `PAYMENT_PROVIDER=sasapay` flip | 🟡 still `daraja` | ✅ flipped | container restarted, smoke-tested |
| Backend redeploy | 🔴 blocked on KMS | ✅ shipped | dd43231 → current HEAD with SasaPay hardening |
| APK upload | 🟡 in flight (vc 6) | 🟡 in flight (vc 7) | v1.1.3 building in WSL right now, ~6–10 min ETA at time of writing |
| Cold wallet seeding | 🔴 env slots empty | 🟡 in progress | air-gap procedure documented; addresses pending generation |
| Smile Identity | 🔴 no account | 🔴 no account | unchanged |
| Sentry DSN | 🟡 env slot empty | 🟡 env slot empty | unchanged |
| UptimeRobot | 🔴 not configured | 🔴 not configured | unchanged |

## Engineering shipped 2026-05-08 → 2026-05-09

**Security hardening (SasaPay)**
- Callback signature: SHA-256-of-body → **HMAC-SHA512** field-concat keyed on Client ID per canonical docs
- IP allowlist tightened: permissive → **10 documented `/32` SasaPay hosts** + 127.0.0.0/8
- **Defense-in-depth status-API re-verification** before any wallet credit (`SASAPAY_VERIFY_CALLBACKS_VIA_API=True`)
- Comprehensive error-code table from docs (success / pending / failed sets, M-Pesa C2B + B2C codes, Pesalink, Airtel, HTTP `SP.4xx/5xx`); pending codes no longer trigger compensation

**Channel coverage (SasaPay)**
- 1 channel (M-Pesa) → **40 channels** (M-PESA, Airtel Money, T-Kash, SasaPay Wallet + 36 Kenyan banks)
- New `checkout_payment()` client method · hosted card / Airtel / M-Pesa / wallet form via `/payments/card-payments/`
- `ensure_utility_balance()` auto-tops Utility from Working before each B2C (+5% buffer)

**KMS uplift**
- Phase 1: 5/7 production secrets in **Secret Manager**
- Phase 2: TOTP HOTP secrets **kms_wrapped** via envelope encryption
- Phase 3 (phone/email column encryption) deferred to maintenance window — design doc pending

**Object storage**
- Cloudflare **R2** bucket `cpay-prod` live, smoke test PASS
- KYC docs + receipts route through R2 via django-storages

**Mobile build pipeline**
- Stable RSA-4096 release keystore at `mobile/credentials/cpay-release.keystore`
- SHA-1 `73:21:C5:C0:91:4D:9B:75:18:AF:31:E2:19:E9:8D:1E:EE:4E:84:49`
- Permanent fix for "App not installed as package appears to be invalid" on in-place upgrades
- WSL build script versioned filename + `EXPO_TOKEN` no longer baked into the script
- Onboarding tour scroll fix at last step
- OTP resend live countdown

## Hard-blocker chain (revised for 2026-05-09)

The 5-step chain in the 2026-05-08 audit is now collapsed to:

1. ~~Re-enable GCP KMS billing~~ ✅
2. ~~Grab + paste SasaPay prod credentials~~ ✅
3. ~~Backend redeploy~~ ✅
4. **APK upload + atomic swap** · in flight (this session)
5. **You · live KES 100 smoke test on v1.1.3** · uninstall v1.1.2 first (one-time keystore-change inconvenience), install v1.1.3 from `cpay.co.ke/download`, M-Pesa → Lipa Na M-Pesa → Pay Bill → 756756 → account `<6-char intent code>` → KES 100. Within 30s: USDT credited.

## Beta-launch checklist updates

| # | Action | 2026-05-08 | 2026-05-09 |
|---|---|---|---|
| 1 | Hard-blocker chain | 🔴 | 🟡 (1 step left: live smoke test) |
| 6 | SasaPay production-approval email | 🔴 | 🔴 unchanged |
| 10 | APK uploaded to VPS | 🟡 | 🟡 vc 7 in flight |
| **11** | **Stable signing keystore in place** | not in 2026-05-08 list | ✅ done |
| **12** | **HMAC-SHA512 + status-API verify on all callbacks** | not in 2026-05-08 list | ✅ done |

(Items 2–5, 7–9 unchanged from 2026-05-08 audit.)

## Newly-tracked risks

- **First v1.1.3 install fails for v1.1.2 users** with "App not installed". Expected; the keystore changed. Documented in v1.1.3 release notes — users uninstall once, then every future build upgrades cleanly.
- **`SASAPAY_ALLOWED_IPS` is fixed at 10 hosts** as of docs read 2026-05-08. If SasaPay rotates origin IPs, the callback handler will start 403'ing. Mitigation: monitor 403s on `/api/v1/payments/sasapay/callback/`, widen the allowlist if rate spikes.
- **R2 access keys not yet in Secret Manager** (Phase 1 list was 7 items, R2 wasn't on it). Move to Secret Manager next sprint.
- **Cloud Audit Logs sink not configured** for KMS / Secret Manager. Means a credential-exfil attempt via service account would not page anyone. Tracked, low urgency for closed beta.

## Closed-beta launch is now gated on

1. APK upload finishing (this session)
2. One live smoke test by the user on a real Android device
3. Cold-wallet addresses generated (operator action)
4. Smile / Sentry / UptimeRobot sign-ups (operator action, 45 min total)

Engineering side: clear.
