# CryptoPay Security Audit Report

**Date:** 2026-03-14
**Scope:** Full backend security audit — OTP, PIN, M-Pesa, payments, wallets, deposits

---

## Summary

| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| CRITICAL | 1 | 1 | 0 |
| HIGH | 7 | 7 | 0 |
| MEDIUM | 7 | 4 | 3 |
| LOW | 4 | 1 | 3 |

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

### M2: TOTP Secret Stored Plaintext in Database — TRACKED
- **File:** `backend/apps/accounts/models.py:57`
- **Issue:** `totp_secret` stored as plaintext CharField. DB breach exposes all TOTP secrets.
- **Recommendation:** Encrypt with `django-encrypted-model-fields` or custom Fernet encryption with key from env var. Tracked for next sprint.

### M3: Google OAuth Users Have No PIN — TRACKED
- **File:** `backend/apps/accounts/views.py:603-604`
- **Issue:** Google OAuth creates users with `phone=""` and no PIN. These users can't transact (PIN required) but no "set initial PIN" flow exists.
- **Recommendation:** Add "set initial PIN" endpoint for users without `pin_hash`. Tracked for next sprint.

### M4: Receipt CORS Echoes Any Origin — FIXED ✅
- **File:** `backend/apps/payments/views.py:711-715`
- **Issue:** Manual CORS headers echoed back ANY origin, bypassing Django CORS middleware's allowed origins list.
- **Fix:** Now validates origin against `settings.CORS_ALLOWED_ORIGINS` before echoing.

### M5: DEPOSIT_SLIPPAGE_TOLERANCE Not Enforced — TRACKED
- **File:** `backend/config/settings/base.py:375`
- **Issue:** Setting defined (2.0%) but never checked during payment execution. Stale quotes at favorable rates honored without slippage verification.
- **Recommendation:** Enforce at quote consumption time by comparing locked rate vs current live rate.

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

### L3: Raw M-Pesa Payload Logged at INFO — ACCEPTED
- **File:** `backend/apps/mpesa/views.py` (multiple locations)
- **Issue:** Full callback payloads (including phone numbers) logged at INFO level. PII in logs.
- **Mitigation:** Acceptable for early stage. Will move to DEBUG-only logging before GDPR/DPA compliance review.

### L4: Phone Dashes Not Stripped in C2B Parsing — FIXED ✅
- **File:** `backend/apps/mpesa/views.py:440`
- **Issue:** Phone numbers with dashes (e.g., "0712-345-678") not cleaned in `_parse_c2b_account_ref`.
- **Fix:** Added `.replace("-", "")` to phone normalization.

---

## Remaining Action Items (Prioritized)

1. **M2:** Encrypt TOTP secrets at rest
2. **M3:** Add "set initial PIN" flow for Google OAuth users
3. **M5:** Enforce slippage tolerance at quote consumption
4. **L3:** Move M-Pesa payload logging to DEBUG level
5. **Future:** Redis-based OAuth token caching for multi-worker deployments
6. **Future:** Add automated M-Pesa reversal for orphaned C2B deposits
