#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# CryptoPay — Production deployment script (Contabo VPS)
#
# Usage:
#   First deploy:  bash deploy.sh --init
#   Subsequent:    bash deploy.sh
#   Full rebuild:  bash deploy.sh --rebuild
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ──────────────────────────────────────────────────
APP_DIR="/opt/cryptopay"
REPO_URL="git@github.com:YOUR_ORG/CryptoPay.git"   # TODO: set your repo URL
BRANCH="main"
COMPOSE_FILE="deploy/docker-compose.prod.yml"
ENV_FILE="deploy/.env.production"
NGINX_CONF="deploy/nginx/cpay.conf"
NGINX_SITES="/etc/nginx/sites-enabled"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Parse args ──────────────────────────────────────────────
INIT=false
REBUILD=false
for arg in "$@"; do
    case $arg in
        --init)    INIT=true ;;
        --rebuild) REBUILD=true ;;
        --help)
            echo "Usage: deploy.sh [--init|--rebuild|--help]"
            echo "  --init     First-time setup (clone, install nginx, create dirs)"
            echo "  --rebuild  Force full Docker rebuild (no cache)"
            exit 0
            ;;
    esac
done

# ── Pre-flight checks ──────────────────────────────────────
if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Install it first."
    exit 1
fi

if ! docker compose version &>/dev/null; then
    error "Docker Compose V2 is not available. Install docker-compose-plugin."
    exit 1
fi

# ── First-time init ────────────────────────────────────────
if [ "$INIT" = true ]; then
    log "Running first-time setup..."

    # Install host-level nginx if not present
    if ! command -v nginx &>/dev/null; then
        log "Installing nginx..."
        apt-get update && apt-get install -y nginx
        # Remove default site
        rm -f /etc/nginx/sites-enabled/default
    fi

    # Clone repo
    if [ ! -d "$APP_DIR/.git" ]; then
        log "Cloning repository..."
        git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
    else
        warn "Repository already exists at $APP_DIR"
    fi

    cd "$APP_DIR"

    # Check for .env.production
    if [ ! -f "$ENV_FILE" ]; then
        if [ -f "deploy/.env.production.example" ]; then
            cp deploy/.env.production.example "$ENV_FILE"
            warn "Created $ENV_FILE from example. EDIT IT NOW with real values!"
            warn "  nano $APP_DIR/$ENV_FILE"
            exit 1
        else
            error "No .env.production or .env.production.example found!"
            exit 1
        fi
    fi

    # Symlink nginx config
    if [ -d "$NGINX_SITES" ]; then
        ln -sf "$APP_DIR/$NGINX_CONF" "$NGINX_SITES/cpay.conf"
        log "Nginx config symlinked to $NGINX_SITES/cpay.conf"
    fi

    # Create M-Pesa certs directory
    mkdir -p "$APP_DIR/backend/certs"

    log "Init complete. Now run: bash deploy.sh"
    exit 0
fi

# ── Deploy ──────────────────────────────────────────────────
cd "$APP_DIR"

# Pull latest code
log "Pulling latest code from $BRANCH..."
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

# Verify env file exists
if [ ! -f "$ENV_FILE" ]; then
    error "Missing $ENV_FILE — run with --init first or create it manually."
    exit 1
fi

# Build and start containers
log "Building and starting containers..."
BUILD_FLAGS=""
if [ "$REBUILD" = true ]; then
    BUILD_FLAGS="--no-cache"
fi

docker compose -f "$COMPOSE_FILE" build $BUILD_FLAGS
docker compose -f "$COMPOSE_FILE" up -d

# Wait for web container to be healthy
log "Waiting for web container to be healthy..."
for i in $(seq 1 30); do
    if docker compose -f "$COMPOSE_FILE" exec -T web curl -sf http://localhost:8000/health/ &>/dev/null; then
        log "Web container is healthy!"
        break
    fi
    if [ "$i" -eq 30 ]; then
        error "Web container failed to become healthy after 30 attempts."
        docker compose -f "$COMPOSE_FILE" logs web --tail 50
        exit 1
    fi
    sleep 2
done

# Run migrations
log "Running database migrations..."
docker compose -f "$COMPOSE_FILE" exec -T web python manage.py migrate --noinput

# Collect static files
log "Collecting static files..."
docker compose -f "$COMPOSE_FILE" exec -T web python manage.py collectstatic --noinput

# Deploy frontend (Expo web build) if dist/ exists
if [ -d "$APP_DIR/mobile/dist" ] && [ -f "$APP_DIR/mobile/dist/index.html" ]; then
    log "Deploying Expo web frontend..."
    WEB_ROOT="/var/www/cpay"
    mkdir -p "$WEB_ROOT"
    rsync -a --delete "$APP_DIR/mobile/dist/" "$WEB_ROOT/"
    chown -R www-data:www-data "$WEB_ROOT"
    chmod -R 755 "$WEB_ROOT"
    log "Frontend deployed to $WEB_ROOT"
fi

# Test & reload host nginx
log "Testing nginx configuration..."
if nginx -t 2>/dev/null; then
    nginx -s reload
    log "Nginx reloaded."
else
    error "Nginx config test failed! Check: nginx -t"
    exit 1
fi

# Purge Cloudflare cache (if credentials are available)
CF_ENV_FILE="$APP_DIR/deploy/.env.cloudflare"
if [ -f "$CF_ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$CF_ENV_FILE"
    if [ -n "${CLOUDFLARE_ZONE_ID:-}" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
        log "Purging Cloudflare cache..."
        DOMAIN="${CLOUDFLARE_DOMAIN:-cpay.co.ke}"
        # Purge index.html specifically
        curl -s -X POST \
            "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "{\"files\":[\"https://${DOMAIN}/\",\"https://${DOMAIN}/index.html\"]}" \
            > /dev/null 2>&1
        # Full purge to clear stale JS bundles
        curl -s -X POST \
            "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data '{"purge_everything":true}' \
            > /dev/null 2>&1
        log "Cloudflare cache purged."
    else
        warn "Cloudflare credentials incomplete in $CF_ENV_FILE — skipping cache purge."
    fi
else
    warn "No deploy/.env.cloudflare found — skipping Cloudflare cache purge."
    warn "Create it from deploy/.env.cloudflare.example for automatic cache busting."
fi

# ── Verification ────────────────────────────────────────────
log "Running health checks..."

# Check all containers are running
RUNNING=$(docker compose -f "$COMPOSE_FILE" ps --status running --format json 2>/dev/null | wc -l)
log "Containers running: $RUNNING"

# Check Django health endpoint
if curl -sf http://127.0.0.1:8100/health/ &>/dev/null; then
    log "Django health check: OK"
else
    warn "Django health check failed on port 8100"
fi

# Show container status
docker compose -f "$COMPOSE_FILE" ps

echo ""
log "Deployment complete!"
echo ""
echo "  Next steps:"
echo "  ─────────────────────────────────────────"
echo "  Create superuser (first time only):"
echo "    docker compose -f $COMPOSE_FILE exec web python manage.py createsuperuser"
echo ""
echo "  View logs:"
echo "    docker compose -f $COMPOSE_FILE logs -f web"
echo "    docker compose -f $COMPOSE_FILE logs -f celery"
echo ""
echo "  Cloudflare DNS:"
echo "    A record: cpay.co.ke -> YOUR_VPS_IP (proxied)"
echo "    CNAME: www -> cpay.co.ke (proxied)"
echo "    CNAME: api -> cpay.co.ke (proxied)"
echo ""
