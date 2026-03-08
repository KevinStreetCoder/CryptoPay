# Authentication & Security Research — 2026-03-08

## 1. Google OAuth for React Native / Expo

### Recommended: `@react-native-google-signin/google-signin`
- **Expo officially recommends this** — they deprecated `expo-google-sign-in`
- Ships as Expo config plugin — add to `app.json` plugins, run `npx expo prebuild`
- Supports **One-Tap Sign In** (Android) and native Google Sign-In (iOS)
- Returns `idToken` — send to backend for verification via Google's tokeninfo endpoint
- **Requires EAS Build** — does NOT work in Expo Go
- Needs `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) from Google Cloud Console

### Alternative: `expo-auth-session`
- Standard OAuth 2.0 + PKCE flow — opens browser for Google login
- Works in Expo Go, custom dev clients, AND web
- Returns authorization code — exchange server-side for tokens
- UX is slightly worse (browser redirect vs native one-tap)

### Verdict
Use `@react-native-google-signin/google-signin` for production. Better UX, native integration, Expo-recommended. We need EAS Build anyway for a fintech app.

### Backend Integration
```python
# Django: Verify Google idToken
from google.oauth2 import id_token
from google.auth.transport import requests

def verify_google_token(token):
    idinfo = id_token.verify_oauth2_token(token, requests.Request(), GOOGLE_CLIENT_ID)
    return idinfo  # Contains: sub, email, name, picture
```

---

## 2. Crypto Wallet Authentication

### Privy (Best for Expo — RECOMMENDED)
- **Dedicated Expo SDK**: `@privy-io/expo`
- Supports **embedded wallets** (Privy creates/manages keys) AND **external wallets** (MetaMask via WalletConnect)
- **SIWE (Sign-In With Ethereum)** support via `useLoginWithSiwe` hook
- Also supports email, phone, social login — users can link multiple auth methods
- Embedded wallets use WebCrypto (requires HTTPS)
- Message signing: `provider.request({ method: 'personal_sign', params: [message, address] })`
- Production-ready with good Expo docs

### Web3Auth (Now MetaMask Embedded Wallets)
- React Native SDK: `@web3auth/react-native-sdk`
- NOT compatible with Expo Go — requires EAS Build
- Uses **MPC (Multi-Party Computation)** for key management — non-custodial
- Supports social logins that generate crypto wallets
- Can integrate with Auth0, Firebase, or custom JWT

### WalletConnect v2
- Connects to external wallets (MetaMask, Trust Wallet, Rainbow)
- `@walletconnect/react-native-dapp` — community-maintained for Expo
- V1 fully deprecated — only V2 URIs work
- EIP-4361 (SIWE) standard: domain + nonce + expiry, signed by user's address

### Verdict
**Privy** is the best choice:
1. Best Expo support with dedicated SDK
2. Embedded wallets — users don't need MetaMask
3. Supports email/phone auth (important for Kenya's crypto-newcomers)
4. SIWE for wallet-based authentication
5. Can link M-Pesa phone number alongside wallet auth

---

## 3. M-Pesa STK Push — Complete Flow

### Step 1: OAuth Token
```
GET https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials
Authorization: Basic Base64(ConsumerKey:ConsumerSecret)
→ Returns access_token (1 hour validity)
```

### Step 2: Generate Password
```
Password = Base64(BusinessShortCode + Passkey + Timestamp)
Timestamp format: YYYYMMDDHHMMSS
```

### Step 3: Initiate STK Push
```
POST /mpesa/stkpush/v1/processrequest
{
  "BusinessShortCode": "174379",
  "Password": "<generated>",
  "Timestamp": "20260308143000",
  "TransactionType": "CustomerPayBillOnline",  // or "CustomerBuyGoodsOnline"
  "Amount": 100,
  "PartyA": "254712345678",  // customer phone
  "PartyB": "174379",         // your shortcode
  "PhoneNumber": "254712345678",
  "CallBackURL": "https://api.cryptopay.co.ke/api/v1/mpesa/callback/stk/",
  "AccountReference": "MCrypto",  // max 12 chars
  "TransactionDesc": "Deposit"    // max 13 chars
}
```

### Step 4: Callback Structure

**Success:**
```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "29115-34620561-1",
      "CheckoutRequestID": "ws_CO_011120241020363925",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          { "Name": "Amount", "Value": 1.00 },
          { "Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV" },
          { "Name": "TransactionDate", "Value": 20241101102115 },
          { "Name": "PhoneNumber", "Value": 254708920430 }
        ]
      }
    }
  }
}
```

**Failed (no CallbackMetadata):**
```json
{
  "Body": {
    "stkCallback": {
      "ResultCode": 1032,
      "ResultDesc": "Request canceled by user."
    }
  }
}
```

### Key Result Codes
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Insufficient funds |
| 1032 | User cancelled |
| 1037 | DS timeout (user unreachable) |
| 2001 | Wrong PIN entered |
| 1025 | Transaction limit exceeded |
| 17 | System internal error |

---

## 4. M-Pesa B2B (BusinessPayBill) — Complete Flow

### SecurityCredential Generation
```python
import base64
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding

def generate_security_credential(password: str, cert_path: str) -> str:
    with open(cert_path, 'rb') as f:
        cert = x509.load_pem_x509_certificate(f.read())
    public_key = cert.public_key()
    encrypted = public_key.encrypt(
        password.encode(),
        padding.PKCS1v15()
    )
    return base64.b64encode(encrypted).decode()
```

### B2B Request
```
POST /mpesa/b2b/v1/paymentrequest
{
  "Initiator": "testapi",
  "SecurityCredential": "<RSA encrypted password>",
  "CommandID": "BusinessPayBill",       // or "BusinessBuyGoods"
  "SenderIdentifierType": "4",          // shortcode
  "RecieverIdentifierType": "4",        // shortcode
  "Amount": 2500,
  "PartyA": "600000",                   // our shortcode
  "PartyB": "888880",                   // target Paybill
  "AccountReference": "12345678",       // account at target
  "Remarks": "CryptoPay payment",
  "QueueTimeOutURL": "https://api.cryptopay.co.ke/api/v1/mpesa/timeout/b2b/",
  "ResultURL": "https://api.cryptopay.co.ke/api/v1/mpesa/callback/b2b/"
}
```

### Limits
- Single B2B: Max KES 250,000
- Daily B2B: Max KES 500,000 (can request increase)
- Minimum: KES 1
- B2C fees: KES 5-55+

### Go-Live Requirements
- Certificate of Incorporation, CR12
- KRA PIN Certificate
- Bank account confirmation letter
- BOF (Business Owner Form)
- Directors' IDs
- Sandbox testing completion
- Production URL + server IP whitelisting
- 24-72 hour approval (can take 7-10 days)

---

## 5. Security Best Practices for Fintech

### Rate Limiting Strategy
- Auth endpoints: 5/min per IP
- Transaction endpoints: 10/min per user
- Read endpoints: 100/min per user
- Use Redis-backed rate limiters
- Return 429 with `Retry-After` header
- Exponential backoff on failed auth (1s, 2s, 4s, 8s...)

### JWT Rotation
- Access tokens: 15 minutes max
- Refresh tokens: stored in `expo-secure-store` (encrypted, biometric-protected)
- **Refresh token rotation**: each use issues new token, invalidates old
- **Family tracking**: if reused old token detected → invalidate entire family (token theft detection)
- Token blacklisting via Redis for immediate revocation

### Device Fingerprinting
- Collect: device model, OS version, screen resolution, timezone, language
- Use `expo-device` and `expo-application`
- Generate device ID on first launch → store in `expo-secure-store`
- Maintain trusted devices list per user
- New device → trigger step-up auth (OTP/biometric)

### Transaction Signing
- Server issues unique nonce per transaction
- Client signs: `HMAC-SHA256(transaction_data + nonce + timestamp, user_secret)`
- Server verifies before processing
- Include amount, recipient, timestamp in signed payload

### Fraud Detection Patterns
- Velocity checks: rapid successive transactions, unusual amounts
- Geolocation anomalies: instant country change
- Behavioral biometrics: typing speed, touch pressure
- ML scoring: XGBoost on transaction history
- Step-up auth when risk score exceeds threshold

### Additional Security Measures
- Certificate pinning: prevent MITM
- Root/jailbreak detection: refuse to run on compromised devices
- Hermes engine: compiles to bytecode (code obfuscation)
- Never store secrets in AsyncStorage — use `expo-secure-store` with `requireAuthentication: true`
- All endpoints over TLS 1.3
- Key rotation: quarterly minimum

---

## 6. Expo Production Build

### EAS Build Profiles (`eas.json`)
```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": { "ENVIRONMENT": "development" }
    },
    "preview": {
      "distribution": "internal",
      "env": { "ENVIRONMENT": "staging" }
    },
    "production": {
      "env": { "ENVIRONMENT": "production" }
    }
  }
}
```

### App Signing
- Android: EAS auto-generates/manages keystore (encrypted on Expo servers)
- iOS: EAS manages provisioning profiles and certs via Apple Developer account
- `eas credentials` to manage signing

### OTA Updates (EAS Update)
- Push JS changes without app store review
- Rollout percentages: start at 5-10%, monitor, increase
- Instant rollback if issues detected
- Channel-based: production builds → production updates
- Fingerprint-based: prevents crashes from native code mismatches

### Error Tracking (Sentry)
- `@sentry/react-native` + Expo integration
- Source maps auto-uploaded during EAS Build
- Session Replays for debugging user flows
- Crash-free rate monitoring

### Analytics
- Expo Insights: built-in (update adoption, crash-free rates)
- Custom: Amplitude, Mixpanel, or PostHog React Native SDKs
