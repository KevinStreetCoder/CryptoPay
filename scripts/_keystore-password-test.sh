#!/bin/bash
# Verify the keystore + key passwords in mobile/credentials.json can
# actually unlock the alias 'cpay'. Run inside WSL.
set -e
cd /mnt/c/Users/Street\ Coder/StartupsIdeas/CryptoPay/mobile

KS_PASS=$(python3 -c "import json; print(json.load(open('credentials.json'))['android']['keystore']['keystorePassword'])")
KEY_PASS=$(python3 -c "import json; print(json.load(open('credentials.json'))['android']['keystore']['keyPassword'])")
KEY_ALIAS=$(python3 -c "import json; print(json.load(open('credentials.json'))['android']['keystore']['keyAlias'])")

echo "alias from json: $KEY_ALIAS"
echo
echo "=== 1. list keystore with storepass (should show 1 entry) ==="
keytool -list -keystore credentials/cpay-release.keystore -storepass "$KS_PASS" 2>&1 | head -8 || true

echo
echo "=== 2. verbose list of the specific alias (this is the gradle check) ==="
keytool -list -v -keystore credentials/cpay-release.keystore \
        -alias "$KEY_ALIAS" \
        -storepass "$KS_PASS" \
        -keypass  "$KEY_PASS" 2>&1 | head -10 || true

echo
echo "=== 3. try the keypass equal to the keystore pass (PKCS12 default) ==="
keytool -list -v -keystore credentials/cpay-release.keystore \
        -alias "$KEY_ALIAS" \
        -storepass "$KS_PASS" \
        -keypass  "$KS_PASS" 2>&1 | head -10 || true
