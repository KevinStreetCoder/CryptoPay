#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# CryptoPay — PostgreSQL Backup Script
#
# Dumps the cryptopay database from the Docker container to
# /opt/cpay-backups/ with 30-day retention.
#
# Usage:
#   chmod +x /opt/cryptopay/deploy/scripts/backup-db.sh
#   /opt/cryptopay/deploy/scripts/backup-db.sh
#
# Cron entry (daily at 2:30 AM EAT):
#   30 2 * * * /opt/cryptopay/deploy/scripts/backup-db.sh >> /var/log/cpay-backup.log 2>&1
# ─────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="/opt/cpay-backups"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/cryptopay_${TIMESTAMP}.sql.gz"
CONTAINER_NAME="cryptopay_db"

# Source production env for DB credentials
ENV_FILE="/opt/cryptopay/deploy/.env.production"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting database backup..."

# Read DB credentials from env file if it exists
if [ -f "${ENV_FILE}" ]; then
    POSTGRES_USER=$(grep -oP '^POSTGRES_USER=\K.*' "${ENV_FILE}" 2>/dev/null || echo "cryptopay")
    POSTGRES_DB=$(grep -oP '^POSTGRES_DB=\K.*' "${ENV_FILE}" 2>/dev/null || echo "cryptopay")
else
    POSTGRES_USER="cryptopay"
    POSTGRES_DB="cryptopay"
fi

# Dump database from Docker container, compress with gzip
docker exec "${CONTAINER_NAME}" pg_dump \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    --verbose 2>/dev/null \
    | gzip > "${BACKUP_FILE}"

# Verify backup is not empty
FILESIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null)
if [ "${FILESIZE}" -lt 1024 ]; then
    echo "[$(date)] ERROR: Backup file is suspiciously small (${FILESIZE} bytes). Check DB connection."
    rm -f "${BACKUP_FILE}"
    exit 1
fi

echo "[$(date)] Backup created: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"

# Delete backups older than retention period
DELETED=$(find "${BACKUP_DIR}" -name "cryptopay_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [ "${DELETED}" -gt 0 ]; then
    echo "[$(date)] Deleted ${DELETED} backup(s) older than ${RETENTION_DAYS} days."
fi

# Show remaining backups
TOTAL=$(find "${BACKUP_DIR}" -name "cryptopay_*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)
echo "[$(date)] Backup complete. ${TOTAL} backup(s) stored, total size: ${TOTAL_SIZE}"
