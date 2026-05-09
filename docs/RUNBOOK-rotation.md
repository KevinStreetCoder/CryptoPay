# Cpay key & secret rotation runbook

**Cadence:** every 90 days. Calendar invite owner: jimvuetutor@gmail.com.

The rotation drill is a *quarterly hygiene check* that proves we can replace
each long-lived secret without taking the platform down. Each rotation is its
own ticket; a single drill runs all of them in the same window.

If a secret is suspected leaked at any other time (laptop loss, accidental
commit, contractor offboard), run the relevant section IMMEDIATELY out-of-band.
Do not wait for the quarterly drill.

## Schedule

| Quarter | Calendar date | Lead | Tested by |
|---|---|---|---|
| Q1 (Feb) | first Sat of Feb 03–05 AM Nairobi | jimvuetutor | _ |
| Q2 (May) | first Sat of May 03–05 AM Nairobi | jimvuetutor | _ |
| Q3 (Aug) | first Sat of Aug 03–05 AM Nairobi | jimvuetutor | _ |
| Q4 (Nov) | first Sat of Nov 03–05 AM Nairobi | jimvuetutor | _ |

The 03–05 AM Nairobi window is chosen because (a) M-Pesa traffic is at its
weekly low, (b) no daily reconciliation jobs are running, (c) we have at least
4 hours before the morning rush if anything needs to be rolled back.

## Pre-flight checklist (do in order)

```
[ ] DB backup taken in the last 1 h (pg_dump → off-VPS)
[ ] Container backup tarball taken (cpay-pre-rotation-<ts>.tar.gz)
[ ] No in-flight payment sagas (UI shows 0 pending in /admin/payments)
[ ] Health check green: curl -s https://cpay.co.ke/health/ | jq .
[ ] On-call Slack channel notified: "rotation drill starting"
[ ] Rollback secret pinned (the OLD value) saved to password manager BEFORE
    any change · in case rotation fails mid-flight
```

## What rotates

### 1 · Secret Manager versions (all Phase-1 secrets · 5/7 currently in SM)

In scope:
- `MPESA_CALLBACK_HMAC_KEY`
- `SASAPAY_CALLBACK_HMAC_KEY`
- `SASAPAY_CLIENT_SECRET`
- `INTASEND_API_SECRET`
- `TOTP_ENCRYPTION_KEY` (KEK · the master key for envelope encryption · see §2)

Out-of-scope (still env-only, fix at next sprint):
- `SASAPAY_WEBHOOK_SECRET` (legacy; the HMAC-SHA512 path no longer needs it
  · the inbound C2B IPN doesn't carry a signature header, see fix
  `1dcb508`. Decommission this env var once the IntaSend webhook secret is
  rotated · they're a matched set in `.env.production`)
- `INTASEND_WEBHOOK_SECRET`

Rotation steps for each in-scope secret:

```bash
# 1. Generate new value
NEW=$(python -c "import secrets; print(secrets.token_urlsafe(48))")

# 2. Push as a new version of the GCP Secret Manager secret
echo -n "$NEW" | gcloud secrets versions add cpay-prod-<NAME> \
  --project=cpay-490223 --data-file=-

# 3. Disable the previous version (NOT destroy · keep for rollback)
PREV=$(gcloud secrets versions list cpay-prod-<NAME> \
  --project=cpay-490223 --filter="state=enabled" --limit=2 \
  --format="value(name)" | tail -1)
gcloud secrets versions disable "$PREV" --secret=cpay-prod-<NAME> \
  --project=cpay-490223

# 4. Restart the web container so it picks up the new version
ssh root@173.249.4.109 "cd /home/deploy/cpay/deploy && \
  docker compose -f docker-compose.prod.yml restart web"

# 5. Verify with the smoke test relevant to the secret
#    (e.g. SASAPAY_CLIENT_SECRET → run sasapay_sandbox_smoke)
```

If the new version doesn't work: re-enable PREV (`gcloud secrets versions
enable $PREV ...`) and restart. The OLD value is still on disk because we
disabled, didn't destroy.

After a clean rotation that's been stable for one full week, **destroy** the
disabled version: `gcloud secrets versions destroy <PREV> ...`. This is the
only step that's irreversible; do it deliberately.

### 2 · TOTP DEK (data-encryption key)

The TOTP secrets in the database are wrapped with an envelope DEK
(`apps.core.totp_keystore`). The DEK is itself wrapped with the KEK
(`TOTP_ENCRYPTION_KEY`, in Secret Manager). Rotation here means rotating
the DEK, not the KEK.

```bash
# Inside the web container:
docker exec -it cryptopay_web python manage.py rotate_totp_key \
    --new-key-id $(date +%Y%m%d) --commit
```

This generates a new DEK, re-wraps every encrypted TOTP secret, and bumps
the active key id. The old DEK stays in the keystore (still wrapped) so
already-issued TOTP codes during the cutover window remain decryptable.

Verify: pick 5 random users with TOTP enabled and ask them to log in. If 5/5
succeed, the rotation is good.

### 3 · R2 access keys (Cloudflare Object Storage)

The R2 keys live in `.env.production` as `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY`. They are NOT yet in Secret Manager; the migration
to SM is on the next-sprint backlog.

Rotation steps:

1. Cloudflare dashboard → R2 → API Tokens → Create new token (scoped to
   bucket `cpay-prod`, permission Object R/W).
2. Save the new pair to a temporary text file on your laptop.
3. SSH to VPS, edit `/home/deploy/cpay/deploy/.env.production`:
   - Comment out the OLD pair, paste the NEW pair below.
4. `docker compose -f deploy/docker-compose.prod.yml restart web celery beat`.
5. Smoke test: upload a 1 KB file via Django shell → verify it appears in R2:

   ```python
   from django.core.files.base import ContentFile
   from django.core.files.storage import default_storage
   default_storage.save("rotation-test.txt", ContentFile(b"hello"))
   ```
6. After 24 hours of clean operation: revoke the OLD pair in Cloudflare
   dashboard.

### 4 · SasaPay client secret (developer.sasapay.app)

SasaPay does NOT expose a self-service rotation API. Rotation requires a
dashboard click-through plus a 5–10 min downtime window because the OAuth
client_credentials cache becomes invalid the moment the new secret is live.

Steps:

1. Open SasaPay dashboard → Production Apps → Cpay → Reveal Client Secret.
2. Click "Regenerate" — they will email you the new value (NOT show it on
   screen). Wait for the email.
3. Save new value to password manager.
4. SM update:
   ```bash
   echo -n "$NEW_SECRET" | gcloud secrets versions add cpay-prod-SASAPAY_CLIENT_SECRET \
     --project=cpay-490223 --data-file=-
   ```
5. Restart web container.
6. Run:
   ```bash
   docker exec cryptopay_web python manage.py sasapay_sandbox_smoke --once
   ```
   You should see `OAuth 200` and `account-validation 200`. If `OAuth 401`,
   the new secret hasn't propagated · disable the new SM version and roll
   back to the previous.

If real C2B traffic is in flight when you rotate, callbacks during the 5–10
min window may queue at SasaPay's side and replay later. Idempotency
prevents double-credit; the user just sees a delayed confirmation.

## Post-rotation

```
[ ] All four secrets verified working (smoke test or real tx)
[ ] Disabled-but-not-destroyed previous versions confirmed in SM:
     gcloud secrets versions list cpay-prod-* --filter='state=disabled'
[ ] Slack channel update: "rotation done, all green"
[ ] Calendar next-quarter date confirmed in jimvuetutor@gmail.com
[ ] Audit log entry · `apps.core.audit.log_event("secret_rotation", ...)`
```

## Roll-forward of decommissioned versions

After 7 days of stable operation post-rotation, destroy the disabled
versions in Secret Manager. This is the only step that's not reversible.

```bash
# Get the disabled version names
DISABLED=$(gcloud secrets versions list cpay-prod-<NAME> \
  --project=cpay-490223 --filter='state=disabled' \
  --format='value(name)')

# Destroy each (interactive prompt asks for confirmation)
for v in $DISABLED; do
  gcloud secrets versions destroy "$v" --secret=cpay-prod-<NAME> \
    --project=cpay-490223
done
```

## What this runbook does NOT cover

- **Cold wallet seed phrase rotation** · separate runbook in
  `docs/RUNBOOK-cold-wallet.md` (TBD). Cold wallet rotation is a hot
  custody migration, not a key rotation, and it has different blast radius.
- **Database master password** · rotated only on VASP-licence application
  audit, not on the quarterly drill. Separate runbook.
- **Domain TLS certs** · auto-rotated via Let's Encrypt + certbot timer.
  Verify the renewal pipeline once per drill (`certbot renew --dry-run`).
- **GCP service account JSON keys** · we don't use them in production
  (workload identity federation only). Verify still true at each drill.

## History

| Date | Lead | What rotated | Issues |
|---|---|---|---|
| 2026-05-09 | (initial drill skipped · runbook just landed) | n/a | n/a |
| 2026-08-XX | _ | _ | _ |
