# CryptoPay — Production Readiness Checklist

**Last updated:** 2026-03-21

Items needed before the app can go live with real users and money.

---

## 🔴 MUST HAVE — Before Any Real Transactions

### API Keys & Credentials
| # | Item | Status | How to Get |
|---|------|--------|------------|
| 1 | **SMS Provider (eSMS Africa)** | ✅ Configured | eSMS Africa API key + account ID set in production .env |
| 2 | **SasaPay Payment API** | ✅ Live (sandbox) | Sandbox tested with real STK Push. Merchant 600980. Needs production merchant account after business registration |
| 3 | **M-Pesa Daraja (alternative)** | ⚠️ Sandbox only | Sandbox keys configured. Production needs business shortcode + VASP license |
| 4 | **Smile Identity (KYC)** | ❌ Need API key | Sign up at usesmileid.com → KES 50-100 per ID check |
| 5 | **CoinGecko API** | ✅ Configured | Demo key `CG-zJVrCfUcwus46BCr8TXJff9M` set. Attribution required. |
| 6 | **Wallet Master Seed** | ✅ Generated | BIP-39 mnemonic generated, HD keys derived for all 5 chains. Stored in VPS .env |
| 7 | **Django SECRET_KEY** | ✅ Set | Production SECRET_KEY configured in .env |
| 8 | **Google OAuth Client IDs** | ✅ Configured | Web + Android client IDs set in app.json |
| 9 | **Resend Email** | ✅ Working | Emails sending (receipts, rate alerts, notifications) |
| 10 | **Expo/EAS Token** | ✅ Configured | Local WSL APK builds working |
| 11 | **TronGrid API** | ✅ Configured | Key set, Tron listener running |
| 12 | **Alchemy (ETH + SOL)** | ✅ Configured | RPC URLs set for both chains |
| 13 | **BlockCypher (BTC)** | ❌ Signup pending | Email verification not received. Need for BTC monitoring |
| 14 | **Yellow Card API** | ❌ Need keys | Contact paymentsapi@yellowcard.io for B2B rebalancing |

### Infrastructure
| # | Item | Status | Details |
|---|------|--------|---------|
| 8 | **VPS / Cloud Server** | ✅ Live | Contabo VPS 173.249.4.109, Docker Compose, nginx + Cloudflare |
| 9 | **Domain Name** | ✅ Live | cpay.co.ke with Cloudflare CDN + SSL |
| 10 | **SSL Certificate** | ✅ Live | Cloudflare handles TLS termination |
| 11 | **Production Database** | ✅ Running | PostgreSQL 16 in Docker, 6 days uptime |
| 12 | **Email Provider** | ✅ Working | Resend SMTP — receipts, alerts, notifications all sending |
| 13 | **Monitoring** | ✅ Running | Prometheus + Grafana + exporters (Redis, Postgres, Node) |

### Legal & Compliance
| # | Item | Status | Details |
|---|------|--------|---------|
| 13 | **VASP Registration** | ⚠️ Comment period | Draft regulations published. Public comment deadline **April 10, 2026** |
| 14 | **Business Registration** | ⚠️ Pending | Submitted on eCitizen, awaiting approval |
| 15 | **Privacy Policy** | ❌ Draft needed | Required for app stores and VASP compliance |
| 16 | **Terms of Service** | ❌ Draft needed | Required for app stores |
| 17 | **Excise Duty Compliance** | ✅ Implemented | 10% excise on platform fees per VASP Act |

### Security (Penetration Tested 2026-03-21)
| # | Item | Status | Details |
|---|------|--------|---------|
| 18 | **Auth bypass protection** | ✅ Passed | All endpoints return 401 without valid JWT |
| 19 | **JWT tampering** | ✅ Passed | Forged tokens rejected |
| 20 | **SQL injection** | ✅ Passed | Django ORM parameterized queries |
| 21 | **XSS** | ✅ Passed | Input validation returns 400 |
| 22 | **CORS** | ✅ Passed | Evil origins blocked |
| 23 | **IDOR** | ✅ Passed | Cross-user data access blocked |
| 24 | **Rate limiting** | ✅ Working | Login throttled at 24 requests |
| 25 | **Sensitive data masking** | ✅ Done | Phone numbers, M-Pesa receipts masked in API |
| 26 | **Swagger disabled** | ✅ Done | OpenAPI/docs return 404 in production |
| 27 | **TOTP secret hidden** | ✅ Done | Only provisioning_uri returned, not raw secret |

---

## 🟡 SHOULD HAVE — Before Public Beta

### Monitoring & Reliability
| # | Item | Status | Details |
|---|------|--------|---------|
| 18 | **Sentry Error Tracking** | ⚠️ Configured | Settings ready, just needs `SENTRY_DSN` env var. Sign up at sentry.io (free tier: 5K events/month) |
| 19 | **Prometheus + Grafana** | ❌ Not deployed | `django-prometheus` middleware ready. Need to add Docker services |
| 20 | **Database Backups** | ✅ Script ready | `scripts/backup-db.sh` exists. Need to add to cron (daily recommended) |
| 21 | **Log Aggregation** | ⚠️ Basic | JSON logging configured. Consider Loki/ELK for production |
| 22 | **Uptime Monitoring** | ❌ Need external | UptimeRobot (free) or Better Uptime. Monitor `/health/` endpoint |

### Security
| # | Item | Status | Details |
|---|------|--------|---------|
| 23 | **Hot/Warm/Cold Wallets** | ❌ Not implemented | Currently all funds in hot wallet. Need tiered security for production amounts |
| 24 | **Rate Limiting Tuning** | ✅ Configured | Nginx + Django throttling. May need tuning based on real traffic |
| 25 | **Penetration Testing** | ❌ Recommended | Hire security auditor before handling real funds |
| 26 | **M-Pesa IP Whitelist** | ✅ Implemented | Safaricom IP ranges configured in middleware |

### App Stores
| # | Item | Status | Details |
|---|------|--------|---------|
| 27 | **Apple Developer Account** | ❌ Need ($99/year) | developer.apple.com — required for iOS App Store |
| 28 | **Google Play Console** | ❌ Need ($25 one-time) | play.google.com/console — required for Play Store |
| 29 | **EAS Production Build** | ✅ Configured | `eas.json` has production profile. Run `eas build --platform all --profile production` |
| 30 | **App Store Screenshots** | ❌ Need to create | Required for both stores. Use simulator screenshots |

---

## 🟢 NICE TO HAVE — Post-Launch

| # | Item | Status | Details |
|---|------|--------|---------|
| 31 | **Solana SPL Listener** | ❌ | Helius API ($49/mo). Only needed when SOL deposits are enabled |
| 32 | **WalletConnect** | ❌ | Reown AppKit for external wallet connections (MetaMask, Trust, Phantom) |
| 33 | **Off-Ramp API** | ❌ | Yellow Card or Kotani Pay for automated USDT→KES exchange |
| 34 | **Push Notifications** | ✅ Ready | Expo Push API integrated. Works on native builds |
| 35 | **Analytics** | ❌ | Mixpanel or PostHog for user behavior tracking |

---

## Quick Start — Minimum Viable Deployment

To get the app running with real money on a VPS:

```bash
# 1. Provision VPS and point domain
# 2. Clone repo and create .env with all required keys
# 3. Deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 4. Run migrations
docker compose exec web python manage.py migrate

# 5. Create admin user
docker compose exec web python manage.py create_admin

# 6. Set up SSL
certbot --nginx -d yourdomain.com

# 7. Build mobile apps
cd mobile && eas build --platform all --profile production
```

**Estimated cost to launch:**
- VPS: ~$20-40/mo (4GB RAM)
- Domain: ~$15/year (.co.ke)
- Africa's Talking SMS: ~KES 0.8/SMS (pay as you go)
- Smile Identity KYC: ~KES 50-100/check
- Apple Developer: $99/year
- Google Play: $25 one-time
- **Total first month: ~$180-250**
