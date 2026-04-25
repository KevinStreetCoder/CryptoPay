#!/usr/bin/env bash
# setup-aws-kms.sh
#
# One-shot provisioning script that creates the AWS resources Cpay needs
# for production-grade KMS envelope encryption.
#
# Creates:
#   1. A symmetric KMS Customer Master Key with annual rotation enabled.
#   2. An alias so application code can refer to alias/cpay-prod-wallet
#      instead of the raw key ARN (which lets you rotate the underlying key
#      without changing app config).
#   3. A dedicated IAM user (cpay-kms-prod) with the minimum permissions
#      required to envelope-encrypt: GenerateDataKey, Decrypt, Encrypt,
#      DescribeKey · scoped to this single key only.
#   4. A pair of access keys for the IAM user, printed at the end.
#
# Required: aws CLI installed and configured with an admin profile in
# the SAME account where you want the KMS key to live.
#
# Run from any directory:
#   bash scripts/setup-aws-kms.sh
#
# Tweak the vars below if you want a non-default region, alias, or IAM
# user name. The default region (af-south-1, Cape Town) is the closest
# AWS region to Kenya.

set -euo pipefail

# ────── CONFIG · edit these once before running ──────
AWS_REGION="${AWS_REGION:-af-south-1}"
KEY_ALIAS="${KEY_ALIAS:-alias/cpay-prod-wallet}"
IAM_USER="${IAM_USER:-cpay-kms-prod}"
KEY_DESCRIPTION="${KEY_DESCRIPTION:-Cpay production wallet seed + hot-wallet key envelope encryption}"
TAGS_KEY="Project"
TAGS_VALUE="cpay"
# ─────────────────────────────────────────────────────

# Sanity checks · fail fast if the host isn't ready.
command -v aws >/dev/null 2>&1 || {
  echo "Error: aws CLI not installed." >&2
  echo "  Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" >&2
  exit 1
}

aws sts get-caller-identity >/dev/null 2>&1 || {
  echo "Error: aws CLI not configured. Run 'aws configure' with an admin profile." >&2
  exit 1
}

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "→ AWS account: ${ACCOUNT_ID}"
echo "→ Region:      ${AWS_REGION}"
echo "→ Key alias:   ${KEY_ALIAS}"
echo "→ IAM user:    ${IAM_USER}"
echo

# ───────── 1) Create the KMS key ─────────
# Skip if an alias already maps to a key in this region.
EXISTING_KEY_ARN="$(aws kms describe-key \
  --region "${AWS_REGION}" \
  --key-id "${KEY_ALIAS}" \
  --query 'KeyMetadata.Arn' \
  --output text 2>/dev/null || true)"

if [ -n "${EXISTING_KEY_ARN}" ] && [ "${EXISTING_KEY_ARN}" != "None" ]; then
  echo "→ Key alias already exists, reusing: ${EXISTING_KEY_ARN}"
  KEY_ARN="${EXISTING_KEY_ARN}"
else
  echo "→ Creating KMS key…"
  KEY_ARN="$(aws kms create-key \
    --region "${AWS_REGION}" \
    --description "${KEY_DESCRIPTION}" \
    --key-usage ENCRYPT_DECRYPT \
    --customer-master-key-spec SYMMETRIC_DEFAULT \
    --tags TagKey="${TAGS_KEY}",TagValue="${TAGS_VALUE}" \
    --query 'KeyMetadata.Arn' \
    --output text)"
  echo "  KEY_ARN=${KEY_ARN}"

  echo "→ Enabling annual key rotation…"
  aws kms enable-key-rotation \
    --region "${AWS_REGION}" \
    --key-id "${KEY_ARN}" >/dev/null

  echo "→ Creating key alias ${KEY_ALIAS}…"
  aws kms create-alias \
    --region "${AWS_REGION}" \
    --alias-name "${KEY_ALIAS}" \
    --target-key-id "${KEY_ARN}" >/dev/null
fi
echo

# ───────── 2) Create the IAM user (idempotent) ─────────
if aws iam get-user --user-name "${IAM_USER}" >/dev/null 2>&1; then
  echo "→ IAM user ${IAM_USER} already exists, reusing."
else
  echo "→ Creating IAM user ${IAM_USER}…"
  aws iam create-user \
    --user-name "${IAM_USER}" \
    --tags Key="${TAGS_KEY}",Value="${TAGS_VALUE}" >/dev/null
fi

# ───────── 3) Attach a least-privilege inline policy ─────────
POLICY_NAME="CpayKMSEnvelopeAccess"
POLICY_DOC="$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnvelopeEncryptOps",
      "Effect": "Allow",
      "Action": [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey"
      ],
      "Resource": "${KEY_ARN}"
    }
  ]
}
EOF
)"

echo "→ Attaching inline policy ${POLICY_NAME} to ${IAM_USER}…"
aws iam put-user-policy \
  --user-name "${IAM_USER}" \
  --policy-name "${POLICY_NAME}" \
  --policy-document "${POLICY_DOC}" >/dev/null
echo

# ───────── 4) Issue access keys (only if the user has none) ─────────
EXISTING_KEYS_COUNT="$(aws iam list-access-keys \
  --user-name "${IAM_USER}" \
  --query 'length(AccessKeyMetadata)' \
  --output text)"

if [ "${EXISTING_KEYS_COUNT}" -ge 2 ]; then
  echo "→ ${IAM_USER} already has 2 active access keys (the AWS limit)."
  echo "  Either rotate one out, or pull existing keys from your secret store."
  echo "  Skipping access key issuance."
  AWS_ACCESS_KEY_ID=""
  AWS_SECRET_ACCESS_KEY=""
elif [ "${EXISTING_KEYS_COUNT}" -ge 1 ]; then
  echo "→ ${IAM_USER} already has 1 access key. Issuing a second one for rotation overlap."
  ACCESS_KEY_JSON="$(aws iam create-access-key --user-name "${IAM_USER}")"
  AWS_ACCESS_KEY_ID="$(echo "${ACCESS_KEY_JSON}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKey"]["AccessKeyId"])')"
  AWS_SECRET_ACCESS_KEY="$(echo "${ACCESS_KEY_JSON}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKey"]["SecretAccessKey"])')"
else
  echo "→ Issuing initial access key…"
  ACCESS_KEY_JSON="$(aws iam create-access-key --user-name "${IAM_USER}")"
  AWS_ACCESS_KEY_ID="$(echo "${ACCESS_KEY_JSON}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKey"]["AccessKeyId"])')"
  AWS_SECRET_ACCESS_KEY="$(echo "${ACCESS_KEY_JSON}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKey"]["SecretAccessKey"])')"
fi
echo

# ───────── 5) Print env vars to copy into .env.production ─────────
echo "════════════════════════════════════════════════════════════════════"
echo "  Add these to .env.production (or your secrets manager):"
echo "════════════════════════════════════════════════════════════════════"
echo
echo "KMS_ENABLED=True"
echo "KMS_KEY_ID=${KEY_ALIAS}"
echo "KMS_REGION=${AWS_REGION}"
if [ -n "${AWS_ACCESS_KEY_ID}" ]; then
  echo "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}"
  echo "AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}"
fi
echo
echo "KEY_ARN (informational, not required at runtime since alias points to it):"
echo "  ${KEY_ARN}"
echo "════════════════════════════════════════════════════════════════════"
echo
echo "Next steps:"
echo "  1. Set the env vars above on the production host."
echo "  2. Run:  python manage.py encrypt_wallet_seed --verify"
echo "          → output is your WALLET_ENCRYPTED_SEED."
echo "  3. For each chain that has a hot-wallet key, run:"
echo "          python manage.py encrypt_hot_wallet_key --chain tron --verify"
echo "          python manage.py encrypt_hot_wallet_key --chain eth --verify"
echo "          python manage.py encrypt_hot_wallet_key --chain sol --verify"
echo "  4. Add the resulting *_ENCRYPTED env vars."
echo "  5. REMOVE every plaintext WALLET_MNEMONIC / WALLET_MASTER_SEED /"
echo "     <CHAIN>_HOT_WALLET_PRIVATE_KEY env var from production."
echo "  6. Restart services and run:  python manage.py kms_health --verbose"
echo
