# CryptoPay — New Features Implementation Plan

**Date:** 2026-03-11
**Source:** Grok deep-dive conversation + independent research
**Priority:** Features not yet planned or partially planned

---

## 1. Enhanced Security Features

### 1.1 OTP Challenge After 3 Wrong Passwords
**Current State:** Progressive lockout (5→10→15 attempts), but no OTP challenge.
**New Approach:** After 3 consecutive failed PIN attempts, require OTP verification before allowing further login attempts.

| Item | Details |
|------|---------|
| Backend | Add `require_otp_challenge` flag on User model. After 3 fails, set flag. Login endpoint checks flag → requires OTP. |
| SMS | Uses existing Africa's Talking integration |
| Reset | OTP success resets `pin_attempts` and clears flag |
| Library | Custom (simple flag + existing OTP system) |
| Effort | Small |

### 1.2 TOTP Authenticator App Support
**Purpose:** Google Authenticator / Authy as 2FA for high-security users.

| Item | Details |
|------|---------|
| Library | `pyotp` (lightweight, well-maintained) |
| QR Code | `qrcode` library → PNG served via DRF endpoint |
| Backup Codes | 10 one-time codes, bcrypt hashed, stored in DB |
| Flow | Enable → QR scan → verify first code → save secret |
| Model | `TOTPDevice(user, secret_key, is_active, backup_codes, created_at)` |
| Effort | Medium |

### 1.3 Recovery Email & Alternate Phone
**Purpose:** Account recovery when primary phone is lost.

| Item | Details |
|------|---------|
| Model Changes | Add `recovery_email`, `recovery_phone`, `recovery_email_verified` to User |
| Verification | Email: token-based link (24hr expiry). Phone: OTP. |
| Recovery Flow | Request → verify identity via recovery contact → reset PIN |
| Effort | Medium |

### 1.4 Email Confirmation Flow
**Purpose:** Verify user email addresses for notifications and recovery.

| Item | Details |
|------|---------|
| Flow | Add email → send verification link → click → mark verified |
| Token | `EmailVerificationToken(user, token, expires_at)` model |
| Expiry | 24 hours |
| Template | New email template `email_verification.html` |
| Effort | Small |

---

## 2. Transaction Notifications & Receipts

### 2.1 Email Notification on Successful Transactions
**Current State:** `send_transaction_receipt_task` exists but may not be triggered on all transaction completions.
**Action:** Ensure every completed transaction triggers email with reference number.

### 2.2 SMS Notification on Successful Transactions
**Purpose:** SMS with transaction reference for all completed payments.

| Item | Details |
|------|---------|
| Integration | Africa's Talking SMS (already integrated for OTP) |
| Template | "CryptoPay: {type} of KES {amount} completed. Ref: {reference}. Thank you." |
| Task | New Celery task `send_transaction_sms_task` |
| Effort | Small |

### 2.3 PDF Receipt Generation
**Purpose:** Well-designed, printable PDF receipt with CryptoPay logo.

| Item | Details |
|------|---------|
| Library | `weasyprint` (best for styled HTML→PDF, supports CSS) |
| Template | HTML receipt template with logo, transaction details, QR code |
| Endpoint | `GET /payments/{id}/receipt/` → returns PDF |
| Frontend | Download/print button on success screen |
| Design | Branded header, transaction table, footer with support info |
| Effort | Medium |

---

## 3. WalletConnect / DeFi Integration

### 3.1 External Wallet Connection (WalletConnect v2 / Reown)
**Purpose:** Users connect MetaMask, Trust Wallet, Phantom to pay directly.

| Item | Details |
|------|---------|
| Library | `@reown/appkit-wagmi-react-native` (WalletConnect v2 successor) |
| Flow | Connect wallet → select crypto → sign transaction → backend verifies on-chain |
| Backend | Verify on-chain transfer to CryptoPay deposit address |
| Chains | Ethereum, Polygon, BSC, Tron |
| Effort | Large |

---

## 4. KES On-Ramp (Deposit KES → Convert to Crypto)

### 4.1 M-Pesa STK Push → Buy Crypto
**Current State:** `BuyCryptoView` EXISTS — STK Push buy flow already implemented.
**Action:** Verify it's working end-to-end, add to account management settings.

---

## 5. Account Management Settings (Frontend)

### 5.1 New Settings Screens Needed

| Screen | Purpose | Priority |
|--------|---------|----------|
| Security Settings | TOTP setup, recovery email/phone, email verification | HIGH |
| Account Recovery | Set up recovery methods | HIGH |
| Two-Factor Auth | Enable/disable TOTP, manage backup codes | HIGH |
| Connected Wallets | WalletConnect management | MEDIUM |

---

## Implementation Order

1. **OTP Challenge after 3 wrong PINs** (Backend + Frontend) — Small
2. **Email Confirmation Flow** (Backend + Frontend) — Small
3. **Recovery Email/Phone** (Backend + Frontend) — Medium
4. **SMS Transaction Notifications** (Backend) — Small
5. **PDF Receipt Generation** (Backend + Frontend) — Medium
6. **Ensure email notifications fire on all transactions** (Backend) — Small
7. **TOTP Authenticator App** (Backend + Frontend) — Medium
8. **Account Management Settings UI** (Frontend) — Medium
9. **WalletConnect Integration** (Frontend + Backend) — Large
