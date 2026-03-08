# M-Pesa Daraja API - Comprehensive Technical Research

**Date**: 2026-03-07
**Purpose**: Technical reference for building a crypto-to-M-Pesa payment platform

---

## 1. Platform Overview

**Daraja** is Safaricom's API platform that provides programmatic access to M-Pesa services. As of November 2025, **Daraja 3.0** has been launched with cloud-native architecture supporting up to **12,000 TPS** (transactions per second).

- **Developer Portal**: https://developer.safaricom.co.ke/
- **Ecosystem**: 66,000+ integrations, 105,000+ developers
- **25% of all M-Pesa transactions** now flow through Daraja APIs

### Base URLs

| Environment | Base URL |
|-------------|----------|
| **Sandbox** | `https://sandbox.safaricom.co.ke` |
| **Production** | `https://api.safaricom.co.ke` |

---

## 2. Authentication (OAuth 2.0)

**Endpoint**: `GET /oauth/v1/generate?grant_type=client_credentials`

**Authorization Header**: `Basic {base64(consumer_key:consumer_secret)}`

**Response**:
```json
{
  "access_token": "SGWcJPtNtYNPGm6uSYR9yPYrAI3Bm",
  "expires_in": "3600"
}
```

- Token is valid for **3600 seconds (1 hour)**
- Consumer Key + Consumer Secret are generated per app on the developer portal
- All subsequent API calls require: `Authorization: Bearer {access_token}`

---

## 3. API Endpoints - Complete Reference

### 3.1 M-Pesa Express / STK Push (Lipa Na M-Pesa Online)

**Purpose**: Business-initiated C2B payment. Sends a payment prompt (STK Push) to the customer's phone.

**Endpoint**: `POST /mpesa/stkpush/v1/processrequest`

**Request Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `BusinessShortCode` | Numeric | Organization shortcode (Paybill/Till) |
| `Password` | String | Base64 of `{Shortcode}{Passkey}{Timestamp}` |
| `Timestamp` | String | Format: `YYYYMMDDHHmmss` |
| `TransactionType` | String | `CustomerPayBillOnline` or `CustomerBuyGoodsOnline` |
| `Amount` | Numeric | Transaction amount |
| `PartyA` | Numeric | Customer phone number (254XXXXXXXXX) |
| `PartyB` | Numeric | Organization shortcode |
| `PhoneNumber` | Numeric | Phone to receive STK push (same as PartyA) |
| `CallBackURL` | URL | HTTPS URL for transaction result callback |
| `AccountReference` | String | Account reference (max 12 chars) |
| `TransactionDesc` | String | Transaction description (max 13 chars) |

**Password Generation**: `base64(BusinessShortCode + Passkey + Timestamp)`

**STK Push Query** (check status):
`POST /mpesa/stkpushquery/v1/query`

Parameters: `BusinessShortCode`, `Password`, `Timestamp`, `CheckoutRequestID`

---

### 3.2 C2B (Customer to Business)

**Purpose**: Register URLs to receive payment notifications when customers pay via Paybill/Till.

#### Register URL
**Endpoint**: `POST /mpesa/c2b/v1/registerurl`

| Parameter | Type | Description |
|-----------|------|-------------|
| `ShortCode` | Numeric | Organization shortcode |
| `ResponseType` | String | `Completed` or `Cancelled` |
| `ConfirmationURL` | URL | URL for confirmed transactions |
| `ValidationURL` | URL | URL for validation (approve/reject) |

**Flow**:
1. Customer pays to Paybill/Till from their phone
2. M-Pesa hits your **ValidationURL** - you can accept or reject
3. If accepted, M-Pesa hits your **ConfirmationURL** with transaction details

#### Simulate C2B (Sandbox only)
**Endpoint**: `POST /mpesa/c2b/v1/simulate`

| Parameter | Type | Description |
|-----------|------|-------------|
| `ShortCode` | Numeric | Organization shortcode |
| `CommandID` | String | `CustomerPayBillOnline` or `CustomerBuyGoodsOnline` |
| `Amount` | Numeric | Amount |
| `Msisdn` | Numeric | Phone number (use test number) |
| `BillRefNumber` | String | Account number (for Paybill) |

---

### 3.3 B2C (Business to Customer)

**Purpose**: Send money from business to M-Pesa users (disbursements, salaries, refunds).

**Endpoint**: `POST /mpesa/b2c/v1/paymentrequest`

| Parameter | Type | Description |
|-----------|------|-------------|
| `InitiatorName` | String | API operator username (from M-Pesa Org Portal) |
| `SecurityCredential` | String | Encrypted password (see Security section) |
| `CommandID` | String | `SalaryPayment`, `BusinessPayment`, or `PromotionPayment` |
| `Amount` | Numeric | Amount to send |
| `PartyA` | Numeric | Organization shortcode (6 digits) |
| `PartyB` | Numeric | Customer phone (254XXXXXXXXX, 12 digits) |
| `Remarks` | String | Comments |
| `QueueTimeOutURL` | URL | Timeout notification URL |
| `ResultURL` | URL | Transaction result URL |
| `Occassion` | String | Optional description |

**CommandID Values**:
- `SalaryPayment` - Salary disbursement
- `BusinessPayment` - General business payment (most common for crypto payouts)
- `PromotionPayment` - Promotional payments

---

### 3.4 B2B (Business to Business)

**Purpose**: Transfer between business shortcodes (Paybill to Paybill/Till).

**Endpoint**: `POST /mpesa/b2b/v1/paymentrequest`

| Parameter | Type | Description |
|-----------|------|-------------|
| `InitiatorName` | String | API operator username |
| `SecurityCredential` | String | Encrypted password |
| `CommandID` | String | See values below |
| `SenderIdentifierType` | Numeric | Sender type (4 = Paybill) |
| `ReceiverIdentifierType` | Numeric | Receiver type (4 = Paybill) |
| `Amount` | Numeric | Amount |
| `PartyA` | Numeric | Sender shortcode |
| `PartyB` | Numeric | Receiver shortcode |
| `AccountReference` | String | Mandatory for BusinessPayBill |
| `Remarks` | String | Comments |
| `QueueTimeOutURL` | URL | Timeout URL |
| `ResultURL` | URL | Result URL |

**CommandID Values**:
- `BusinessPayBill`
- `MerchantToMerchantTransfer`
- `MerchantTransferFromMerchantToWorking`
- `MerchantServicesMMFAccountTransfer`
- `AgencyFloatAdvance`

---

### 3.5 Transaction Status API

**Purpose**: Query status of any M-Pesa transaction.

**Endpoint**: `POST /mpesa/transactionstatus/v1/query`

| Parameter | Type | Description |
|-----------|------|-------------|
| `Initiator` | String | API operator name |
| `SecurityCredential` | String | Encrypted password |
| `CommandID` | String | `TransactionStatusQuery` |
| `TransactionID` | String | M-Pesa transaction ID to query |
| `PartyA` | Numeric | Organization shortcode |
| `IdentifierType` | Numeric | 1=MSISDN, 2=Till, 4=Paybill |
| `ResultURL` | URL | Result callback URL |
| `QueueTimeOutURL` | URL | Timeout callback URL |
| `Remarks` | String | Comments |
| `Occassion` | String | Optional |

---

### 3.6 Account Balance API

**Purpose**: Query M-Pesa account balance of a shortcode.

**Endpoint**: `POST /mpesa/accountbalance/v1/query`

| Parameter | Type | Description |
|-----------|------|-------------|
| `Initiator` | String | API operator name |
| `SecurityCredential` | String | Encrypted password |
| `CommandID` | String | `AccountBalance` |
| `PartyA` | Numeric | Organization shortcode |
| `IdentifierType` | Numeric | 4 (for organization) |
| `Remarks` | String | Comments |
| `QueueTimeOutURL` | URL | Timeout URL |
| `ResultURL` | URL | Result URL |

---

### 3.7 Reversal API

**Purpose**: Reverse a completed B2B, B2C, or C2B transaction.

**Endpoint**: `POST /mpesa/reversal/v1/request`

| Parameter | Type | Description |
|-----------|------|-------------|
| `Initiator` | String | API operator name |
| `SecurityCredential` | String | Encrypted password |
| `CommandID` | String | `TransactionReversal` |
| `TransactionID` | String | Transaction to reverse |
| `Amount` | Numeric | Amount to reverse |
| `ReceiverParty` | Numeric | Organization shortcode |
| `ReceiverIdentifierType` | Numeric | 11 |
| `ResultURL` | URL | Result URL |
| `QueueTimeOutURL` | URL | Timeout URL |
| `Remarks` | String | Reason for reversal |
| `Occassion` | String | Optional |

---

### 3.8 Dynamic QR Code API

**Purpose**: Generate QR codes scannable by M-Pesa/My Safaricom App.

**Endpoint**: `POST /mpesa/qrcode/v1/generate`

| Parameter | Type | Description |
|-----------|------|-------------|
| `MerchantName` | String | Business name |
| `RefNo` | String | Invoice/transaction reference |
| `Amount` | Numeric | Transaction amount |
| `TrxCode` | String | Transaction type code (see below) |
| `CPI` | String | Credit Party Identifier (Till/Phone/Paybill) |
| `Size` | String | QR code size in pixels (e.g., "300") |

**TrxCode Values**:
- `BG` - Buy Goods (Till)
- `WA` - Withdraw Cash (Agent)
- `PB` - Pay Bill
- `SM` - Send Money (Phone)
- `SB` - Send to Business

**Response**: Returns `QRCode` as base64-encoded image string.

---

## 4. Security & Encryption

### 4.1 SecurityCredential Generation (for B2C, B2B, Balance, Status, Reversal)

The SecurityCredential is the **initiator password encrypted with Safaricom's public key certificate**.

**Process**:
1. Download the public key certificate from Daraja portal (separate certs for sandbox vs production)
2. Encrypt the initiator password using the certificate with **OpenSSL RSA PKCS#1 v1.5**
3. Base64-encode the resulting ciphertext
4. Use this as the `SecurityCredential` parameter

**OpenSSL command**:
```bash
echo -n "InitiatorPassword" | openssl rsautl -encrypt -pubin -inkey cert.pem | base64
```

**Important**: Use the correct certificate - sandbox cert for testing, production cert (from Daraja portal, NOT G2 portal) for live.

### 4.2 Callback URL Requirements

- Must be **HTTPS** (SSL required)
- Must be **publicly accessible** (no localhost)
- Must **NOT** contain words "MPesa", "M-Pesa", "Safaricom" in the URL
- Safaricom sends results via POST with JSON body
- IP whitelisting recommended for production

### 4.3 Daraja 3.0 Security Enhancements

- Zero Trust Architecture
- HTTPS/TLS for all data in transit
- OAuth2 token-based authentication
- IP whitelisting for callbacks from Safaricom's known IP ranges
- Secret management (environment variables, not hardcoded)

---

## 5. Sandbox vs Production

### Sandbox

- **URL**: `https://sandbox.safaricom.co.ke`
- **Test Credentials**: Available at https://developer.safaricom.co.ke/test_credentials
- Provides test shortcodes, passkeys, and phone numbers
- SimulateC2B endpoint available (sandbox only)
- No real money transacted
- Free to use for development

### Going Live - Requirements

**Business Documents**:
1. **Company Registration Certificate** (Certificate of Incorporation)
2. **CR12** (Company Registry form showing directors) - must be current
3. **KRA PIN Certificate** (Kenya Revenue Authority)
4. **Bank Letter / Cancelled Cheque** (confirming company bank account)
5. **BOF** (Beneficial Ownership Form)
6. **Directors' IDs** (front and back scans)
7. **Signed & Stamped Administrator Form** (signed by 2+ directors)

**Technical Requirements**:
1. Working sandbox integration
2. Registered & verified Paybill or Till Number
3. Active Daraja developer account
4. Publicly accessible HTTPS callback URLs
5. Server IP to be whitelisted

**Go-Live Process**:
1. Complete sandbox testing
2. Submit go-live request on Daraja portal
3. Upload required business documents
4. Safaricom reviews (typically **24-72 hours**, can take up to 7-10 days)
5. Receive production credentials via email/dashboard
6. Replace sandbox URLs and credentials with production ones
7. Server IP gets whitelisted

**Tips**:
- Keep CR12 and BOF updated (outdated = rejection)
- Bank documents must match registration name exactly
- Follow up if no feedback in 7-10 days
- Activate credentials promptly (they can expire if unused)

---

## 6. Transaction Limits & Fees

### Transaction Limits

| Metric | Limit |
|--------|-------|
| **Max single transaction** | KES 250,000 (~USD 1,900) |
| **Min transaction (Send Money)** | KES 1 |
| **Daily transaction limit** | KES 500,000 |
| **Daily balance cap** | KES 500,000 |
| **Min withdrawal** | KES 50 |

### Customer Fees (Send Money)

| Amount Range (KES) | Fee (KES) |
|---------------------|-----------|
| 1 - 100 | **FREE** |
| 101 - 500 | 7 |
| 501 - 1,000 | 13 |
| 1,001 - 1,500 | 23 |
| 1,501 - 2,500 | 33 |
| 2,501 - 3,500 | 53 |
| 3,501 - 5,000 | 57 |
| 5,001 - 7,500 | 78 |
| 7,501 - 10,000 | 90 |
| 10,001 - 15,000 | 97 |
| 15,001 - 20,000 | 102 |
| 20,001 - 250,000 | 108 |

**Note**: 20% excise duty applies on top of fees (on the fee amount, not the principal).

### Paybill Tariff Models (Business Receives)

Safaricom offers 3 tariff models when registering a Paybill:

1. **Mgao Tariff**: Fee split equally between customer and business
2. **Business Bouquet**: Customer pays entire fee, business pays nothing (most common for utilities, banks)
3. **Customer Bouquet**: Business absorbs entire fee, customer pays nothing

### Buy Goods (Till) Merchant Fees

- Customer: **FREE** (always)
- Merchant: **0.5%** of amount (capped at KES 200)
- For amounts below KES 200: **0.25%**

### B2C Fees

B2C fees are charged to the business and vary by amount. Typically:
- Small amounts (< KES 100): KES 5-11
- Medium amounts: KES 15-30
- Large amounts (> KES 50,000): KES 55+

---

## 7. M-Pesa Global / International Transfers

### Countries Where M-Pesa Operates
Kenya, Tanzania, DRC, Egypt, Ethiopia, Ghana, Lesotho, Mozambique

### International Money Transfer (IMT)
- Available to all active M-Pesa registered users in East Africa
- Send to: Rwanda, Tanzania, Uganda, Botswana, Burundi

### Global Remittance Partners
- **Western Union**: Send to millions of bank accounts and 500,000+ locations globally
- **MoneyGram**: Receive from 200+ countries
- **WorldRemit**: Europe, USA, Australia, Middle East
- **TerraPay/Mobex**: Outbound cross-border remittances (Bangladesh, Pakistan)
- **Alipay**: Transfer to beneficiaries in China

### M-Pesa Visa Virtual Card
- M-Pesa launched a virtual Visa card for global online payments
- Enables M-Pesa users to pay at any Visa-accepting merchant worldwide

### API Access for Cross-Border
Cross-border remittance is primarily available through **partner integrations** rather than directly through the standard Daraja API. For programmatic cross-border transfers, you would need to work with:
- Safaricom's M-Pesa Global team directly
- Partner APIs (Western Union, TerraPay, etc.)

---

## 8. Compliance Requirements for Crypto-to-M-Pesa Platform

### Kenya VASP Act 2025 (Effective November 4, 2025)

**CRITICAL**: Kenya has enacted the **Virtual Asset Service Providers Act, 2025**, which is now law.

**Regulators**:
- **Central Bank of Kenya (CBK)**: Licenses stablecoins, payments, custody, wallets
- **Capital Markets Authority (CMA)**: Supervises exchanges, brokers, market operators, investment tokens

**Mandatory Licensing Required For**:
- Cryptocurrency exchanges
- Custodial wallet services
- Crypto brokerages
- Payment gateways handling virtual assets
- Stablecoin issuance

**Licensing Requirements**:
1. Company registered under Kenya's Companies Act
2. Physical office in Kenya
3. At least 2 independent directors
4. Personnel with relevant skills/knowledge/experience
5. Minimum paid-up share capital (varies by service class - higher for exchanges)
6. Liquidity buffers commensurate with risk profile
7. Insurance guarantees or trust accounts to protect client funds
8. Digital KYC implementation
9. Transaction monitoring systems
10. AML/CFT/CPF compliance
11. Data protection compliance
12. Cybersecurity measures
13. Client complaints handling mechanism
14. Periodic risk assessments

**Transition Period**: Existing operators must comply by **November 4, 2026**.

**Tax**: 10% excise duty on service fees charged by VASPs (replaced the earlier Digital Asset Tax).

### M-Pesa Integration Compliance

For a crypto-to-M-Pesa platform specifically:
1. **VASP License** from CMA/CBK is mandatory
2. **KYC/AML** on all users (both crypto and M-Pesa sides)
3. **Safaricom's Terms**: Safaricom may have additional restrictions on crypto-related businesses using their API - this needs direct confirmation with their business team
4. **Data Protection**: Comply with Kenya's Data Protection Act, 2019
5. **Consumer Protection**: Clear disclosure of fees, exchange rates, risks

### Recommended Business Structure

For a crypto-to-M-Pesa platform:
- Register a Kenya company (LLC/Ltd)
- Obtain VASP license from CMA
- Apply for M-Pesa Paybill (for receiving crypto sale proceeds in KES)
- Set up B2C integration (for sending KES to users' M-Pesa)
- Use STK Push for collecting KES from users buying crypto
- Implement full KYC/AML pipeline

---

## 9. Architecture Recommendations for Crypto-to-M-Pesa Platform

### Payment Flow: User Sells Crypto, Receives M-Pesa

```
User sends crypto -> Platform wallet -> Confirms on-chain ->
Calculate KES amount -> B2C API (BusinessPayment) -> User receives M-Pesa
```

### Payment Flow: User Buys Crypto with M-Pesa

```
User initiates buy -> STK Push to user's phone -> User enters PIN ->
Callback confirms payment -> Platform sends crypto to user's wallet
```

### Key APIs You'll Need

| Use Case | API |
|----------|-----|
| User buys crypto (collect KES) | **STK Push** (M-Pesa Express) |
| User sells crypto (send KES) | **B2C** (BusinessPayment) |
| Check payment status | **Transaction Status API** |
| Check business float balance | **Account Balance API** |
| Handle failed/disputed payments | **Reversal API** |
| QR code payments at events/POS | **Dynamic QR API** |
| Receive manual Paybill payments | **C2B** (Register URL) |

### Callback Architecture

All M-Pesa APIs are **asynchronous**. The initial API call returns an acknowledgment, and the actual result comes via callback to your ResultURL/CallBackURL.

```
Your Server -> POST to Daraja -> Immediate ACK response
                                    |
                                    v (async, seconds to minutes)
Daraja -> POST callback to your ResultURL/CallBackURL
```

You MUST implement:
- Idempotent callback handlers (M-Pesa may retry)
- Timeout handling (QueueTimeOutURL)
- Transaction status polling as fallback (if callback fails)

---

## 10. Daraja 3.0 New Features (Nov 2025)

- **12,000 TPS capacity** (up from ~3,000)
- **Mini Apps**: Build services within M-Pesa Super App
- **IoT APIs**: Connected device payments
- **Security APIs**: Enhanced fraud detection and identity verification
- **AI-powered developer support**: Real-time troubleshooting chatbot
- **Improved sandbox**: Complex transaction flow simulation
- **Daraja Marketplace**: Connect developers with businesses
- **Simplified documentation and onboarding**

---

## 11. Quick Reference - All Endpoints

| API | Endpoint Path | Method |
|-----|---------------|--------|
| OAuth Token | `/oauth/v1/generate?grant_type=client_credentials` | GET |
| STK Push | `/mpesa/stkpush/v1/processrequest` | POST |
| STK Query | `/mpesa/stkpushquery/v1/query` | POST |
| C2B Register | `/mpesa/c2b/v1/registerurl` | POST |
| C2B Simulate | `/mpesa/c2b/v1/simulate` | POST |
| B2C | `/mpesa/b2c/v1/paymentrequest` | POST |
| B2B | `/mpesa/b2b/v1/paymentrequest` | POST |
| Transaction Status | `/mpesa/transactionstatus/v1/query` | POST |
| Account Balance | `/mpesa/accountbalance/v1/query` | POST |
| Reversal | `/mpesa/reversal/v1/request` | POST |
| Dynamic QR | `/mpesa/qrcode/v1/generate` | POST |

**Note**: Some production endpoints may use `/v2/` instead of `/v1/` - verify with Safaricom's go-live email.

---

## 12. Rate Limits

Safaricom does not publicly document specific rate limits per developer account. However:
- Daraja 3.0 supports **12,000 TPS** platform-wide
- Individual accounts likely have lower limits based on tier/agreement
- Implement exponential backoff for HTTP 429 responses
- Contact Safaricom developer support for specific account limits

---

## Sources

- Safaricom Daraja Developer Portal: https://developer.safaricom.co.ke/
- Daraja Documentation: https://developer.safaricom.co.ke/Documentation
- Daraja 3.0 Launch: https://www.safaricom.co.ke/media-center-landing/press-releases/safaricom-launches-daraja-3-0-to-enhance-security-speed-and-developer-innovation
- VASP Act 2025: https://www.afriwise.com/blog/kenya-now-has-a-crypto-law-virtual-asset-service-providers-vasp-bill-2025
- M-Pesa Charges 2026: https://mpesa.co.ke/mpesa-charges
- M-Pesa Global: https://www.safaricom.co.ke/main-mpesa/m-pesa-services/m-pesa-global
- Go-Live Guide: https://payherokenya.com/2025/05/21/how_to_go_live_on_mpesa_daraja_api/
- STK Push Guide: https://dev.to/msnmongare/m-pesa-express-stk-push-api-guide-40a2
- QR Code API: https://dev.to/msnmongare/safaricom-daraja-api-dynamic-qr-code-api-generation-guide-34io
- Kenya VASP Licensing: https://masibolaw.co.ke/2025/04/22/how-to-get-a-virtual-asset-service-provider-vasp-license-in-kenya/
