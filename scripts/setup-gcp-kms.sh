#!/usr/bin/env bash
# setup-gcp-kms.sh
#
# One-shot provisioning script that creates the Google Cloud resources
# Cpay needs for production-grade KMS envelope encryption.
#
# Creates:
#   1. A symmetric Cloud KMS CryptoKey with HSM-grade rotation enabled
#      (90 days, the GCP default for symmetric keys).
#   2. A KeyRing to hold it (logical container; key rings live forever).
#   3. A dedicated service account (cpay-kms-prod@…) with the minimum
#      role required: roles/cloudkms.cryptoKeyEncrypterDecrypter scoped
#      to this single key.
#   4. A service-account JSON key file written to ./cpay-kms-prod.json,
#      ready to copy onto the production host as
#      GOOGLE_APPLICATION_CREDENTIALS.
#
# Required: gcloud CLI installed and authenticated to the SAME GCP
# project where you want the KMS key to live.
#
# Run from any directory:
#   bash scripts/setup-gcp-kms.sh
#
# Tweak the vars below if you want a non-default location, ring, key,
# or service-account name. The default location (africa-south1,
# Johannesburg) is the closest GCP region to Kenya.

set -euo pipefail

# ────── CONFIG · edit these once before running ──────
GCP_LOCATION="${GCP_LOCATION:-africa-south1}"
KEY_RING="${KEY_RING:-cpay-prod}"
KEY_NAME="${KEY_NAME:-cpay-prod-wallet}"
SA_NAME="${SA_NAME:-cpay-kms-prod}"
SA_KEY_FILE="${SA_KEY_FILE:-./cpay-kms-prod.json}"
ROTATION_PERIOD="${ROTATION_PERIOD:-7776000s}"  # 90 days · GCP default for symmetric
# ─────────────────────────────────────────────────────

# Sanity checks
command -v gcloud >/dev/null 2>&1 || {
  echo "Error: gcloud CLI not installed." >&2
  echo "  Install: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
}

PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "${PROJECT_ID}" ] || [ "${PROJECT_ID}" = "(unset)" ]; then
  echo "Error: no GCP project selected. Run:" >&2
  echo "  gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
echo "→ GCP project:    ${PROJECT_ID}"
echo "→ Active account: ${ACTIVE_ACCOUNT}"
echo "→ Location:       ${GCP_LOCATION}"
echo "→ Key ring:       ${KEY_RING}"
echo "→ Key name:       ${KEY_NAME}"
echo "→ Service acct:   ${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
echo

# ───────── 1) Enable required APIs (idempotent) ─────────
echo "→ Enabling cloudkms.googleapis.com + iam.googleapis.com…"
gcloud services enable cloudkms.googleapis.com iam.googleapis.com --quiet

# ───────── 2) Create the key ring ─────────
if gcloud kms keyrings describe "${KEY_RING}" --location "${GCP_LOCATION}" >/dev/null 2>&1; then
  echo "→ Key ring ${KEY_RING} already exists, reusing."
else
  echo "→ Creating key ring ${KEY_RING} in ${GCP_LOCATION}…"
  gcloud kms keyrings create "${KEY_RING}" --location "${GCP_LOCATION}"
fi

# ───────── 3) Create the symmetric key (idempotent) ─────────
if gcloud kms keys describe "${KEY_NAME}" \
    --keyring "${KEY_RING}" \
    --location "${GCP_LOCATION}" >/dev/null 2>&1; then
  echo "→ Key ${KEY_NAME} already exists, reusing."
else
  echo "→ Creating symmetric key ${KEY_NAME}…"
  gcloud kms keys create "${KEY_NAME}" \
    --keyring "${KEY_RING}" \
    --location "${GCP_LOCATION}" \
    --purpose encryption \
    --rotation-period "${ROTATION_PERIOD}" \
    --next-rotation-time "$(date -u -d '+90 days' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || python3 -c 'import datetime; print((datetime.datetime.utcnow() + datetime.timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
fi

KEY_RESOURCE="projects/${PROJECT_ID}/locations/${GCP_LOCATION}/keyRings/${KEY_RING}/cryptoKeys/${KEY_NAME}"

# ───────── 4) Create the service account (idempotent) ─────────
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1; then
  echo "→ Service account ${SA_EMAIL} already exists, reusing."
else
  echo "→ Creating service account ${SA_EMAIL}…"
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name "Cpay KMS prod (envelope encrypt/decrypt)"
fi

# ───────── 5) Grant least-privilege role on the key only ─────────
echo "→ Granting roles/cloudkms.cryptoKeyEncrypterDecrypter on ${KEY_NAME}…"
gcloud kms keys add-iam-policy-binding "${KEY_NAME}" \
  --keyring "${KEY_RING}" \
  --location "${GCP_LOCATION}" \
  --member "serviceAccount:${SA_EMAIL}" \
  --role roles/cloudkms.cryptoKeyEncrypterDecrypter \
  --quiet >/dev/null

# ───────── 6) Issue a service-account JSON key (only if missing) ─────────
if [ -f "${SA_KEY_FILE}" ]; then
  echo "→ Service-account key file ${SA_KEY_FILE} already exists, leaving it alone."
  echo "  (Delete the file and re-run this script if you want a fresh key.)"
else
  echo "→ Creating service-account JSON key at ${SA_KEY_FILE}…"
  gcloud iam service-accounts keys create "${SA_KEY_FILE}" \
    --iam-account "${SA_EMAIL}"
  chmod 600 "${SA_KEY_FILE}" 2>/dev/null || true
  echo "  WARNING: this file is the credential. Treat it like a password."
  echo "  Move it to the production host with scp; do NOT commit it to git."
fi

# ───────── 7) Print the env block for .env.production ─────────
echo
echo "════════════════════════════════════════════════════════════════════"
echo "  Add these to .env.production (or your secrets manager):"
echo "════════════════════════════════════════════════════════════════════"
echo
echo "KMS_ENABLED=True"
echo "KMS_PROVIDER=gcp"
echo "KMS_KEY_RESOURCE=${KEY_RESOURCE}"
echo "GOOGLE_APPLICATION_CREDENTIALS=/path/to/cpay-kms-prod.json"
echo
echo "════════════════════════════════════════════════════════════════════"
echo
echo "Next steps:"
echo "  1. Copy ${SA_KEY_FILE} onto the production host (e.g. /etc/cpay/),"
echo "     chown it to the runtime user, chmod 400, and point"
echo "     GOOGLE_APPLICATION_CREDENTIALS at it."
echo "  2. Set the env vars above on the production host."
echo "  3. Run:  python manage.py encrypt_wallet_seed --verify"
echo "          → output is your WALLET_ENCRYPTED_SEED."
echo "  4. For each chain that has a hot-wallet key, run:"
echo "          python manage.py encrypt_hot_wallet_key --chain tron --verify"
echo "          python manage.py encrypt_hot_wallet_key --chain eth  --verify"
echo "          python manage.py encrypt_hot_wallet_key --chain sol  --verify"
echo "  5. Add the resulting *_ENCRYPTED env vars."
echo "  6. REMOVE every plaintext WALLET_MNEMONIC / WALLET_MASTER_SEED /"
echo "     <CHAIN>_HOT_WALLET_PRIVATE_KEY env var from production."
echo "  7. Restart services and run:  python manage.py kms_health --verbose"
echo
