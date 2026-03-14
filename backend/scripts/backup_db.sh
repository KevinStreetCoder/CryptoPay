#!/usr/bin/env bash
# CryptoPay PostgreSQL backup script.
# Dumps the database, compresses with gzip, retains 7 daily + 4 weekly backups,
# and optionally uploads to S3.
#
# Usage:
#   ./backup_db.sh                 # Uses env vars for DB connection
#   ./backup_db.sh --weekly        # Tag as weekly backup (for retention)
#
# Required env vars: DB_NAME, DB_USER, DB_HOST, DB_PORT, DB_PASSWORD (or .pgpass)
# Optional env vars: AWS_S3_BUCKET, AWS_S3_PREFIX, BACKUP_DIR

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cryptopay}"
DB_NAME="${DB_NAME:-cryptopay}"
DB_USER="${DB_USER:-cryptopay}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

DAILY_RETENTION=7
WEEKLY_RETENTION=4

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DAY_OF_WEEK=$(date +"%u")  # 1=Monday, 7=Sunday

IS_WEEKLY=false
if [[ "${1:-}" == "--weekly" ]] || [[ "$DAY_OF_WEEK" == "7" ]]; then
    IS_WEEKLY=true
fi

# ── Create backup directory ─────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}/daily"
mkdir -p "${BACKUP_DIR}/weekly"

# ── Dump database ───────────────────────────────────────────────────────────
BACKUP_FILE="${BACKUP_DIR}/daily/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "[$(date -Iseconds)] Starting backup of ${DB_NAME}..."

export PGPASSWORD="${DB_PASSWORD:-}"

pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
    --verbose 2>/dev/null \
| gzip > "$BACKUP_FILE"

FILESIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat --printf="%s" "$BACKUP_FILE" 2>/dev/null || echo "unknown")
echo "[$(date -Iseconds)] Backup complete: ${BACKUP_FILE} (${FILESIZE} bytes)"

# ── Weekly copy ─────────────────────────────────────────────────────────────
if $IS_WEEKLY; then
    WEEKLY_FILE="${BACKUP_DIR}/weekly/${DB_NAME}_weekly_${TIMESTAMP}.sql.gz"
    cp "$BACKUP_FILE" "$WEEKLY_FILE"
    echo "[$(date -Iseconds)] Weekly backup saved: ${WEEKLY_FILE}"
fi

# ── Retention cleanup ───────────────────────────────────────────────────────
# Remove daily backups older than DAILY_RETENTION days
find "${BACKUP_DIR}/daily" -name "*.sql.gz" -mtime +${DAILY_RETENTION} -delete 2>/dev/null || true
echo "[$(date -Iseconds)] Cleaned daily backups older than ${DAILY_RETENTION} days"

# Remove weekly backups older than WEEKLY_RETENTION weeks
find "${BACKUP_DIR}/weekly" -name "*.sql.gz" -mtime +$((WEEKLY_RETENTION * 7)) -delete 2>/dev/null || true
echo "[$(date -Iseconds)] Cleaned weekly backups older than ${WEEKLY_RETENTION} weeks"

# ── Optional S3 upload ──────────────────────────────────────────────────────
if [[ -n "${AWS_S3_BUCKET:-}" ]]; then
    S3_PREFIX="${AWS_S3_PREFIX:-backups/cryptopay}"
    S3_PATH="s3://${AWS_S3_BUCKET}/${S3_PREFIX}/daily/$(basename "$BACKUP_FILE")"

    echo "[$(date -Iseconds)] Uploading to ${S3_PATH}..."
    aws s3 cp "$BACKUP_FILE" "$S3_PATH" --storage-class STANDARD_IA

    if $IS_WEEKLY; then
        S3_WEEKLY="s3://${AWS_S3_BUCKET}/${S3_PREFIX}/weekly/$(basename "$WEEKLY_FILE")"
        aws s3 cp "$WEEKLY_FILE" "$S3_WEEKLY" --storage-class STANDARD_IA
        echo "[$(date -Iseconds)] Weekly backup uploaded to ${S3_WEEKLY}"
    fi

    echo "[$(date -Iseconds)] S3 upload complete"
else
    echo "[$(date -Iseconds)] AWS_S3_BUCKET not set — skipping S3 upload"
fi

echo "[$(date -Iseconds)] Backup process finished successfully"
