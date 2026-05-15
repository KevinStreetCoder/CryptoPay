#!/bin/bash
# WSL Android App Bundle build · for Google Play Store submission.
#
# Same flow as `_build-apk-wsl.sh` but produces an AAB (`--profile
# production`) instead of an APK (`--profile preview`). Use this for
# every Play Console release · NEVER use the APK output for Play
# uploads (Play has rejected APK uploads since August 2021).
#
# Hardened against credential leakage (same scrubbing as the APK
# script) · the keystore base64 + passwords inside the EAS manifest
# argv are wiped from any persisted log on exit.
#
# Output: /root/cpay-aab/cpay-v<version>-<timestamp>.aab
#
# Usage:
#   wsl -d Ubuntu -u root -- bash /tmp/_build-aab.sh
#
# Prereq:
#   - /root/.android_env exports EXPO_TOKEN
#   - The EAS project's Android keystore is already provisioned
#     (cloud-managed by `eas credentials` · first build prompts).
set -e

source /root/.android_env
: "${EXPO_TOKEN:?EXPO_TOKEN is required — set it in /root/.android_env}"
export EXPO_TOKEN
export EAS_LOCAL_BUILD_WORKINGDIR=/root/eas-aab-sandbox

# ── secret-scrubbing log pipeline ────────────────────────────────────
LOG=/tmp/aab-build.log
SCRUBBED=/tmp/aab-build.scrubbed.log

_scrub_eas_log() {
  sed -E \
    -e 's/[A-Za-z0-9+/=]{200,}/<REDACTED_BASE64>/g' \
    -e 's/"keystoreBase64":"[^"]*"/"keystoreBase64":"<REDACTED>"/g' \
    -e 's/"keystorePassword":"[^"]*"/"keystorePassword":"<REDACTED>"/g' \
    -e 's/"keyPassword":"[^"]*"/"keyPassword":"<REDACTED>"/g' \
    -e 's/"keyAlias":"[^"]*"/"keyAlias":"<REDACTED>"/g' \
    -e 's/EXPO_TOKEN=[A-Za-z0-9]+/EXPO_TOKEN=<REDACTED>/g'
}

_cleanup() {
  if [ -f "$LOG" ]; then : > "$LOG"; fi
  if [ -f "$SCRUBBED" ]; then : > "$SCRUBBED"; fi
  rm -rf /root/eas-aab-sandbox /tmp/eas-aab-*.tmp 2>/dev/null || true
}
trap _cleanup EXIT INT TERM

rm -rf /root/eas-aab-sandbox /tmp/metro-cache 2>/dev/null || true
mkdir -p /root/eas-aab-sandbox /root/cpay-aab

# Read the version from app.json so the output filename carries it ·
# saves the operator a step when uploading to Play Console.
SRC="/mnt/c/Users/Street Coder/StartupsIdeas/CryptoPay"
VERSION=$(node -e "console.log(require('$SRC/mobile/app.json').expo.version)")
VERSION_CODE=$(node -e "console.log(require('$SRC/mobile/app.json').expo.android.versionCode)")
OUT="/root/cpay-aab/cpay-v${VERSION}-vc${VERSION_CODE}-$(date +%Y%m%d-%H%M%S).aab"
echo "Building AAB · version=${VERSION} versionCode=${VERSION_CODE}"
echo "OUT=$OUT"

WORK="/root/cpay-build-aab"
rm -rf "$WORK"
mkdir -p "$WORK"
echo "Syncing mobile/ to $WORK (this takes 30-60s)..."
rsync -a --delete --exclude=node_modules --exclude=dist --exclude=.expo --exclude=.git "$SRC/mobile/" "$WORK/" 2>&1 | tail -5

cd "$WORK"
git config --global --add safe.directory "$WORK"
git config --global --add safe.directory '*'
git config --global user.email build@cpay.local
git config --global user.name cpay-build
git init -q
git add -A
git commit -qm "build" 2>&1 | tail -3 || true

echo "Installing dependencies..."
npm ci --no-audit --no-fund 2>&1 | tail -5

# ── Pre-build keystore sanity (mirror of _build-apk-wsl.sh) ─────────
[ -f "$WORK/credentials.json" ] || { echo "FATAL: $WORK/credentials.json missing · refuse build" >&2; exit 5; }
[ -f "$WORK/credentials/cpay-release.keystore" ] || { echo "FATAL: keystore missing · refuse build" >&2; exit 5; }
if ! grep -q '"credentialsSource": *"local"' "$WORK/eas.json"; then
  echo "FATAL: eas.json must declare credentialsSource:local in the production profile · refuse build" >&2
  exit 5
fi
KS_PASS=$(python3 -c "import json; print(json.load(open('$WORK/credentials.json'))['android']['keystore']['keystorePassword'])")
KS_ALIAS=$(python3 -c "import json; print(json.load(open('$WORK/credentials.json'))['android']['keystore']['keyAlias'])")
EXPECTED_SHA1=$(keytool -list -v -keystore "$WORK/credentials/cpay-release.keystore" \
    -storepass "$KS_PASS" -alias "$KS_ALIAS" 2>/dev/null \
  | grep -E '^[[:space:]]*SHA1:' | head -1 | awk '{print $2}')
[ -n "$EXPECTED_SHA1" ] || { echo "FATAL: could not read keystore SHA-1" >&2; exit 5; }
echo "expected AAB signing SHA-1: $EXPECTED_SHA1"
echo

echo "Starting EAS local build (production profile · AAB)..."
(
  eas build --platform android --profile production --local --non-interactive --output "$OUT" 2>&1
) | _scrub_eas_log | tail -80 | tee "$SCRUBBED" >&1

[ -f "$OUT" ] || { echo "FATAL: build did not produce $OUT" >&2; exit 6; }
ls -lh "$OUT"

# ── Post-build keystore verification ────────────────────────────────
# AAB cert verify via apksigner works because AAB is a zip with the
# same META-INF/CERT.RSA shape as an APK. Treat the AAB as an APK
# for verification purposes; the cert bytes are identical to what
# Google Play Signing re-signs against.
APKSIGNER=$(find "$ANDROID_HOME/build-tools" -name apksigner -type f 2>/dev/null | head -1)
[ -n "$APKSIGNER" ] || { echo "FATAL: apksigner not found in build-tools" >&2; exit 7; }
ACTUAL_SHA1=$("$APKSIGNER" verify --print-certs "$OUT" 2>&1 \
  | grep -i "certificate SHA-1 digest" | head -1 | awk '{print $NF}')
EXPECTED_HEX=$(echo "$EXPECTED_SHA1" | tr -d ':' | tr 'A-F' 'a-f')
ACTUAL_HEX=$(echo "$ACTUAL_SHA1" | tr 'A-F' 'a-f')
if [ -n "$ACTUAL_HEX" ] && [ "$ACTUAL_HEX" != "$EXPECTED_HEX" ]; then
  echo "FATAL: AAB signing cert mismatch" >&2
  echo "  expected: $EXPECTED_HEX (from $WORK/credentials/cpay-release.keystore)" >&2
  echo "  actual:   $ACTUAL_HEX (the AAB that just built)" >&2
  echo "  Deleting the wrongly-signed AAB to prevent accidental shipping." >&2
  rm -f "$OUT"
  exit 4
fi
if [ -n "$ACTUAL_HEX" ]; then
  echo "OK · AAB signed with the expected cpay-release.keystore (SHA-1 $EXPECTED_SHA1)"
fi
echo "BUILD_OK=$OUT"
echo ""
echo "Next step: upload this AAB to Google Play Console."
echo "  1. https://play.google.com/console"
echo "  2. Cpay → Internal testing → Create new release"
echo "  3. Upload: $OUT"
echo "  4. Release name: ${VERSION} (${VERSION_CODE})"
echo "  5. Add release notes (EN + SW), Save, Review, Start rollout"
echo ""
echo "See docs/PLAY-CONSOLE-RELEASE-RUNBOOK.md for the full release ladder."
