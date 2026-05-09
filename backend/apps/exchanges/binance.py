"""Binance HMAC-signed REST client for withdraw-only flow.

Binance has no public OAuth, so users link their account by pasting
an API key + secret that they've created on Binance themselves with:
  - "Enable Withdrawals" scope ON
  - "Enable Spot & Margin Trading" + "Enable Reading" scopes OFF
  - IP restriction: Cpay's outbound IP (`CPAY_BINANCE_EGRESS_IP`)
  - Address whitelist: Cpay's per-chain deposit addresses

This client signs every request with HMAC-SHA256 over the query
string + timestamp + recvWindow, per Binance's documented spec.

The key + secret are persisted in `ExchangeLink.api_key` (plain) and
`ExchangeLink.api_secret` (Fernet-encrypted via PIIEncryptedField).
We never echo either back to the client.

Reference docs:
  https://binance-docs.github.io/apidocs/spot/en/#withdraw-user_data
  https://binance-docs.github.io/apidocs/spot/en/#withdraw-history-supporting-network-user_data
  https://binance-docs.github.io/apidocs/spot/en/#all-coins-39-information-user_data
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from decimal import Decimal
from typing import Optional
from urllib.parse import urlencode

import requests
from django.conf import settings


logger = logging.getLogger(__name__)


BINANCE_API_BASE = "https://api.binance.com"
DEFAULT_RECV_WINDOW = 5000
DEFAULT_TIMEOUT = 15  # seconds · withdraw is async, so 15 s is generous


# Map of Cpay currency code → (Binance coin, default network code)
# We default to the cheapest withdrawal rail for each asset; if the
# user's Cpay deposit address whitelist doesn't have that network,
# the withdraw call fails fast with a clear error and the caller can
# fall back to another network.
DEFAULT_NETWORKS = {
    "USDT": "TRX",       # TRC-20 · ~$1 fee, ~3 min confirm
    "USDC": "MATIC",     # Polygon · ~$0.01 fee, ~30 s confirm
    "BTC":  "BTC",       # Bitcoin native · ~$2-5 fee, ~30 min confirm
    "ETH":  "ETH",       # ERC-20 · ~$5-15 fee, ~3 min confirm
}


class BinanceError(Exception):
    """Wrapping all Binance API failures so the caller can map to
    user-visible messages without depending on requests.* details."""

    def __init__(self, code: str, message: str, http_status: int = 0):
        self.code = code
        self.message = message
        self.http_status = http_status
        super().__init__(f"binance[{code}]: {message}")


def _sign(params: dict, secret: str) -> str:
    """HMAC-SHA256 of the query string with the API secret."""
    qs = urlencode(params, doseq=True)
    sig = hmac.new(
        secret.encode("utf-8"),
        qs.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return sig


def _signed_get(api_key: str, secret: str, path: str,
                params: Optional[dict] = None,
                timeout: int = DEFAULT_TIMEOUT) -> dict:
    return _signed_request("GET", api_key, secret, path, params, timeout)


def _signed_post(api_key: str, secret: str, path: str,
                 params: Optional[dict] = None,
                 timeout: int = DEFAULT_TIMEOUT) -> dict:
    return _signed_request("POST", api_key, secret, path, params, timeout)


def _signed_request(method: str, api_key: str, secret: str, path: str,
                    params: Optional[dict] = None,
                    timeout: int = DEFAULT_TIMEOUT) -> dict:
    """Sign + dispatch a Binance signed-endpoint call.

    Binance's signed-endpoint protocol:
      - Append `timestamp` (ms) and `recvWindow` to the params
      - HMAC-SHA256 the resulting query string with the API secret
      - Append `signature` to the query string
      - Pass the API key in the `X-MBX-APIKEY` header
    """
    p = dict(params or {})
    p["timestamp"] = int(time.time() * 1000)
    p["recvWindow"] = DEFAULT_RECV_WINDOW
    p["signature"] = _sign(p, secret)

    url = BINANCE_API_BASE + path
    headers = {"X-MBX-APIKEY": api_key}
    try:
        if method == "GET":
            resp = requests.get(url, params=p, headers=headers, timeout=timeout)
        else:
            resp = requests.post(url, params=p, headers=headers, timeout=timeout)
    except requests.RequestException as e:
        logger.warning("binance.network_error path=%s err=%s", path, str(e)[:200])
        raise BinanceError("network", str(e), 0)

    body = {}
    try:
        body = resp.json()
    except ValueError:
        pass

    if resp.status_code >= 400:
        # Binance error shape: {"code": -2014, "msg": "API-key format invalid."}
        code = str(body.get("code", resp.status_code))
        msg = body.get("msg") or resp.text[:200]
        # Don't log the full body · it can include sensitive details
        # (account state). Just the error code + safe truncation.
        logger.warning(
            "binance.api_error path=%s status=%s code=%s",
            path, resp.status_code, code,
        )
        raise BinanceError(code, msg, resp.status_code)

    return body


# ─────────────────────────────────────────────────────────────────
# Public client surface
# ─────────────────────────────────────────────────────────────────


def verify_credentials(api_key: str, secret: str) -> dict:
    """Probe the keys to confirm they're valid AND withdraw-scoped.

    Calls `/sapi/v1/capital/config/getall` which requires the
    "Enable Withdrawals" scope. If the call returns 200, we have
    at minimum withdraw-read permission. We also assert that a
    second call to `/sapi/v1/account` (which requires Spot Trading
    scope) FAILS · that's how we confirm the keys are NOT
    over-privileged.

    Returns:
        {
            "ok": True,
            "scopes": ["withdraw"],
            "supported_coins": [<binance coin codes>],
            "address_whitelist": {<coin>: [<addresses>]},
        }

    Raises BinanceError on any failure.
    """
    # Step 1 · positive scope check (withdraw enabled)
    coins = _signed_get(api_key, secret, "/sapi/v1/capital/config/getall")
    if not isinstance(coins, list):
        raise BinanceError(
            "shape", f"Unexpected getall response type: {type(coins).__name__}"
        )

    supported = []
    address_whitelist: dict[str, list[str]] = {}
    for c in coins:
        coin_code = c.get("coin")
        if not coin_code:
            continue
        if c.get("withdrawAllEnable") or c.get("depositAllEnable"):
            supported.append(coin_code)
        # Each `networkList[i]` doesn't directly expose the user's
        # whitelisted addresses · that's only on a separate
        # `/sapi/v1/capital/withdraw/address/list` endpoint that
        # requires withdraw scope. We fetch that next.

    # Step 2 · pull the user's address whitelist for the major coins
    # we care about. If the user hasn't whitelisted Cpay's deposit
    # address yet, the link verification will WARN but still succeed
    # (the actual withdraw call will fail with a clear
    # "address not in whitelist" error later).
    try:
        addrs = _signed_get(
            api_key, secret, "/sapi/v1/capital/withdraw/address/list"
        )
        for a in addrs or []:
            coin = a.get("coin")
            addr = a.get("address")
            if coin and addr:
                address_whitelist.setdefault(coin, []).append(addr)
    except BinanceError as e:
        # 404 / 400 here means the endpoint doesn't exist on the
        # account's tier · don't fail the link, just log.
        logger.info("binance.address_list_unavailable code=%s", e.code)

    # Step 3 · negative scope check · ensure trading is OFF.
    # `/sapi/v1/account` requires Spot Trading scope · we EXPECT it
    # to fail with -2015 ("Invalid API-key, IP, or permissions for
    # action"). If it succeeds, the keys are over-privileged · refuse.
    #
    # 2026-05-09 audit fix H2 · the previous `except BinanceError as e:
    # if e.code != 'scope_too_wide': pass` accepted ANY error code as
    # "trading off" · network blip / -1003 rate-limit / -1099 server
    # overload all caused over-privileged keys to be silently linked.
    # Now we accept ONLY the specific permission-denied codes from
    # Binance's documented error table; any other code is treated
    # as "verification inconclusive" → fail closed.
    PERMISSION_DENIED_CODES = {
        "-2015",  # Invalid API-key, IP, or permissions for action
        "-1022",  # Signature for this request is not valid
        "-2014",  # API-key format invalid (also returned for scope mismatch)
    }
    try:
        _signed_get(api_key, secret, "/sapi/v1/account", timeout=10)
        # If we got here, trading IS enabled · refuse.
        raise BinanceError(
            "scope_too_wide",
            "API key has Spot Trading enabled. Cpay only accepts "
            "withdraw-only keys. Disable trading on Binance and re-link.",
        )
    except BinanceError as e:
        if e.code == "scope_too_wide":
            raise
        if e.code not in PERMISSION_DENIED_CODES:
            # Anything other than a known permission-denied code
            # means we don't actually KNOW whether trading is on or
            # off · refuse to link.
            raise BinanceError(
                "verification_inconclusive",
                f"Could not verify trading scope is disabled "
                f"(Binance returned {e.code}: {e.message[:120]}). "
                f"Try again in a moment, or check Binance status.",
            )
        # Documented permission-denied · trading is disabled. Continue.

    return {
        "ok": True,
        "scopes": ["withdraw"],
        "supported_coins": supported,
        "address_whitelist": address_whitelist,
    }


def get_balances(api_key: str, secret: str) -> dict:
    """Read the user's spot balances per coin.

    Returns:
        {<coin>: {"free": Decimal, "locked": Decimal}, ...}

    Calls `/sapi/v1/capital/config/getall` (withdraw scope) which
    includes free/locked amounts per coin without needing trading
    scope. Filters to non-zero balances.
    """
    coins = _signed_get(api_key, secret, "/sapi/v1/capital/config/getall")
    out: dict[str, dict] = {}
    for c in coins or []:
        code = c.get("coin")
        if not code:
            continue
        free = Decimal(str(c.get("free", "0")))
        locked = Decimal(str(c.get("locked", "0")))
        if free > 0 or locked > 0:
            out[code] = {"free": free, "locked": locked}
    return out


def withdraw(
    api_key: str,
    secret: str,
    coin: str,
    network: str,
    amount: Decimal,
    destination_address: str,
    withdraw_order_id: str,
    address_tag: str = "",
) -> dict:
    """Submit a withdraw request to Binance.

    Args:
        coin · Binance coin code (e.g. "USDT", "BTC")
        network · Binance network code (e.g. "TRX", "MATIC", "BTC")
        amount · Decimal · amount in `coin` units (NOT cents/satoshi)
        destination_address · the Cpay deposit address on `network`
        withdraw_order_id · client-supplied unique id for idempotency
            · use the ExchangeWithdrawal.request_id (UUID)
        address_tag · memo / destination tag for chains that need it
            (e.g. XRP). Empty string for the chains we support today.

    Returns:
        {"id": <binance_withdraw_id>}
        per https://binance-docs.github.io/apidocs/spot/en/#withdraw-user_data

    Raises BinanceError with the upstream code on failure. Common codes:
        -1022 · signature invalid (key/secret mismatch)
        -2008 · invalid address tag
        -4014 · withdraw amount is below the network's minimum
        -4023 · invalid amount precision (too many decimals)
        -4026 · withdraw is suspended for this coin
        -2014 · API-key format invalid
        -2015 · IP / scope rejection (the key isn't enabled for this IP)
        -4067 · the destination_address is not in the user's whitelist
                (this is what fires if the user hasn't pre-whitelisted
                Cpay's deposit address on Binance)
    """
    params = {
        "coin": coin,
        "network": network,
        "address": destination_address,
        "amount": str(amount),
        # Client-supplied id · Binance uses this for dedup so a network
        # retry doesn't double-pull. Up to 36 chars. We pass a UUID4.
        "withdrawOrderId": withdraw_order_id,
    }
    if address_tag:
        params["addressTag"] = address_tag

    return _signed_post(api_key, secret, "/sapi/v1/capital/withdraw/apply", params)


def get_withdraw_history(
    api_key: str,
    secret: str,
    withdraw_order_id: Optional[str] = None,
    limit: int = 20,
) -> list:
    """Fetch withdraw history. Filterable by `withdrawOrderId` so we
    can resolve the on-chain status for ONE specific request.

    Returns a list of withdraw records:
        [{
            "id": "...",
            "amount": "...",
            "transactionFee": "...",
            "coin": "USDT",
            "status": 0|1|2|3|4|5|6,
                # 0:Email Sent, 1:Cancelled, 2:Awaiting Approval,
                # 3:Rejected, 4:Processing, 5:Failure, 6:Completed
            "address": "...",
            "txId": "...",
            "applyTime": "2024-01-01 12:00:00",
            "network": "TRX",
            ...
        }, ...]
    """
    params: dict = {"limit": limit}
    if withdraw_order_id:
        params["withdrawOrderId"] = withdraw_order_id
    body = _signed_get(api_key, secret, "/sapi/v1/capital/withdraw/history", params)
    return body if isinstance(body, list) else []


# ─────────────────────────────────────────────────────────────────
# Status mapping · Binance numeric codes → Cpay status enum
# ─────────────────────────────────────────────────────────────────


# Binance withdraw status codes (numeric per their API docs).
BINANCE_STATUS = {
    0: "pending",     # Email Sent · awaiting user confirmation in their email
    1: "failed",      # Cancelled (by Binance, not user)
    2: "pending",     # Awaiting Approval (compliance review)
    3: "failed",      # Rejected
    4: "confirming",  # Processing · withdraw is on-chain
    5: "failed",      # Failure
    6: "done",        # Completed · funds left Binance, on-chain confirmed
}


def map_binance_status(numeric: int) -> str:
    """Map Binance's numeric status to Cpay's ExchangeWithdrawal.status."""
    return BINANCE_STATUS.get(int(numeric), "pending")


# ─────────────────────────────────────────────────────────────────
# Egress IP helper · what the user pastes into Binance
# ─────────────────────────────────────────────────────────────────


def egress_ip_for_binance() -> str:
    """The static IP users must whitelist on Binance for their API key.

    Read from settings.CPAY_BINANCE_EGRESS_IP · falls through to the
    direct VPS IP. If you front the backend with a NAT / proxy, set
    this to the proxy's outbound IP.
    """
    return getattr(settings, "CPAY_BINANCE_EGRESS_IP", "173.249.4.109")
