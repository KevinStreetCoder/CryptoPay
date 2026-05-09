"""Cloud Function · alert on suspicious KMS / Secret Manager access.

Triggered by Pub/Sub topic `security-audit` (populated by the
`kms-audit-sink` logging sink). For each event we inspect the caller
identity and decrypt context · if it's a non-service-account caller
or an unexpected service account, post a high-priority Slack alert.

Deploy:
    gcloud functions deploy audit-alerter \\
        --gen2 --region=europe-west1 --runtime=python312 \\
        --source=. --entry-point=on_audit_event \\
        --trigger-topic=security-audit \\
        --set-env-vars=SLACK_WEBHOOK_URL=$SLACK_WEBHOOK_URL,\\
ALLOWED_SAS=cpay-kms-prod@cpay-490223.iam.gserviceaccount.com,cpay-app-prod@cpay-490223.iam.gserviceaccount.com \\
        --project=cpay-490223 --no-allow-unauthenticated

Environment:
    SLACK_WEBHOOK_URL  · required · the incoming-webhook URL for #ops-alerts
    ALLOWED_SAS        · optional · comma-separated list of expected SA
                          principals. Caller identities NOT in this list
                          fire a HIGH-priority alert; identities in the
                          list fire a LOW-priority audit-trail message
                          only on Decrypt of high-value keys.
"""
from __future__ import annotations

import base64
import json
import os
from typing import Any
from urllib import request as urlreq


SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL", "")
ALLOWED_SAS = {
    s.strip()
    for s in os.environ.get("ALLOWED_SAS", "").split(",")
    if s.strip()
}

# Method names that count as "use of the key" · catch both KMS and
# Secret Manager.
SENSITIVE_METHODS = (
    "Decrypt",
    "AsymmetricDecrypt",
    "AccessSecretVersion",
)

# Keys whose use is high-value · alert at WARN even for legitimate SAs.
HIGH_VALUE_KEY_FRAGMENTS = (
    "totp",          # cpay-prod-TOTP_ENCRYPTION_KEY
    "fernet",        # any fernet master
    "kek",           # the KEK that wraps DEKs
    "wallet",        # treasury wallet keys
)


def on_audit_event(event: dict[str, Any], context: Any) -> None:
    """Pub/Sub trigger entry point."""
    if not SLACK_WEBHOOK_URL:
        # No-op when not configured · prevents the function from
        # crash-looping during initial provision.
        print("WARN · SLACK_WEBHOOK_URL not set, dropping event")
        return

    payload = _decode(event)
    if not payload:
        return

    proto = payload.get("protoPayload", {})
    method = proto.get("methodName", "")
    if not any(m in method for m in SENSITIVE_METHODS):
        # Sink filter should have caught this, but belt-and-braces
        return

    caller = proto.get("authenticationInfo", {}).get("principalEmail", "<unknown>")
    resource = proto.get("resourceName", "")
    request_md = proto.get("request", {})
    src_ip = (
        proto.get("requestMetadata", {})
        .get("callerIp", "<unknown>")
    )

    # Classify
    if not caller.endswith(".iam.gserviceaccount.com"):
        # User account or external · always HIGH
        severity = "HIGH"
        reason = "Non-service-account principal accessed sensitive key/secret"
    elif caller not in ALLOWED_SAS:
        severity = "HIGH"
        reason = "Unknown service account accessed sensitive key/secret"
    elif any(f in resource.lower() for f in HIGH_VALUE_KEY_FRAGMENTS):
        severity = "INFO"
        reason = "Allowed SA accessed high-value key (audit trail)"
    else:
        # Allowed SA, normal key · don't alert
        return

    text = (
        f":lock: *{severity}* · {reason}\n"
        f"```\n"
        f"caller   {caller}\n"
        f"method   {method}\n"
        f"resource {resource}\n"
        f"src_ip   {src_ip}\n"
        f"request  {json.dumps(request_md)[:400]}\n"
        f"```"
    )
    _post_slack(text)


def _decode(event: dict[str, Any]) -> dict[str, Any] | None:
    """Decode the Pub/Sub event into the underlying log entry JSON."""
    data_b64 = event.get("data")
    if not data_b64:
        return None
    try:
        raw = base64.b64decode(data_b64).decode("utf-8")
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError) as e:
        print(f"WARN · failed to decode event: {e}")
        return None


def _post_slack(text: str) -> None:
    body = json.dumps({"text": text}).encode("utf-8")
    req = urlreq.Request(
        SLACK_WEBHOOK_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlreq.urlopen(req, timeout=10) as r:
            if r.status >= 400:
                print(f"WARN · slack post returned {r.status}")
    except Exception as e:
        # Don't raise · we don't want a Slack outage to crash-loop the
        # audit alerter (which is a defence layer, not a critical path).
        print(f"WARN · slack post failed: {e}")
