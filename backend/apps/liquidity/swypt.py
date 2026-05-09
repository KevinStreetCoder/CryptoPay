"""Swypt liquidity provider · KES ↔ crypto on/off-ramp via Swypt's
on-ramp + deposit endpoints (https://github.com/Swypt-io/swypt-api-
documentation).

Why Swypt is our primary choice (research 2026-05-09):
  - Public API + documented · `/api/swypt-onramp` triggers M-Pesa
    STK push, `/api/swypt-deposit` releases crypto to ANY address
    we specify · literal 1:1 fit for our treasury-funding flow.
  - Onboarding is days (email swypt.io@gmail.com), not weeks of
    KYB + sales-call gauntlet like Yellow Card.
  - Limits KES 1 - 250,000 per onramp · covers both micro user
    deposits (KES 50) and batched daily top-ups (100 USDT).
  - Chains · USDT, USDC, ETH, MATIC, cKES, CELO on Celo / Polygon
    / Base / Lisk / Scroll / Algorand. Confirmed gap · no BTC L1,
    no SOL · for those we keep Yellow Card / manual ops.

Status: SCAFFOLD ONLY. The HTTP shapes here are based on the public
API documentation (linked above) · they need to be re-verified once
the user emails Swypt and gets actual sandbox keys. Specifically:
  - The exact request/response field names (camelCase vs snake_case)
  - The auth header shape (Bearer vs API-Key vs HMAC)
  - The callback payload structure
  - Which `chain` slugs Swypt accepts (`tron` vs `Tron` vs network
    code)

I've left `# TODO(swypt-keys-arrive)` markers at every spot that
needs verification once the user replies. The rest of the saga
integration (cron resolver, callback handler, SystemWallet credit
flow) is built generically against the LiquidityProvider interface
and won't need changes when the field names settle.
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal
from typing import Optional

import requests
from django.conf import settings

from .base import (
    LiquidityOrder,
    LiquidityProvider,
    LiquidityProviderError,
    OrderDirection,
    OrderStatus,
)

logger = logging.getLogger(__name__)

# Swypt's chain slugs (verify against actual API docs once we have keys).
# Mapping our internal chain names → Swypt's expected `network` field.
_CHAIN_MAP = {
    "tron":     "tron",        # USDT-TRC20
    "ethereum": "ethereum",
    "polygon":  "polygon",     # USDC + USDT
    "base":     "base",
    "celo":     "celo",
    "lisk":     "lisk",
    "scroll":   "scroll",
    "algorand": "algorand",
    # Unsupported: bitcoin, solana · saga falls through to next provider
}

# Asset codes Swypt accepts. Matches the chain support · for an asset
# on a chain Swypt doesn't list, we fall through.
_SUPPORTED = {
    ("USDT", "tron"),
    ("USDT", "polygon"),
    ("USDT", "ethereum"),
    ("USDC", "polygon"),
    ("USDC", "base"),
    ("USDC", "ethereum"),
    ("USDC", "celo"),
    ("ETH",  "ethereum"),
    ("ETH",  "base"),
    ("CELO", "celo"),
    ("CKES", "celo"),  # cKES stablecoin pegged to KES
}


class SwyptProvider(LiquidityProvider):
    """Swypt API client · implements both BUY (KES → crypto) and
    SELL (crypto → KES) via the same auth + base URL."""

    name = "swypt"

    def __init__(self):
        self.base_url = getattr(settings, "SWYPT_BASE_URL", "https://api.swypt.io").rstrip("/")
        self.api_key = getattr(settings, "SWYPT_API_KEY", "")
        self.api_secret = getattr(settings, "SWYPT_API_SECRET", "")
        # Cpay's wallet address per chain · destination for BUY orders.
        # Source from settings so ops can rotate the receiving address
        # without a code change.
        self.receive_addresses = {
            "tron":     getattr(settings, "TRON_HOT_WALLET_ADDRESS", ""),
            "ethereum": getattr(settings, "ETH_HOT_WALLET_ADDRESS", ""),
            "polygon":  getattr(settings, "POLYGON_HOT_WALLET_ADDRESS", ""),
            "base":     getattr(settings, "BASE_HOT_WALLET_ADDRESS", ""),
            "celo":     getattr(settings, "CELO_HOT_WALLET_ADDRESS", ""),
        }

    # ── Helpers ──────────────────────────────────────────────────────

    def _headers(self) -> dict:
        # TODO(swypt-keys-arrive) · verify the actual auth header shape.
        # The README hints at "x-api-key" but their API spec may use a
        # signed HMAC like Yellow Card. Will adjust once docs land.
        return {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "x-api-secret": self.api_secret,
        }

    def _post(self, path: str, body: dict) -> dict:
        url = f"{self.base_url}{path}"
        try:
            r = requests.post(url, json=body, headers=self._headers(), timeout=30)
        except requests.RequestException as e:
            raise LiquidityProviderError(f"Swypt network error on {path}: {e}") from e
        if r.status_code >= 400:
            raise LiquidityProviderError(
                f"Swypt {path} HTTP {r.status_code}: {r.text[:300]}"
            )
        try:
            return r.json()
        except ValueError:
            raise LiquidityProviderError(f"Swypt {path} returned non-JSON: {r.text[:200]}")

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        r = requests.get(url, params=params or {}, headers=self._headers(), timeout=30)
        if r.status_code >= 400:
            raise LiquidityProviderError(
                f"Swypt {path} HTTP {r.status_code}: {r.text[:300]}"
            )
        return r.json()

    # ── LiquidityProvider interface ──────────────────────────────────

    def supports(self, asset: str, chain: str) -> bool:
        return (asset.upper(), chain.lower()) in _SUPPORTED

    def quote(
        self,
        direction: OrderDirection,
        asset: str,
        chain: str,
        kes_amount: Optional[Decimal] = None,
        crypto_amount: Optional[Decimal] = None,
    ) -> LiquidityOrder:
        """Get a rate quote for the requested direction. Swypt's
        `/api/swypt-quotes` (TODO · verify path) returns rate + fees.
        Returned LiquidityOrder is provisional · execute via buy()/sell().
        """
        # TODO(swypt-keys-arrive) · the actual quote endpoint + body
        # shape needs verification. Stubbed for now · returns the
        # input amount and a placeholder rate so the saga can still
        # render a quote screen during development.
        if kes_amount is None and crypto_amount is None:
            raise LiquidityProviderError("Need either kes_amount or crypto_amount")

        # Placeholder · replace with `self._post("/api/swypt-quotes", ...)`
        # once the endpoint is documented.
        rate = Decimal("129.00")  # KES per asset · placeholder
        if kes_amount is not None and crypto_amount is None:
            crypto_amount = (kes_amount / rate).quantize(Decimal("0.00000001"))
        elif crypto_amount is not None and kes_amount is None:
            kes_amount = (crypto_amount * rate).quantize(Decimal("0.01"))

        return LiquidityOrder(
            direction=direction,
            status=OrderStatus.PENDING,
            provider_ref="",
            idempotency_key="",
            asset=asset.upper(),
            chain=chain.lower(),
            crypto_amount=crypto_amount or Decimal("0"),
            kes_amount=kes_amount or Decimal("0"),
            rate=rate,
            fees_kes=Decimal("0"),  # Swypt fees · TBD from docs
        )

    def buy(
        self,
        asset: str,
        chain: str,
        kes_amount: Decimal,
        target_address: str,
        idempotency_key: str,
        phone: Optional[str] = None,
    ) -> LiquidityOrder:
        """KES → crypto. Two-step on Swypt:
          1. `/api/swypt-onramp` · triggers M-Pesa STK push to `phone`
             (or our ops phone if not given) for `kes_amount`
          2. `/api/swypt-deposit` · once STK clears, releases the
             crypto to `target_address` on `chain`

        For our use-case (treasury funding from already-collected KES)
        we may want to skip step 1 if SasaPay already has the KES, OR
        Swypt may offer a "from-merchant-wallet" mode. TBD when keys
        land.
        """
        if not self.supports(asset, chain):
            raise LiquidityProviderError(
                f"Swypt does not support {asset} on {chain}"
            )
        if not target_address:
            target_address = self.receive_addresses.get(chain, "")
        if not target_address:
            raise LiquidityProviderError(
                f"No target address configured for {chain} · set "
                f"{chain.upper()}_HOT_WALLET_ADDRESS in env"
            )

        # TODO(swypt-keys-arrive) · the actual request shape needs
        # verification. The README pseudocode is:
        #   POST /api/swypt-onramp
        #     { phone, amount_kes, asset, network, callback_url }
        body = {
            "phone": phone or "",
            "amount_kes": str(kes_amount),
            "asset": asset.upper(),
            "network": _CHAIN_MAP.get(chain.lower(), chain.lower()),
            "destination_address": target_address,
            "reference": idempotency_key,
            "callback_url": getattr(
                settings, "SWYPT_CALLBACK_URL",
                "https://cpay.co.ke/api/v1/swypt/callback/",
            ),
        }
        try:
            response = self._post("/api/swypt-onramp", body)
        except LiquidityProviderError:
            raise

        return LiquidityOrder(
            direction=OrderDirection.BUY,
            status=OrderStatus.PROCESSING,
            provider_ref=response.get("order_id", "") or response.get("id", ""),
            idempotency_key=idempotency_key,
            asset=asset.upper(),
            chain=chain.lower(),
            crypto_amount=Decimal(str(response.get("crypto_amount", "0"))),
            kes_amount=kes_amount,
            rate=Decimal(str(response.get("rate", "0"))),
            fees_kes=Decimal(str(response.get("fees_kes", "0"))),
            target_address=target_address,
            raw=response,
        )

    def sell(
        self,
        asset: str,
        chain: str,
        crypto_amount: Decimal,
        kes_destination: str,
        idempotency_key: str,
    ) -> LiquidityOrder:
        """crypto → KES. For Swypt's offramp flow:
          1. We send crypto on-chain to a Swypt-provided address
             (returned in this response as `deposit_address`)
          2. Once they observe the deposit, they push KES to
             `kes_destination` (M-Pesa phone or paybill)
        """
        if not self.supports(asset, chain):
            raise LiquidityProviderError(
                f"Swypt does not support {asset} on {chain}"
            )
        # TODO(swypt-keys-arrive) · verify offramp endpoint + body shape
        body = {
            "asset": asset.upper(),
            "network": _CHAIN_MAP.get(chain.lower(), chain.lower()),
            "amount_crypto": str(crypto_amount),
            "destination_phone": kes_destination,
            "reference": idempotency_key,
            "callback_url": getattr(
                settings, "SWYPT_CALLBACK_URL",
                "https://cpay.co.ke/api/v1/swypt/callback/",
            ),
        }
        response = self._post("/api/swypt-offramp", body)
        return LiquidityOrder(
            direction=OrderDirection.SELL,
            status=OrderStatus.PROCESSING,
            provider_ref=response.get("order_id", "") or response.get("id", ""),
            idempotency_key=idempotency_key,
            asset=asset.upper(),
            chain=chain.lower(),
            crypto_amount=crypto_amount,
            kes_amount=Decimal(str(response.get("kes_amount", "0"))),
            rate=Decimal(str(response.get("rate", "0"))),
            fees_kes=Decimal(str(response.get("fees_kes", "0"))),
            target_address=response.get("deposit_address", ""),
            raw=response,
        )

    def get_order_status(self, provider_ref: str) -> LiquidityOrder:
        """Active poll · used by the cron when callbacks drop."""
        # TODO(swypt-keys-arrive) · verify status endpoint
        response = self._get(f"/api/swypt-orders/{provider_ref}")
        status_map = {
            "pending":    OrderStatus.PENDING,
            "processing": OrderStatus.PROCESSING,
            "settled":    OrderStatus.SETTLED,
            "complete":   OrderStatus.SETTLED,
            "completed":  OrderStatus.SETTLED,
            "failed":     OrderStatus.FAILED,
            "refunded":   OrderStatus.REFUNDED,
        }
        raw_status = (response.get("status") or "").lower()
        return LiquidityOrder(
            direction=OrderDirection.BUY if response.get("direction") == "buy" else OrderDirection.SELL,
            status=status_map.get(raw_status, OrderStatus.PENDING),
            provider_ref=provider_ref,
            idempotency_key=response.get("reference", ""),
            asset=response.get("asset", ""),
            chain=response.get("network", ""),
            crypto_amount=Decimal(str(response.get("crypto_amount", "0"))),
            kes_amount=Decimal(str(response.get("kes_amount", "0"))),
            rate=Decimal(str(response.get("rate", "0"))),
            fees_kes=Decimal(str(response.get("fees_kes", "0"))),
            tx_hash=response.get("tx_hash", "") or "",
            mpesa_receipt=response.get("mpesa_receipt", "") or "",
            raw=response,
        )
