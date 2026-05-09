"""Coinbase OAuth 2.0 client · per-user link, balance read, send.

Coinbase has a proper OAuth 2.0 implementation with refresh tokens
(~10-year lifetime per their docs). The flow:

  1. Mobile client opens authorize URL
       https://www.coinbase.com/oauth/authorize?client_id=...&...
  2. User signs in to Coinbase + grants scopes (wallet:user:read,
     wallet:accounts:read, wallet:transactions:send)
  3. Coinbase redirects to our deep link with `code` + `state`
  4. We POST to `/oauth/token` with grant_type=authorization_code
     to exchange the code for `access_token` + `refresh_token`
  5. Both are persisted on the ExchangeLink (Fernet-encrypted)

For each subsequent action we use the access_token (cached); when
it expires (default 2 hours), we refresh transparently with the
refresh token. If the user revokes via the Coinbase UI, our calls
start failing with 401 invalid_grant · we mark the link revoked.

Required env / settings:
    COINBASE_OAUTH_CLIENT_ID       · from Coinbase Developer Platform
    COINBASE_OAUTH_CLIENT_SECRET   · from same
    EXCHANGE_OAUTH_REDIRECT_BASE   · default https://cpay.co.ke

Reference: https://docs.cdp.coinbase.com/coinbase-app/docs/api-overview
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


COINBASE_AUTH_URL = "https://www.coinbase.com/oauth/authorize"
COINBASE_TOKEN_URL = "https://api.coinbase.com/oauth/token"
COINBASE_REVOKE_URL = "https://api.coinbase.com/oauth/revoke"
COINBASE_API_BASE = "https://api.coinbase.com"

DEFAULT_SCOPES = [
    "wallet:user:read",
    "wallet:accounts:read",
    "wallet:transactions:send",
]

DEFAULT_TIMEOUT = 15


class CoinbaseError(Exception):
    """Wrapping all Coinbase API failures · gives the caller a stable
    `code` + `message` pair for user-visible errors."""

    def __init__(self, code: str, message: str, http_status: int = 0):
        self.code = code
        self.message = message
        self.http_status = http_status
        super().__init__(f"coinbase[{code}]: {message}")


# ─────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────


def _client_id() -> str:
    cid = getattr(settings, "COINBASE_OAUTH_CLIENT_ID", "") or ""
    if not cid:
        raise CoinbaseError(
            "not_configured",
            "COINBASE_OAUTH_CLIENT_ID is not set. Provision the OAuth "
            "app at https://www.coinbase.com/oauth/applications and "
            "paste client_id + client_secret into .env.production.",
        )
    return cid


def _client_secret() -> str:
    s = getattr(settings, "COINBASE_OAUTH_CLIENT_SECRET", "") or ""
    if not s:
        raise CoinbaseError(
            "not_configured",
            "COINBASE_OAUTH_CLIENT_SECRET is not set.",
        )
    return s


def _redirect_uri(scheme: str = "web") -> str:
    """Pick the right redirect URI based on the client.

    `scheme="web"`  → https://cpay.co.ke/api/v1/exchanges/coinbase/oauth/callback/
    `scheme="app"`  → cryptopay://oauth/coinbase
    """
    base = getattr(
        settings, "EXCHANGE_OAUTH_REDIRECT_BASE", "https://cpay.co.ke",
    ).rstrip("/")
    if scheme == "app":
        return "cryptopay://oauth/coinbase"
    return f"{base}/api/v1/exchanges/coinbase/oauth/callback/"


def is_configured() -> bool:
    """True if the OAuth app credentials are set. Caller can use this
    to hide the 'Link Coinbase' button when the operator hasn't
    provisioned the app yet."""
    return bool(
        getattr(settings, "COINBASE_OAUTH_CLIENT_ID", "")
        and getattr(settings, "COINBASE_OAUTH_CLIENT_SECRET", "")
    )


# ─────────────────────────────────────────────────────────────────
# OAuth flow
# ─────────────────────────────────────────────────────────────────


def build_authorize_url(state: str, scheme: str = "app") -> str:
    """Build the Coinbase authorize URL the user is redirected to.

    `state` MUST be a CSRF-resistant random token that the caller
    persists (e.g. in Redis with a 10-minute TTL keyed on user_id) so
    the callback can verify the response wasn't forged.
    """
    params = {
        "response_type": "code",
        "client_id": _client_id(),
        "redirect_uri": _redirect_uri(scheme),
        "scope": ",".join(DEFAULT_SCOPES),
        "state": state,
        # Long-lived refresh token · without this Coinbase issues a
        # short-lived offline_access-equivalent that we'd need to
        # refresh hourly.
        "account": "all",
    }
    return f"{COINBASE_AUTH_URL}?{urlencode(params)}"


def mint_state(prefix: str = "cb") -> str:
    """CSRF-resistant state token. 32 url-safe bytes. Caller persists
    in Redis with a short TTL."""
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def exchange_code(code: str, scheme: str = "app") -> dict:
    """Exchange the authorize-code for an access + refresh token pair.

    Returns:
        {
            "access_token": str,
            "refresh_token": str,
            "expires_in": int (seconds),
            "scope": str,
            "token_type": "Bearer",
        }
    """
    body = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": _client_id(),
        "client_secret": _client_secret(),
        "redirect_uri": _redirect_uri(scheme),
    }
    return _post_token(body)


def refresh_token(rt: str) -> dict:
    """Trade a refresh token for a fresh access + refresh pair. Coinbase
    rotates the refresh token on every refresh, so the caller MUST
    persist the NEW refresh_token returned."""
    body = {
        "grant_type": "refresh_token",
        "client_id": _client_id(),
        "client_secret": _client_secret(),
        "refresh_token": rt,
    }
    return _post_token(body)


def revoke(access_or_refresh: str) -> None:
    """Revoke the token upstream. Best-effort · we don't fail if the
    token is already invalid (idempotent)."""
    try:
        resp = requests.post(
            COINBASE_REVOKE_URL,
            data={"token": access_or_refresh},
            timeout=DEFAULT_TIMEOUT,
        )
        if resp.status_code >= 500:
            logger.warning(
                "coinbase.revoke_upstream_5xx status=%s", resp.status_code,
            )
    except requests.RequestException as e:
        logger.info("coinbase.revoke_network_error err=%s", str(e)[:120])


def _post_token(body: dict) -> dict:
    try:
        resp = requests.post(
            COINBASE_TOKEN_URL, data=body, timeout=DEFAULT_TIMEOUT,
        )
    except requests.RequestException as e:
        raise CoinbaseError("network", str(e), 0)
    j = {}
    try:
        j = resp.json()
    except ValueError:
        pass
    if resp.status_code >= 400:
        raise CoinbaseError(
            j.get("error", str(resp.status_code)),
            j.get("error_description") or resp.text[:200],
            resp.status_code,
        )
    return j


# ─────────────────────────────────────────────────────────────────
# Authenticated API calls
# ─────────────────────────────────────────────────────────────────


def _api_get(access_token: str, path: str, params: Optional[dict] = None) -> dict:
    url = COINBASE_API_BASE + path
    headers = {
        "Authorization": f"Bearer {access_token}",
        "CB-VERSION": "2024-04-10",
    }
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=DEFAULT_TIMEOUT)
    except requests.RequestException as e:
        raise CoinbaseError("network", str(e), 0)
    j = {}
    try:
        j = resp.json()
    except ValueError:
        pass
    if resp.status_code == 401:
        raise CoinbaseError("token_expired", "Access token expired", 401)
    if resp.status_code >= 400:
        err = j.get("errors", [{}])[0] if isinstance(j, dict) else {}
        raise CoinbaseError(
            err.get("id", str(resp.status_code)),
            err.get("message") or resp.text[:200],
            resp.status_code,
        )
    return j


def _api_post(access_token: str, path: str, payload: dict) -> dict:
    url = COINBASE_API_BASE + path
    headers = {
        "Authorization": f"Bearer {access_token}",
        "CB-VERSION": "2024-04-10",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=DEFAULT_TIMEOUT)
    except requests.RequestException as e:
        raise CoinbaseError("network", str(e), 0)
    j = {}
    try:
        j = resp.json()
    except ValueError:
        pass
    if resp.status_code == 401:
        raise CoinbaseError("token_expired", "Access token expired", 401)
    if resp.status_code >= 400:
        err = j.get("errors", [{}])[0] if isinstance(j, dict) else {}
        raise CoinbaseError(
            err.get("id", str(resp.status_code)),
            err.get("message") or resp.text[:200],
            resp.status_code,
        )
    return j


def get_accounts(access_token: str) -> list[dict]:
    """List the user's wallets/accounts on Coinbase. Each entry has
    a `balance.amount` + `balance.currency`. Filters to non-zero."""
    j = _api_get(access_token, "/v2/accounts")
    out = []
    for a in (j.get("data") or []):
        bal = a.get("balance") or {}
        amt = Decimal(str(bal.get("amount", "0")))
        if amt > 0:
            out.append(
                {
                    "id": a.get("id"),
                    "name": a.get("name"),
                    "currency": bal.get("currency"),
                    "amount": amt,
                    "type": a.get("type"),
                }
            )
    return out


def get_balances(access_token: str) -> dict:
    """Convenience wrapper · returns {currency: amount} for all
    non-zero accounts. Same shape as binance.get_balances() but
    Coinbase aggregates per-currency rather than free/locked."""
    out: dict[str, Decimal] = {}
    for a in get_accounts(access_token):
        cur = a["currency"]
        out[cur] = out.get(cur, Decimal("0")) + a["amount"]
    return out


def send_to_external(
    access_token: str,
    account_id: str,
    destination_address: str,
    amount: Decimal,
    currency: str,
    idempotency_key: str,
    description: str = "Cpay deposit",
) -> dict:
    """Send crypto from a Coinbase wallet to an external address.

    Args:
        account_id · the Coinbase account UUID for the source wallet
        destination_address · Cpay's per-user deposit address on the
            same chain as the source currency
        amount · Decimal in `currency` units
        idempotency_key · UUID4 client-supplied key for dedup ·
            Coinbase respects this so a network retry won't double-send
        description · free-text annotation on the transaction

    Returns the Coinbase transaction record:
        {
            "id": "...",
            "status": "pending" | "completed" | ...,
            "amount": {"amount": "...", "currency": "USDT"},
            "network": {"hash": "...", "status": "..."},
            ...
        }
    """
    payload = {
        "type": "send",
        "to": destination_address,
        "amount": str(amount),
        "currency": currency,
        "description": description[:200],
        "idem": idempotency_key,
        "skip_notifications": True,
    }
    return _api_post(
        access_token,
        f"/v2/accounts/{account_id}/transactions",
        payload,
    )


def get_transaction(access_token: str, account_id: str, tx_id: str) -> dict:
    """Poll a previously-sent transaction by ID."""
    return _api_get(
        access_token,
        f"/v2/accounts/{account_id}/transactions/{tx_id}",
    )


# ─────────────────────────────────────────────────────────────────
# Status mapping · Coinbase strings → Cpay enum
# ─────────────────────────────────────────────────────────────────


COINBASE_STATUS = {
    "pending":   "pending",
    "completed": "done",
    "failed":    "failed",
    "expired":   "failed",
    "canceled":  "failed",
    "waiting_for_clearing": "confirming",
    "waiting_for_signature": "pending",
}


def map_coinbase_status(s: str) -> str:
    return COINBASE_STATUS.get((s or "").lower(), "pending")


# ─────────────────────────────────────────────────────────────────
# Token-aware wrapper · picks the right access_token, refreshes
# transparently, persists refreshed tokens back onto the link.
# ─────────────────────────────────────────────────────────────────


def access_token_for(link) -> str:
    """Return a valid access_token for `link`, refreshing if expired.

    Persists the (potentially rotated) refresh_token + new access_token
    back onto the ExchangeLink so subsequent calls don't refresh again.

    2026-05-09 audit fix H5 · the previous implementation had a race
    where two concurrent withdraw / status-poll requests both observed
    an expired access_token, both called `refresh_token()` on Coinbase
    (which ROTATES refresh tokens), and the second `save()` overwrote
    the first thread's already-stored `refresh_token`. The losing
    thread persists a STALE refresh_token · subsequent calls 401 with
    `invalid_grant` and the link is bricked. Fix · wrap the refresh
    in a `select_for_update` row lock inside an atomic block so only
    one thread can refresh at a time; the second thread re-reads the
    row after acquiring and uses the now-fresh token.
    """
    from django.db import transaction
    from .models import ExchangeLink as _ELink

    now = timezone.now()
    expires_at = link.access_token_expires_at
    if (
        link.access_token
        and expires_at
        and expires_at - now > timedelta(seconds=60)
    ):
        return link.access_token

    if not link.refresh_token:
        raise CoinbaseError(
            "no_refresh_token",
            "Link has no refresh token · user must re-authorize.",
        )

    with transaction.atomic():
        # Re-read the row with row-level lock · concurrent callers
        # serialize here.
        locked = _ELink.objects.select_for_update().get(pk=link.pk)
        # Did another thread refresh while we waited for the lock?
        if (
            locked.access_token
            and locked.access_token_expires_at
            and locked.access_token_expires_at - timezone.now() > timedelta(seconds=60)
        ):
            # Yes · just sync the in-memory `link` and return.
            link.access_token = locked.access_token
            link.refresh_token = locked.refresh_token
            link.access_token_expires_at = locked.access_token_expires_at
            return link.access_token

        # Still expired · do the refresh ourselves.
        fresh = refresh_token(locked.refresh_token)
        locked.access_token = fresh["access_token"]
        locked.refresh_token = fresh.get("refresh_token", locked.refresh_token)
        expires_in = int(fresh.get("expires_in", 7200))
        locked.access_token_expires_at = timezone.now() + timedelta(seconds=expires_in - 30)
        locked.last_used_at = timezone.now()
        locked.save(update_fields=[
            "access_token", "refresh_token",
            "access_token_expires_at", "last_used_at",
        ])
        # Sync caller's in-memory `link` so subsequent attribute
        # access reflects the new tokens.
        link.access_token = locked.access_token
        link.refresh_token = locked.refresh_token
        link.access_token_expires_at = locked.access_token_expires_at
        link.last_used_at = locked.last_used_at
        return link.access_token
