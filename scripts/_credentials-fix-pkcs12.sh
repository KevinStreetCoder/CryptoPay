#!/bin/bash
# Align keyPassword := keystorePassword in mobile/credentials.json.
# The keystore is PKCS12, which mandates the two passwords match (the
# Java KeyStore engine prints a "Different store and key passwords not
# supported for PKCS12 KeyStores. Ignoring user-specified -keypass
# value" warning when they don't · gradle's AGP signing step is less
# forgiving and throws "Get Key failed: Given final block not properly
# padded" instead of falling back gracefully).
#
# This script edits credentials.json in-place; passwords are never
# printed. Run inside WSL or git-bash.
set -e
cd /mnt/c/Users/Street\ Coder/StartupsIdeas/CryptoPay/mobile

python3 - <<'PY'
import json, pathlib

p = pathlib.Path('credentials.json')
data = json.loads(p.read_text())

ks = data['android']['keystore']
store_pw = ks.get('keystorePassword', '')
key_pw   = ks.get('keyPassword', '')

if not store_pw:
    raise SystemExit("ERROR · keystorePassword missing.")

if store_pw == key_pw:
    print("ALREADY ALIGNED · keystorePassword == keyPassword. No-op.")
else:
    print("MISMATCH detected · setting keyPassword := keystorePassword "
          "(PKCS12 requires equality).")
    ks['keyPassword'] = store_pw
    p.write_text(json.dumps(data, indent=2) + "\n")
    print("wrote credentials.json")
PY

# Sanity · ensure the file still parses and lists 1 entry under both
# passwords (which now match).
python3 - <<'PY'
import json
c = json.load(open('credentials.json'))['android']['keystore']
assert c['keystorePassword'] == c['keyPassword'], "passwords still differ"
print("OK · passwords aligned")
PY
