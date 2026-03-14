# KES Deposit Flow — Research & Implementation Guide

**Last updated:** 2026-03-14
**Status:** Implemented + Audited

---

## 1. Overview

CryptoPay supports KES (Kenyan Shilling) deposits via two M-Pesa channels:

1. **STK Push (Lipa Na M-Pesa Online)** — App-initiated payment prompt
2. **C2B Paybill** — Customer-initiated from M-Pesa menu

Both convert KES to crypto (USDT, USDC, BTC, ETH, SOL) at the current market rate.

### Why KES-Only

- M-Pesa is denominated in KES — all M-Pesa transactions are inherently KES
- The Central Bank of Kenya regulatory framework operates in KES
- Our target market (Kenya) transacts primarily in KES
- USD display is supported for UI convenience only (display currency setting)
- Future multi-currency expansion is architecturally supported via `source_currency`/`dest_currency` fields

---

## 2. M-Pesa C2B Integration

### 2.1 Flow Architecture

```
User (M-Pesa Menu)                    CryptoPay Backend
─────────────────                    ──────────────────
1. Lipa Na M-Pesa → Pay Bill
2. Enter Business No: [SHORTCODE]
3. Account No: USDT-0712345678
4. Amount: KES 5,000
5. Enter M-Pesa PIN
        │
        ▼
   Safaricom API
        │
        ├──→ POST /api/v1/mpesa/callback/c2b/validate/
        │    (Validate account ref, amount limits, user status)
        │    Response: {"ResultCode": 0} or {"ResultCode": "C2B00012"}
        │
        └──→ POST /api/v1/mpesa/callback/c2b/confirm/
             (Save callback, dispatch Celery task)
             Response: {"ResultCode": 0}
                    │
                    ▼
             process_c2b_deposit (Celery)
             1. Parse account reference → find user + currency
             2. Fetch live market rate (raw_rate, no spread)
             3. Calculate fee (DEPOSIT_FEE_PERCENTAGE)
             4. Atomic: Create Transaction + Credit Wallet
             5. Send notifications
```

### 2.2 ResponseType: "Completed" vs "Cancelled"

| Setting | Behavior When Validation URL is Unreachable |
|---------|----------------------------------------------|
| **Completed** (our default) | M-Pesa accepts the payment anyway |
| Cancelled | M-Pesa rejects the payment |

**Decision:** We use "Completed" because:
- We'd rather receive money and handle edge cases than reject legitimate payments
- The `process_c2b_deposit` task has its own validation layer (min/max, user lookup)
- Admin alerts are sent for any deposit issues requiring manual intervention

**Trade-off:** Deposits outside min/max limits will be processed (money already received). The task logs the violation and sends an admin alert for manual review.

### 2.3 Account Reference Formats

| Format | Example | Behavior |
|--------|---------|----------|
| `USDT-0712345678` | Currency-specific | Deposit as USDT |
| `USDC-0712345678` | Currency-specific | Deposit as USDC |
| `BTC-0712345678` | Currency-specific | Deposit as BTC |
| `ETH-0712345678` | Currency-specific | Deposit as ETH |
| `SOL-0712345678` | Currency-specific | Deposit as SOL |
| `CP-0712345678` | Company prefix | Default to USDT |
| `0712345678` | Plain phone | Default to USDT |
| *(empty)* | No reference | Use MSISDN, default USDT |

**Phone normalization:** Strips spaces, dashes. Converts `0XXX` → `+254XXX`, `254XXX` → `+254XXX`.

**Safaricom limit:** `AccountReference` max 12 characters. Our longest format is `USDT-254XXXXXXXXX` (17 chars) — users should use `USDT-07XXXXXXXX` (14 chars). Consider shortening to ticker codes only if this becomes an issue.

### 2.4 C2B URL Registration

Must be called before C2B payments can be received:
```python
client = MpesaClient()
client.register_c2b_urls()
```

**Important:**
- Sandbox uses `/mpesa/c2b/v1/registerurl`
- Production should use `/mpesa/c2b/v2/registerurl`
- URLs persist until re-registered — if you change URL structure, call again
- Do NOT include "mpesa", "safaricom" in callback URL paths (Safaricom filters them)

### 2.5 Idempotency

- `C2BConfirmationView` checks `MpesaCallback.objects.filter(mpesa_receipt=trans_id).exists()` before processing
- `process_c2b_deposit` uses `idempotency_key=f"c2b:{trans_id}"` with PostgreSQL unique constraint
- `WalletService.credit()` checks for existing `LedgerEntry` with matching transaction_id

---

## 3. M-Pesa STK Push Integration

### 3.1 Flow

```
Mobile App                    Backend                    Safaricom
──────────                    ───────                    ─────────
1. Choose currency + amount
2. POST /payments/buy-crypto/
        │
        ▼
   Verify PIN → Lock rate → Create Transaction → STK Push
                                                        │
                                                        ▼
                                              User sees prompt on phone
                                              Enters M-Pesa PIN (or cancels)
                                                        │
                                                        ▼
                              POST /mpesa/callback/stk/
                              (Update transaction, credit wallet)
```

### 3.2 STK Push Result Codes

| Code | Description | Action |
|------|-------------|--------|
| **0** | Success | Credit crypto, mark COMPLETED |
| **1** | Insufficient funds | Mark FAILED |
| **1001** | Transaction in progress | Wait 2-3 min, retry |
| **1025** | Unable to send prompt | Check TransactionDesc length (max 13 chars) |
| **1032** | Cancelled by user | Mark FAILED |
| **1037** | User unreachable | Mark FAILED, inform user |
| **2001** | Invalid initiator | Check credentials |

### 3.3 Timeout Handling

- STK prompts expire after ~60 seconds
- `poll_stk_status` Celery task fires after 90s if no callback received
- Polls up to 3 times at 30s intervals
- Uses STK Query API: `POST /mpesa/stkpushquery/v1/query`

### 3.4 Amount Constraints

- **Minimum:** KES 100 (our limit, API allows KES 1)
- **Maximum:** KES 250,000 per transaction (Safaricom limit)
- **Daily limit:** KES 500,000 per user (Safaricom limit)
- **Amounts must be whole numbers** (no decimals)

---

## 4. Fee Structure

### 4.1 STK Push (BUY) Fees

| Component | Rate | Description |
|-----------|------|-------------|
| Platform spread | 1.5% | Baked into exchange rate (`final_rate = raw_rate × 0.985`) |
| Flat fee | KES 10 | Per transaction |
| Excise duty | 10% of platform fees | VASP Act 2025, remitted to KRA |

**Total user cost:** ~1.5% spread + KES 10 flat + excise on fees

### 4.2 C2B (Paybill) Deposit Fees

| Component | Rate | Description |
|-----------|------|-------------|
| Deposit fee | 1.5% | Explicit percentage of KES amount |
| Exchange rate | Raw rate | No spread applied (fee is explicit instead) |

**Important:** C2B uses `raw_rate` (not `final_rate`) to avoid double-charging. The 1.5% is the total fee.

---

## 5. Security Measures

### 5.1 Callback Security (3-Layer Defense)

1. **IP Whitelist:** Safaricom IPs (`196.201.212-214.0/24`)
   - Private IPs (`192.168.x.x`, `127.0.0.1`) allowed in development only
   - Production must override `MPESA_ALLOWED_IPS` to exclude private ranges

2. **Per-Transaction HMAC Tokens:** Dynamic callback URLs with one-time tokens
   - Generated via `build_callback_url()` using HMAC-SHA256
   - Consumed on first use via Redis (replay prevention)
   - C2B callbacks use static paths (IP whitelist is sole defense)

3. **X-Forwarded-For:** Read from trusted proxy chain
   - **Warning:** Must configure reverse proxy to set this authoritatively
   - Without proper proxy config, this header can be spoofed

### 5.2 OTP Security

- Generated with `secrets.randbelow(900000) + 100000` (CSPRNG)
- Never included in API responses (server-side logging only)
- 5-minute TTL in Redis
- Brute-force protection: 5 failed verification attempts → OTP invalidated, 429 response
- Rate limited: 3 OTP requests per phone per 10 minutes

### 5.3 PIN Security in Payments

- All payment endpoints verify PIN with progressive lockout tracking
- Failed PIN attempts increment `user.pin_attempts` across all views (login + payments)
- Lockout thresholds: 5 attempts → 1min, 10 → 5min, 15 → 1hr
- OTP challenge after 3 consecutive failures

### 5.4 OAuth Token Management

- Cached per-instance with 50-minute refresh (conservative vs 60-min expiry)
- **Future improvement:** Use Redis for token storage to share across workers

---

## 6. Sandbox Testing Guide

### 6.1 Safaricom Sandbox Setup

1. Register at [developer.safaricom.co.ke](https://developer.safaricom.co.ke/)
2. Create app → get Consumer Key + Consumer Secret
3. Enable M-Pesa Express, C2B APIs

### 6.2 Default Sandbox Credentials

| Credential | Value |
|-----------|-------|
| Shortcode (Paybill) | `174379` |
| Passkey | `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919` |
| Base URL | `https://sandbox.safaricom.co.ke` |

### 6.3 Testing STK Push

```bash
# 1. Get OAuth token
curl -X GET "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials" \
  -H "Authorization: Basic $(echo -n 'CONSUMER_KEY:CONSUMER_SECRET' | base64)"

# 2. Initiate STK Push via our API
curl -X POST http://localhost:8000/api/v1/payments/buy-crypto/ \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "<quote>", "pin": "1234", "idempotency_key": "<uuid>"}'
```

### 6.4 Testing C2B

```bash
# 1. Register C2B URLs (do this once)
# Django management command or API call to register_c2b_urls()

# 2. Simulate C2B payment via Daraja
curl -X POST "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/simulate" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "ShortCode": "174379",
    "CommandID": "CustomerPayBillOnline",
    "Amount": "500",
    "Msisdn": "254708374149",
    "BillRefNumber": "USDT-0708374149"
  }'
```

### 6.5 Known Sandbox Limitations

| Issue | Impact | Workaround |
|-------|--------|------------|
| Callbacks delivered ~40% of the time | Can't fully test async flow | Test callback parsing with Postman manually |
| No real money movement | Can't verify M-Pesa balance | Trust the result codes |
| Shared passkey | Not representative of production | Use production passkey after go-live |
| HTTP accepted | Production requires HTTPS | Ensure SSL is configured before go-live |

### 6.6 Manual Callback Testing

Since sandbox callbacks are unreliable, test by POSTing directly:

```bash
# STK callback simulation
curl -X POST http://localhost:8000/api/v1/mpesa/callback/stk/ \
  -H "Content-Type: application/json" \
  -d '{
    "Body": {
      "stkCallback": {
        "MerchantRequestID": "test-123",
        "CheckoutRequestID": "<from_stk_push_response>",
        "ResultCode": 0,
        "ResultDesc": "The service request is processed successfully.",
        "CallbackMetadata": {
          "Item": [
            {"Name": "Amount", "Value": 500},
            {"Name": "MpesaReceiptNumber", "Value": "TEST12345"},
            {"Name": "PhoneNumber", "Value": 254712345678}
          ]
        }
      }
    }
  }'

# C2B confirmation simulation
curl -X POST http://localhost:8000/api/v1/mpesa/callback/c2b/confirm/ \
  -H "Content-Type: application/json" \
  -d '{
    "TransactionType": "Pay Bill",
    "TransID": "TEST67890",
    "TransTime": "20260314120000",
    "TransAmount": "1000",
    "BusinessShortCode": "174379",
    "BillRefNumber": "USDT-0712345678",
    "MSISDN": "254712345678",
    "FirstName": "Test",
    "LastName": "User"
  }'
```

---

## 7. Production Go-Live Checklist

### 7.1 Safaricom Requirements

- [ ] Apply for production credentials at [Daraja portal](https://developer.safaricom.co.ke/)
- [ ] Get production Shortcode (Paybill number)
- [ ] Get production Passkey (unique to your shortcode)
- [ ] Download production Safaricom certificate (for B2C/B2B SecurityCredential)
- [ ] Set up IP whitelisting with Safaricom (they need your server IPs)
- [ ] Register C2B URLs with production credentials
- [ ] HTTPS callback URLs with valid SSL certificate (TLS 1.2+)

### 7.2 Environment Configuration

```env
# Production .env
MPESA_ENVIRONMENT=production
MPESA_CONSUMER_KEY=<production_key>
MPESA_CONSUMER_SECRET=<production_secret>
MPESA_SHORTCODE=<your_paybill>
MPESA_PASSKEY=<your_passkey>
MPESA_INITIATOR_NAME=<your_initiator>
MPESA_INITIATOR_PASSWORD=<your_password>
MPESA_CERT_PATH=certs/production.cer
MPESA_CALLBACK_BASE_URL=https://api.cryptopay.co.ke
MPESA_ALLOWED_IPS=196.201.214.0/24,196.201.213.0/24,196.201.212.0/24
```

### 7.3 Security Checklist

- [ ] Remove private IP ranges from `MPESA_ALLOWED_IPS`
- [ ] Ensure `DEBUG=False`
- [ ] Verify reverse proxy sets `X-Forwarded-For` authoritatively
- [ ] Rotate all sandbox credentials
- [ ] Ensure `MPESA_ENVIRONMENT` is set to `production`
- [ ] Verify SSL certificate is valid and auto-renewing
- [ ] Set up monitoring alerts for callback failures
- [ ] Enable Prometheus/Grafana monitoring stack

### 7.4 Testing After Go-Live

- [ ] Make a small KES 100 deposit via STK Push
- [ ] Verify crypto is credited correctly
- [ ] Make a small C2B Paybill deposit
- [ ] Verify C2B callback is received and processed
- [ ] Verify admin alerts work for edge cases
- [ ] Test with invalid account reference (should get validation rejection)
- [ ] Verify daily limit enforcement
- [ ] Verify circuit breaker triggers at threshold

---

## 8. Known Issues & Mitigation

| Issue | Severity | Status | Mitigation |
|-------|----------|--------|------------|
| Sandbox callbacks unreliable (~40%) | Low | By design | Manual testing + `poll_stk_status` fallback |
| C2B AccountReference max 12 chars | Low | Monitoring | Users use `USDT-07XXXXXXXX` (14 chars, works in practice) |
| OAuth token cached per-instance | Medium | Accepted | Works for single-instance. Redis caching for multi-worker. |
| TOTP secret stored plaintext in DB | Medium | Tracked | Encrypt with `django-encrypted-model-fields` |
| No automated C2B reversal | Medium | Tracked | Manual intervention for orphaned deposits |

---

## 9. API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/payments/buy-crypto/` | JWT | STK Push buy crypto |
| POST | `/payments/deposit/quote/` | JWT | Get deposit quote with locked rate |
| GET | `/payments/deposit/<id>/status/` | JWT | Poll deposit status |
| GET | `/payments/deposit/c2b-instructions/` | JWT | Get C2B Paybill instructions |
| POST | `/mpesa/callback/stk/` | IP whitelist | STK Push callback (Safaricom) |
| POST | `/mpesa/callback/c2b/validate/` | IP whitelist | C2B validation (Safaricom) |
| POST | `/mpesa/callback/c2b/confirm/` | IP whitelist | C2B confirmation (Safaricom) |

---

## 10. Configuration Reference

```python
# backend/config/settings/base.py
DEPOSIT_FEE_PERCENTAGE = 1.5      # C2B deposit fee (%)
DEPOSIT_MIN_KES = 100             # Minimum deposit
DEPOSIT_MAX_KES = 300_000         # Maximum deposit
DEPOSIT_QUOTE_TTL_SECONDS = 30    # Quote lock duration
DEPOSIT_SLIPPAGE_TOLERANCE = 2.0  # Max rate deviation (%)
MPESA_C2B_RESPONSE_TYPE = "Completed"  # Accept even if validation URL unreachable
MPESA_C2B_ACCOUNT_PREFIX = "CP"   # Default account prefix
```
