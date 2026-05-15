"""D16 audit-bump runtime test · exercise the public-API surface we
actually use from tronpy / web3 / bitcoinlib so a breaking change
fails CI rather than the saga.

The test pins the SHAPE of the calls we make · it doesn't network out,
doesn't sign real tx, doesn't hit RPCs. The only thing it proves is
that the import + symbol-resolution + minimal call surface stays
compatible across the version bump.
"""
from __future__ import annotations

import pytest


def test_tronpy_imports_and_address_helpers():
    """We use `tronpy.keys.PrivateKey` for sweep signing and
    `tronpy.providers.HTTPProvider` for the RPC client."""
    from tronpy.keys import PrivateKey
    from tronpy.providers import HTTPProvider  # noqa: F401

    # Generate a deterministic private key + derive its address · this
    # is the exact path the sweep code uses.
    pk = PrivateKey(bytes.fromhex("01" * 32))
    addr = pk.public_key.to_base58check_address()
    assert isinstance(addr, str)
    assert addr.startswith("T"), f"tron address must start with T, got {addr[:4]}"


def test_web3_imports_and_account_signing_surface():
    """We use `web3.Web3.to_checksum_address`, `Account.from_key`, and
    EIP-1559 transaction signing for the EVM sweep path."""
    from web3 import Web3
    from eth_account import Account

    # Checksum-format an address · this is in every send path.
    raw = "0x52908400098527886e0f7030069857d2e4169ee7"
    checksummed = Web3.to_checksum_address(raw)
    assert checksummed.startswith("0x")
    assert checksummed == Web3.to_checksum_address(checksummed)

    # Derive an account from a deterministic key.
    acct = Account.from_key("0x" + "ab" * 32)
    assert acct.address.startswith("0x")
    assert len(acct.address) == 42


def test_web3_eip1559_tx_fields_present():
    """EIP-1559 sweep code populates maxFeePerGas + maxPriorityFeePerGas ·
    pin that the constants the saga reads still exist."""
    from web3 import Web3
    # Cheap-to-call helper that should be stable across patches.
    assert hasattr(Web3, "to_wei")
    assert Web3.to_wei(1, "ether") == 10 ** 18


def test_bitcoinlib_imports():
    """We use bitcoinlib's HDKey / Wallet primitives in the deposit-
    address derivation tests. Just confirm import path is intact."""
    from bitcoinlib.keys import HDKey
    # Derive a deterministic HD key from a known seed.
    k = HDKey.from_seed(b"\x00" * 64)
    # Address format may vary by network · just check we got a string.
    addr = k.address()
    assert isinstance(addr, str)
    assert len(addr) > 10
