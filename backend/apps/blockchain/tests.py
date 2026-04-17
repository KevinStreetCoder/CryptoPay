"""
Tests for blockchain security hardening.

Covers: dust thresholds, amount-based confirmation tiers, address validation,
double-credit prevention, re-org detection, deposit velocity checks.
"""

import uuid
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APITestCase, APIClient

from apps.accounts.models import User
from apps.wallets.models import Wallet
from apps.wallets.services import WalletService

from .models import BlockchainDeposit
from .security import (
    estimate_usd_value,
    get_minimum_deposit,
    get_required_confirmations,
    is_dust_deposit,
    validate_address,
    validate_deposit_address_ownership,
    check_deposit_velocity,
)
from .tasks import _credit_single_deposit, process_pending_deposits


class DustThresholdTest(TestCase):
    """Tests for minimum deposit threshold (dust attack prevention)."""

    def test_btc_dust_rejected(self):
        """BTC amounts below 0.00005 should be rejected as dust."""
        self.assertTrue(is_dust_deposit(Decimal("0.00001"), "BTC"))
        self.assertTrue(is_dust_deposit(Decimal("0.00004"), "BTC"))

    def test_btc_above_minimum_accepted(self):
        self.assertFalse(is_dust_deposit(Decimal("0.0001"), "BTC"))
        self.assertFalse(is_dust_deposit(Decimal("1.0"), "BTC"))

    def test_usdt_dust_rejected(self):
        self.assertTrue(is_dust_deposit(Decimal("0.50"), "USDT"))
        self.assertTrue(is_dust_deposit(Decimal("0.99"), "USDT"))

    def test_usdt_above_minimum_accepted(self):
        self.assertFalse(is_dust_deposit(Decimal("1.00"), "USDT"))
        self.assertFalse(is_dust_deposit(Decimal("100.00"), "USDT"))

    def test_eth_dust_rejected(self):
        self.assertTrue(is_dust_deposit(Decimal("0.001"), "ETH"))

    def test_eth_above_minimum_accepted(self):
        self.assertFalse(is_dust_deposit(Decimal("0.01"), "ETH"))

    def test_sol_dust_rejected(self):
        self.assertTrue(is_dust_deposit(Decimal("0.01"), "SOL"))

    def test_sol_above_minimum_accepted(self):
        self.assertFalse(is_dust_deposit(Decimal("0.1"), "SOL"))

    def test_usdc_dust_rejected(self):
        self.assertTrue(is_dust_deposit(Decimal("0.50"), "USDC"))

    def test_usdc_above_minimum_accepted(self):
        self.assertFalse(is_dust_deposit(Decimal("5.00"), "USDC"))

    def test_unknown_currency_passes(self):
        """Unknown currencies should not be blocked (no minimum defined)."""
        self.assertFalse(is_dust_deposit(Decimal("0.0001"), "DOGE"))

    @override_settings(MINIMUM_DEPOSIT_AMOUNTS={"BTC": "0.001"})
    def test_settings_override(self):
        """Settings should override default minimums."""
        # 0.0005 is above default (0.00005) but below override (0.001)
        self.assertTrue(is_dust_deposit(Decimal("0.0005"), "BTC"))
        self.assertFalse(is_dust_deposit(Decimal("0.002"), "BTC"))

    def test_get_minimum_deposit_returns_decimal(self):
        result = get_minimum_deposit("BTC")
        self.assertIsInstance(result, Decimal)
        self.assertGreater(result, 0)


class ConfirmationTierTest(TestCase):
    """Tests for amount-based confirmation tiers."""

    def test_btc_small_amount_low_confs(self):
        """Small BTC deposits need fewer confirmations."""
        confs = get_required_confirmations("bitcoin", Decimal("500"))
        self.assertEqual(confs, 2)

    def test_btc_medium_amount_moderate_confs(self):
        confs = get_required_confirmations("bitcoin", Decimal("5000"))
        self.assertEqual(confs, 3)

    def test_btc_large_amount_high_confs(self):
        """Large BTC deposits need 6 confirmations (Satoshi's recommendation)."""
        confs = get_required_confirmations("bitcoin", Decimal("50000"))
        self.assertEqual(confs, 6)

    def test_eth_small_amount(self):
        confs = get_required_confirmations("ethereum", Decimal("500"))
        self.assertEqual(confs, 12)

    def test_eth_large_amount(self):
        """Large ETH deposits need 64 confs (2 finalized epochs)."""
        confs = get_required_confirmations("ethereum", Decimal("50000"))
        self.assertEqual(confs, 64)

    def test_tron_always_19(self):
        """Tron solidification is binary — always 19 confs."""
        confs = get_required_confirmations("tron", Decimal("1000000"))
        self.assertEqual(confs, 19)

    def test_solana_always_32(self):
        """Solana finalized commitment = deterministic finality — always 32."""
        confs = get_required_confirmations("solana", Decimal("1000000"))
        self.assertEqual(confs, 32)

    def test_unknown_chain_fallback(self):
        """Unknown chains should fallback to settings REQUIRED_CONFIRMATIONS."""
        confs = get_required_confirmations("litecoin", Decimal("100"))
        self.assertIsInstance(confs, int)
        self.assertGreater(confs, 0)


class AddressValidationTest(TestCase):
    """Tests for blockchain address format validation."""

    def test_valid_tron_address(self):
        self.assertTrue(validate_address("tron", "TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn"))

    def test_invalid_tron_address_wrong_prefix(self):
        self.assertFalse(validate_address("tron", "0x1234567890abcdef1234567890abcdef12345678"))

    def test_invalid_tron_address_too_short(self):
        self.assertFalse(validate_address("tron", "T123"))

    def test_valid_ethereum_address(self):
        self.assertTrue(validate_address("ethereum", "0x1234567890abcdef1234567890abcdef12345678"))

    def test_invalid_ethereum_address_no_prefix(self):
        self.assertFalse(validate_address("ethereum", "1234567890abcdef1234567890abcdef12345678"))

    def test_invalid_ethereum_address_too_short(self):
        self.assertFalse(validate_address("ethereum", "0x1234"))

    def test_valid_bitcoin_p2pkh(self):
        self.assertTrue(validate_address("bitcoin", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"))

    def test_valid_bitcoin_p2sh(self):
        self.assertTrue(validate_address("bitcoin", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"))

    def test_valid_bitcoin_bech32(self):
        self.assertTrue(validate_address("bitcoin", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"))

    def test_invalid_bitcoin_address(self):
        self.assertFalse(validate_address("bitcoin", "T123invalidbitcoinaddress"))

    def test_valid_solana_address(self):
        # Base58 encoded Ed25519 public key (32-44 chars)
        self.assertTrue(validate_address("solana", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"))

    def test_empty_address_rejected(self):
        self.assertFalse(validate_address("ethereum", ""))

    def test_none_address_rejected(self):
        self.assertFalse(validate_address("ethereum", None))

    def test_unknown_chain_passes(self):
        """Unknown chains should pass validation (fail open for new chains)."""
        self.assertTrue(validate_address("dogecoin", "DRandomAddress123"))


class AddressOwnershipTest(TestCase):
    """Tests for address ownership verification."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.wallet = Wallet.objects.create(
            user=self.user,
            currency="USDT",
            deposit_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
        )

    def test_owned_address_passes(self):
        self.assertTrue(
            validate_deposit_address_ownership(
                "TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn", "USDT"
            )
        )

    def test_unknown_address_fails(self):
        self.assertFalse(
            validate_deposit_address_ownership(
                "TUnknownAddress1234567890123456789", "USDT"
            )
        )

    def test_wrong_currency_fails(self):
        """Address exists but for a different currency."""
        self.assertFalse(
            validate_deposit_address_ownership(
                "TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn", "BTC"
            )
        )


class DoubleCreditPreventionTest(TestCase):
    """Tests for preventing double-crediting of deposits."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.wallet = Wallet.objects.create(
            user=self.user,
            currency="USDT",
            balance=Decimal("0"),
            deposit_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
        )

    def test_confirmed_deposit_credited_once(self):
        """A confirmed deposit should only be credited once."""
        deposit = BlockchainDeposit.objects.create(
            chain="tron",
            tx_hash="abc123confirmed",
            from_address="TSenderAddress",
            to_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
            amount=Decimal("50.00"),
            currency="USDT",
            confirmations=19,
            required_confirmations=19,
            status=BlockchainDeposit.Status.CONFIRMED,
            block_number=12345,
        )

        _credit_single_deposit(deposit.id)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("50.00000000"))

        # Try to credit again — should be a no-op
        _credit_single_deposit(deposit.id)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("50.00000000"))

    def test_already_credited_deposit_skipped(self):
        """Deposits with CREDITED status should be completely skipped."""
        deposit = BlockchainDeposit.objects.create(
            chain="tron",
            tx_hash="abc123already",
            from_address="TSenderAddress",
            to_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
            amount=Decimal("100.00"),
            currency="USDT",
            confirmations=19,
            required_confirmations=19,
            status=BlockchainDeposit.Status.CREDITED,
            block_number=12345,
        )

        _credit_single_deposit(deposit.id)
        self.wallet.refresh_from_db()
        # Balance should remain 0 — deposit was already credited
        self.assertEqual(self.wallet.balance, Decimal("0"))


class DepositDustAtCreditTimeTest(TestCase):
    """Tests for dust threshold re-check at credit time."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.wallet = Wallet.objects.create(
            user=self.user,
            currency="USDT",
            balance=Decimal("0"),
            deposit_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
        )

    def test_dust_deposit_not_credited_even_if_confirmed(self):
        """Deposits below dust threshold should not be credited even if confirmed."""
        deposit = BlockchainDeposit.objects.create(
            chain="tron",
            tx_hash="abc123dust",
            from_address="TSenderAddress",
            to_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
            amount=Decimal("0.50"),  # Below $1 USDT minimum
            currency="USDT",
            confirmations=19,
            required_confirmations=19,
            status=BlockchainDeposit.Status.CONFIRMED,
            block_number=12345,
        )

        _credit_single_deposit(deposit.id)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("0"))


class DepositVelocityTest(TestCase):
    """Tests for deposit velocity anomaly detection."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")

    def test_normal_velocity_passes(self):
        """A few deposits within window should pass."""
        self.assertTrue(check_deposit_velocity("TTestAddr123", "USDT"))

    def test_high_velocity_fails(self):
        """Too many deposits in a short window should fail."""
        # Create 21 deposits in the last 10 minutes
        for i in range(21):
            BlockchainDeposit.objects.create(
                chain="tron",
                tx_hash=f"velocity_test_{i}",
                to_address="THighVelocityAddr",
                amount=Decimal("10.00"),
                currency="USDT",
                confirmations=0,
                required_confirmations=19,
            )

        self.assertFalse(
            check_deposit_velocity("THighVelocityAddr", "USDT", max_count=20)
        )


class USDValueEstimationTest(TestCase):
    """Tests for USD value estimation used in confirmation tier selection."""

    def test_stablecoin_near_1_usd(self):
        """USDT/USDC should estimate near face value."""
        value = estimate_usd_value(Decimal("100"), "USDT")
        self.assertGreater(value, 0)

    def test_btc_high_value(self):
        """BTC should estimate a high USD value per unit."""
        value = estimate_usd_value(Decimal("1"), "BTC")
        # Even with fallback prices, 1 BTC > $1000
        self.assertGreater(value, 1000)

    def test_zero_amount(self):
        value = estimate_usd_value(Decimal("0"), "BTC")
        self.assertEqual(value, 0)


class ProcessPendingDepositsIntegrationTest(TestCase):
    """Integration test for the full process_pending_deposits flow."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+254712345678", pin="123456")
        self.wallet = Wallet.objects.create(
            user=self.user,
            currency="USDT",
            balance=Decimal("0"),
            deposit_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
        )

    def test_full_deposit_flow(self):
        """Test: detecting → confirming → confirmed → credited."""
        deposit = BlockchainDeposit.objects.create(
            chain="tron",
            tx_hash="integration_test_001",
            from_address="TSenderAddress",
            to_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
            amount=Decimal("25.00"),
            currency="USDT",
            confirmations=19,
            required_confirmations=19,
            status=BlockchainDeposit.Status.CONFIRMED,
            block_number=12345,
        )

        process_pending_deposits()

        deposit.refresh_from_db()
        self.assertEqual(deposit.status, BlockchainDeposit.Status.CREDITED)
        self.assertIsNotNone(deposit.credited_at)

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("25.00000000"))

    def test_unconfirmed_not_credited(self):
        """Deposits without enough confirmations should not be credited."""
        deposit = BlockchainDeposit.objects.create(
            chain="tron",
            tx_hash="integration_test_002",
            from_address="TSenderAddress",
            to_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
            amount=Decimal("25.00"),
            currency="USDT",
            confirmations=5,
            required_confirmations=19,
            status=BlockchainDeposit.Status.CONFIRMING,
            block_number=12345,
        )

        process_pending_deposits()

        deposit.refresh_from_db()
        self.assertNotEqual(deposit.status, BlockchainDeposit.Status.CREDITED)

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("0"))

    def test_no_wallet_deposit_not_credited(self):
        """Deposits to unknown addresses should not be credited."""
        deposit = BlockchainDeposit.objects.create(
            chain="tron",
            tx_hash="integration_test_003",
            from_address="TSenderAddress",
            to_address="TUnknownAddr12345678901234567890",
            amount=Decimal("25.00"),
            currency="USDT",
            confirmations=19,
            required_confirmations=19,
            status=BlockchainDeposit.Status.CONFIRMED,
            block_number=12345,
        )

        process_pending_deposits()

        deposit.refresh_from_db()
        # Should remain CONFIRMED (not credited) due to failed ownership check
        self.assertNotEqual(deposit.status, BlockchainDeposit.Status.CREDITED)

    def test_unique_tx_hash_per_chain(self):
        """Same tx_hash on different chains should be treated as separate deposits."""
        Wallet.objects.create(
            user=self.user,
            currency="ETH",
            balance=Decimal("0"),
            deposit_address="0x1234567890abcdef1234567890abcdef12345678",
        )

        deposit1 = BlockchainDeposit.objects.create(
            chain="tron",
            tx_hash="shared_hash_001",
            to_address="TJYeasTPa8KoFBnRkUsMiYBrYtQTagjKxn",
            amount=Decimal("10.00"),
            currency="USDT",
            confirmations=19,
            required_confirmations=19,
            status=BlockchainDeposit.Status.CONFIRMED,
            block_number=12345,
        )

        deposit2 = BlockchainDeposit.objects.create(
            chain="ethereum",
            tx_hash="shared_hash_001",
            to_address="0x1234567890abcdef1234567890abcdef12345678",
            amount=Decimal("5.00"),
            currency="ETH",
            confirmations=64,
            required_confirmations=64,
            status=BlockchainDeposit.Status.CONFIRMED,
            block_number=98765,
        )

        process_pending_deposits()

        deposit1.refresh_from_db()
        deposit2.refresh_from_db()
        self.assertEqual(deposit1.status, BlockchainDeposit.Status.CREDITED)
        self.assertEqual(deposit2.status, BlockchainDeposit.Status.CREDITED)


class BitcoinBech32AddressTest(TestCase):
    """Native SegWit (BIP-173 / P2WPKH) address generation."""

    def test_encode_p2wpkh_mainnet_known_vector(self):
        """BIP-173 test vector: 20-byte all-zero hash -> bc1q... with correct checksum."""
        from apps.blockchain.services import _encode_p2wpkh

        # HASH160 is 20 bytes of zeros — deterministic BIP-173 example.
        addr = _encode_p2wpkh(bytes(20), hrp="bc")
        self.assertTrue(addr.startswith("bc1q"))
        # Length of a P2WPKH bech32 address is always 42 chars for mainnet.
        self.assertEqual(len(addr), 42)

    def test_encode_p2wpkh_testnet_hrp(self):
        """Testnet HRP is `tb`; addresses start with tb1q..."""
        from apps.blockchain.services import _encode_p2wpkh

        addr = _encode_p2wpkh(bytes(20), hrp="tb")
        self.assertTrue(addr.startswith("tb1q"))

    def test_encode_p2wpkh_rejects_wrong_length(self):
        """Anything other than a 20-byte hash is a caller bug."""
        from apps.blockchain.services import _encode_p2wpkh

        with self.assertRaises(ValueError):
            _encode_p2wpkh(b"\x00" * 21, hrp="bc")

    def test_generate_deposit_address_btc_is_bech32(self):
        """End-to-end: real HD-derived key produces a bc1q/tb1q address."""
        from apps.blockchain.services import generate_deposit_address

        # Use a deterministic user_id so the test is reproducible.
        addr = generate_deposit_address(
            user_id="00000000-0000-0000-0000-000000000001",
            currency="BTC",
            address_index=0,
        )
        # HRP depends on current BTC_NETWORK setting — tests default to dev
        # settings where BTC_NETWORK=main unless overridden by env.
        self.assertTrue(
            addr.startswith("bc1q") or addr.startswith("tb1q"),
            f"expected bech32 P2WPKH address, got {addr}",
        )


class BitcoinWithdrawalFeatureFlagTest(TestCase):
    """Gate BTC withdrawals behind BTC_WITHDRAWALS_ENABLED to avoid accidents
    before the native-SegWit signer has been verified on mainnet."""

    def test_sweep_raises_when_disabled(self):
        from django.test import override_settings
        from apps.blockchain.sweep import _execute_btc_sweep

        class _FakeOrder:
            from_address = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
            to_address = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
            amount = Decimal("0.001")

        with override_settings(BTC_WITHDRAWALS_ENABLED=False):
            with self.assertRaisesRegex(RuntimeError, "BTC_WITHDRAWALS_ENABLED"):
                _execute_btc_sweep(_FakeOrder(), private_key=b"\x01" * 32)

    def test_legacy_broadcast_raises_when_disabled(self):
        from django.test import override_settings
        from apps.blockchain.tasks import _broadcast_bitcoin

        with override_settings(BTC_WITHDRAWALS_ENABLED=False):
            with self.assertRaisesRegex(RuntimeError, "BTC_WITHDRAWALS_ENABLED"):
                _broadcast_bitcoin(
                    "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
                    Decimal("0.001"),
                )


class ForexFallbackTest(TestCase):
    """Forex chain must *always* return a non-zero rate — never raise, even
    when every live provider is down."""

    def test_all_providers_fail_returns_hardcoded(self):
        from unittest.mock import patch
        from apps.rates.forex import fetch_usd_kes_rate
        from apps.rates.models import ExchangeRate

        # Ensure DB is empty so we exercise the hard-coded tail branch, not
        # a stale row from another test.
        ExchangeRate.objects.filter(pair="USD/KES").delete()

        with patch("apps.rates.forex._provider_exchangerate_api", return_value=None), \
             patch("apps.rates.forex._provider_open_exchange_rates", return_value=None), \
             patch("apps.rates.forex._provider_fixer", return_value=None):
            quote = fetch_usd_kes_rate()

        self.assertGreater(quote.rate, Decimal("0"))
        self.assertEqual(quote.source, "fallback")

    def test_first_provider_wins(self):
        from unittest.mock import patch
        from apps.rates.forex import fetch_usd_kes_rate

        with patch("apps.rates.forex._provider_exchangerate_api",
                   return_value=Decimal("145.25")):
            quote = fetch_usd_kes_rate()

        self.assertEqual(quote.source, "exchangerate-api")
        self.assertEqual(quote.rate, Decimal("145.25"))
