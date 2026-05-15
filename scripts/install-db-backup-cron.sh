#!/bin/bash
# Install / refresh the daily Postgres backup cron + wrapper on the VPS.
#
# Local-first deployment vector · this script is the ONLY way to update
# the VPS-side cron configuration. Edit files under deploy/cron/ +
# scripts/backup-db.sh locally, then run this to push.
#
# Usage:   bash scripts/install-db-backup-cron.sh
#
# Idempotent · safe to re-run on every deploy.

set -e

VPS="root@173.249.4.109"

echo "=== validating local files ==="
test -f scripts/backup-db.sh
test -f deploy/cron/cpay-backup
test -f deploy/cron/cpay-backup-wrapper.sh
test -f deploy/cron/cpay-backup.logrotate
bash -n scripts/backup-db.sh
bash -n deploy/cron/cpay-backup-wrapper.sh
echo "    all local files parse"

echo
echo "=== ensuring local backup script is executable on disk ==="
chmod +x scripts/backup-db.sh
chmod +x deploy/cron/cpay-backup-wrapper.sh

echo
echo "=== syncing files to VPS ==="
# Note · the project tree on the VPS lives at /home/deploy/cpay/.
# scripts/backup-db.sh comes along on every git pull; we ALSO push the
# wrapper + cron file into /etc/ paths the cron daemon reads from.

# 1. The latest backup-db.sh (in case the VPS hasn't pulled main yet).
scp -o StrictHostKeyChecking=accept-new \
    scripts/backup-db.sh \
    "$VPS:/home/deploy/cpay/scripts/backup-db.sh"

# 2. The cron entry → /etc/cron.d/ (cron daemon picks up automatically).
scp deploy/cron/cpay-backup           "$VPS:/etc/cron.d/cpay-backup"

# 3. The wrapper → /usr/local/bin/ (kept off the project tree so a
#    `git clean -fdx` can't delete the binary cron depends on).
scp deploy/cron/cpay-backup-wrapper.sh "$VPS:/usr/local/bin/cpay-backup-wrapper.sh"

# 4. Logrotate config.
scp deploy/cron/cpay-backup.logrotate  "$VPS:/etc/logrotate.d/cpay-backup"

echo
echo "=== fixing permissions + ensuring dirs exist on VPS ==="
ssh "$VPS" 'set -e
  chmod 0755 /usr/local/bin/cpay-backup-wrapper.sh
  chmod 0644 /etc/cron.d/cpay-backup           # cron.d files require 0644
  chmod 0644 /etc/logrotate.d/cpay-backup
  chmod 0755 /home/deploy/cpay/scripts/backup-db.sh
  chown root:root /etc/cron.d/cpay-backup /etc/logrotate.d/cpay-backup /usr/local/bin/cpay-backup-wrapper.sh
  mkdir -p /var/backups/cpay
  chown root:root /var/backups/cpay
  chmod 0750 /var/backups/cpay
  mkdir -p /var/lib/node_exporter/textfile_collector
  chown 65534:65534 /var/lib/node_exporter/textfile_collector  # nobody:nogroup (node_exporter runs as nobody)
  chmod 0755 /var/lib/node_exporter/textfile_collector
  touch /var/log/cpay-backup.log
  chmod 0640 /var/log/cpay-backup.log
'

echo
echo "=== verifying cron daemon picks up the file ==="
ssh "$VPS" '
  echo "cron.d entry:"
  ls -la /etc/cron.d/cpay-backup
  echo
  echo "wrapper script:"
  ls -la /usr/local/bin/cpay-backup-wrapper.sh
  echo
  echo "next 3 cron firings (per cron):"
  systemctl status cron --no-pager 2>&1 | head -5 || service cron status 2>&1 | head -5
'

echo
echo "=== installing aws cli v2 if missing (required for R2 upload) ==="
ssh "$VPS" 'set -e
  if command -v aws >/dev/null 2>&1; then
    echo "aws cli already installed: $(aws --version 2>&1 | head -1)"
  else
    # Ubuntu 24.04 dropped the awscli package · install AWS CLI v2 via
    # the official binary bundle. ~50 MB download, idempotent.
    echo "Installing aws cli v2 (one-time, ~50 MB download)..."
    apt-get install -y -qq unzip curl
    cd /tmp
    rm -rf aws awscliv2.zip
    curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
    unzip -q awscliv2.zip
    ./aws/install
    rm -rf aws awscliv2.zip
    echo "Installed: $(aws --version 2>&1 | head -1)"
  fi
'

echo
echo "=== smoke-test · run the wrapper once manually ==="
echo "    (this proves env loads, R2 upload works, retention prune works)"
ssh "$VPS" '/usr/local/bin/cpay-backup-wrapper.sh'

echo
echo "=== confirm metric file was written ==="
ssh "$VPS" 'ls -la /var/lib/node_exporter/textfile_collector/cpay_backup.prom 2>&1; echo "---"; cat /var/lib/node_exporter/textfile_collector/cpay_backup.prom 2>&1'

echo
echo "=== DONE ==="
echo
echo "Next firing: 02:00 EAT daily (23:00 UTC)."
echo "Manual run any time: ssh $VPS /usr/local/bin/cpay-backup-wrapper.sh"
echo "View latest log:     ssh $VPS tail -50 /var/log/cpay-backup.log"
echo "Local copies:        ssh $VPS ls -la /var/backups/cpay/"
echo "R2 copies:           use rclone or aws s3 ls (configure with R2 creds)"
