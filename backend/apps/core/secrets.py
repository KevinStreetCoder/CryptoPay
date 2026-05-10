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
  - **Self-disable on hard auth failure** · 2026-05-10. When the SA
    JSON file is missing / IAM is revoked / the project doesn't have
    Secret Manager API enabled, every fetch hits the same hard wall.
    Logging WARNING per secret per `manage.py` invocation produced
    log spam · 7 Phase-1 secrets × N callers × N CLI runs. We now
    detect hard auth failures (DefaultCredentialsError, RefreshError,
    Forbidden, NotFound on the project) and flip a process-level
    `_runtime_disabled` flag · subsequent fetches skip the SM client
    entirely and log NOTHING. One INFO line on first failure tells
    ops "running env-only this process". Clear via `reset_runtime_state()`
    after fixing creds.
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

# 2026-05-10 · process-level latch · once we hit a hard auth failure
# (creds file missing, SA revoked, API disabled) we stop calling the
# SM client for the lifetime of this process. Avoids the per-secret,
# per-invocation log spam we were seeing in prod (one
# `secret_manager.fetch_failed` line per `manage.py` command, 10 of
# them per `inspect_tx` run · all redundant since the underlying
# DefaultCredentialsError is the same on every call).
_runtime_disabled: bool = False
_runtime_disable_reason: str = ""

# Hard-auth-failure exception class NAMES · we match by class name
# rather than importing the GCP exception types (`google.api_core.exceptions`)
# to keep this module importable when the google-cloud library isn't
# installed (CI / local dev without the optional dep). These mean
# "no SA in scope · don't bother retrying":
#   DefaultCredentialsError · the SA JSON file isn't where ADC can
#                              find it (most common · this is the bug
#                              we shipped today's fix for)
#   RefreshError            · the cached credential failed to refresh
#                              (rotated out of band, revoked)
#   PermissionDenied        · IAM has the SA but the secretmanager.viewer
#                              role isn't bound (configuration drift)
#   Forbidden               · alias of PermissionDenied via google-api-core
# Per-secret NotFound is INTENTIONALLY excluded · it's the expected
# state for secrets we haven't migrated to SM yet, and we want the env
# fallback to stay invisible (no log spam).
_HARD_AUTH_FAIL_NAMES = frozenset({
    "DefaultCredentialsError",
    "RefreshError",
    "PermissionDenied",
    "Forbidden",
})


def _disabled() -> bool:
    """Return True when Secret Manager is intentionally turned off.

    We disable it (forcing env-only) when:
      - `GOOGLE_CLOUD_PROJECT` is unset (local dev / CI)
      - `DISABLE_SECRET_MANAGER=True` is set (operator escape hatch
        for the case where the SA key got revoked and we need to
        ship a fix that boots from env-only)
      - We've already hit a hard auth failure in this process (latched
        via `_runtime_disabled`).
    """
    if not _PROJECT_ID:
        return True
    if os.environ.get("DISABLE_SECRET_MANAGER", "").lower() in {"1", "true", "yes"}:
        return True
    if _runtime_disabled:
        return True
    return False


def _latch_runtime_disable(error: BaseException) -> None:
    """Mark Secret Manager unusable for the rest of this process.

    Logs ONCE at INFO level so ops sees that we've fallen back to env
    without burying the signal in 7×N WARNING lines. The reason string
    is also exposed on `get_managed_secret_status()` for the admin
    /health endpoint.
    """
    global _runtime_disabled, _runtime_disable_reason
    if _runtime_disabled:
        return
    _runtime_disabled = True
    _runtime_disable_reason = f"{type(error).__name__}: {str(error)[:200]}"
    logger.info(
        "secret_manager.runtime_disabled · falling back to env for the rest of "
        "this process · reason=%s",
        _runtime_disable_reason,
    )


def reset_runtime_state() -> None:
    """Clear the runtime-disable latch + cache.

    Use after fixing the SA credentials in prod (e.g. mounting the JSON
    file the container expected) so the next call probes Secret Manager
    again instead of staying latched in env-only mode for the rest of
    the process.
    """
    global _runtime_disabled, _runtime_disable_reason
    _runtime_disabled = False
    _runtime_disable_reason = ""
    _fetch_from_gcp.cache_clear()


@lru_cache(maxsize=64)
def _fetch_from_gcp(name: str, version: str) -> Optional[str]:
    """Fetch a secret from Google Secret Manager. Cached for process
    lifetime; clear via `clear_secret_cache()`.

    Returns None on any failure so the caller can fall back to env.

    Hard auth failures (creds file missing, SA revoked, IAM denied)
    flip the process-level latch via `_latch_runtime_disable` so we
    stop retrying. Per-secret NotFound is silent (env fallback is
    the design while migration is in progress). Other unexpected
    exceptions log at debug level so ops can find them without log
    spam.
    """
    if _runtime_disabled:
        # Belt-and-braces · _disabled() already short-circuited the
        # caller, but if someone calls _fetch_from_gcp directly (e.g.
        # the diagnostic helper) honour the latch.
        return None

    try:
        from google.cloud import secretmanager
    except ImportError:
        # Library not installed · log ONCE and latch.
        if not _runtime_disabled:
            logger.info(
                "secret_manager.runtime_disabled · "
                "google-cloud-secret-manager not installed · using env fallback"
            )
            globals()["_runtime_disabled"] = True
            globals()["_runtime_disable_reason"] = "ImportError: google-cloud-secret-manager"
        return None

    try:
        client = secretmanager.SecretManagerServiceClient()
        path = f"projects/{_PROJECT_ID}/secrets/{name}/versions/{version}"
        response = client.access_secret_version(request={"name": path})
        return response.payload.data.decode("utf-8")
    except Exception as e:
        err_name = type(e).__name__
        if err_name in _HARD_AUTH_FAIL_NAMES:
            # No SA available / IAM not bound · stop calling SM for
            # the rest of this process.
            _latch_runtime_disable(e)
            return None
        if err_name == "NotFound":
            # Per-secret 404 · expected during the env→SM migration.
            # Silent fallback to env.
            return None
        # Anything else · transient (network blip, quota, server
        # error). Debug-level so it's discoverable but not spammy.
        # If we're seeing these in volume, ops can flip the log
        # level to WARNING via Django's LOGGING config.
        logger.debug(
            "secret_manager.fetch_failed",
            extra={"secret_name": name, "version": version, "error": err_name},
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
    migration progress at a glance.

    `runtime_disabled` is True after a hard auth failure has latched
    Secret Manager off for this process · `runtime_disable_reason`
    carries the originating exception so ops doesn't have to dig
    through logs to find out WHY SM stopped working."""
    out = {
        "project": _PROJECT_ID,
        "disabled": _disabled(),
        "runtime_disabled": _runtime_disabled,
        "runtime_disable_reason": _runtime_disable_reason,
        "secrets": {},
    }
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
