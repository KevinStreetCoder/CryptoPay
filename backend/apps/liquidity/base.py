"""LiquidityProvider · abstract base for crypto-on-ramp / off-ramp rails.

The platform credits user wallets in USDT/USDC/BTC/ETH/SOL on its
internal ledger, but holds zero on-chain crypto by default · we need
a programmatic way to:

  * BUY  · accept KES (already collected via SasaPay STK), deliver
           crypto to OUR hot-wallet address
  * SELL · push crypto OUT, get KES into our M-Pesa float

This module defines the contract every provider implements. Phase-1
provider is Swypt (Kenya-native, fastest path to production · see
docs/research/SWYPT-EVALUATION-2026-05-09.md). Yellow Card stays as
a fallback once their KYB lands.

Design choices:

  - **Async via callback** · BUY/SELL are not synchronous · the
    provider takes our request, queues a settlement, and pushes a
    callback when the crypto lands or KES settles. The interface
    returns a `LiquidityOrder` with a status that the caller polls
    via `get_order_status()` or wires into our existing IPN handler.
  - **Idempotent** · every call accepts an `idempotency_key` (Cpay's
    saga key) so a network blip doesn't double-spend.
  - **Provider-agnostic shape** · `LiquidityOrder.fees` is a Decimal
    KES amount; `LiquidityOrder.crypto_amount` is in the asset's
    native unit. The saga maps these to our existing Transaction
    fields without provider-specific branching.
  - **Drop-in replacement** · `LiquidityProviderRegistry` lets the
    saga switch providers via a single env var (`BUY_PROVIDER`,
    `SELL_PROVIDER`) without code changes; same pattern as
    `PAYMENT_PROVIDER`.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Optional


class OrderStatus(str, Enum):
    """Lifecycle states a liquidity order goes through."""

    PENDING = "pending"            # Order accepted by provider, awaiting fulfilment
    PROCESSING = "processing"      # Crypto/KES movement in flight
    SETTLED = "settled"            # Funds landed at the destination
    FAILED = "failed"              # Provider rejected / on-chain failure / timeout
    REFUNDED = "refunded"          # We initiated a refund and it landed


class OrderDirection(str, Enum):
    BUY = "buy"   # KES → crypto (we receive crypto)
    SELL = "sell" # crypto → KES (we receive KES)


@dataclass
class LiquidityOrder:
    """Provider-agnostic order shape · maps to Cpay's Transaction row.

    `provider_ref` is the provider's order ID we use to query status
    or correlate the callback. `tx_hash` only populates after on-chain
    settlement (BUY) · for SELL it stays empty and we get a
    `mpesa_receipt`-style code instead.
    """

    direction: OrderDirection
    status: OrderStatus
    provider_ref: str            # provider's order ID
    idempotency_key: str         # Cpay's saga key
    asset: str                   # USDT / USDC / BTC / ETH / SOL / cKES
    chain: str                   # tron / ethereum / polygon / base / solana / bitcoin
    crypto_amount: Decimal       # asset-native units
    kes_amount: Decimal          # equivalent KES at quoted rate
    rate: Decimal                # KES per 1 unit of asset
    fees_kes: Decimal = Decimal("0")
    target_address: str = ""     # destination (BUY · our hot wallet; SELL · provider's)
    tx_hash: str = ""            # on-chain hash once settled (BUY only)
    mpesa_receipt: str = ""      # M-Pesa receipt code (SELL only)
    raw: dict = field(default_factory=dict)  # provider response, for audit


class LiquidityProviderError(Exception):
    """Wraps any provider-side error · network, auth, validation, etc."""


class LiquidityProvider(abc.ABC):
    """Interface every concrete provider implements."""

    name: str = ""

    @abc.abstractmethod
    def supports(self, asset: str, chain: str) -> bool:
        """Return True if this provider can buy/sell the given asset
        on the given chain. The saga uses this to pick a provider · the
        first registered provider that supports the requested pair wins."""

    @abc.abstractmethod
    def quote(
        self,
        direction: OrderDirection,
        asset: str,
        chain: str,
        kes_amount: Optional[Decimal] = None,
        crypto_amount: Optional[Decimal] = None,
    ) -> LiquidityOrder:
        """Return a quote (status=PENDING) · either kes_amount or
        crypto_amount must be set · the other is computed at the
        provider's current rate. The returned object is NOT yet
        committed · call execute() to commit, or let it expire."""

    @abc.abstractmethod
    def buy(
        self,
        asset: str,
        chain: str,
        kes_amount: Decimal,
        target_address: str,
        idempotency_key: str,
        phone: Optional[str] = None,
    ) -> LiquidityOrder:
        """Initiate a KES → crypto purchase. Returns a LiquidityOrder
        with status=PENDING or PROCESSING. Provider will push a
        callback when settled.

        `target_address` is the on-chain address we want the crypto
        delivered to · typically Cpay's hot-wallet address for the
        chain. `phone` is optional for providers that need it for
        KYC/AML at the M-Pesa source side."""

    @abc.abstractmethod
    def sell(
        self,
        asset: str,
        chain: str,
        crypto_amount: Decimal,
        kes_destination: str,
        idempotency_key: str,
    ) -> LiquidityOrder:
        """Initiate a crypto → KES sale. `kes_destination` is the
        M-Pesa phone or paybill that receives the KES."""

    @abc.abstractmethod
    def get_order_status(self, provider_ref: str) -> LiquidityOrder:
        """Active poll for an order. Used by our cron to resolve
        stuck orders when the provider's callback drops."""


class LiquidityProviderRegistry:
    """Singleton registry · settings.py registers concrete providers
    here at boot, the saga reads via `get_provider(direction)`."""

    _buy: list[LiquidityProvider] = []
    _sell: list[LiquidityProvider] = []

    @classmethod
    def register(cls, provider: LiquidityProvider, *, buy: bool = True, sell: bool = True) -> None:
        if buy:
            cls._buy.append(provider)
        if sell:
            cls._sell.append(provider)

    @classmethod
    def for_asset(cls, direction: OrderDirection, asset: str, chain: str) -> Optional[LiquidityProvider]:
        """Return the first registered provider that supports the
        given asset+chain in the given direction. Order matters · the
        first registered wins, so register the preferred provider
        first (Swypt before Yellow Card before manual)."""
        bucket = cls._buy if direction == OrderDirection.BUY else cls._sell
        for provider in bucket:
            if provider.supports(asset, chain):
                return provider
        return None

    @classmethod
    def reset(cls) -> None:
        """Test/seam · clears the registry. Don't call from app code."""
        cls._buy = []
        cls._sell = []
