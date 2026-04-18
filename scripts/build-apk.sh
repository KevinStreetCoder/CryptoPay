#!/bin/bash
# Local APK build via EAS preview profile, optionally uploaded to the VPS.
#
# Prereqs (one-time): run `scripts/install-android-sdk.sh` from WSL Ubuntu
# to install Android SDK 34+35, NDK 27.1.x, CMake 3.22 under $HOME/android-sdk.
#
# Required env vars:
#   EXPO_TOKEN         — EAS access token (from `expo whoami` / Expo dashboard)
#
# Optional env vars:
#   UPLOAD_TO_VPS=1    — after build, scp the APK to the VPS download path
#   VPS_HOST           — defaults to root@173.249.4.109
#   VPS_APK_PATH       — defaults to /var/www/cpay-downloads/cryptopay.apk
#
# Run from WSL Ubuntu:
#   EXPO_TOKEN=xxx UPLOAD_TO_VPS=1 bash scripts/build-apk.sh
set -e

if [ -z "${EXPO_TOKEN:-}" ]; then
  echo "ERROR: EXPO_TOKEN env var is required."
  echo "  Get one at https://expo.dev → Account Settings → Access Tokens"
  echo "  Then: EXPO_TOKEN=xxx bash scripts/build-apk.sh"
  exit 1
fi

# Source the SDK env (this script is non-interactive — .bashrc isn't sourced)
export ANDROID_HOME="$HOME/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# react-native-worklets-core needs the NDK at build time
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/34.0.0:$PATH"

if [ ! -d "$ANDROID_HOME" ]; then
  echo "ERROR: Android SDK not found at $ANDROID_HOME"
  echo "  Run scripts/install-android-sdk.sh first."
  exit 1
fi

echo "Building with $(nproc) parallel jobs"

# Resolve the mobile/ dir relative to this script so it works no matter where
# you launch from (Windows path, WSL path, etc.).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/../mobile" && pwd)"
cd "$MOBILE_DIR"

echo "[1/4] Verifying lockfile is in sync with package.json..."
# EAS sandbox runs `npm ci`, which fails if the lockfile is stale.
# Quick dry-run detects mismatch without installing; only on mismatch do
# we regenerate (saves ~7 min when lockfile is fine).
if ! npm ci --dry-run --no-audit --no-fund > /dev/null 2>&1; then
  echo "Lockfile out of sync — regenerating (~7 min)..."
  rm -rf node_modules package-lock.json
  npm install --no-audit --no-fund 2>&1 | tail -5
  if [ ! -f package-lock.json ]; then
    echo "ERROR: npm install did not produce a package-lock.json"
    exit 1
  fi
else
  echo "Lockfile is in sync."
fi

echo "[2/4] Running EAS local build (preview profile, APK)..."
mkdir -p ~/cpay-apk
OUTPUT="$HOME/cpay-apk/cpay-$(date +%Y%m%d-%H%M%S).apk"

# Use a dedicated sandbox dir, cleaned every run (EAS refuses non-empty dir)
export EAS_LOCAL_BUILD_WORKINGDIR="$HOME/eas-sandbox"
rm -rf "$EAS_LOCAL_BUILD_WORKINGDIR"
mkdir -p "$EAS_LOCAL_BUILD_WORKINGDIR"

# Metro stomps on /tmp/metro-cache. If a prior build (e.g. as root) left
# files there with wrong ownership, our build fails with EACCES. Wipe it
# each run so ownership is always clean.
sudo -n rm -rf /tmp/metro-cache 2>/dev/null || rm -rf /tmp/metro-cache 2>/dev/null || true

# --local builds entirely on this machine using our SDK + NDK
# --non-interactive avoids prompts on EAS account / project linking
# --output writes the APK to a known path
npx --yes eas-cli@latest build \
  --platform android \
  --profile preview \
  --local \
  --non-interactive \
  --output "$OUTPUT" 2>&1 | tee /tmp/eas-build.log | tail -60

echo "[3/4] Build complete:"
ls -lh "$OUTPUT"

if [ "${UPLOAD_TO_VPS:-0}" != "1" ]; then
  echo ""
  echo "[4/4] Skipping upload (set UPLOAD_TO_VPS=1 to enable)."
  echo "Local APK: $OUTPUT"
  exit 0
fi

VPS_HOST="${VPS_HOST:-root@173.249.4.109}"
VPS_APK_PATH="${VPS_APK_PATH:-/var/www/cpay-downloads/cryptopay.apk}"

echo "[4/4] Uploading to $VPS_HOST:$VPS_APK_PATH ..."
# Atomic swap: upload as .new, then rename. Avoids serving a partial file
# to anyone mid-download.
scp -o StrictHostKeyChecking=no "$OUTPUT" "$VPS_HOST:${VPS_APK_PATH}.new"
ssh -o StrictHostKeyChecking=no "$VPS_HOST" \
  "mv ${VPS_APK_PATH}.new ${VPS_APK_PATH} && \
   chown www-data:www-data ${VPS_APK_PATH} && \
   ls -lh ${VPS_APK_PATH} && \
   md5sum ${VPS_APK_PATH}"

echo ""
echo "Live at https://cpay.co.ke/download/$(basename ${VPS_APK_PATH})"
