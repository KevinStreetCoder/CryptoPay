#!/bin/bash
# Production deploy runbook.
#
# Refuses to proceed unless:
#   (a) the currently-checked-out commit's CI has conclusion=="success"
#       on the `deploy-gate` job (via GitHub REST API), AND
#   (b) the staging smoke test is green against the running staging
#       stack (docker-compose.staging.yml).
#
# Usage on the VPS:
#   cd /home/deploy/cpay
#   git fetch origin main
#   bash scripts/deploy-production.sh   # runs gates, then rolls prod
#
# Hard requirements:
#   - GITHUB_TOKEN exported (read-only scope is enough).
#   - Staging stack already running (docker-compose.staging.yml up -d).
#   - `.env.staging` and `.env.production` populated under `deploy/`.

set -euo pipefail

REPO="KevinStreetCoder/CryptoPay"
COMPOSE_BASE="docker-compose.yml"
COMPOSE_STAGING="docker-compose.staging.yml"
COMPOSE_PROD="deploy/docker-compose.prod.yml"

SHA="$(git rev-parse HEAD)"
echo "Target commit: $SHA"

# ── Gate 1 · GitHub CI green ───────────────────────────────────
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_TOKEN not set. Cannot verify CI state."
  exit 1
fi

echo "Checking CI conclusion for $SHA …"
runs_json=$(curl -sf \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/actions/runs?head_sha=$SHA&per_page=10")

deploy_gate_status=$(echo "$runs_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
# Look at every run whose head_sha matches, find the one named 'CryptoPay CI'
# that completed, and check its deploy-gate job conclusion.
for run in data.get('workflow_runs', []):
    if run.get('name') != 'CryptoPay CI':
        continue
    if run.get('status') != 'completed':
        continue
    print(run.get('conclusion', 'unknown'))
    break
else:
    print('missing')
")

if [ "$deploy_gate_status" != "success" ]; then
  echo "ERROR: CI not green for $SHA (got: $deploy_gate_status). Refusing to deploy."
  exit 2
fi
echo "✓ CI green"

# ── Gate 2 · Staging smoke green ───────────────────────────────
echo "Running staging smoke …"
bash scripts/smoke-staging.sh || {
  echo "ERROR: Staging smoke failed. Fix before deploying to production."
  exit 3
}
echo "✓ Staging smoke green"

# ── Deploy · pull + rebuild + migrate + restart ────────────────
echo "Deploying $SHA to production …"
cd deploy
docker compose -f docker-compose.prod.yml exec -T web python manage.py migrate --noinput
docker compose -f docker-compose.prod.yml build web celery celery-beat
docker compose -f docker-compose.prod.yml up -d web celery celery-beat

echo "✓ Production rolled to $SHA"

# ── Post-deploy smoke ──────────────────────────────────────────
sleep 5
curl -sf "https://cpay.co.ke/health/" > /dev/null && echo "✓ cpay.co.ke/health → 200" \
  || { echo "ERROR: production health check failed post-deploy"; exit 4; }

echo "✓ Deploy complete · $SHA"
