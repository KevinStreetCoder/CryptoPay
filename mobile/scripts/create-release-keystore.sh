#!/bin/bash
# Generate a stable Cpay release keystore once · subsequent EAS local
# builds use this keystore so installed APKs upgrade in-place across
# version codes (Android refuses to install over an existing app with
# a different signature).
#
# Run this ONCE on the WSL machine that builds APKs:
#   bash mobile/scripts/create-release-keystore.sh
#
# Outputs · mobile/credentials/cpay-release.keystore + a credentials.json
# stub that points eas.json's local builds at the keystore. The
# keystore + its passwords are GITIGNORED · they live only on the
# build machine.
#
# IMPORTANT · keep a backup of the generated keystore + its passwords.
# Losing them means you can NEVER ship an upgrade to existing users
# without making them uninstall first. Recommended · copy the
# generated files to a 1Password / Bitwarden vault entry the moment
# this script finishes.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
MOBILE_DIR="$( dirname "$SCRIPT_DIR" )"
CREDS_DIR="$MOBILE_DIR/credentials"
KEYSTORE_PATH="$CREDS_DIR/cpay-release.keystore"
CREDS_JSON="$MOBILE_DIR/credentials.json"

mkdir -p "$CREDS_DIR"

if [ -f "$KEYSTORE_PATH" ]; then
    echo "[!] Keystore already exists at $KEYSTORE_PATH"
    echo "    Aborting to avoid overwriting · delete the file manually if you really want to regenerate."
    exit 2
fi

# Generate fresh passwords. We use openssl for high-entropy randomness;
# the keystore + key passwords are different per the keytool best practice.
KEYSTORE_PASSWORD="$(openssl rand -hex 24)"
KEY_PASSWORD="$(openssl rand -hex 24)"
KEY_ALIAS="cpay"

echo "[+] Generating keystore at $KEYSTORE_PATH ..."
keytool -genkeypair \
    -v \
    -keystore "$KEYSTORE_PATH" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 4096 \
    -validity 10000 \
    -storepass "$KEYSTORE_PASSWORD" \
    -keypass "$KEY_PASSWORD" \
    -dname "CN=Cpay Technologies, OU=Mobile, O=Cpay Kenya Ltd, L=Nairobi, ST=Nairobi, C=KE" \
    > /dev/null 2>&1

echo "[+] Keystore created · 4096-bit RSA, 10000-day validity"

# Write credentials.json that EAS local builds read.
cat > "$CREDS_JSON" <<JSON
{
  "android": {
    "keystore": {
      "keystorePath": "credentials/cpay-release.keystore",
      "keystorePassword": "$KEYSTORE_PASSWORD",
      "keyAlias": "$KEY_ALIAS",
      "keyPassword": "$KEY_PASSWORD"
    }
  }
}
JSON

chmod 600 "$KEYSTORE_PATH" "$CREDS_JSON"

echo "[+] credentials.json written at $CREDS_JSON (mode 600)"
echo ""
echo "═══ BACK UP THESE VALUES NOW ═══════════════════════════════════"
echo "Keystore file · $KEYSTORE_PATH"
echo "Keystore password · $KEYSTORE_PASSWORD"
echo "Key alias · $KEY_ALIAS"
echo "Key password · $KEY_PASSWORD"
echo ""
echo "SHA-1 fingerprint (use for Google Play / FCM / OAuth registration):"
keytool -list -v -keystore "$KEYSTORE_PATH" -alias "$KEY_ALIAS" -storepass "$KEYSTORE_PASSWORD" 2>/dev/null | grep -E "SHA1|SHA-256" | head -2
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Next · re-run mobile/_wsl_build_apk.sh · the new APK will be"
echo "signed with this keystore and every future build will share the"
echo "same fingerprint, so installs upgrade in-place."
