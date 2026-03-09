# CryptoPay — Startup Checklist

> **CRITICAL UPDATE (March 2026):** The VASP Act 2025 was signed into law on October 15, 2025 and took effect November 4, 2025. Kenya now has a full crypto regulatory framework. Unlicensed operation carries penalties up to KES 25 million or 5 years imprisonment. CBK oversees payment VASPs, CMA oversees exchanges.

## Legal & Regulatory (Do FIRST — Before Writing Code)

### Company Registration
- [ ] Choose company name: "CryptoPay Technologies Ltd" (check availability at eCitizen)
- [ ] Register Limited Company at Registrar of Companies (eCitizen portal)
- [ ] Obtain Certificate of Incorporation
- [ ] Obtain CR12 (company directors/shareholders)
- [ ] Register for KRA PIN (company)
- [ ] Open business bank account (Equity Bank recommended — fintech-friendly)
- [ ] Register business with NSSF and NHIF
- [ ] Appoint at least 1 Kenyan national director (VASP Act requirement)

### VASP License Preparation (MANDATORY — Act No. 20 of 2025)
- [ ] Engage a Kenyan fintech lawyer (firms: Bowmans, AMG Advocates, Njaga Advocates, KDS Advocates)
- [ ] Draft AML/KYC policy document (required for FRC designation as Reporting Institution)
- [ ] Draft cybersecurity policy (required for VASP license)
- [ ] Draft Travel Rule compliance policy (originator/beneficiary data for transfers)
- [ ] Prepare minimum capital (TBD in implementing regulations — budget KES 5-10M)
- [ ] Appoint compliance officer
- [ ] Commission penetration test ($5,000-10,000 — required for license application)
- [ ] Set up client funds segregation (trust account or insurance)
- [ ] Monitor CBK/CMA for implementing regulations (expected mid-2026)
- [ ] Apply for VASP license from CBK (payment processor category)
- [ ] **CRITICAL:** Get VASP license BEFORE or alongside Daraja Paybill application — Safaricom can terminate unlicensed crypto businesses (Lipisha v Safaricom precedent)

### Safaricom Daraja API (Now Daraja 3.0)
- [ ] Register organization on Safaricom Daraja portal (developer.safaricom.co.ke)
- [ ] Apply for Paybill number at m-pesaforbusiness.co.ke — required documents:
  - Certificate of Incorporation
  - CR12 (directors from Registrar of Companies)
  - KRA PIN certificate
  - Bank letter / Bank on File (BOF) confirmation
  - Directors' national ID copies
  - Signed tariff guide (choose Mgao, Business Bouquet, or Customer Bouquet)
  - Company letterhead request letter
  - Signed Daraja Administrator Form
- [ ] Choose tariff: Business Bouquet recommended (business absorbs fees, B2B max 0.55% capped at KES 200)
- [ ] Get sandbox API keys for development (separate from Paybill application)
- [ ] Test all endpoints in sandbox: STK Push, B2B, B2C, Account Balance, Reversal, Transaction Status
- [ ] Upload test cases document for go-live review
- [ ] Complete go-live approval (**realistically 1-4 weeks**, not 24-72 hours)
- [ ] Whitelist Safaricom callback IPs: `196.201.214.200`, `196.201.214.206`, `196.201.213.114`
- [ ] **IMPORTANT:** Callback URLs must NOT contain "MPesa", "M-Pesa", or "Safaricom" in the path
- [ ] **IMPORTANT:** Position business as "digital asset payment service" not "crypto exchange" in application

### Domain & Brand
- [ ] Register domains: cryptopay.co.ke (KENIC) + cryptopay.africa + cryptopay.app
- [ ] Trademark "CryptoPay" with KIPI (Kenya Industrial Property Institute)
  - Check for existing "CryptoPay" trademarks globally (there may be EU-based ones — Kenya-specific should be fine)
- [ ] Design logo (hire Kenyan designer or use Figma)
- [ ] Brand guidelines document

---

## Technical Setup (After Legal Basics)

### Accounts & Services
- [ ] GitHub organization: create `cryptopay-ke` org
- [ ] Cloudflare Free: add domains, enable proxy + CDN + DDoS protection + SSL
- [ ] Safaricom Daraja: sandbox API keys (developer.safaricom.co.ke)
- [ ] Yellow Card API: apply for B2B API access — primary USDT→KES off-ramp (paymentsapi@yellowcard.io, docs.yellowcard.engineering)
- [ ] Kotani Pay API: apply as secondary off-ramp — Tether-backed, M-Pesa direct (docs.kotanipay.com)
- [ ] CoinGecko: register for API key (free tier: 10K calls/month — NOT 30 calls/min as often cited)
- [ ] CryptoCompare: register for fallback price feed (100K calls/month free — min-api.cryptocompare.com)
- [ ] Smile Identity: register for KYC API — 36M+ Kenya ID records, liveness checks (docs.usesmileid.com, sales@usesmileid.com)
- [ ] Africa's Talking: register for SMS OTP — KSh 0.40-0.60/SMS, 40x cheaper than Twilio (africastalking.com)
- [ ] Resend: transactional email — 3K/month free ongoing (SendGrid killed free tier May 2025)
- [ ] Sentry Free: error tracking — 5K errors/month
- [ ] UptimeRobot Free: uptime monitoring — 50 monitors
- [ ] AWS KMS: key management — $1/key/month for wallet seed encryption
- [ ] VPS: order Lineserve or Truehost (Nairobi data center, lowest latency to Kenya, M-Pesa payment accepted)
  - Alternative: AWS Cape Town (af-south-1) for higher reliability (~$160/mo)
  - Hetzner/Contabo are cheaper but ~150-200ms latency to Nairobi (no Africa DC)

### Development Environment
- [ ] Initialize Django project with cookiecutter-django or custom template
- [ ] PostgreSQL 16 setup
- [ ] Redis 7 setup
- [ ] Docker Compose configuration
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Staging environment

### Blockchain Wallets
- [ ] Install `bip-utils` Python library for BIP-32/44 HD wallet derivation (replaces HMAC-SHA256)
- [ ] Generate master HD seed (BIP-39 mnemonic, 24 words)
- [ ] Store seed in AWS KMS ($1/mo) — encrypted at rest, never in code, never in git
- [ ] Derivation paths:
  - Bitcoin: `m/44'/0'/0'/0/{index}`
  - Ethereum: `m/44'/60'/0'/0/{index}` (shared with ERC-20 USDT/USDC)
  - Tron: `m/44'/195'/0'/0/{index}` (TRC-20 USDT)
  - Solana: `m/44'/501'/0'/0'`
- [ ] Set up TronGrid API — free tier: 15 QPS, 100K req/day (currently implemented)
- [ ] Set up Alchemy (Ethereum) — free tier: 30M compute units/month (Phase 2)
- [ ] Set up BlockCypher (Bitcoin) — free tier: 3 req/sec, upgrade to $50/mo Starter (Phase 3)
- [ ] Set up Helius (Solana) — free tier: 1M credits, upgrade to $49/mo (Phase 4)
- [ ] Test deposit detection on testnets for each chain
- [ ] Implement hot/warm/cold wallet split before mainnet launch

---

## Financial Planning

### Startup Costs (Estimated — Updated March 2026)

| Item | Cost (KES) | Cost (USD) | Notes |
|------|-----------|-----------|-------|
| Company registration | 15,000 | ~$115 | eCitizen fees |
| Legal counsel (initial) | 200,000-500,000 | ~$1,500-3,800 | VASP prep, AML policy, cybersecurity policy |
| Domain names (3) | 10,000 | ~$75 | .co.ke (KSh 999/yr) + .africa + .app |
| Trademark registration | 30,000 | ~$230 | KIPI filing |
| VPS (6 months) | 20,000-36,000 | ~$150-280 | Nairobi VPS (Lineserve/Truehost) or AWS Cape Town |
| Daraja Paybill setup | 0-50,000 | ~$0-380 | Safaricom tariff agreement |
| SMS OTP credits | 10,000 | ~$75 | Africa's Talking — KSh 0.40-0.60/SMS |
| KYC API credits | 15,000 | ~$115 | Smile Identity — custom pricing for startups |
| M-Pesa float (initial) | 500,000 | ~$3,800 | Operating float for B2B payments |
| Penetration test | 650,000-1,300,000 | ~$5,000-10,000 | Required for VASP application |
| Apple Developer (annual) | 12,900 | ~$99 | Required for iOS App Store |
| Google Play (one-time) | 3,250 | ~$25 | Required for Play Store |
| AWS KMS (6 months) | 780 | ~$6 | Wallet seed encryption |
| Misc (design, tools) | 50,000 | ~$380 | Figma, GitHub, monitoring (most tools free tier) |
| **TOTAL** | **~1,500,000-2,500,000** | **~$11,500-19,000** | Excluding developer salaries |

**Monthly Recurring (MVP):** ~KES 6,500-11,000 (~$50-85) for infrastructure

### VASP License Costs (When Implementing Regulations Published)

| Item | Estimated Cost (KES) | Notes |
|------|---------------------|-------|
| Minimum capital requirement | 5,000,000-10,000,000 (TBD) | Paid-up share capital + liquidity buffer |
| Application fee | 100,000-500,000 (TBD) | CBK payment processor category |
| Annual license fee | 200,000-1,000,000 (TBD) | Renewable |
| Compliance audit | 300,000-500,000 | Annual, by approved auditor |
| Insurance/trust account | Varies | Client funds segregation |

*Note: Implementing regulations being drafted by CBK/CMA, expected mid-2026. Penalties for unlicensed operation: up to KES 25M fine or 5 years imprisonment.*

---

## Go-to-Market Strategy

### Phase 1: Private Beta (50-100 users)
- Recruit from Kenya crypto Telegram groups and Twitter/X
- Focus on crypto-native users who already understand USDT
- Paybill payments only (KPLC, DSTV, water — essential bills)
- Gather feedback, fix bugs, measure conversion times

### Phase 2: Public Beta (1,000 users)
- Open registration with referral system
- Add more Paybill merchants
- Add Till number support
- Content marketing: "Pay your KPLC bill with USDT in 10 seconds"
- YouTube demos in English + Swahili

### Phase 3: Public Launch
- App Store + Google Play submission
- PR push: TechWeez, TechCabal, BitcoinKE, Kenyan Wallstreet
- Partnerships: crypto influencers in Kenya
- Merchant onboarding for Till payments

### Target User Personas

1. **The Freelancer** — Earns USDT from international clients (Upwork, Fiverr), needs to pay rent (Paybill) and buy groceries (Till)
2. **The Trader** — Holds BTC/ETH, wants to pay bills without selling on P2P (slow, risky)
3. **The Remittance Receiver** — Family abroad sends USDT instead of Western Union, recipient pays bills directly
4. **The DeFi User** — Has yield-earning stablecoins, wants to spend without exiting to fiat first

---

## Key Contacts & Resources

### Regulatory
- **CBK**: cbk@centralbank.go.ke, +254 20 286 0000
- **CMA**: corporateaffairs@cma.or.ke
- **FRC**: frc@frc.go.ke (Financial Reporting Centre — AML)
- **KRA**: callcentre@kra.go.ke

### Technical
- **Safaricom Daraja**: developer.safaricom.co.ke (support via portal)
- **Yellow Card API**: docs.yellowcard.engineering
- **Kotani Pay**: docs.kotanipay.com
- **Smile Identity**: docs.smileidentity.com
- **Africa's Talking**: africastalking.com/sms

### Legal (Kenya Fintech Specialists)
- **Bowmans Kenya**: bowmanslaw.com (handled VASP Act analysis)
- **AMG Advocates**: amgadvocates.com (published VASP guide)
- **Njaga Advocates**: njagaadvocates.com (crypto licensing expertise)
- **KDS Advocates**: kdsadvocates.com (VASP licensing guide published)

### Industry
- **Blockchain Association of Kenya**: blockchain.or.ke
- **Kenya Fintech Association**: fintechassociation.ke
- **BitcoinKE**: bitcoinke.io (Kenya crypto news)
