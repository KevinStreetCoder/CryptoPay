# CryptoPay - Content Rating Questionnaire Preparation

This document prepares answers for the Google Play Console content rating questionnaire.
Complete this in Play Console > App content > Content rating > Start questionnaire.

---

## IARC Rating Questionnaire Answers

### Category Selection
- **Primary category**: Finance / Utilities
- **App type**: Functional app (not a game)

### Violence
- **Does the app contain violence?** No
- **Graphic violence?** No
- **Cartoon/fantasy violence?** No

### Sexual Content
- **Does the app contain sexual content?** No
- **Nudity?** No
- **Sexual themes?** No

### Language
- **Does the app contain profanity?** No
- **Crude humor?** No
- **Discrimination?** No

### Controlled Substances
- **Does the app reference drugs?** No
- **Alcohol?** No
- **Tobacco?** No

### Gambling
- **Does the app simulate gambling?** No
- **Real-money gambling?** No
- **Note**: Cryptocurrency trading is NOT classified as gambling, but involves financial risk. The app is a currency exchange, not a speculative trading platform.

### User-Generated Content
- **Does the app contain user-generated content?** No
- **Social features?** No (no chat, forums, or user profiles visible to others)
- **User-to-user interaction?** No (peer-to-peer transactions use wallet addresses only)

### Real Money / Financial Transactions
- **Does the app handle real money?** Yes
- **Digital purchases?** Yes (cryptocurrency purchases)
- **In-app purchases?** No (no IAP via Google Play Billing)
- **Note**: Transactions are financial services, not digital goods. App uses its own payment rails (M-Pesa), not Google Play Billing.

### Personal Information
- **Does the app collect personal information?** Yes
- **What information?** Phone number, name, email, device ID, IP address
- **From children?** No (app is 18+ only)

### Location
- **Does the app use device location?** No

### Camera/Microphone
- **Does the app use the camera?** Yes (KYC identity verification only)
- **Does the app use the microphone?** No

---

## Expected Rating Result

- **IARC**: 18+ (financial transactions with real money)
- **ESRB**: Mature (simulated gambling note may apply due to crypto volatility disclaimers)
- **PEGI**: 18 (real money transactions)
- **USK**: 18 (financial services)
- **ClassInd**: 18 (financial content)

---

## Target Audience

- **Primary age group**: 18-45
- **Target audience**: Adults only (18+)
- **Reason for 18+ restriction**: App handles real money and cryptocurrency, which involves financial risk. Regulatory requirements mandate adult users only.
- **Google Play setting**: Set "Target audience" to 18+ in App content > Target audience and content

---

## Ads Declaration

- **Does the app contain ads?** No
- **Ad networks used**: None
- **Note**: App is ad-free. Revenue comes from transaction fees and exchange rate spreads.

---

## App Access Instructions (for Google Play Review)

Provide these credentials to Google Play reviewers:

1. **Test account phone**: [Provide test phone number]
2. **Test account PIN**: [Provide test PIN]
3. **Test M-Pesa sandbox**: App uses Safaricom sandbox in non-production builds
4. **Note**: Reviewers should use the "preview" build profile which connects to staging API

---

## Google Play Policy Compliance Notes

- App does NOT use Google Play Billing because it is a financial services app handling real currency (KES) and cryptocurrency, which are exempt from Google Play Billing requirements per Google Play policy section on "Financial Products"
- App clearly discloses all fees and exchange rates before transaction confirmation
- App provides a confirmation screen before every financial transaction
- App does not target children or minors
