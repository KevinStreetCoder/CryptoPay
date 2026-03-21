#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# CryptoPay — Frontend (Expo Web) deployment with cache busting
#
# This script:
#   1. Builds the Expo web app locally
#   2. Syncs the build to the VPS
#   3. Purges Cloudflare cache (index.html specifically + full purge)
#   4. Verifies the deployment
#
# Prerequisites:
#   - SSH access to VPS (ssh root@173.249.4.109)
#   - Cloudflare API token with Cache Purge permission
#   - Set environment variables (or create deploy/.env.cloudflare):
#       CLOUDFLARE_ZONE_ID=your_zone_id
#       CLOUDFLARE_API_TOKEN=your_api_token
#       CLOUDFLARE_DOMAIN=cpay.co.ke
#
# Usage:
#   bash deploy/scripts/deploy-frontend.sh              # Build + deploy + purge
#   bash deploy/scripts/deploy-frontend.sh --skip-build  # Deploy existing dist/ + purge
#   bash deploy/scripts/deploy-frontend.sh --purge-only   # Only purge Cloudflare cache
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ──────────────────────────────────────────────────
VPS_HOST="root@173.249.4.109"
VPS_WEB_ROOT="/var/www/cpay"
LOCAL_DIST_DIR="mobile/dist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
info()  { echo -e "${CYAN}[INFO]${NC} $*"; }

# ── Load Cloudflare credentials ─────────────────────────────
# Source from deploy/.env.cloudflare if it exists
CF_ENV_FILE="$PROJECT_ROOT/deploy/.env.cloudflare"
if [ -f "$CF_ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$CF_ENV_FILE"
fi

# Verify Cloudflare credentials are set
: "${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID in environment or deploy/.env.cloudflare}"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN in environment or deploy/.env.cloudflare}"
CLOUDFLARE_DOMAIN="${CLOUDFLARE_DOMAIN:-cpay.co.ke}"

# ── Parse args ──────────────────────────────────────────────
SKIP_BUILD=false
PURGE_ONLY=false
for arg in "$@"; do
    case $arg in
        --skip-build)  SKIP_BUILD=true ;;
        --purge-only)  PURGE_ONLY=true ;;
        --help)
            echo "Usage: deploy-frontend.sh [--skip-build|--purge-only|--help]"
            echo "  --skip-build   Skip the Expo build, deploy existing dist/"
            echo "  --purge-only   Only purge Cloudflare cache, no deploy"
            exit 0
            ;;
    esac
done

# ── Cloudflare cache purge function ──────────────────────────
purge_cloudflare_cache() {
    log "Purging Cloudflare cache..."

    # Step 1: Purge specific critical files (index.html and its variants)
    info "Purging index.html from Cloudflare edge..."
    PURGE_RESPONSE=$(curl -s -X POST \
        "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"files\":[
            \"https://${CLOUDFLARE_DOMAIN}/\",
            \"https://${CLOUDFLARE_DOMAIN}/index.html\",
            \"https://www.${CLOUDFLARE_DOMAIN}/\",
            \"https://www.${CLOUDFLARE_DOMAIN}/index.html\",
            \"http://${CLOUDFLARE_DOMAIN}/\",
            \"http://${CLOUDFLARE_DOMAIN}/index.html\"
        ]}")

    # Check if purge was successful
    PURGE_SUCCESS=$(echo "$PURGE_RESPONSE" | grep -o '"success":\s*true' || true)
    if [ -n "$PURGE_SUCCESS" ]; then
        log "Specific file purge: SUCCESS"
    else
        warn "Specific file purge response: $PURGE_RESPONSE"
    fi

    # Step 2: Full cache purge (nuclear option — ensures no stale JS bundles remain)
    # This is safe because hashed assets will be re-cached on first request,
    # and index.html should never be cached anyway.
    info "Purging entire domain cache..."
    FULL_PURGE_RESPONSE=$(curl -s -X POST \
        "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data '{"purge_everything":true}')

    FULL_PURGE_SUCCESS=$(echo "$FULL_PURGE_RESPONSE" | grep -o '"success":\s*true' || true)
    if [ -n "$FULL_PURGE_SUCCESS" ]; then
        log "Full cache purge: SUCCESS"
    else
        warn "Full cache purge response: $FULL_PURGE_RESPONSE"
    fi
}

# ── Purge-only mode ──────────────────────────────────────────
if [ "$PURGE_ONLY" = true ]; then
    purge_cloudflare_cache
    log "Cache purge complete."
    exit 0
fi

cd "$PROJECT_ROOT"

# ── Step 1: Build Expo web ───────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
    log "Building Expo web app..."
    cd mobile
    npx expo export --platform web
    cd "$PROJECT_ROOT"
    log "Build complete."
else
    info "Skipping build (--skip-build flag set)."
fi

# Verify dist/ exists
if [ ! -f "$LOCAL_DIST_DIR/index.html" ]; then
    error "No index.html found at $LOCAL_DIST_DIR/. Run without --skip-build."
    exit 1
fi

# ── Step 2: Show what will be deployed ───────────────────────
JS_BUNDLE=$(find "$LOCAL_DIST_DIR/_expo/static/js" -name "entry-*.js" 2>/dev/null | head -1 || true)
if [ -n "$JS_BUNDLE" ]; then
    JS_HASH=$(basename "$JS_BUNDLE")
    info "JS bundle: $JS_HASH"
else
    warn "Could not find entry-*.js bundle — unusual build output."
fi

TOTAL_FILES=$(find "$LOCAL_DIST_DIR" -type f | wc -l)
info "Total files to deploy: $TOTAL_FILES"

# ── Step 3: Deploy to VPS ───────────────────────────────────
log "Deploying to $VPS_HOST:$VPS_WEB_ROOT ..."

# Ensure target directory exists
ssh "$VPS_HOST" "mkdir -p $VPS_WEB_ROOT"

# Strategy: rsync with --delete to remove old hashed bundles
# --checksum ensures only changed files are transferred
# --delete removes old JS bundles that no longer exist
rsync -avz --checksum --delete \
    --exclude='.DS_Store' \
    --exclude='*.map' \
    "$LOCAL_DIST_DIR/" \
    "$VPS_HOST:$VPS_WEB_ROOT/"

log "Files synced to VPS."

# ── Step 4: Verify nginx can read the files ──────────────────
log "Setting file permissions..."
ssh "$VPS_HOST" "chown -R www-data:www-data $VPS_WEB_ROOT && chmod -R 755 $VPS_WEB_ROOT"

# ── Step 5: Verify nginx config and reload ───────────────────
log "Testing nginx configuration..."
ssh "$VPS_HOST" "nginx -t 2>&1"
ssh "$VPS_HOST" "nginx -s reload"
log "Nginx reloaded."

# ── Step 6: Purge Cloudflare cache ───────────────────────────
purge_cloudflare_cache

# ── Step 7: Verify deployment ────────────────────────────────
log "Verifying deployment..."

# Check index.html is accessible and returns no-cache headers
info "Checking cache headers on index.html..."
HEADERS=$(curl -sI "https://${CLOUDFLARE_DOMAIN}/index.html" 2>/dev/null || \
          curl -sI "http://173.249.4.109/index.html" -H "Host: ${CLOUDFLARE_DOMAIN}" 2>/dev/null || true)

if echo "$HEADERS" | grep -qi "no-cache\|no-store\|must-revalidate"; then
    log "Cache-Control headers: CORRECT (no-cache set on index.html)"
else
    warn "Could not verify cache headers. Check manually:"
    warn "  curl -I https://${CLOUDFLARE_DOMAIN}/index.html"
fi

# Check that the JS bundle is accessible
if [ -n "$JS_BUNDLE" ]; then
    JS_PATH="/_expo/static/js/web/$JS_HASH"
    info "Checking JS bundle at $JS_PATH..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        "http://173.249.4.109${JS_PATH}" \
        -H "Host: ${CLOUDFLARE_DOMAIN}" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        log "JS bundle accessible: $JS_HASH (HTTP $HTTP_CODE)"
    else
        warn "JS bundle returned HTTP $HTTP_CODE — check deployment."
    fi
fi

# ── Done ─────────────────────────────────────────────────────
echo ""
log "Frontend deployment complete!"
echo ""
echo "  Deployed to: $VPS_HOST:$VPS_WEB_ROOT"
[ -n "${JS_HASH:-}" ] && echo "  JS bundle:   $JS_HASH"
echo "  CF cache:    purged"
echo ""
echo "  Verify live: https://${CLOUDFLARE_DOMAIN}"
echo "  Check hdrs:  curl -I https://${CLOUDFLARE_DOMAIN}/index.html"
echo ""
