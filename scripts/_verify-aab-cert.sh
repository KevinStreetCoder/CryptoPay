#!/bin/bash
# Verify an AAB's signing certificate SHA-1 against an expected pin.
# Usage:  ./_verify-aab-cert.sh <aab-path> <expected-sha1-hex-no-colons>
#
# 2026-05-17 · the post-build keystore check inside _build-aab-wsl.sh
# uses apksigner, but apksigner can't read raw AABs (no AndroidManifest.xml
# at the zip root). This script uses the canonical extract-cert-and-
# fingerprint approach:
#   1. unzip the AAB to grab META-INF/<ALIAS>.RSA (the signed cert chain)
#   2. keytool -printcert reads the cert chain
#   3. grep the SHA1 fingerprint, normalise hex (lowercase, no colons)
#   4. compare to the expected pin
set -euo pipefail

AAB="${1:?Usage: $0 <aab-path> <expected-sha1-hex-no-colons>}"
EXPECTED_RAW="${2:?Usage: $0 <aab-path> <expected-sha1-hex-no-colons>}"
EXPECTED=$(echo "$EXPECTED_RAW" | tr -d ':' | tr 'A-F' 'a-f')

[ -f "$AAB" ] || { echo "FATAL: $AAB does not exist" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Extract every cert under META-INF/. EAS local-build signs with whatever
# alias the credentials.json or remote-managed keystore declares; we
# don't hard-code it.
unzip -q -o "$AAB" 'META-INF/*.RSA' 'META-INF/*.DSA' 'META-INF/*.EC' -d "$TMP" 2>/dev/null || true
CERT=$(find "$TMP/META-INF" -type f \( -name '*.RSA' -o -name '*.DSA' -o -name '*.EC' \) | head -1)
[ -n "$CERT" ] || { echo "FATAL: no cert block found under META-INF/" >&2; exit 2; }

# `keytool -printcert -rfc` won't dump fingerprints; use the v1 form.
SHA1_LINE=$(keytool -printcert -file "$CERT" 2>/dev/null | grep -i 'SHA1:' | head -1)
[ -n "$SHA1_LINE" ] || { echo "FATAL: keytool didn't emit SHA1 fingerprint" >&2; exit 3; }
ACTUAL_RAW=$(echo "$SHA1_LINE" | awk -F'SHA1:' '{print $2}' | tr -d ' ')
ACTUAL=$(echo "$ACTUAL_RAW" | tr -d ':' | tr 'A-F' 'a-f')

echo "expected SHA-1: $EXPECTED"
echo "actual SHA-1  : $ACTUAL"

if [ "$ACTUAL" = "$EXPECTED" ]; then
  echo "OK · AAB signing cert matches the pinned upload key."
  exit 0
fi
echo "FAIL · AAB signing cert does NOT match the pinned upload key." >&2
exit 4
