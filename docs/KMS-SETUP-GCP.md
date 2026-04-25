# KMS Setup Runbook · Google Cloud KMS

Use this runbook when you want to use Google Cloud KMS instead of AWS
KMS for envelope encryption of the wallet seed and hot-wallet private
keys. Functionally equivalent to the AWS path · the on-disk envelope
format is identical, just with a different `provider` discriminator,
so you can switch providers later without re-encrypting payloads under
a fresh seed.

The AWS runbook lives at `docs/KMS-SETUP.md`. Use whichever provider
the operator already has an account with. Cpay supports either at
runtime via `KMS_PROVIDER=aws` / `KMS_PROVIDER=gcp`.

This runbook walks through the one-time setup. About 25 minutes total.

## What you'll have at the end

- A symmetric Cloud KMS CryptoKey in `africa-south1` (Johannesburg, the
  closest GCP region to Kenya) with automatic 90-day rotation enabled.
- A KeyRing `cpay-prod` holding it.
- A dedicated service account `cpay-kms-prod@<project>.iam.gserviceaccount.com`
  with the minimum role: `roles/cloudkms.cryptoKeyEncrypterDecrypter`,
  scoped to that single key.
- A service-account JSON key file on the production host, pointed at
  by `GOOGLE_APPLICATION_CREDENTIALS`.
- Encrypted secrets (`WALLET_ENCRYPTED_SEED`, `<CHAIN>_HOT_WALLET_ENCRYPTED`)
  set on the host, all plaintext variants removed.

## Prerequisites

1. A Google Cloud account. Use any Google account · `kevinisaackareithi@gmail.com`
   or `jimvuetutor@gmail.com` work fine. New accounts get **\$300 of
   free credit** valid for 90 days. After that, KMS for Cpay's traffic
   sits at roughly **\$0.06/key/month plus a few cents in operations**
   · well under \$1/month.
2. The `gcloud` CLI installed locally.
   Install: <https://cloud.google.com/sdk/docs/install>
3. The current Cpay backend checked out and dependencies installed.

## Step 1 · Create the GCP project

In the Cloud Console (<https://console.cloud.google.com>):

1. Top bar → "Select a project" → "New Project".
2. Project name: `cpay-prod`. The project ID is auto-generated, e.g.
   `cpay-prod-471623`. **Note this ID.**
3. Leave billing under your default account.
4. Wait ~30 seconds for the project to provision.

## Step 2 · Authenticate gcloud locally

In a terminal:

```bash
gcloud auth login
gcloud config set project cpay-prod-471623   # use YOUR project id
gcloud auth list
```

The browser opens, you authenticate with your Google account, and the
project ID gets stored in `~/.config/gcloud/`. Confirm with
`gcloud config get-value project`.

## Step 3 · Provision the KMS resources

From the repo root, run:

```bash
bash scripts/setup-gcp-kms.sh
```

The script enables the necessary APIs, creates the key ring + key,
creates the runtime service account with a least-privilege binding,
and downloads the service-account JSON to `./cpay-kms-prod.json`. It
prints, at the end:

```
KMS_ENABLED=True
KMS_PROVIDER=gcp
KMS_KEY_RESOURCE=projects/cpay-prod-471623/locations/africa-south1/keyRings/cpay-prod/cryptoKeys/cpay-prod-wallet
GOOGLE_APPLICATION_CREDENTIALS=/path/to/cpay-kms-prod.json
```

The script is idempotent · re-running is safe and reuses any existing
ring / key / service account.

## Step 4 · Move the credential file to the production host

The downloaded JSON file IS the credential. Treat it like a password.

```bash
# From your laptop:
scp ./cpay-kms-prod.json root@cpay-vps:/etc/cpay/cpay-kms-prod.json

# On the VPS:
chown www-data:www-data /etc/cpay/cpay-kms-prod.json
chmod 400 /etc/cpay/cpay-kms-prod.json
```

Then add to `.env.production`:

```
KMS_ENABLED=True
KMS_PROVIDER=gcp
KMS_KEY_RESOURCE=projects/cpay-prod-471623/locations/africa-south1/keyRings/cpay-prod/cryptoKeys/cpay-prod-wallet
GOOGLE_APPLICATION_CREDENTIALS=/etc/cpay/cpay-kms-prod.json
```

**Delete the local copy** of the JSON once it's on the host:

```bash
rm ./cpay-kms-prod.json
```

If you later need a fresh key (suspected compromise, key rotation),
re-run the provisioning script · it'll see the existing service account
and just issue a new key (GCP allows up to 10 active keys per service
account).

## Step 5 · Encrypt the wallet seed

On the production host:

```bash
python manage.py encrypt_wallet_seed --verify
```

This reads the plaintext seed from `WALLET_MASTER_SEED` (preferred) or
falls back to `WALLET_MNEMONIC`, calls GCP KMS to encrypt a fresh
data key, AES-256-GCM encrypts the seed locally, and prints the
envelope blob. Copy the printed `WALLET_ENCRYPTED_SEED=<blob>` into
your secrets store.

## Step 6 · Encrypt each hot-wallet private key

```bash
python manage.py encrypt_hot_wallet_key --chain tron --verify
python manage.py encrypt_hot_wallet_key --chain eth  --verify
python manage.py encrypt_hot_wallet_key --chain sol  --verify
# btc / polygon if you have them
```

Add each printed `<CHAIN>_HOT_WALLET_ENCRYPTED=<blob>` to your
secrets store.

## Step 7 · Remove plaintext variants

After Steps 5 and 6, the host should hold both plaintext and
encrypted versions of every secret · intentional overlap during
deployment. Once the new env loads cleanly and the service starts,
delete the plaintext entries:

- `WALLET_MNEMONIC`
- `WALLET_MASTER_SEED`
- `TRON_HOT_WALLET_PRIVATE_KEY`
- `ETH_HOT_WALLET_PRIVATE_KEY`
- `POLYGON_HOT_WALLET_PRIVATE_KEY`
- `SOL_HOT_WALLET_PRIVATE_KEY`
- `BTC_HOT_WALLET_PRIVATE_KEY`

Restart the services. The `secure_keys.py` loader refuses plaintext
keys when `KMS_ENABLED=True` and `DEBUG=False`.

## Step 8 · Verify the live setup

```bash
python manage.py kms_health --verbose
python manage.py kms_health --check-blob WALLET_ENCRYPTED_SEED
python manage.py kms_health --check-blob TRON_HOT_WALLET_ENCRYPTED
```

A clean run prints `KMS healthy · provider=GCPKMSManager round-trip OK`
and exits 0. Anything else means something's misconfigured · do not
proceed until it clears. Wire the first form into your deploy hook so
a misconfigured release fails before traffic shifts.

## Step 9 · Lock in the requirement

Once everything works, set:

```
REQUIRE_PROD_ENV_STRICT=True
```

on the production host. Now any future deploy that drops `KMS_ENABLED`
or breaks the credential file will refuse to boot instead of
silently falling back to the SECRET_KEY-derived encryption.

## Rotation cadence

- **90 days** · GCP rotates the underlying key material automatically
  (the script set `--rotation-period 7776000s`). Existing ciphertexts
  stay valid · GCP keeps the old key versions internally for decryption.
- **Quarterly** · rotate the service-account JSON via the Cloud
  Console (`IAM & Admin → Service Accounts → cpay-kms-prod → Keys`).
  Up to 10 active keys are allowed, so you can update the host then
  delete the old one.
- **On suspicion of compromise** · provision a fresh key alias
  (`cpay-prod-wallet-v2`) under the same key ring, re-encrypt every
  blob under it via the management commands, swap the env vars, then
  *disable* (don't delete) the old key to preserve audit trail.

## Cost monitoring

- Enable the Cloud KMS metric `request_count`. Cpay's healthy steady
  state is well under 100 calls/hour (the seed cache TTL is 5 minutes
  per process).
- Alert on `request_count > 1000/hour` · indicates either a runaway
  service that's not caching, or hostile activity.

## Disaster recovery

If you lose access to the GCP project (account suspended, region
outage, credential file destroyed), every encrypted blob becomes
useless. Mitigations:

1. Keep an offline, paper copy of the original BIP-39 mnemonic in a
   sealed envelope, stored separately from the production host. The
   point of KMS is to keep that phrase off the runtime host, not to
   be the only copy.
2. Set up a second service-account key file (rotation slot) so a
   single corrupted file isn't fatal.
3. Optionally, replicate the same encrypted blobs to a second region
   (`europe-west4`, etc.) by creating a second key ring there. GCP
   doesn't replicate Cloud KMS keys cross-region by default.
