#!/bin/bash
# Verify the just-built APK is signed with the canonical
# cpay-release.keystore (SHA-1 73:21:C5:...:4E:84:49). Run inside WSL.
set -e

APK="${1:-/root/cpay-apk/cpay-20260516-095437.apk}"
EXPECTED="73:21:C5:C0:91:4D:9B:75:18:AF:31:E2:19:E9:8D:1E:EE:4E:84:49"

echo "=== APK: $APK ==="
ls -la "$APK"
echo

# Find apksigner. Try Android SDK common locations.
APKSIGNER=$(find /root/Android /opt/android-sdk /root/.android $ANDROID_HOME -name apksigner 2>/dev/null -type f | head -1)
if [ -z "$APKSIGNER" ]; then
  # Fall back to bundled jar
  JAR=$(find /root /opt -name "apksigner*.jar" 2>/dev/null | head -1)
  if [ -n "$JAR" ]; then
    APKSIGNER="java -jar $JAR"
  fi
fi
echo "apksigner: $APKSIGNER"
echo

if [ -z "$APKSIGNER" ]; then
  echo "FALLBACK · using openssl on META-INF cert"
  TMPDIR=$(mktemp -d)
  unzip -q -o "$APK" -d "$TMPDIR"
  RSA=$(find "$TMPDIR/META-INF" -name "*.RSA" -o -name "*.DSA" -o -name "*.EC" 2>/dev/null | head -1)
  if [ -n "$RSA" ]; then
    SHA1=$(openssl pkcs7 -inform DER -print_certs -in "$RSA" 2>/dev/null \
           | openssl x509 -fingerprint -sha1 -noout 2>/dev/null \
           | sed 's/^SHA1 Fingerprint=//')
    echo "Cert SHA-1: $SHA1"
    if [ "$SHA1" = "$EXPECTED" ]; then
      echo "OK · matches canonical keystore"
    else
      echo "FAIL · expected $EXPECTED"
      rm -rf "$TMPDIR"
      exit 4
    fi
    openssl pkcs7 -inform DER -print_certs -in "$RSA" 2>/dev/null \
      | openssl x509 -subject -noout
  fi
  rm -rf "$TMPDIR"
else
  echo "=== apksigner verify --print-certs ==="
  $APKSIGNER verify --print-certs "$APK" 2>&1 | grep -iE "SHA-1|DN:" | head -6
  SHA1=$($APKSIGNER verify --print-certs "$APK" 2>&1 | grep -iE "SHA-1 digest" | head -1 | awk '{print $NF}')
  echo
  echo "Detected SHA-1: $SHA1"
  if [ "$SHA1" = "$EXPECTED" ]; then
    echo "OK · matches canonical keystore"
  else
    echo "FAIL · expected $EXPECTED"
    exit 4
  fi
fi
