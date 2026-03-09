#!/bin/bash
# CryptoPay PostgreSQL Backup Script
# Usage: ./scripts/backup-db.sh
# Schedule with cron: 0 2 * * * /path/to/CryptoPay/scripts/backup-db.sh

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
CONTAINER_NAME="${DB_CONTAINER:-cryptopay-db-1}"
DB_NAME="${POSTGRES_DB:-cryptopay}"
DB_USER="${POSTGRES_USER:-cryptopay}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/cryptopay_${TIMESTAMP}.sql.gz"

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting database backup..."

# Dump and compress
docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --clean | gzip > "$BACKUP_FILE"

# Verify backup
if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[$(date)] Backup successful: $BACKUP_FILE ($SIZE)"
else
    echo "[$(date)] ERROR: Backup failed or empty!"
    exit 1
fi

# Cleanup old backups
DELETED=$(find "$BACKUP_DIR" -name "cryptopay_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    echo "[$(date)] Cleaned up $DELETED backup(s) older than $RETENTION_DAYS days"
fi

echo "[$(date)] Backup complete."
