# CryptoPay

Crypto-to-M-Pesa payment platform for Kenya. Pay any Safaricom Paybill or Till number directly from cryptocurrency (USDT, BTC, ETH, SOL).

## Architecture

- **Backend**: Django 5 + DRF + PostgreSQL + Redis + Celery
- **Frontend**: React Native + Expo SDK 55 + Expo Router
- **Deployment**: Docker Compose (web, celery, celery-beat, postgres, redis)

## Features

### Core
- Multi-currency wallets (USDT, BTC, ETH, SOL, KES)
- Paybill, Till, and M-Pesa send payments
- Real-time exchange rates (CoinGecko)
- Quote locking with 90s TTL
- PIN-secured transactions

### Security
- JWT authentication with token rotation
- Biometric unlock (fingerprint/Face ID)
- KYC verification (Smile Identity)
- M-Pesa IP whitelist middleware
- Audit logging

### Mobile + Web
- Responsive design (mobile + desktop web)
- Google Sign-In
- Push notifications (Expo)
- Onboarding tour (popup modal)
- EN + Swahili localization
- Settings hub (notifications, KYC, change PIN, language, help)

### Backend
- Swagger/OpenAPI docs at /api/docs/
- Admin stats dashboard at /admin/stats/
- Email notifications (welcome, receipt, KYC, security)
- Celery Beat periodic tasks
- GitHub Actions CI/CD

## Quick Start

### Backend
```bash
cd backend
cp .env.example .env  # configure your env vars
docker compose up --build -d
docker compose exec web python manage.py migrate
docker compose exec web python manage.py create_admin
```

### Frontend
```bash
cd mobile
npm install
npx expo start --web
```

### API Docs
- Swagger UI: http://localhost:8000/api/docs/
- Admin: http://localhost:8000/admin/
- Admin Stats: http://localhost:8000/admin/stats/

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Django 5, DRF, drf-spectacular |
| Database | PostgreSQL 16 |
| Cache/Queue | Redis 7, Celery |
| Frontend | React Native, Expo SDK 55, Expo Router |
| Auth | JWT (SimpleJWT), Google OAuth |
| Payments | M-Pesa (Daraja API) |
| Rates | CoinGecko API |
| KYC | Smile Identity |
| Email | SMTP (Django templates) |
| CI/CD | GitHub Actions |
| Monitoring | Structured JSON logging |
