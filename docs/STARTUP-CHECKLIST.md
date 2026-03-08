# CryptoPay — Startup Checklist

## Legal & Regulatory (Do FIRST — Before Writing Code)

### Company Registration
- [ ] Choose company name: "CryptoPay Technologies Ltd" (check availability at eCitizen)
- [ ] Register Limited Company at Registrar of Companies (eCitizen portal)
- [ ] Obtain Certificate of Incorporation
- [ ] Obtain CR12 (company directors/shareholders)
- [ ] Register for KRA PIN (company)
- [ ] Open business bank account (Equity Bank recommended — fintech-friendly)
- [ ] Register business with NSSF and NHIF

### VASP License Preparation
- [ ] Engage a Kenyan fintech lawyer (firms: Bowmans, AMG Advocates, Njaga Advocates)
- [ ] Draft AML/KYC policy document
- [ ] Draft cybersecurity policy
- [ ] Prepare minimum capital (TBD — budget KES 5-10M)
- [ ] Appoint compliance officer
- [ ] Monitor National Treasury for implementing regulations
- [ ] Apply for VASP license when applications open (CBK — payment processor category)

### Safaricom Daraja API
- [ ] Register organization on Safaricom Daraja portal (developer.safaricom.co.ke)
- [ ] Apply for Paybill number (OR partner with existing Paybill holder initially)
- [ ] Submit go-live documents:
  - Certificate of Incorporation
  - CR12
  - KRA PIN
  - Bank account letter
  - Directors' IDs
  - Signed Administrator Form
- [ ] Get sandbox API keys for development
- [ ] Complete go-live approval (24-72 hours)

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
- [ ] Cloudflare: add domains, enable proxy + SSL
- [ ] Safaricom Daraja: sandbox API keys
- [ ] Yellow Card: apply for API access (docs.yellowcard.engineering)
- [ ] CoinGecko: register for API key (free tier: 30 calls/min)
- [ ] Smile Identity: register for KYC API (smileidentity.com)
- [ ] Africa's Talking: register for SMS OTP (africastalking.com — cheaper than Twilio in Kenya)
- [ ] Sentry: error tracking account
- [ ] VPS: order Hetzner/Contabo (8 CPU, 16GB RAM, 200GB SSD)

### Development Environment
- [ ] Initialize Django project with cookiecutter-django or custom template
- [ ] PostgreSQL 16 setup
- [ ] Redis 7 setup
- [ ] Docker Compose configuration
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Staging environment

### Blockchain Wallets
- [ ] Generate master HD seed (BIP-39 mnemonic)
- [ ] Store seed SECURELY (encrypted, never in code, never in git)
- [ ] Set up Tron node access (TronGrid API — free tier available)
- [ ] Set up Polygon RPC (Alchemy or QuickNode — free tier)
- [ ] Test deposit detection on testnets
- [ ] Test wallet derivation

---

## Financial Planning

### Startup Costs (Estimated)

| Item | Cost (KES) | Cost (USD) | Notes |
|------|-----------|-----------|-------|
| Company registration | 15,000 | ~$115 | eCitizen fees |
| Legal counsel (initial) | 200,000-500,000 | ~$1,500-3,800 | VASP prep, AML policy |
| Domain names (3) | 10,000 | ~$75 | .co.ke + .africa + .app |
| Trademark registration | 30,000 | ~$230 | KIPI filing |
| VPS (6 months) | 20,000 | ~$150 | Hetzner/Contabo |
| Daraja Paybill setup | 0-50,000 | ~$0-380 | Safaricom fees vary |
| SMS OTP credits | 10,000 | ~$75 | Africa's Talking prepaid |
| KYC API credits | 15,000 | ~$115 | Smile Identity (100 verifications) |
| M-Pesa float (initial) | 500,000 | ~$3,800 | Operating float for B2B payments |
| Misc (design, tools) | 50,000 | ~$380 | Figma, GitHub, monitoring |
| **TOTAL** | **~850,000-1,170,000** | **~$6,500-9,000** | Excluding developer salaries |

### VASP License Costs (When Regulations Published)

| Item | Estimated Cost (KES) |
|------|---------------------|
| Minimum capital requirement | 5,000,000-10,000,000 (TBD) |
| Application fee | 100,000-500,000 (TBD) |
| Annual license fee | 200,000-1,000,000 (TBD) |
| Compliance audit | 300,000-500,000 |
| Insurance/trust account | Varies |

*Note: Exact amounts will be in the implementing regulations — not yet published as of March 2026.*

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
