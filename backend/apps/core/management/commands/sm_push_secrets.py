"""Push the Phase-1 secrets currently in environment variables into
Google Secret Manager, and grant the platform's service account
read access. Idempotent · safe to re-run.

Usage (one-shot, on the VPS):
    docker exec cryptopay_web python manage.py sm_push_secrets

Lists every secret it touched + which version was created. Skips
secrets that are empty in env (won't push a blank).
"""
import json
import os

from django.core.management.base import BaseCommand

PROJECT_ID = "cpay-490223"

# The 7 Phase-1 secrets · same list as apps/core/secrets.PHASE_1_SECRETS
SECRETS = [
    "MPESA_CALLBACK_HMAC_KEY",
    "SASAPAY_CALLBACK_HMAC_KEY",
    "SASAPAY_WEBHOOK_SECRET",
    "SASAPAY_CLIENT_SECRET",
    "INTASEND_API_SECRET",
    "INTASEND_WEBHOOK_SECRET",
    "TOTP_ENCRYPTION_KEY",
]


class Command(BaseCommand):
    help = "Push Phase-1 secrets from env into Google Secret Manager"

    def handle(self, *args, **kwargs):
        try:
            from google.cloud import secretmanager
        except ImportError:
            self.stderr.write(
                "google-cloud-secret-manager not installed in this container. "
                "pip install google-cloud-secret-manager==2.24.0"
            )
            return

        # Read SA email from the mounted KMS JSON · same SA does both KMS
        # and Secret Manager (one identity, two products).
        try:
            with open("/run/secrets/gcp-kms.json") as f:
                sa_email = json.load(f)["client_email"]
        except Exception as e:
            self.stderr.write(f"Could not read /run/secrets/gcp-kms.json: {e}")
            return

        self.stdout.write(f"service account: {sa_email}")
        self.stdout.write(f"project:         {PROJECT_ID}")
        self.stdout.write("")

        client = secretmanager.SecretManagerServiceClient()
        parent = f"projects/{PROJECT_ID}"
        created_count = 0
        version_count = 0

        for name in SECRETS:
            val = os.environ.get(name, "")
            if not val:
                self.stdout.write(f"  - {name}: empty in env · skipped")
                continue

            secret_path = f"projects/{PROJECT_ID}/secrets/{name}"

            # Create-or-noop the secret
            try:
                client.get_secret(request={"name": secret_path})
                action = "exists"
            except Exception:
                client.create_secret(request={
                    "parent": parent,
                    "secret_id": name,
                    "secret": {"replication": {"automatic": {}}},
                })
                created_count += 1
                action = "created"

            # Push a new version with the current env value
            version = client.add_secret_version(request={
                "parent": secret_path,
                "payload": {"data": val.encode()},
            })
            short = version.name.split("/")[-1]
            version_count += 1
            self.stdout.write(
                f"  + {name}: {action} · version {short} (len={len(val)})"
            )

            # Grant the SA accessor role · idempotent
            policy = client.get_iam_policy(request={"resource": secret_path})
            member = f"serviceAccount:{sa_email}"
            role = "roles/secretmanager.secretAccessor"
            found = any(
                b.role == role and member in b.members for b in policy.bindings
            )
            if not found:
                binding = policy.bindings.add()
                binding.role = role
                binding.members.append(member)
                client.set_iam_policy(request={
                    "resource": secret_path,
                    "policy": policy,
                })
                self.stdout.write(f"      granted secretAccessor")
            else:
                self.stdout.write(f"      access already granted")

        self.stdout.write("")
        self.stdout.write(
            f"DONE · {created_count} secret(s) created, {version_count} version(s) pushed"
        )
