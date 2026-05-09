# Cloud audit sink runbook · KMS + Secret Manager access alerts

**Status (2026-05-09):** Pub/Sub topic + log sink + IAM binding **live**.
Cloud Function alerter source written; **deploy is gated on a Slack incoming-
webhook URL** (one-time operator action).

This runbook documents what's already deployed, what's pending, and the
steps to finish wiring it up.

## What's live

| Resource | Name | State |
|---|---|---|
| Pub/Sub topic | `projects/cpay-490223/topics/security-audit` | created |
| Logging sink | `kms-audit-sink` | created |
| IAM binding | `service-797403635202@gcp-sa-logging.iam.gserviceaccount.com` → `roles/pubsub.publisher` on the topic | granted |
| Cloud Function source | `infrastructure/audit-alerter/` | written, NOT deployed |

The sink filters to:
```
resource.type=("cloudkms.googleapis.com/CryptoKey" OR "secretmanager.googleapis.com/Secret")
  AND (protoPayload.methodName=~"Decrypt|AccessSecretVersion")
```

So every Decrypt / AsymmetricDecrypt / AccessSecretVersion call against
any CryptoKey or Secret in `cpay-490223` lands as a Pub/Sub message
within ~1 minute of the event.

## What's pending

### 1 · Create a Slack incoming webhook (5 min, operator)

1. Open `https://api.slack.com/apps` → Create New App → From scratch
2. Name: `Cpay Audit Alerter`
3. Workspace: your Cpay Slack
4. Features → Incoming Webhooks → Activate
5. Add New Webhook to Workspace → pick `#ops-alerts`
6. Copy the webhook URL (starts `https://hooks.slack.com/services/T.../B.../...`)
7. Save the URL to your password manager · DO NOT commit to git

### 2 · Deploy the Cloud Function

```bash
cd infrastructure/audit-alerter

# Pull the webhook URL from your password manager into this shell
SLACK_URL="<paste from password manager>"

# Set the allow-list of expected service-account principals.
# Anyone OUTSIDE this list triggers a HIGH-priority alert.
ALLOWED="cpay-kms-prod@cpay-490223.iam.gserviceaccount.com"
ALLOWED="$ALLOWED,cpay-app-prod@cpay-490223.iam.gserviceaccount.com"

gcloud functions deploy audit-alerter \
    --gen2 --region=europe-west1 --runtime=python312 \
    --source=. --entry-point=on_audit_event \
    --trigger-topic=security-audit \
    --set-env-vars="SLACK_WEBHOOK_URL=$SLACK_URL,ALLOWED_SAS=$ALLOWED" \
    --project=cpay-490223 \
    --no-allow-unauthenticated
```

### 3 · Smoke-test

Trigger a known-good Decrypt call and confirm Slack receives the audit
trail message:

```bash
gcloud kms encrypt \
    --location=global --keyring=cpay-prod \
    --key=totp-fernet-kek \
    --plaintext-file=<(echo -n "smoke-test") \
    --ciphertext-file=/tmp/sm.bin \
    --project=cpay-490223

# wait ~60 seconds, check Slack #ops-alerts for an :lock: INFO message
```

Then trigger a NEGATIVE test (run a Decrypt as your personal user
account · should generate a HIGH alert):

```bash
gcloud kms decrypt \
    --location=global --keyring=cpay-prod \
    --key=totp-fernet-kek \
    --ciphertext-file=/tmp/sm.bin \
    --plaintext-file=/tmp/sm.txt \
    --project=cpay-490223
```

Slack should ping with:
```
:lock: *HIGH* · Non-service-account principal accessed sensitive key/secret
caller   kevinisaackareithi@gmail.com
method   Decrypt
resource ...
```

If both messages arrive, the alerter is live.

## Maintenance

### Adding a new service account to the allow-list

When a new SA is provisioned that legitimately needs Decrypt access:

```bash
# Re-deploy with the updated allow-list
gcloud functions deploy audit-alerter --gen2 --region=europe-west1 \
    --update-env-vars="ALLOWED_SAS=<comma-separated-list>" \
    --project=cpay-490223
```

### Rotating the Slack webhook

If the webhook leaks or rotates:

```bash
gcloud functions deploy audit-alerter --gen2 --region=europe-west1 \
    --update-env-vars="SLACK_WEBHOOK_URL=<new-url>" \
    --project=cpay-490223
```

### Tightening the filter

If the alert volume is too noisy, tighten the sink filter. The current
filter catches every Decrypt; you can scope to specific resources:

```bash
gcloud logging sinks update kms-audit-sink \
    --log-filter='resource.type=("cloudkms.googleapis.com/CryptoKey")
                  AND protoPayload.methodName=~"Decrypt"
                  AND resource.labels.key_name=~"totp|fernet|kek"' \
    --project=cpay-490223
```

### Pausing alerts (e.g. during a planned maintenance burst)

```bash
gcloud functions deploy audit-alerter --gen2 --region=europe-west1 \
    --update-env-vars="SLACK_WEBHOOK_URL=" \
    --project=cpay-490223

# Re-enable later by re-deploying with the URL set.
```

## Cost

- Pub/Sub topic: free for first 10 GB/month — we'll be in the 10s of MB
- Logging sink: free
- Cloud Function: free for first 2M invocations/month — we'll be in the
  hundreds at most
- Net: $0/month at our current scale

## Decommissioning

If we ever need to remove the sink (e.g. moving to a different audit
target), the order is:
1. `gcloud functions delete audit-alerter --project=cpay-490223`
2. `gcloud logging sinks delete kms-audit-sink --project=cpay-490223`
3. `gcloud pubsub topics delete security-audit --project=cpay-490223`
4. Revoke the IAM binding (auto-removed when topic is deleted)
