#!/bin/bash
# CryptoPay PostgreSQL backup script.
#
# Runs daily via /etc/cron.d/cpay-backup. Dumps the prod Postgres DB,
# gzips, writes to ${BACKUP_DIR}, uploads to Cloudflare R2 for off-VPS
# durability, prunes old local copies, and emits a Prometheus textfile
# metric so the `BackupStale` alert can fire if the cron stops running.
#
# Run locally via:
#   POSTGRES_PASSWORD=... R2_*=... bash scripts/backup-db.sh
# Run on VPS via cron · see /etc/cron.d/cpay-backup.
#
# Exit codes:
#   0  success
#   1  pg_dump failed (DB unreachable, bad creds, container down)
#   2  upload to R2 failed
#   3  local file is empty / corrupt after dump
#   4  R2 verify failed (uploaded object missing or wrong size)
#
# Env required:
#   POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD     (DB creds)
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
#   R2_ACCOUNT_ID, R2_BUCKET                          (R2 creds; if any
#                                                     are empty we skip
#                                                     the upload but
#                                                     still keep the
#                                                     local copy and
#                                                     emit a warning
#                                                     metric)
#
# Env optional:
#   BACKUP_DIR             default /var/backups/cpay
#   DB_CONTAINER           default cryptopay_db
#   RETENTION_DAYS_LOCAL   default 7
#   RETENTION_DAYS_R2      default 30
#   METRIC_DIR             default /var/lib/node_exporter/textfile_collector

set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cpay}"
DB_CONTAINER="${DB_CONTAINER:-cryptopay_db}"
DB_NAME="${POSTGRES_DB:-cryptopay}"
DB_USER="${POSTGRES_USER:-cryptopay}"
RETENTION_DAYS_LOCAL="${RETENTION_DAYS_LOCAL:-7}"
RETENTION_DAYS_R2="${RETENTION_DAYS_R2:-30}"
METRIC_DIR="${METRIC_DIR:-/var/lib/node_exporter/textfile_collector}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/cryptopay_${TIMESTAMP}.sql.gz"
OBJECT_KEY="backups/postgres/cryptopay_${TIMESTAMP}.sql.gz"
METRIC_FILE="${METRIC_DIR}/cpay_backup.prom"

log() {
  echo "[$(date -Iseconds)] $*" >&2
}

# Emit a Prometheus textfile metric. Atomic write via mv so node_exporter
# never reads a half-written file.
emit_metric() {
  local status="$1"        # 0=ok, 1=fail
  local size_bytes="$2"    # local file size, 0 if dump failed
  local r2_uploaded="$3"   # 0 or 1
  local now=$(date +%s)
  mkdir -p "$METRIC_DIR" 2>/dev/null || true
  local tmp="${METRIC_FILE}.tmp.$$"
  cat > "$tmp" <<EOF
# HELP cpay_backup_last_run_timestamp_seconds Unix time of the last cpay backup attempt.
# TYPE cpay_backup_last_run_timestamp_seconds gauge
cpay_backup_last_run_timestamp_seconds $now
# HELP cpay_backup_last_success_timestamp_seconds Unix time of the last successful cpay backup.
# TYPE cpay_backup_last_success_timestamp_seconds gauge
cpay_backup_last_success_timestamp_seconds $([ "$status" = "0" ] && echo "$now" || (test -f "$METRIC_FILE" && grep -oE 'cpay_backup_last_success_timestamp_seconds [0-9]+' "$METRIC_FILE" | awk '{print $2}' || echo "0"))
# HELP cpay_backup_size_bytes Size of the last produced backup .sql.gz in bytes.
# TYPE cpay_backup_size_bytes gauge
cpay_backup_size_bytes $size_bytes
# HELP cpay_backup_r2_uploaded 1 if the last backup was uploaded to R2, 0 otherwise.
# TYPE cpay_backup_r2_uploaded gauge
cpay_backup_r2_uploaded $r2_uploaded
EOF
  mv -f "$tmp" "$METRIC_FILE" 2>/dev/null || rm -f "$tmp"
}

mkdir -p "$BACKUP_DIR" || { log "FATAL: cannot create $BACKUP_DIR"; emit_metric 1 0 0; exit 1; }

log "Starting backup of $DB_NAME via $DB_CONTAINER · target=$BACKUP_FILE"

# --- Step 1: pg_dump | gzip ---
if ! docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$DB_CONTAINER" \
       pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --clean --if-exists 2>/dev/null \
     | gzip -9 > "$BACKUP_FILE"; then
  log "ERROR: pg_dump failed"
  rm -f "$BACKUP_FILE"
  emit_metric 1 0 0
  exit 1
fi

# --- Step 2: verify the dump is non-empty + uncorrupt ---
if [ ! -s "$BACKUP_FILE" ]; then
  log "ERROR: backup file is empty after dump"
  rm -f "$BACKUP_FILE"
  emit_metric 1 0 0
  exit 3
fi

if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
  log "ERROR: backup file is corrupt (gzip -t failed)"
  rm -f "$BACKUP_FILE"
  emit_metric 1 0 0
  exit 3
fi

SIZE_BYTES=$(stat -c %s "$BACKUP_FILE" 2>/dev/null || stat -f %z "$BACKUP_FILE" 2>/dev/null)
SIZE_HUMAN=$(du -h "$BACKUP_FILE" | cut -f1)
log "Dump OK · $SIZE_HUMAN ($SIZE_BYTES bytes)"

# --- Step 3: upload to R2 (Cloudflare object storage) ---
R2_UPLOADED=0
if [ -n "${R2_ACCESS_KEY_ID:-}" ] \
   && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] \
   && [ -n "${R2_ACCOUNT_ID:-}" ] \
   && [ -n "${R2_BUCKET:-}" ]; then
  R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  log "Uploading to R2 · $R2_BUCKET/$OBJECT_KEY"

  # Use the official aws cli with R2's S3-compatible endpoint. The
  # alternative is a python+boto3 inline script; the cli is simpler
  # and `apt-get install awscli` is a one-liner. If awscli isn't on
  # the system, fail loudly so the operator installs it.
  if ! command -v aws >/dev/null 2>&1; then
    log "ERROR: aws cli not installed · skip R2 upload but keep local copy"
    log "       install with: apt-get install -y awscli  OR  pip install awscli"
    emit_metric 1 "$SIZE_BYTES" 0
    exit 2
  fi

  if AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
     AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
     AWS_DEFAULT_REGION="auto" \
     aws s3 cp "$BACKUP_FILE" "s3://$R2_BUCKET/$OBJECT_KEY" \
       --endpoint-url "$R2_ENDPOINT" \
       --only-show-errors; then
    log "R2 upload OK"
    R2_UPLOADED=1
  else
    log "ERROR: R2 upload failed · keeping local copy, exiting 2"
    emit_metric 1 "$SIZE_BYTES" 0
    exit 2
  fi

  # --- Step 4: verify R2 object exists at expected size ---
  R2_SIZE=$(AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
            AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
            AWS_DEFAULT_REGION="auto" \
            aws s3api head-object \
              --bucket "$R2_BUCKET" \
              --key "$OBJECT_KEY" \
              --endpoint-url "$R2_ENDPOINT" \
              --query 'ContentLength' \
              --output text 2>/dev/null)
  if [ -z "$R2_SIZE" ] || [ "$R2_SIZE" != "$SIZE_BYTES" ]; then
    log "ERROR: R2 verify failed · local=$SIZE_BYTES r2=$R2_SIZE"
    emit_metric 1 "$SIZE_BYTES" 0
    exit 4
  fi
  log "R2 verify OK · object size matches"
else
  log "WARN: R2 credentials not set · skipping off-VPS upload (local copy only)"
fi

# --- Step 5: prune local copies older than RETENTION_DAYS_LOCAL ---
DELETED=$(find "$BACKUP_DIR" -maxdepth 1 -name "cryptopay_*.sql.gz" -mtime +"$RETENTION_DAYS_LOCAL" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  log "Pruned $DELETED local backup(s) older than $RETENTION_DAYS_LOCAL days"
fi

# Note · R2 retention is enforced by a Cloudflare R2 lifecycle policy
# on the bucket (set once via the dashboard or `aws s3api
# put-bucket-lifecycle-configuration`). The script does NOT enumerate
# and delete R2 objects to avoid scope-creep failure modes.

emit_metric 0 "$SIZE_BYTES" "$R2_UPLOADED"
log "Backup complete · status=ok size=$SIZE_HUMAN r2_uploaded=$R2_UPLOADED"
exit 0
