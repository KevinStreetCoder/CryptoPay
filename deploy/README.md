# CryptoPay Production Deployment Guide

**Target:** Contabo VPS, Ubuntu 24.04, Docker installed, shared with camhub (ports 80/443).

**Domain:** `cpay.co.ke` behind Cloudflare proxy.

## Architecture

```
Internet -> Cloudflare (SSL) -> VPS:80 -> Host Nginx
                                            |
                                            +-- cpay.co.ke -> 127.0.0.1:8100 (CryptoPay Django)
                                            +-- camhub domain   -> camhub nginx container (80/443)
```

CryptoPay services run in Docker with non-conflicting ports:
- Django (gunicorn): `127.0.0.1:8100` (host) -> `8000` (container)
- PostgreSQL: `127.0.0.1:5433` (host) -> `5432` (container)
- Redis: `127.0.0.1:6380` (host) -> `6379` (container)

## Prerequisites

1. **VPS with Docker** and Docker Compose V2
2. **Host-level nginx** (not containerised) for domain routing
3. **Cloudflare account** with domain `cpay.co.ke`

## Step-by-step Deployment

### 1. Prepare the VPS

```bash
# Install host nginx (if not present)
apt update && apt install -y nginx

# Remove the default site
rm -f /etc/nginx/sites-enabled/default

# Ensure camhub's nginx container doesn't bind to 80/443 on the host
# Instead, camhub should bind to a different host port (e.g., 8200)
# and have its own server block in host nginx.
```

### 2. Clone and configure

```bash
# Clone the repo
git clone git@github.com:YOUR_ORG/CryptoPay.git /opt/cryptopay
cd /opt/cryptopay

# Create production env file
cp deploy/.env.production.example deploy/.env.production
nano deploy/.env.production   # Fill in ALL real values
```

**Critical values to set:**
- `SECRET_KEY` — generate with: `python3 -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`
- `POSTGRES_PASSWORD` — strong random password
- `REDIS_PASSWORD` — strong random password
- `DATABASE_URL` — must match POSTGRES_PASSWORD
- `REDIS_URL` / `CELERY_BROKER_URL` — must match REDIS_PASSWORD
- `MPESA_*` — get from Safaricom Daraja portal
- `WALLET_MNEMONIC` — generate BIP-39 mnemonic offline, store backup securely

### 3. Deploy

```bash
# First-time init (installs nginx, symlinks config, clones repo)
bash deploy/deploy.sh --init

# After editing .env.production, run the actual deploy
bash deploy/deploy.sh
```

### 4. Create superuser

```bash
docker compose -f deploy/docker-compose.prod.yml exec web python manage.py createsuperuser
```

### 5. Set up M-Pesa certificates

```bash
# Copy production M-Pesa cert into the certs volume
docker cp /path/to/production.pem cryptopay_web:/app/certs/production.pem
```

### 6. Set up JWT keys (if using RS256)

```bash
# Generate keys on the VPS
openssl genrsa -out /tmp/jwt_private.pem 2048
openssl rsa -in /tmp/jwt_private.pem -pubout -out /tmp/jwt_public.pem

# Copy into the certs volume
docker cp /tmp/jwt_private.pem cryptopay_web:/app/certs/jwt_private.pem
docker cp /tmp/jwt_public.pem cryptopay_web:/app/certs/jwt_public.pem

# Clean up
rm /tmp/jwt_private.pem /tmp/jwt_public.pem
```

### 7. Configure Cloudflare DNS

| Type  | Name            | Target        | Proxy |
|-------|-----------------|---------------|-------|
| A     | cpay.co.ke | YOUR_VPS_IP  | Yes   |
| CNAME | www             | cpay.co.ke | Yes |
| CNAME | api             | cpay.co.ke | Yes |

**Cloudflare SSL settings:**
- SSL/TLS mode: **Full** (not Full Strict, since we use HTTP between CF and nginx)
- Always Use HTTPS: **On**
- Minimum TLS Version: **1.2**

### 8. Handle camhub coexistence

The existing camhub app needs to be updated so its nginx container does NOT bind to host ports 80/443. Instead:

1. Change camhub's docker-compose to expose on a different host port (e.g., `127.0.0.1:8200:80`)
2. Create a host nginx server block for camhub's domain pointing to `127.0.0.1:8200`
3. Both domains are routed by the HOST nginx based on `server_name`

## Operations

### View logs

```bash
cd /opt/cryptopay
docker compose -f deploy/docker-compose.prod.yml logs -f web
docker compose -f deploy/docker-compose.prod.yml logs -f celery
docker compose -f deploy/docker-compose.prod.yml logs -f celery-beat
```

### Restart services

```bash
docker compose -f deploy/docker-compose.prod.yml restart web celery celery-beat
```

### Run migrations manually

```bash
docker compose -f deploy/docker-compose.prod.yml exec web python manage.py migrate
```

### Database backup

```bash
docker compose -f deploy/docker-compose.prod.yml exec db \
  pg_dump -U cryptopay cryptopay | gzip > /var/backups/cryptopay/db_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Update deployment

```bash
cd /opt/cryptopay
bash deploy/deploy.sh           # Normal update (pulls latest, rebuilds, migrates)
bash deploy/deploy.sh --rebuild # Force full rebuild (no Docker cache)
```

## Troubleshooting

| Issue | Check |
|-------|-------|
| 502 Bad Gateway | `docker compose -f deploy/docker-compose.prod.yml ps` — is web running? |
| Static files 404 | Run `collectstatic` again, check WhiteNoise middleware |
| M-Pesa callbacks failing | Check `MPESA_CALLBACK_BASE_URL`, verify Cloudflare is not blocking Safaricom IPs |
| Redis connection refused | Verify `REDIS_PASSWORD` matches in `REDIS_URL` and `redis` service command |
| High memory usage | Check `docker stats`, adjust `GUNICORN_WORKERS` and memory limits |
