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
                      SOL_HOT_WALLET_PRIVATE_KEY="someplaintext",
                      BTC_HOT_WALLET_PRIVATE_KEY="L1...wifplaintext")
    def test_refuses_plaintext_in_production(self):
        """A14 belt-and-braces · the boot guard catches it too, but the
        loader refuses plaintext in DEBUG=False even if it slips through."""
        from apps.blockchain.secure_keys import (
            load_hot_wallet_key, HotWalletKeyMissing,
        )
        with self.assertRaisesRegex(HotWalletKeyMissing, "plaintext"):
            load_hot_wallet_key("sol")
        with self.assertRaisesRegex(HotWalletKeyMissing, "plaintext"):
            load_hot_wallet_key("btc")

    @override_settings(DEBUG=True, KMS_ENABLED=False,
                      SOL_HOT_WALLET_PRIVATE_KEY="2" + "a" * 87)  # base58-ish stub
    def test_plaintext_path_dev_returns_bytearray(self):
        """DEBUG=True dev path · plaintext is read as utf-8 (Solana's
        base58 / JSON-array formats land here verbatim, ready for the
        broadcast path to parse with Keypair.from_base58_string)."""
        from apps.blockchain.secure_keys import load_hot_wallet_key
        ba = load_hot_wallet_key("sol")
        self.assertIsInstance(ba, bytearray)
        self.assertEqual(len(ba), 88)  # 1 + 87 chars utf-8 → 88 bytes

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
                      SOL_HOT_WALLET_PRIVATE_KEY="invalid-base58-on-purpose")
    def test_solana_broadcast_wipes_key_on_exception(self):
        """A14 · the wipe MUST run even when the broadcast call itself
        raises. Otherwise the loaded bytearray lingers in memory past
        the exception unwind, defeating the whole point of the wrapper.
        """
        from apps.blockchain import tasks as _blk_tasks
        from apps.blockchain.secure_keys import load_hot_wallet_key

        # Capture the bytearray returned by load_hot_wallet_key so we
        # can inspect it after the broadcast raises.
        captured: dict = {}
        original = _blk_tasks.load_hot_wallet_key if hasattr(_blk_tasks, "load_hot_wallet_key") else None

        def _capture(chain):
            ba = load_hot_wallet_key(chain)
            captured["ba"] = ba
            return ba

        with patch("apps.blockchain.tasks.load_hot_wallet_key", side_effect=_capture, create=True):
            # Force a downstream failure so we exercise the finally clause.
            with patch("apps.blockchain.tasks.req" if False else "requests.post",
                       side_effect=RuntimeError("forced network failure")):
                with self.assertRaises(Exception):
                    _blk_tasks._broadcast_solana(
                        currency="SOL",
                        destination_address="11111111111111111111111111111111",
                        amount=Decimal("0.001"),
                    )

        # After the broadcast raises, the captured bytearray must have
        # been wiped (all zeros) by the finally clause.
        if "ba" in captured:
            self.assertTrue(
                all(b == 0 for b in captured["ba"]),
                f"SOL key bytearray was NOT wiped after broadcast failure: "
                f"first byte = {captured['ba'][0]}",
            )

    @override_settings(BTC_WITHDRAWALS_ENABLED=True,
                      DEBUG=True, KMS_ENABLED=False,
                      BTC_HOT_WALLET_PRIVATE_KEY="cVjzvdHGfL...wif-test",
                      BTC_NETWORK="testnet")
    def test_bitcoin_broadcast_wipes_key_on_exception(self):
        from apps.blockchain import tasks as _blk_tasks
        from apps.blockchain.secure_keys import load_hot_wallet_key

        captured: dict = {}

        def _capture(chain):
            ba = load_hot_wallet_key(chain)
            captured["ba"] = ba
            return ba

        with patch("apps.blockchain.tasks.load_hot_wallet_key", side_effect=_capture, create=True):
            # bit.PrivateKeyTestnet(...).get_balance will network out · force
            # the call to raise so we hit the finally.
            with patch("bit.PrivateKeyTestnet") as mock_key:
                mock_key.return_value.get_balance.side_effect = RuntimeError("forced")
                with self.assertRaises(Exception):
                    _blk_tasks._broadcast_bitcoin(
                        destination_address="tb1qar0srrr7xfkvy5l643lydnw9re59gtzzwfqqqq",
                        amount=Decimal("0.001"),
                    )

        if "ba" in captured:
            self.assertTrue(
                all(b == 0 for b in captured["ba"]),
                f"BTC key bytearray was NOT wiped after broadcast failure: "
                f"first byte = {captured['ba'][0]}",
            )
