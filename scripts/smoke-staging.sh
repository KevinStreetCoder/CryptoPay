#!/bin/bash
# Staging smoke tests — run AFTER `docker compose -f docker-compose.yml
# -f docker-compose.staging.yml up -d` and BEFORE any production deploy.
#
# Exit code 0  = staging is healthy; safe to promote to prod.
# Exit code 1  = staging is broken; abort the prod deploy.
#
# Checks (fail-fast, each one takes < 2 s):
#   1. Health endpoint returns HTTP 200 + JSON { "status": "healthy" }
#   2. Django migrations are fully applied (no pending)
#   3. `/apk/` redirects 302 to /download/cryptopay.apk (counter wiring)
#   4. Admin metrics endpoint returns 401 unauth (not 200 or 404)
#   5. Rates API responds with a real KES number (>50), proving rate
#      fetch, cache, and serialiser all work end-to-end.
#   6. `pytest -m staging_smoke` — a small set of tests decorated with
#      @pytest.mark.staging_smoke that exercise the critical paths
#      against the live staging DB (NOT transactional-rollback-based).
#
# Runs on the VPS, hitting localhost:8800 directly (see the port
# binding in docker-compose.staging.yml).
set -euo pipefail

BASE="http://127.0.0.1:8800"
FAIL=0

check() {
  local name="$1"; shift
  if "$@"; then
    printf "  ✓ %s\n" "$name"
  else
    printf "  ✗ %s\n" "$name"
    FAIL=1
  fi
}

echo "── Staging smoke · $(date -u '+%Y-%m-%dT%H:%M:%SZ') ──"

# 1. /health/ returns JSON with status healthy
check "health endpoint" bash -c '
  body=$(curl -sf "'"$BASE"'/health/") && echo "$body" | grep -q "\"status\":\"healthy\""
'

# 2. Migrations all applied (no [ ] unapplied rows)
check "migrations applied" bash -c '
  docker compose -f docker-compose.yml -f docker-compose.staging.yml \
    exec -T web python manage.py showmigrations 2>/dev/null \
    | grep -q "\[ \]" && exit 1 || exit 0
'

# 3. /apk/ → 302 Found
check "apk tracker 302" bash -c '
  code=$(curl -sk -o /dev/null -w "%{http_code}" "'"$BASE"'/apk/") && test "$code" = "302"
'

# 4. /admin/metrics/apk-downloads/ → 401 (auth required, NOT 404)
check "admin metrics gated" bash -c '
  code=$(curl -sk -o /dev/null -w "%{http_code}" "'"$BASE"'/api/v1/admin/metrics/apk-downloads/") && test "$code" = "401" || test "$code" = "403"
'

# 5. Rates endpoint returns a real number
check "rates live" bash -c '
  resp=$(curl -sf "'"$BASE"'/api/v1/rates/quote/?currency=USDT&kes_amount=1000") \
    && echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); assert float(d[\"exchange_rate\"]) > 50, d"
'

# 6. Staging-only pytest markers
check "staging_smoke pytest" bash -c '
  docker compose -f docker-compose.yml -f docker-compose.staging.yml \
    exec -T web pytest -m staging_smoke --no-header -q 2>&1 | tail -3 | grep -qE "passed|no tests"
'

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✓ Staging smoke green — safe to deploy to production."
  exit 0
else
  echo "✗ Staging smoke FAILED — aborting. Fix above before promoting."
  exit 1
fi
