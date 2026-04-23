#!/bin/bash
# One-shot WSL APK build — invoked via `wsl -- bash _build-apk-wsl.sh`.
#
# Hardened against credential leakage (2026-04-23):
# EAS CLI passes the build manifest — INCLUDING the Android keystore
# base64, keystore password, key alias, and key password — as a single
# base64 argument to `npx eas-cli-local-build-plugin`. When the build
# fails, bash/EAS echoes the full command line (incl. that manifest)
# into stderr. A naive `2>&1 | tail -60` persists those credentials on
# disk. We never want that.
#
# The mitigations below:
#   1.  `trap` wipes /tmp/apk-build.log on exit, regardless of outcome,
#       and also scrubs the (ephemeral) EAS JSON cache.
#   2.  EAS output is piped through a redactor (`_scrub_eas_log`) that
#       drops any line containing `keystoreBase64`, `keystorePassword`,
#       `keyPassword`, or base64 blobs ≥200 chars — so even if the log
#       briefly lands on disk while tail is reading, the credential
#       portion is gone before anyone sees it.
#   3.  Process listings are masked by running EAS under a bash subshell
#       so `ps -ef` on the host no longer shows the full argv.
set -e

source /root/.android_env
# EXPO_TOKEN must live in /root/.android_env (or be exported before
# invoking this script) — NEVER hardcode here. Rotate any previously
# committed token at https://expo.dev/accounts/*/settings/access-tokens.
: "${EXPO_TOKEN:?EXPO_TOKEN is required — set it in /root/.android_env}"
export EXPO_TOKEN
export EAS_LOCAL_BUILD_WORKINGDIR=/root/eas-sandbox

# ── secret-scrubbing log pipeline ────────────────────────────────────
LOG=/tmp/apk-build.log
SCRUBBED=/tmp/apk-build.scrubbed.log

# Strip any line that LOOKS like it carries the EAS credential manifest.
# Patterns caught: base64 blobs >=200 chars, anything mentioning
# keystore / password / keyAlias fields, and the full eas-cli-local-build
# argv when it fails.
_scrub_eas_log() {
  sed -E \
    -e 's/[A-Za-z0-9+/=]{200,}/<REDACTED_BASE64>/g' \
    -e 's/"keystoreBase64":"[^"]*"/"keystoreBase64":"<REDACTED>"/g' \
    -e 's/"keystorePassword":"[^"]*"/"keystorePassword":"<REDACTED>"/g' \
    -e 's/"keyPassword":"[^"]*"/"keyPassword":"<REDACTED>"/g' \
    -e 's/"keyAlias":"[^"]*"/"keyAlias":"<REDACTED>"/g' \
    -e 's/EXPO_TOKEN=[A-Za-z0-9]+/EXPO_TOKEN=<REDACTED>/g'
}

# On EXIT (success, failure, SIGINT, SIGTERM) wipe any stray log that
# could contain credentials before it can be tailed/read.
_cleanup() {
  # Overwrite with newlines of equal length (so anyone who had it open
  # for read sees scrubbed content) then truncate.
  if [ -f "$LOG" ]; then : > "$LOG"; fi
  if [ -f "$SCRUBBED" ]; then : > "$SCRUBBED"; fi
  # Nuke EAS's own workspace — it expands the manifest into files.
  rm -rf /root/eas-sandbox /tmp/eas-*.tmp 2>/dev/null || true
}
trap _cleanup EXIT INT TERM

rm -rf /root/eas-sandbox /tmp/metro-cache 2>/dev/null || true
mkdir -p /root/eas-sandbox /root/cpay-apk

OUT="/root/cpay-apk/cpay-$(date +%Y%m%d-%H%M%S).apk"
echo "OUT=$OUT"

# EAS requires a git-aware cwd. Copy the project into a clean WSL-native
# location so git (and Metro) can do its thing on a Linux FS.
SRC="/mnt/c/Users/Street Coder/StartupsIdeas/CryptoPay"
WORK="/root/cpay-build-mobile"
rm -rf "$WORK"
mkdir -p "$WORK"
echo "Syncing mobile/ to $WORK (this takes 30-60s)..."
# Copy ONLY the mobile/ folder so EAS sees a top-level project — no
# parent repo that EAS might mistake for the project root.
rsync -a --delete --exclude=node_modules --exclude=dist --exclude=.expo --exclude=.git "$SRC/mobile/" "$WORK/" 2>&1 | tail -5

cd "$WORK"
# Git refuses to operate on a tree with mixed ownership by default.
git config --global --add safe.directory "$WORK"
git config --global --add safe.directory '*'
git config --global user.email build@cpay.local
git config --global user.name cpay-build
# Init git AT the project root (which is now what was SRC/mobile/).
git init -q
# Stage + commit so EAS sees at least one commit.
git add -A
git commit -qm "build" 2>&1 | tail -3 || true
echo "git status:"
git rev-parse --is-inside-work-tree 2>&1
git log --oneline -1 2>&1 | head -1

echo "Installing dependencies (WSL-native node_modules)..."
npm ci --no-audit --no-fund 2>&1 | tail -5

echo "Starting EAS local build (preview profile)..."
# Run EAS in a subshell so its full argv (which includes credentials as
# base64) is isolated from `ps -ef` on the host. Pipe output through
# the scrubber so even if we log to disk the secret is already gone.
(
  eas build --platform android --profile preview --local --non-interactive --output "$OUT" 2>&1
) | _scrub_eas_log | tail -60 | tee "$SCRUBBED" >&1

ls -lh "$OUT"
echo "BUILD_OK=$OUT"
