# CryptoPay — Production Readiness Checklist

**Last updated:** 2026-03-11

Items needed before the app can go live with real users and money.

---

## 🔴 MUST HAVE — Before Any Real Transactions

### API Keys & Credentials
| # | Item | Status | How to Get |
|---|------|--------|------------|
| 1 | **Africa's Talking SMS API** | ❌ Need API key | Sign up at africastalking.com → sandbox free, production KES 0.8/SMS. Set `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID` in `.env` |
| 2 | **M-Pesa Daraja Production Keys** | ❌ Need production app | Apply at developer.safaricom.co.ke → business shortcode required. Switch from sandbox. Set `MPESA_*` env vars |
| 3 | **Smile Identity (KYC)** | ❌ Need API key | Sign up at usesmileid.com → KES 50-100 per ID check. Set `SMILE_API_KEY`, `SMILE_PARTNER_ID` |
| 4 | **CoinGecko Pro API** | ⚠️ Optional | Free tier: 10K calls/month. Pro ($129/mo) for 500K calls. Set `COINGECKO_API_KEY`. Currently using free tier with CryptoCompare fallback. |
| 5 | **Wallet Master Seed** | ❌ Must generate | Run: `python -c "import secrets; print(secrets.token_hex(32))"`. Set `WALLET_MASTER_SEED` env var. **CRITICAL: Back up securely, never commit!** |
| 6 | **Django SECRET_KEY** | ❌ Must generate | Run: `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`. Set in `.env` |
| 7 | **Google OAuth Client IDs** | ❌ Need config | Google Cloud Console → OAuth 2.0 credentials. Set in `mobile/app.json` extra config |

### Infrastructure
| # | Item | Status | Details |
|---|------|--------|---------|
| 8 | **VPS / Cloud Server** | ❌ Need to provision | Recommended: Nairobi-based VPS (Lineserve/Truehost) or AWS Africa (Cape Town). Min 4GB RAM, 2 vCPU |
| 9 | **Domain Name** | ❌ Need to register | `cryptopay.co.ke` or similar. Register at kenic.or.ke or via Namecheap |
| 10 | **SSL Certificate** | ❌ Auto with deploy | Certbot + Let's Encrypt. Already configured in nginx.conf, just needs domain |
| 11 | **Production Database** | ❌ Need to provision | PostgreSQL 16. Can use managed (AWS RDS, DigitalOcean) or self-hosted Docker |
| 12 | **Email Provider** | ⚠️ Configured | Resend SMTP configured in production.py (3K emails/month free). Set `RESEND_API_KEY` |

### Legal & Compliance
| # | Item | Status | Details |
|---|------|--------|---------|
| 13 | **VASP Registration** | ❌ Required | Kenya VASP Act 2025 requires registration with CMA. Apply at cma.or.ke |
| 14 | **Business Registration** | ❌ Required | Register company with Kenya BRS. Need for M-Pesa business shortcode |
| 15 | **Privacy Policy** | ⚠️ Draft needed | Required for app stores and VASP compliance. Currently placeholder URLs |
| 16 | **Terms of Service** | ⚠️ Draft needed | Required for app stores. Cover crypto risks, liability, KYC requirements |
| 17 | **Excise Duty Compliance** | ✅ Implemented | 10% excise on platform fees per VASP Act. Already in backend + frontend |

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
