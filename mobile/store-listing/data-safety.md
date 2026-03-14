# CryptoPay - Google Play Data Safety Declaration

This document maps to the Google Play Console Data Safety form.
Complete this in Play Console > App content > Data safety.

---

## Data Collected

### 1. Phone Number
- **Collected**: Yes
- **Required**: Yes (used for authentication and M-Pesa integration)
- **Shared with third parties**: Yes (Safaricom M-Pesa for payment processing)
- **Purpose**: App functionality, account management
- **Encrypted in transit**: Yes (TLS 1.2+)
- **User can request deletion**: Yes

### 2. Full Name
- **Collected**: Yes
- **Required**: Yes (KYC compliance, displayed on profile)
- **Shared with third parties**: Yes (Safaricom M-Pesa for payment verification)
- **Purpose**: App functionality, account management, regulatory compliance
- **Encrypted in transit**: Yes (TLS 1.2+)
- **User can request deletion**: Yes

### 3. Email Address
- **Collected**: Yes
- **Required**: No (optional, used for receipts and account recovery)
- **Shared with third parties**: No
- **Purpose**: App functionality, account management
- **Encrypted in transit**: Yes (TLS 1.2+)
- **User can request deletion**: Yes

### 4. Device Identifiers
- **Collected**: Yes
- **Required**: Yes (device fingerprinting for security)
- **Shared with third parties**: No
- **Purpose**: Fraud prevention, security (new device detection triggers OTP)
- **Encrypted in transit**: Yes (TLS 1.2+)
- **User can request deletion**: Yes (on account deletion)

### 5. IP Address
- **Collected**: Yes
- **Required**: Yes (logged for security audit trail)
- **Shared with third parties**: No
- **Purpose**: Fraud prevention, security (IP change triggers OTP)
- **Encrypted in transit**: Yes (TLS 1.2+)
- **User can request deletion**: Yes (on account deletion, subject to regulatory retention)

### 6. Financial Transaction Data
- **Collected**: Yes
- **Required**: Yes (core app functionality)
- **Shared with third parties**: Yes
  - Safaricom M-Pesa (KES transactions)
  - Blockchain networks (cryptocurrency transfers: BTC, ETH, USDT)
- **Purpose**: App functionality, regulatory compliance
- **Encrypted in transit**: Yes (TLS 1.2+)
- **Encrypted at rest**: Yes (database encryption)
- **User can request deletion**: No (regulatory requirement to retain for 7 years)

### 7. Authentication Credentials (PIN, TOTP secrets)
- **Collected**: Yes
- **Required**: Yes
- **Shared with third parties**: No
- **Purpose**: Security, authentication
- **Encrypted in transit**: Yes (TLS 1.2+)
- **Encrypted at rest**: Yes (PIN hashed with bcrypt, TOTP secrets encrypted)
- **User can request deletion**: Yes (on account deletion)

---

## Data NOT Collected

- Precise location / GPS
- Contacts or address book
- Photos or media (camera used only for KYC, images sent directly)
- Calendar data
- SMS content
- Call logs
- Browsing history
- Search history
- Installed apps
- Advertising ID

---

## Third-Party Data Sharing Summary

| Third Party | Data Shared | Purpose |
|---|---|---|
| Safaricom M-Pesa | Phone number, name, transaction amounts | Payment processing |
| Blockchain networks (BTC, ETH, TRON) | Wallet addresses, transaction amounts | Cryptocurrency transfers |
| WalletConnect | Wallet address (user-initiated) | External wallet deposits |

---

## Data Retention

- **Transaction records**: 7 years (Kenya regulatory requirement)
- **Security logs (IP, device)**: 2 years
- **Account data**: Until account deletion + 90 day grace period
- **Authentication data**: Until account deletion

---

## Security Practices

- All data encrypted in transit (TLS 1.2+)
- Sensitive data encrypted at rest (TOTP secrets, PIN hashes)
- 3-layer idempotency for transaction safety
- Session expiry and OTP challenges for suspicious activity
- Biometric authentication support (fingerprint, Face ID)
- No data sold to third parties
