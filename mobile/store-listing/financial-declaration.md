# CryptoPay - Financial Features Declaration

This document supports the Google Play Console Financial Features declaration.
Complete this in Play Console > App content > Financial features.

---

## App Classification

- **Category**: Finance
- **Sub-category**: Cryptocurrency exchange and custodial wallet
- **Handles real money**: Yes (KES via M-Pesa, cryptocurrency assets)
- **Payment processor**: Safaricom M-Pesa (B2B and C2B)
- **Custodial wallet**: Yes (app holds cryptocurrency on behalf of users)

---

## Regulatory Compliance

### Kenya VASP Act 2025
- **Status**: Compliance in progress
- **Applicable law**: Kenya Virtual Asset Service Providers Act, 2025
- **Regulatory body**: Capital Markets Authority (CMA) of Kenya
- **License application**: [To be filed / In progress / Obtained — update accordingly]
- **AML/CFT compliance**: Yes, follows FATF guidelines

### KYC (Know Your Customer) Procedures
1. **Registration**: Phone number verification via OTP
2. **Identity verification**: Full name collection at registration
3. **Enhanced KYC** (planned): National ID / Passport document upload
4. **Transaction limits**: Applied based on KYC tier
5. **PEP screening**: [Planned / Implemented — update accordingly]

### AML (Anti-Money Laundering) Controls
1. **Transaction monitoring**: All transactions logged with full audit trail
2. **Suspicious activity detection**: IP and device change detection
3. **Transaction limits**: Per-transaction and daily limits enforced
4. **Record retention**: 7-year transaction record retention
5. **Reporting**: Suspicious Transaction Reports (STR) capability

---

## User Fund Protection

### Cryptocurrency Custody
- **Wallet architecture**: BIP-44 HD wallet with BIP-39 mnemonic
- **Key storage**: Server-side, encrypted at rest
- **Supported assets**: BTC, ETH, USDT (TRC-20 and ERC-20)
- **Hot wallet**: Used for operational transactions
- **Cold storage**: [Planned — percentage of funds to be held offline]

### Transaction Safety
- **3-layer idempotency**: Client UUID, Redis SET NX, PostgreSQL UNIQUE constraint
- **Payment saga pattern**: Lock -> Convert -> Disburse with compensation on failure
- **Atomic operations**: Database transactions for all financial operations

### Account Security
- **Authentication**: 4-digit PIN (bcrypt hashed)
- **2FA**: TOTP authenticator support (Google Authenticator, Authy)
- **Biometric**: Fingerprint and Face ID support
- **Session management**: Automatic expiry, single active session
- **Brute force protection**: OTP challenge after 3 failed PIN attempts
- **Device trust**: New device or IP change triggers OTP verification

---

## Supported Financial Operations

| Operation | Description | Provider |
|---|---|---|
| Buy crypto | Purchase BTC/ETH/USDT with KES via M-Pesa | Safaricom M-Pesa |
| Sell crypto | Convert crypto to KES, receive via M-Pesa | Safaricom M-Pesa |
| Send crypto | Transfer crypto to external wallet address | Blockchain network |
| Receive crypto | Deposit crypto from external wallet | Blockchain network |
| Pay bill | Pay M-Pesa paybill using crypto | Safaricom M-Pesa |
| Buy goods | Pay M-Pesa till using crypto | Safaricom M-Pesa |
| Send to mobile | Send KES to M-Pesa number using crypto | Safaricom M-Pesa |
| KES deposit | Deposit KES to wallet via M-Pesa STK push | Safaricom M-Pesa |

---

## Google Play Financial Services Policy Checklist

- [ ] App provides disclosures about fees before transaction confirmation
- [ ] App displays exchange rates before transaction confirmation
- [ ] App provides transaction receipts (email, SMS, PDF, push notification)
- [ ] App has a privacy policy accessible within the app
- [ ] App has terms of service accessible within the app
- [ ] App complies with local financial regulations (Kenya VASP Act 2025)
- [ ] App does not facilitate illegal financial activity
- [ ] App provides customer support contact (support@cpay.co.ke)
- [ ] App clearly identifies the operating entity

---

## Operating Entity

- **Company**: CryptoPay Kenya Ltd (update with actual entity name)
- **Jurisdiction**: Kenya
- **Registered address**: [To be completed]
- **Support email**: support@cpay.co.ke
- **Website**: https://cpay.co.ke
- **Privacy policy**: https://cpay.co.ke/privacy
- **Terms of service**: https://cpay.co.ke/terms
