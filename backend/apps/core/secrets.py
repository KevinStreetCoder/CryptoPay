"""Centralised secret retrieval with Google Secret Manager + env fallback.

Phase 1 of the KMS-coverage uplift (audit 2026-05-09 · 20% → 85%).

The previous architecture kept every payment-rail callback HMAC + OAuth
secret in `.env.production` (mode 600 on the VPS). That's fine until:
  - A misconfigured sidecar mounts the file
  - A backup ends up in object storage with looser ACLs
  - A privileged-container escape leaks the file
  - The file gets pasted into a chat / pull-request / Sentry breadcrumb

Google Secret Manager fixes all four · the secret never sits on the VPS
filesystem; access is IAM-gated, revocable, audit-logged on every read,
and rotation is one click in the GCP console.

Design choices:
  - **Lazy + cached** · `@lru_cache` on the helper means each secret
    is fetched once per process lifetime. No per-request latency.
  - **Env fallback** · if `GOOGLE_CLOUD_PROJECT` is unset OR Secret
    Manager throws (network blip, IAM revoke, project mismatch), fall
    back to `os.environ[NAME]`. Zero-downtime migration · we can move
    secrets into Secret Manager one at a time.
  - **Refresh on signal** · `clear_secret_cache()` flushes the
    lru_cache so a SIGHUP-style reload picks up rotated values without
    a container restart. Wire into a Celery beat task if/when we
    automate rotation.
  - **No raw secret in logs** · the helper never log-prints a value;
    only the secret NAME (so you can grep "secret_manager.fetch" to
    see access patterns without leaking the value).
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)

# Project ID from env · matches the GCP project where the cpay-prod
# key ring lives (cpay-490223). Set to "" to disable Secret Manager
# entirely and force env-fallback (useful for local dev / CI).
_PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()

# Optional override for the version selector. "latest" is fine for
# normal rotation; pin to "5" etc. for canary rollouts.
_DEFAULT_VERSION = os.environ.get("GCP_SECRET_VERSION", "latest")


def _disabled() -> bool:
    """Return True when Secret Manager is intentionally turned off.

    We disable it (forcing env-only) when:
      - `GOOGLE_CLOUD_PROJECT` is unset (local dev / CI)
      - `DISABLE_SECRET_MANAGER=True` is set (operator escape hatch
        for the case where the SA key got revoked and we need to
        ship a fix that boots from env-only)
    """
    if not _PROJECT_ID:
        return True
    if os.environ.get("DISABLE_SECRET_MANAGER", "").lower() in {"1", "true", "yes"}:
        return True
    return False


@lru_cache(maxsize=64)
def _fetch_from_gcp(name: str, version: str) -> Optional[str]:
    """Fetch a secret from Google Secret Manager. Cached for process
    lifetime; clear via `clear_secret_cache()`.

    Returns None on any failure so the caller can fall back to env.
    Logs the failure so ops can see whether SM is the bottleneck.
    """
    try:
        from google.cloud import secretmanager
    except ImportError:
        logger.warning(
            "secret_manager.import_failed · `pip install google-cloud-secret-manager`"
        )
        return None

    try:
        client = secretmanager.SecretManagerServiceClient()
        path = f"projects/{_PROJECT_ID}/secrets/{name}/versions/{version}"
        response = client.access_secret_version(request={"name": path})
        return response.payload.data.decode("utf-8")
    except Exception as e:
        # Catch-all · IAM denied, network, project mismatch, secret
        # not found. We don't distinguish · ops checks the log, the
        # caller falls through to env.
        logger.warning(
            "secret_manager.fetch_failed",
            extra={"secret_name": name, "version": version, "error": type(e).__name__},
        )
        return None


def get_secret(name: str, default: Optional[str] = None, version: Optional[str] = None) -> str:
    """Retrieve a secret value, preferring Secret Manager over env.

    Lookup order:
      1. Google Secret Manager at projects/<PROJECT>/secrets/<name>
         (skipped if Secret Manager is disabled)
      2. `os.environ[name]`
      3. The `default` argument (or "" if not given)

    A typical call from settings.py:

        SASAPAY_CLIENT_SECRET = get_secret("SASAPAY_CLIENT_SECRET")

    For one-off cold-path lookups (cron jobs, migrations) prefer the
    direct call · `_fetch_from_gcp` is private to discourage cache-
    bypassing patterns from app code.
    """
    if not _disabled():
        gcp_value = _fetch_from_gcp(name, version or _DEFAULT_VERSION)
        if gcp_value is not None:
            logger.debug("secret_manager.hit", extra={"secret_name": name})
            return gcp_value

    env_value = os.environ.get(name)
    if env_value is not None:
        return env_value

    return default if default is not None else ""


def clear_secret_cache() -> None:
    """Flush the in-memory lru_cache so the next get_secret() re-
    fetches from Secret Manager. Wire to a Celery beat task or a
    SIGHUP handler if you want auto-pickup of rotated values without
    a container restart."""
    _fetch_from_gcp.cache_clear()


# ── Secret-name registry · the 7 callback/OAuth keys we want to
# migrate into Secret Manager in Phase 1. Centralised here so a
# single grep tells ops which secrets are managed where.
PHASE_1_SECRETS = (
    "MPESA_CALLBACK_HMAC_KEY",
    "SASAPAY_CALLBACK_HMAC_KEY",
    "SASAPAY_WEBHOOK_SECRET",
    "SASAPAY_CLIENT_SECRET",
    "INTASEND_API_SECRET",
    "INTASEND_WEBHOOK_SECRET",
    "TOTP_ENCRYPTION_KEY",
)


def get_managed_secret_status() -> dict:
    """Diagnostic helper · for each Phase-1 secret, report whether
    it's currently being served from Secret Manager or env. Used
    by the admin /admin/health endpoint so ops can confirm the
    migration progress at a glance."""
    out = {"project": _PROJECT_ID, "disabled": _disabled(), "secrets": {}}
    for name in PHASE_1_SECRETS:
        if _disabled():
            source = "env" if os.environ.get(name) else "missing"
        else:
            gcp_value = _fetch_from_gcp(name, _DEFAULT_VERSION)
            if gcp_value is not None:
                source = "secret_manager"
            elif os.environ.get(name):
                source = "env_fallback"
            else:
                source = "missing"
        out["secrets"][name] = source
    return out
