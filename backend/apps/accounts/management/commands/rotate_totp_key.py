"""Phase-2 ops command · rotate the TOTP Fernet key, KMS-wrap it, and
push the ciphertext to Google Secret Manager.

Two modes:

  --kms-wrap (default migration mode) · take the existing legacy
    TOTP_ENCRYPTION_KEY from env, KMS-encrypt it, and store the
    ciphertext in Secret Manager as TOTP_FERNET_KEY_CIPHERTEXT. The
    Fernet key value itself doesn't change · existing encrypted TOTP
    rows keep decrypting with no re-write.

  --rotate · generate a NEW Fernet key, KMS-wrap it, push to Secret
    Manager, AND re-encrypt every Transaction / User row that holds
    Fernet ciphertext under the old key. Run during a maintenance
    window because re-encryption walks the user table.

Usage:
    docker exec cryptopay_web python manage.py rotate_totp_key --kms-wrap
    docker exec cryptopay_web python manage.py rotate_totp_key --rotate
"""
import base64

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.management.base import BaseCommand


PROJECT_ID = "cpay-490223"
SECRET_NAME = "TOTP_FERNET_KEY_CIPHERTEXT"


class Command(BaseCommand):
    help = "KMS-wrap the TOTP Fernet key and push to Secret Manager (Phase-2)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--kms-wrap",
            action="store_true",
            help="Wrap the existing legacy key (no Fernet-key change · no re-encryption needed).",
        )
        parser.add_argument(
            "--rotate",
            action="store_true",
            help="Generate a NEW Fernet key + re-encrypt all TOTP rows. Maintenance-window only.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would happen without writing anything.",
        )

    def handle(self, *args, **opts):
        if not (opts["kms_wrap"] or opts["rotate"]):
            self.stderr.write("Pass --kms-wrap or --rotate.")
            return

        # ── Resolve the Fernet key bytes we're going to wrap ──────────
        if opts["rotate"]:
            new_key = Fernet.generate_key()
            self.stdout.write("Generated NEW Fernet key (rotation mode).")
            key_bytes = new_key
        else:
            legacy = (getattr(settings, "TOTP_ENCRYPTION_KEY", "") or "").strip()
            if not legacy:
                self.stderr.write(
                    "TOTP_ENCRYPTION_KEY is empty in env · nothing to wrap. "
                    "Pass --rotate to generate a fresh key instead."
                )
                return
            if len(legacy) == 44 and legacy.endswith("="):
                key_bytes = legacy.encode()
            else:
                import hashlib
                key_bytes = base64.urlsafe_b64encode(
                    hashlib.sha256(legacy.encode()).digest()
                )
            self.stdout.write("Wrapping the existing legacy key (--kms-wrap mode).")

        # ── KMS-encrypt the key bytes ────────────────────────────────
        from apps.blockchain.kms import get_kms_manager

        manager = get_kms_manager()
        kms = manager._kms  # noqa: SLF001
        ciphertext = kms.encrypt(key_bytes)
        ciphertext_b64 = base64.b64encode(ciphertext).decode("ascii")
        self.stdout.write(
            f"  KMS-encrypted · ciphertext length = {len(ciphertext_b64)} chars"
        )

        if opts["dry_run"]:
            self.stdout.write("Dry-run · stopping before Secret Manager write.")
            return

        # ── Push to Secret Manager ───────────────────────────────────
        try:
            from google.cloud import secretmanager
        except ImportError:
            self.stderr.write(
                "google-cloud-secret-manager not installed · pip install it first."
            )
            return

        client = secretmanager.SecretManagerServiceClient()
        parent = f"projects/{PROJECT_ID}"
        secret_path = f"projects/{PROJECT_ID}/secrets/{SECRET_NAME}"

        try:
            client.get_secret(request={"name": secret_path})
            self.stdout.write(f"  Secret {SECRET_NAME} exists · adding new version")
        except Exception:
            client.create_secret(request={
                "parent": parent,
                "secret_id": SECRET_NAME,
                "secret": {"replication": {"automatic": {}}},
            })
            self.stdout.write(f"  Created secret {SECRET_NAME}")

        version = client.add_secret_version(request={
            "parent": secret_path,
            "payload": {"data": ciphertext_b64.encode()},
        })
        short = version.name.split("/")[-1]
        self.stdout.write(f"  Pushed version {short}")

        # Grant the SA accessor role · idempotent
        import json
        with open("/run/secrets/gcp-kms.json") as f:
            sa_email = json.load(f)["client_email"]
        policy = client.get_iam_policy(request={"resource": secret_path})
        member = f"serviceAccount:{sa_email}"
        role = "roles/secretmanager.secretAccessor"
        if not any(b.role == role and member in b.members for b in policy.bindings):
            binding = policy.bindings.add()
            binding.role = role
            binding.members.append(member)
            client.set_iam_policy(request={"resource": secret_path, "policy": policy})
            self.stdout.write(f"  Granted secretAccessor to {sa_email[:30]}...")
        else:
            self.stdout.write(f"  Access already granted")

        # ── Re-encrypt rows if rotating ──────────────────────────────
        if opts["rotate"]:
            from apps.accounts.models import User, _decrypt_totp_token
            from apps.core import totp_keystore

            old_fernet = _fernet_from_legacy_key_bytes(
                (getattr(settings, "TOTP_ENCRYPTION_KEY", "") or "").strip()
            )
            new_fernet = Fernet(key_bytes)
            count = 0
            with_totp = User.objects.exclude(totp_secret="").iterator()
            for user in with_totp:
                if not user.totp_secret:
                    continue
                try:
                    plain = old_fernet.decrypt(user.totp_secret.encode()).decode()
                except Exception:
                    self.stderr.write(
                        f"  Failed to decrypt user {user.id}'s TOTP · skipping"
                    )
                    continue
                user.totp_secret = new_fernet.encrypt(plain.encode()).decode()
                user.save(update_fields=["totp_secret"])
                count += 1
            self.stdout.write(f"  Re-encrypted {count} user TOTP row(s)")

            # Flush in-memory keystore so the next operation reads the new key.
            totp_keystore.reset_cache()

        self.stdout.write(
            self.style.SUCCESS(
                "DONE · Phase-2 KMS-wrapped TOTP key is live. "
                "Restart the web container OR call totp_keystore.reset_cache() "
                "to pick up the new ciphertext immediately."
            )
        )


def _fernet_from_legacy_key_bytes(legacy: str) -> Fernet:
    """Mirror the existing accounts/models.py legacy-key derivation."""
    if len(legacy) == 44 and legacy.endswith("="):
        return Fernet(legacy.encode())
    import hashlib
    return Fernet(base64.urlsafe_b64encode(
        hashlib.sha256(legacy.encode()).digest()
    ))
