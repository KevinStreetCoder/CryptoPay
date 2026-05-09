"""Noones (formerly Paxful) OAuth 2.0 client.

Noones is fundamentally a P2P marketplace, but the **Wallet API**
gives us non-P2P balance read + external send · the same flow we
need for "user has crypto on Noones, push it to Cpay deposit".

We use **Delegated Access** (OAuth Authorization Code Grant) · the
user signs in on Noones, grants Cpay access, we get a refresh token
that lets us read their wallet + initiate sends to whitelisted
addresses (the user's Cpay deposit address).

Reference: https://developers.noones.com (Wallet API)
"""
from __future__ import annotations

import logging
import secrets
from datetime import timedelta
from decimal import Decimal
from typing import Optional
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.utils import timezone


logger = logging.getLogger(__name__)


# Noones (Paxful) inherits the Paxful OAuth endpoints. The new portal
# at developers.noones.com points at these hosts:
NOONES_AUTH_URL = "https://accounts.noones.com/oauth2/authorize"
NOONES_TOKEN_URL = "https://accounts.noones.com/oauth2/token"
NOONES_REVOKE_URL = "https://accounts.noones.com/oauth2/revoke"
NOONES_API_BASE = "https://api.noones.com"

# Phase 1 scopes · read balance + send to external. Withdraw to
# external addresses (`wallet:withdraw`) is the partner-tier scope ·
# without partner status the request still works for the linker but
# Noones may gate the actual withdraw call. Read scope ALWAYS works.
DEFAULT_SCOPES = [
    "read_balance",
    "read_account",
    "wallet:withdraw",  # falls through gracefully if not granted
]

DEFAULT_TIMEOUT = 15


class NoonesError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 0):
        self.code = code
        self.message = message
        self.http_status = http_status
        super().__init__(f"noones[{code}]: {message}")


def _client_id() -> str:
    cid = getattr(settings, "NOONES_OAUTH_CLIENT_ID", "") or ""
    if not cid:
        raise NoonesError(
            "not_configured",
            "NOONES_OAUTH_CLIENT_ID is not set. Provision the OAuth "
            "app at https://developers.noones.com (Delegated Access).",
        )
    return cid


def _client_secret() -> str:
    s = getattr(settings, "NOONES_OAUTH_CLIENT_SECRET", "") or ""
    if not s:
        raise NoonesError(
            "not_configured", "NOONES_OAUTH_CLIENT_SECRET is not set.",
        )
    return s


def _redirect_uri(scheme: str = "web") -> str:
    base = getattr(
        settings, "EXCHANGE_OAUTH_REDIRECT_BASE", "https://cpay.co.ke",
    ).rstrip("/")
    if scheme == "app":
        return "cryptopay://oauth/noones"
    return f"{base}/api/v1/exchanges/noones/oauth/callback/"


def is_configured() -> bool:
    return bool(
        getattr(settings, "NOONES_OAUTH_CLIENT_ID", "")
        and getattr(settings, "NOONES_OAUTH_CLIENT_SECRET", "")
    )


def mint_state(prefix: str = "no") -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def build_authorize_url(state: str, scheme: str = "app") -> str:
    params = {
        "response_type": "code",
        "client_id": _client_id(),
        "redirect_uri": _redirect_uri(scheme),
        "scope": " ".join(DEFAULT_SCOPES),
        "state": state,
    }
    return f"{NOONES_AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str, scheme: str = "app") -> dict:
    return _post_token({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": _client_id(),
        "client_secret": _client_secret(),
        "redirect_uri": _redirect_uri(scheme),
    })


def refresh_token(rt: str) -> dict:
    return _post_token({
        "grant_type": "refresh_token",
        "client_id": _client_id(),
        "client_secret": _client_secret(),
        "refresh_token": rt,
    })


def revoke(access_or_refresh: str) -> None:
    try:
        requests.post(
            NOONES_REVOKE_URL,
            data={
                "token": access_or_refresh,
                "client_id": _client_id(),
                "client_secret": _client_secret(),
            },
            timeout=DEFAULT_TIMEOUT,
        )
    except requests.RequestException as e:
        logger.info("noones.revoke_network_error err=%s", str(e)[:120])


def _post_token(body: dict) -> dict:
    try:
        resp = requests.post(NOONES_TOKEN_URL, data=body, timeout=DEFAULT_TIMEOUT)
    except requests.RequestException as e:
        raise NoonesError("network", str(e), 0)
    j = {}
    try:
        j = resp.json()
    except ValueError:
        pass
    if resp.status_code >= 400:
        raise NoonesError(
            j.get("error", str(resp.status_code)),
            j.get("error_description") or resp.text[:200],
            resp.status_code,
        )
    return j


# ─────────────────────────────────────────────────────────────────
# Wallet API
# ─────────────────────────────────────────────────────────────────
#
# Noones inherited Paxful's RPC-style API: every endpoint is POST
# with JSON body and a Bearer auth header. Phase 1 needs:
#   - /wallet/balance        · read balances
#   - /wallet/send           · send to external address (partner-tier)
#   - /transaction/list      · poll send status
#
# The endpoint shape is documented in their Wallet API reference;
# we implement the minimum for our flow.


def _api_post(access_token: str, path: str, payload: Optional[dict] = None) -> dict:
    url = NOONES_API_BASE + path
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            url, headers=headers, json=payload or {}, timeout=DEFAULT_TIMEOUT,
        )
    except requests.RequestException as e:
        raise NoonesError("network", str(e), 0)
    j = {}
    try:
        j = resp.json()
    except ValueError:
        pass
    if resp.status_code == 401:
        raise NoonesError("token_expired", "Access token expired", 401)
    if resp.status_code >= 400:
        # Noones error shape: {"status":"error","error":{"code":"...","message":"..."}}
        err = (j.get("error") or {}) if isinstance(j, dict) else {}
        raise NoonesError(
            err.get("code", str(resp.status_code)),
            err.get("message") or resp.text[:200],
            resp.status_code,
        )
    if isinstance(j, dict) and j.get("status") == "error":
        err = j.get("error") or {}
        raise NoonesError(
            err.get("code", "api_error"),
            err.get("message", "Unknown error"),
            resp.status_code,
        )
    # Success shape: {"status":"success","timestamp":...,"data":{...}}
    return (j.get("data") if isinstance(j, dict) else j) or {}


def get_balances(access_token: str) -> dict:
    """Read the user's Noones wallet balances. Returns
        {<crypto>: Decimal(amount), ...}
    Filtered to non-zero balances.
    """
    data = _api_post(access_token, "/wallet/balance")
    out: dict[str, Decimal] = {}
    # Response shape: data.balances = [{"currency":"BTC","balance":"0.123"}, ...]
    for b in (data.get("balances") or []):
        cur = b.get("currency")
        amt = Decimal(str(b.get("balance", "0")))
        if cur and amt > 0:
            out[cur] = amt
    return out


def send_to_external(
    access_token: str,
    currency: str,
    amount: Decimal,
    destination_address: str,
    request_id: str,
    description: str = "Cpay deposit",
) -> dict:
    """Send crypto from the user's Noones wallet to an external address.

    Requires the partner-tier `wallet:withdraw` scope. If the scope
    isn't granted, Noones returns 403 with code='insufficient_scope'.

    Returns Noones' transaction record:
        {"id": "...", "status": "pending", "txhash": "..."}
    """
    payload = {
        "currency": currency,
        "amount": str(amount),
        "address": destination_address,
        "description": description[:200],
        "client_request_id": request_id,
    }
    return _api_post(access_token, "/wallet/send", payload)


def get_transaction(access_token: str, tx_id: str) -> dict:
    """Poll a previously-sent transaction."""
    return _api_post(access_token, "/transaction/get", {"id": tx_id})


# ─────────────────────────────────────────────────────────────────
# Status mapping
# ─────────────────────────────────────────────────────────────────


NOONES_STATUS = {
    "pending":    "pending",
    "processing": "confirming",
    "confirmed":  "confirming",
    "completed":  "done",
    "succeeded":  "done",
    "failed":     "failed",
    "rejected":   "failed",
    "canceled":   "failed",
}


def map_noones_status(s: str) -> str:
    return NOONES_STATUS.get((s or "").lower(), "pending")


# ─────────────────────────────────────────────────────────────────
# Token-aware wrapper · same shape as coinbase.access_token_for
# ─────────────────────────────────────────────────────────────────


def access_token_for(link) -> str:
    now = timezone.now()
    expires_at = link.access_token_expires_at
    if (
        link.access_token
        and expires_at
        and expires_at - now > timedelta(seconds=60)
    ):
        return link.access_token

    if not link.refresh_token:
        raise NoonesError(
            "no_refresh_token",
            "Link has no refresh token · user must re-authorize.",
        )

    fresh = refresh_token(link.refresh_token)
    link.access_token = fresh["access_token"]
    link.refresh_token = fresh.get("refresh_token", link.refresh_token)
    expires_in = int(fresh.get("expires_in", 3600))
    link.access_token_expires_at = now + timedelta(seconds=expires_in - 30)
    link.last_used_at = now
    link.save(update_fields=[
        "access_token", "refresh_token",
        "access_token_expires_at", "last_used_at",
    ])
    return link.access_token
