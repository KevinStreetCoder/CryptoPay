# KMS Setup Runbook

Cpay envelope-encrypts the BIP-39 wallet seed and every hot-wallet
private key under an AWS KMS Customer Master Key (CMK). When KMS is
off, those blobs decrypt from `SECRET_KEY` via PBKDF2 — which means a
single `SECRET_KEY` leak decrypts every wallet. **Production must run
with `KMS_ENABLED=True`.** The production-settings guard refuses to
boot otherwise.

This runbook walks an operator through the one-time setup. Allow
about 20 minutes.

## What you'll have at the end

- A symmetric AWS KMS key in the `af-south-1` (Cape Town) region with
  annual rotation enabled.
- An alias `alias/cpay-prod-wallet` so app config can stay stable
  through key rotations.
- A dedicated IAM user `cpay-kms-prod` with the minimum permissions
  needed to envelope-encrypt: `Encrypt`, `Decrypt`, `GenerateDataKey`,
  `DescribeKey` — scoped to that one key.
- Access keys for the IAM user, set as `AWS_ACCESS_KEY_ID` and
  `AWS_SECRET_ACCESS_KEY` on the production host.
- An encrypted wallet seed (`WALLET_ENCRYPTED_SEED`) and one encrypted
  blob per hot-wallet chain (`TRON_HOT_WALLET_ENCRYPTED`,
  `ETH_HOT_WALLET_ENCRYPTED`, etc.).
- Every plaintext wallet env var removed from the production host.

## Prerequisites

1. An AWS account with billing enabled. KMS is roughly **\$1/key/month
   plus \$0.03 per 10,000 API calls** — Cpay's traffic profile sits
   well under \$5/month.
2. The `aws` CLI installed locally and configured with an admin
   profile in the same account where you want the KMS key:
   ```
   aws sts get-caller-identity
   ```
3. The current Cpay backend checked out and dependencies installed.

## Step 1 · Provision the AWS resources

From the repo root, run:

```bash
bash scripts/setup-aws-kms.sh
```

The script is idempotent · running it twice is safe and re-uses any
key/alias/IAM user that already exists. It prints, at the end, a block
of env vars to copy into your production secrets store:

```
KMS_ENABLED=True
KMS_KEY_ID=alias/cpay-prod-wallet
KMS_REGION=af-south-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

If the host already has an attached IAM role (EC2 instance profile,
ECS task role, EKS pod identity), the access-key pair is unnecessary
and you can omit it · attach the inline policy printed by the script
to the role instead.

## Step 2 · Encrypt the wallet seed

On the production host (or any machine that has your current
`WALLET_MNEMONIC` / `WALLET_MASTER_SEED`):

```bash
python manage.py encrypt_wallet_seed --verify
```

This:

1. Reads the plaintext seed from `WALLET_MASTER_SEED` (preferred) or
   falls back to `WALLET_MNEMONIC`.
2. Calls KMS `GenerateDataKey` to mint a fresh 256-bit data
   encryption key (DEK).
3. Uses the DEK to AES-256-GCM encrypt the seed locally, then asks
   KMS to encrypt the DEK itself.
4. Packages the encrypted DEK + IV + ciphertext into a JSON envelope,
   base64-encodes it, and prints the result.
5. Decrypts the result back to bytes and asserts it matches the
   original seed (the `--verify` flag).

Copy the printed `WALLET_ENCRYPTED_SEED=<blob>` line into your
secrets manager.

## Step 3 · Encrypt each hot-wallet private key

For every chain that has a plaintext `*_HOT_WALLET_PRIVATE_KEY` set:

```bash
python manage.py encrypt_hot_wallet_key --chain tron --verify
python manage.py encrypt_hot_wallet_key --chain eth  --verify
python manage.py encrypt_hot_wallet_key --chain sol  --verify
# btc and polygon if you have them
```

Each command reads the plaintext from the matching env var, encrypts
under KMS, prints `<CHAIN>_HOT_WALLET_ENCRYPTED=<blob>`. Add each line
to your secrets manager.

If you'd rather not put the plaintext key in an env var even briefly
(reasonable position), you can pass it directly:

```bash
python manage.py encrypt_hot_wallet_key --chain tron --key 0xabc... --verify
```

The CLI flag form does land in your shell history · clear it
afterwards (`history -d $(history 1 | awk '{print $1}')` for bash).

## Step 4 · Remove the plaintext values

After Steps 2 and 3, the production host should have BOTH the
plaintext and encrypted versions of every secret. That is intentional
overlap during deployment. Once you confirm the new env loaded and the
service started cleanly, **delete the plaintext entries**:

- `WALLET_MNEMONIC`
- `WALLET_MASTER_SEED`
- `TRON_HOT_WALLET_PRIVATE_KEY`
- `ETH_HOT_WALLET_PRIVATE_KEY`
- `POLYGON_HOT_WALLET_PRIVATE_KEY`
- `SOL_HOT_WALLET_PRIVATE_KEY`
- `BTC_HOT_WALLET_PRIVATE_KEY`

Restart the services. The `secure_keys.py` loader will refuse
plaintext keys when `KMS_ENABLED=True` and `DEBUG=False`.

## Step 5 · Verify the live setup

Run the health check on the production container:

```bash
python manage.py kms_health --verbose
python manage.py kms_health --check-blob WALLET_ENCRYPTED_SEED
python manage.py kms_health --check-blob TRON_HOT_WALLET_ENCRYPTED
```

A clean run prints `KMS healthy · provider=AWSKMSManager round-trip OK`
and exits 0. Anything else is a deploy bug · do not proceed until it
clears. Add the first form to your deploy hook so a misconfigured
release fails before traffic shifts.

## Step 6 · Lock in the requirement

Once you've confirmed everything works, set:

```
REQUIRE_PROD_ENV_STRICT=True
```

This flips every production-settings warning into a hard `boot
refused` error. From this point on, any future deploy that drops
`KMS_ENABLED` or removes the encrypted seed will crashloop instead of
silently regressing to the SECRET_KEY-derived fallback.

## Rotation cadence

- **Annual** · KMS will rotate the underlying key material
  automatically because the script enables `EnableKeyRotation`. Cpay
  doesn't have to do anything · the alias keeps pointing at the same
  logical key, the previous DEK ciphertexts stay valid (KMS keeps the
  old key versions internally for decryption).
- **Quarterly** · rotate the IAM access keys via the AWS console
  (`IAM → Users → cpay-kms-prod → Security credentials → Create
  access key`). Two keys can be active simultaneously, which lets you
  update the env, restart, then disable + delete the old key.
- **On suspicion of compromise** · run the full Step 1–4 cycle with a
  fresh KMS key alias (`alias/cpay-prod-wallet-v2`), re-encrypt every
  blob under it, swap the env vars, then disable the old KMS key
  (don't delete · disabling preserves the audit trail).

## Cost monitoring

In the AWS console, set a CloudWatch alarm on `kms:Decrypt` calls per
hour · a sustained spike implies either a runaway service that's
not caching the seed, or hostile activity. The default
`KMS_SEED_CACHE_TTL=300` in `base.py` means the seed is decrypted at
most once every 5 minutes per process; a healthy busy host should sit
well below 100 calls/hour.

## Disaster recovery

If you lose access to the KMS key (account compromise, region
outage, deleted-by-mistake), every encrypted blob becomes useless.
Before that happens:

1. Generate a fresh BIP-39 mnemonic offline.
2. Sweep every hot wallet to a fresh cold address you control via a
   separately-stored seed.
3. Rotate the service to the new mnemonic via the standard Step 2.

That sequence requires the original mnemonic, so keep an offline,
geographically-separated paper copy of the BIP-39 phrase in a sealed
envelope. The point of KMS is to keep that phrase off the runtime
host, not to be the only copy in existence.
