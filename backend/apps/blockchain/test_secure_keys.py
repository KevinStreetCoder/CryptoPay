"""A14 regression tests · SOL + BTC hot-wallet key loader.

Tron + EVM migrated to `secure_keys.load_hot_wallet_key()` in earlier
audit work. SOL + BTC followed in the broadcast paths but had NO test
coverage pinning the behaviour · this file fixes that.

What we pin:
  1. `_broadcast_solana` calls `load_hot_wallet_key("sol")` and wipes
     the bytearray in its finally block.
  2. `_broadcast_bitcoin` calls `load_hot_wallet_key("btc")` and wipes
     the bytearray in its finally block.
  3. `load_hot_wallet_key` refuses plaintext in non-DEBUG mode unless
     ALLOW_PLAINTEXT_HOT_WALLET=True (the same guard as Tron/EVM).
  4. KMS-encrypted source path · when KMS_ENABLED=True AND the
     encrypted env var is set, the loader uses that path (not plaintext).
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch, MagicMock

import pytest
from django.test import TestCase, override_settings


class SecureKeyLoaderTest(TestCase):
    """Direct loader API · raises, prefers KMS, refuses plaintext in prod."""

    @override_settings(DEBUG=True, ALLOW_PLAINTEXT_HOT_WALLET=False,
                      KMS_ENABLED=False,
                      SOL_HOT_WALLET_PRIVATE_KEY="",
                      BTC_HOT_WALLET_PRIVATE_KEY="")
    def test_raises_when_no_source_configured(self):
        from apps.blockchain.secure_keys import (
            load_hot_wallet_key, HotWalletKeyMissing,
        )
        with self.assertRaises(HotWalletKeyMissing):
            load_hot_wallet_key("sol")
        with self.assertRaises(HotWalletKeyMissing):
            load_hot_wallet_key("btc")

    @override_settings(DEBUG=False, ALLOW_PLAINTEXT_HOT_WALLET=False,
                      KMS_ENABLED=False,
                      SOL_HOT_WALLET_PRIVATE_KEY="<test-placeholder-not-a-key>",
                      BTC_HOT_WALLET_PRIVATE_KEY="<test-placeholder-not-a-key>")
    def test_refuses_plaintext_in_production(self):
        """A14 belt-and-braces · the boot guard catches it too, but the
        loader refuses plaintext in DEBUG=False even if it slips through.
        Placeholder values use the literal `<test-placeholder-...>` form
        so credential scanners and grep tools never match a key-shaped
        string (no WIF prefix, no base58 alphabet, no hex)."""
        from apps.blockchain.secure_keys import (
            load_hot_wallet_key, HotWalletKeyMissing,
        )
        with self.assertRaisesRegex(HotWalletKeyMissing, "plaintext"):
            load_hot_wallet_key("sol")
        with self.assertRaisesRegex(HotWalletKeyMissing, "plaintext"):
            load_hot_wallet_key("btc")

    @override_settings(
        DEBUG=True, KMS_ENABLED=False,
        SOL_HOT_WALLET_PRIVATE_KEY="<test-placeholder-not-a-key>",
    )
    def test_plaintext_path_dev_returns_bytearray(self):
        """DEBUG=True dev path · the loader reads the env var as utf-8
        bytes for non-hex inputs. We don't care that the string parses
        as a real Solana key here · only that the loader hands the
        caller a wipe-able bytearray of the input length."""
        from apps.blockchain.secure_keys import load_hot_wallet_key
        ba = load_hot_wallet_key("sol")
        self.assertIsInstance(ba, bytearray)
        # `<test-placeholder-not-a-key>` is 29 chars utf-8 = 29 bytes.
        self.assertEqual(len(ba), len("<test-placeholder-not-a-key>"))

    @override_settings(DEBUG=True, KMS_ENABLED=True,
                      SOL_HOT_WALLET_ENCRYPTED="kms-encrypted-blob-stub-sol",
                      BTC_HOT_WALLET_ENCRYPTED="kms-encrypted-blob-stub-btc")
    def test_kms_path_preferred_when_enabled(self):
        """When KMS_ENABLED=True AND <CHAIN>_HOT_WALLET_ENCRYPTED is set,
        the KMS path wins · the loader never falls through to the
        plaintext env. Pinned because a regression here would silently
        store plaintext in process memory longer than necessary."""
        from apps.blockchain.secure_keys import load_hot_wallet_key

        fake_plaintext = b"\x01" * 64  # 64-byte ed25519 keypair
        with patch("apps.blockchain.secure_keys._decrypt_via_kms",
                   return_value=bytearray(fake_plaintext)) as mock_decrypt:
            ba_sol = load_hot_wallet_key("sol")
            ba_btc = load_hot_wallet_key("btc")
        self.assertEqual(bytes(ba_sol), fake_plaintext)
        self.assertEqual(bytes(ba_btc), fake_plaintext)
        # Each call must have decrypted exactly once · no plaintext fallback
        self.assertEqual(mock_decrypt.call_count, 2)

    def test_wipe_zeros_bytearray(self):
        from apps.blockchain.secure_keys import wipe
        ba = bytearray(b"\xff\xff\xff\xff")
        wipe(ba)
        self.assertEqual(bytes(ba), b"\x00\x00\x00\x00")


class BroadcastWipeTest(TestCase):
    """Broadcast paths · key is wiped in finally even on exception."""

    @override_settings(DEBUG=True, KMS_ENABLED=False,
                      SOL_HOT_WALLET_PRIVATE_KEY="<test-placeholder-not-a-key>")
    def test_solana_broadcast_wipes_key_on_exception(self):
        """A14 · the wipe MUST run even when the broadcast call itself
        raises. Otherwise the loaded bytearray lingers in memory past
        the exception unwind, defeating the whole point of the wrapper.

        We mock `solders.keypair.Keypair` at the top of the broadcast
        path so a Rust-side panic (which bypasses Python's try/finally
        and would skip our wipe) can never happen in this test.
        """
        from apps.blockchain import tasks as _blk_tasks
        from apps.blockchain import secure_keys

        captured: dict = {}
        original = secure_keys.load_hot_wallet_key

        def _capture(chain):
            ba = original(chain)
            captured["ba"] = ba
            return ba

        # Mock both the Keypair constructors solders exposes · either
        # path used by `_broadcast_solana` raises a plain Python error
        # before any Rust code runs.
        keypair_mock = type("KP", (), {
            "from_base58_string": staticmethod(
                lambda _: (_ for _ in ()).throw(RuntimeError("forced (mocked solders)")),
            ),
            "from_bytes": staticmethod(
                lambda _: (_ for _ in ()).throw(RuntimeError("forced (mocked solders)")),
            ),
        })

        with patch.object(secure_keys, "load_hot_wallet_key", side_effect=_capture):
            with patch("solders.keypair.Keypair", keypair_mock):
                with self.assertRaises(Exception):
                    _blk_tasks._broadcast_solana(
                        currency="SOL",
                        destination_address="11111111111111111111111111111111",
                        amount=Decimal("0.001"),
                    )

        self.assertIn("ba", captured, "load_hot_wallet_key was never called")
        self.assertTrue(
            all(b == 0 for b in captured["ba"]),
            f"SOL key bytearray was NOT wiped after broadcast failure: "
            f"first byte = {captured['ba'][0]}",
        )

    @override_settings(BTC_WITHDRAWALS_ENABLED=True,
                      DEBUG=True, KMS_ENABLED=False,
                      BTC_HOT_WALLET_PRIVATE_KEY="<test-placeholder-not-a-key>",
                      BTC_NETWORK="testnet")
    def test_bitcoin_broadcast_wipes_key_on_exception(self):
        from apps.blockchain import tasks as _blk_tasks
        from apps.blockchain import secure_keys

        captured: dict = {}
        original = secure_keys.load_hot_wallet_key

        def _capture(chain):
            ba = original(chain)
            captured["ba"] = ba
            return ba

        # Force the WIF parse to raise BEFORE bit touches the network.
        # bit.PrivateKeyTestnet(<placeholder>) would itself fail; we
        # mock it so the test pins the wipe behaviour, not bit's parse.
        with patch.object(secure_keys, "load_hot_wallet_key", side_effect=_capture):
            with patch("bit.PrivateKeyTestnet") as mock_key:
                mock_key.side_effect = RuntimeError("forced (mocked bit)")
                with self.assertRaises(Exception):
                    _blk_tasks._broadcast_bitcoin(
                        destination_address="tb1qar0srrr7xfkvy5l643lydnw9re59gtzzwfqqqq",
                        amount=Decimal("0.001"),
                    )

        self.assertIn("ba", captured, "load_hot_wallet_key was never called")
        self.assertTrue(
            all(b == 0 for b in captured["ba"]),
            f"BTC key bytearray was NOT wiped after broadcast failure: "
            f"first byte = {captured['ba'][0]}",
        )
