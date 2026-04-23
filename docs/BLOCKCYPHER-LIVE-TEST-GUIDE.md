# BlockCypher Live Test Guide

Step-by-step smoke test for the `BLOCKCYPHER_API_TOKEN` added to production on
**2026-04-22**. Run these checks whenever you (re-)rotate the token or want to
confirm the Bitcoin deposit path is healthy.

The active token lives in `/home/deploy/cpay/deploy/.env.production` on the
VPS at `BLOCKCYPHER_API_TOKEN=`. A backup token sits at
`BLOCKCYPHER_API_TOKEN_BACKUP=` so rotation is a one-line swap. **Never
print the raw token value** — every command below masks it.

---

## 1 · Confirm Django loaded the token (length-only probe)

```bash
ssh root@173.249.4.109 \
  'cd /home/deploy/cpay/deploy && \
   docker compose -f docker-compose.prod.yml exec -T web python manage.py shell -c "
from django.conf import settings as s
t = s.BLOCKCYPHER_API_TOKEN or \"\"
b = getattr(s, \"BLOCKCYPHER_API_TOKEN_BACKUP\", \"\")
print(f\"active_loaded={bool(t)} len={len(t)}\")
print(f\"backup_loaded={bool(b)} len={len(b)}\")
"'
```

Expected:

```
active_loaded=True len=32
backup_loaded=True len=32
```

If `len=0` on the active slot, the container didn't pick up the env change.
Fix: `docker compose -f docker-compose.prod.yml up -d web celery celery-beat`.

---

## 2 · Confirm token works against the BlockCypher API

From inside the web container (so the token never leaves the VPS):

```bash
ssh root@173.249.4.109 \
  'docker compose -f /home/deploy/cpay/deploy/docker-compose.prod.yml exec -T web python manage.py shell -c "
import json, urllib.request
from django.conf import settings
token = settings.BLOCKCYPHER_API_TOKEN
url = f\"https://api.blockcypher.com/v1/tokens/{token}\"
req = urllib.request.Request(url, headers={\"User-Agent\":\"cpay-health\"})
with urllib.request.urlopen(req, timeout=10) as r:
    j = json.loads(r.read())
print(f\"status=ok token_prefix={token[:4]}... rate_hits_24h={j.get(\\\"hits_history\\\", \\\"?\\\")}\")"'
```

Expected: prints `status=ok token_prefix=255a... rate_hits_24h={...}`.
On HTTP 401: the token is revoked — swap to backup (step 5).

> Rate-limit contract: **2000 req/hr with token** vs 200 req/hr free. If you
> see 429s on steps 3-4, check your usage on
> [accounts.blockcypher.com](https://accounts.blockcypher.com/).

---

## 3 · End-to-end deposit-address query

Pick any BTC deposit address the platform has generated (e.g. via
`Wallet.objects.filter(currency="BTC", deposit_address__gt="").first()`).
Then from the VPS:

```bash
ADDR='bc1qyyyour-address-here'   # paste real address, don't echo it back
ssh root@173.249.4.109 \
  "docker compose -f /home/deploy/cpay/deploy/docker-compose.prod.yml exec -T web python manage.py shell -c \"
from apps.blockchain.sweep import get_on_chain_balance
from decimal import Decimal
bal = get_on_chain_balance('bitcoin', '$ADDR', 'BTC')
print(f'on_chain_balance={bal} BTC')
\""
```

Expected: prints the on-chain BTC balance as a `Decimal`. That confirms:
- Settings round-trip works (token loaded, read, used in the HTTP call)
- The BlockCypher endpoint accepts our token
- Our `sweep.get_on_chain_balance` helper parses the response correctly

If it prints `0` for a fresh address, that's fine — the test passes as long
as no exception raised.

---

## 4 · Deposit webhook (optional · production-only)

The current deposit listener **polls** every N seconds. To graduate to
BlockCypher webhooks (cheaper + lower latency), register a
[subscribe-to-address hook](https://www.blockcypher.com/dev/bitcoin/#events-and-hooks)
pointing at `https://cpay.co.ke/api/v1/hooks/btc/blockcypher/`:

```bash
# On the VPS — sign in with the active token
curl -s -X POST "https://api.blockcypher.com/v1/btc/main/hooks?token=$TOKEN" \
  -d '{
    "event": "unconfirmed-tx",
    "address": "bc1qreceiving-address",
    "url": "https://cpay.co.ke/api/v1/hooks/btc/blockcypher/"
  }'
```

Expected response: 201 Created with a `id` field — store it so you can `DELETE`
the hook when the address rotates. Until the webhook endpoint is wired in
`backend/apps/blockchain/views.py`, keep polling.

---

## 5 · Rotate active ↔ backup token

When the primary gets revoked, rate-limited, or leaked:

```bash
ssh root@173.249.4.109 \
  "ENV_FILE=/home/deploy/cpay/deploy/.env.production && \
   # Atomically swap ACTIVE and BACKUP — no token values in this shell's history
   awk -i inplace '
     /^BLOCKCYPHER_API_TOKEN=/        { print \"BLOCKCYPHER_API_TOKEN=\" saved_backup; next }
     /^BLOCKCYPHER_API_TOKEN_BACKUP=/ { saved_backup = substr(\$0, 28); next }
     { print }
   ' \$ENV_FILE && \
   grep -c ^BLOCKCYPHER_ \$ENV_FILE"
```

Then restart the app so it picks up the new active token:

```bash
ssh root@173.249.4.109 \
  "cd /home/deploy/cpay/deploy && \
   docker compose -f docker-compose.prod.yml up -d web celery celery-beat"
```

Go to [accounts.blockcypher.com](https://accounts.blockcypher.com/), click
**Make Active** on the backup token that's now being used, and delete the
compromised one.

---

## 6 · Tripwire · fail the healthcheck if the token breaks

Add to the existing daily-summary or health Celery task (`apps/core/tasks.py`):

```python
import urllib.request, json
from django.conf import settings

def check_blockcypher_token() -> dict:
    tok = settings.BLOCKCYPHER_API_TOKEN
    if not tok:
        return {"status": "missing"}
    try:
        with urllib.request.urlopen(
            f"https://api.blockcypher.com/v1/tokens/{tok}", timeout=5,
        ) as r:
            data = json.loads(r.read())
        return {"status": "ok", "hits_history": data.get("hits_history")}
    except Exception as e:
        return {"status": "error", "error": str(e)[:100]}
```

Surface the result in the 08:00 EAT daily summary so a revocation is visible
before it bites a user. **Do not** log the raw token — log only status + the
4-char prefix.

---

## Never-do list

- ❌ **`echo $BLOCKCYPHER_API_TOKEN`** — goes to shell history and terminal scrollback
- ❌ **`git grep` for the token value** — writes it into `.git/index.lock`
  metadata on some versions of git
- ❌ Pasting the token into a Slack/Discord/WhatsApp DM to Kevin
- ❌ Hard-coding in `_build-apk-wsl.sh` or any CI YAML
- ✅ The token lives in `.env.production` (mode 0600, root:root) and in the
  BlockCypher dashboard. That's the only two places. Rotate via step 5.
