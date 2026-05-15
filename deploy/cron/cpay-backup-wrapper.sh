#!/bin/bash
# /usr/local/bin/cpay-backup-wrapper.sh · cron entry point.
#
# Installed via scripts/install-db-backup-cron.sh. The job here is to
# source the .env.production for credentials, then call the real
# backup script. Keeping the env-load out of the script itself lets
# operators run `scripts/backup-db.sh` ad-hoc with their own env.
set -u

ENV_FILE="/home/deploy/cpay/deploy/.env.production"
BACKUP_SCRIPT="/home/deploy/cpay/scripts/backup-db.sh"

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(date -Iseconds)] FATAL: env file missing at $ENV_FILE" >&2
  exit 1
fi
if [ ! -x "$BACKUP_SCRIPT" ]; then
  echo "[$(date -Iseconds)] FATAL: backup script missing or not executable at $BACKUP_SCRIPT" >&2
  exit 1
fi

# Source the env file. The file uses KEY=value lines (Docker compose
# style); we extract POSTGRES_* and R2_* via grep so we don't accidentally
# eval shell-special characters in other values.
set -a
# shellcheck disable=SC1090
while IFS= read -r line; do
  case "$line" in
    POSTGRES_DB=*|POSTGRES_USER=*|POSTGRES_PASSWORD=*) eval "$line" ;;
    R2_ACCESS_KEY_ID=*|R2_SECRET_ACCESS_KEY=*|R2_ACCOUNT_ID=*|R2_BUCKET=*) eval "$line" ;;
  esac
done < "$ENV_FILE"
set +a

exec "$BACKUP_SCRIPT"
