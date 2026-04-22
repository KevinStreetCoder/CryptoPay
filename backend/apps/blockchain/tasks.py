"""
Celery tasks for blockchain deposit monitoring.

Tron (TRC-20 USDT) listener and shared deposit-crediting logic.
ETH, BTC, and SOL listeners live in their own dedicated modules:
  - eth_listener.py  (Ethereum / ERC-20)
  - btc_listener.py  (Bitcoin via BlockCypher)
  - sol_listener.py  (Solana / SPL)

Production-grade security hardening:
  - Dust attack prevention (minimum deposit thresholds)
  - Amount-based confirmation tiers (more confs for larger deposits)
  - Address format validation
  - Re-org detection (block hash verification)
  - Double-credit prevention (select_for_update locking)
  - Deposit velocity anomaly detection
"""

import logging
import uuid
from decimal import Decimal

import requests
from celery import shared_task
from django.conf import settings
from django.db import transaction as db_transaction
from django.utils import timezone

from apps.wallets.models import Wallet
from apps.wallets.services import WalletService

from .models import BlockchainDeposit
from .security import (
    check_confirmation_monotonicity,
    check_deposit_velocity,
    check_stablecoin_blacklist,
    estimate_usd_value,
    get_required_confirmations,
    is_dust_deposit,
    validate_address,
    validate_deposit_address_ownership,
    verify_block_hash,
)

logger = logging.getLogger(__name__)

# USDT TRC-20 contract address
USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"  # Mainnet
USDT_TRC20_CONTRACT_SHASTA = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"  # Shasta testnet

# TronGrid API endpoints
TRONGRID_MAINNET = "https://api.trongrid.io"
TRONGRID_SHASTA = "https://api.shasta.trongrid.io"


def _get_trongrid_base_url() -> str:
    """Get TronGrid base URL based on configured network."""
    network = getattr(settings, "TRON_NETWORK", "shasta")
    return TRONGRID_MAINNET if network == "mainnet" else TRONGRID_SHASTA


def _get_usdt_contract() -> str:
    """Get USDT contract address based on configured network."""
    network = getattr(settings, "TRON_NETWORK", "shasta")
    return USDT_TRC20_CONTRACT if network == "mainnet" else USDT_TRC20_CONTRACT_SHASTA


def _get_trongrid_headers() -> dict:
    """Get TronGrid API headers."""
    headers = {"Accept": "application/json"}
    api_key = getattr(settings, "TRON_API_KEY", "")
    if api_key:
        headers["TRON-PRO-API-KEY"] = api_key
    return headers


@shared_task
def monitor_tron_deposits():
    """
    Poll for new TRC-20 USDT deposits on Tron via TronGrid API.
    Runs every 10 seconds via Celery Beat.

    For each monitored address:
    1. Query TronGrid for recent TRC-20 transfers TO that address
    2. Create BlockchainDeposit records for new transactions
    3. process_pending_deposits() handles confirmation tracking
    """
    tron_wallets = list(
        Wallet.objects.filter(
            currency="USDT",
            deposit_address__startswith="T",
        ).values_list("deposit_address", flat=True)
    )

    if not tron_wallets:
        return

    base_url = _get_trongrid_base_url()
    headers = _get_trongrid_headers()
    usdt_contract = _get_usdt_contract()
    required_confirmations = settings.REQUIRED_CONFIRMATIONS.get("tron", 19)

    for address in tron_wallets:
        try:
            # Query TRC-20 transfers to this address
            url = f"{base_url}/v1/accounts/{address}/transactions/trc20"
            params = {
                "only_to": "true",
                "limit": 20,
                "contract_address": usdt_contract,
            }
            response = requests.get(url, headers=headers, params=params, timeout=10)

            if response.status_code != 200:
                logger.warning(
                    f"TronGrid API error for {address[:10]}...: {response.status_code}"
                )
                continue

            data = response.json()
            transactions = data.get("data", [])

            for tx in transactions:
                tx_hash = tx.get("transaction_id", "")
                if not tx_hash:
                    continue

                # Skip if we already track this deposit
                if BlockchainDeposit.objects.filter(
                    chain="tron", tx_hash=tx_hash
                ).exists():
                    continue

                # Parse amount (USDT has 6 decimals on TRC-20)
                raw_value = tx.get("value", "0")
                amount = Decimal(raw_value) / Decimal("1000000")

                if amount <= 0:
                    continue

                # Security: reject dust deposits
                if is_dust_deposit(amount, "USDT"):
                    continue

                # Security: validate address format
                if not validate_address("tron", address):
                    continue

                # Security: check deposit velocity
                if not check_deposit_velocity(address, "USDT"):
                    logger.critical(f"Deposit velocity exceeded for {address[:10]}..., skipping new deposits")
                    break

                from_address = tx.get("from", "")
                # TronGrid TRC-20 API returns block_timestamp (ms) but NOT
                # block_number directly. We need the block number for
                # confirmation counting. Extract it from the transaction info
                # if available, otherwise leave null (update_tron_confirmations
                # will handle it via tx lookup).
                block_number = None
                tx_info_url = f"{base_url}/v1/transactions/{tx_hash}"
                try:
                    tx_info_resp = requests.get(
                        tx_info_url, headers=headers, timeout=5,
                    )
                    if tx_info_resp.status_code == 200:
                        tx_info_data = tx_info_resp.json().get("data", [])
                        if tx_info_data:
                            block_number = tx_info_data[0].get(
                                "blockNumber",
                                tx_info_data[0].get("block_number"),
                            )
                except Exception:
                    pass  # Will be resolved in update_tron_confirmations

                # Security: amount-based confirmation tier
                usd_value = estimate_usd_value(amount, "USDT")
                dynamic_confirmations = get_required_confirmations("tron", usd_value)

                # Create deposit record
                BlockchainDeposit.objects.create(
                    chain="tron",
                    tx_hash=tx_hash,
                    from_address=from_address,
                    to_address=address,
                    amount=amount,
                    currency="USDT",
                    confirmations=0,
                    required_confirmations=dynamic_confirmations,
                    status=BlockchainDeposit.Status.DETECTING,
                    block_number=block_number,
                )

                logger.info(
                    f"Detected USDT deposit: {amount} USDT to {address[:10]}... "
                    f"tx={tx_hash[:16]}... (requires {dynamic_confirmations} confs)"
                )

        except requests.RequestException as e:
            logger.error(f"TronGrid request failed for {address[:10]}...: {e}")
        except Exception as e:
            logger.error(f"Error monitoring {address[:10]}...: {e}")

    logger.debug(f"Monitored {len(tron_wallets)} Tron addresses for deposits")


@shared_task
def update_tron_confirmations():
    """
    Update confirmation count for pending Tron deposits.
    Queries TronGrid for current block number and calculates confirmations.
    """
    pending = BlockchainDeposit.objects.filter(
        chain="tron",
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    if not pending.exists():
        return

    base_url = _get_trongrid_base_url()
    headers = _get_trongrid_headers()

    try:
        # Get current block number
        response = requests.post(
            f"{base_url}/wallet/getnowblock",
            headers=headers,
            timeout=10,
        )
        if response.status_code != 200:
            logger.warning(f"Failed to get current block: {response.status_code}")
            return

        current_block = response.json().get("block_header", {}).get("raw_data", {}).get("number", 0)
        if not current_block:
            return

    except requests.RequestException as e:
        logger.error(f"Failed to get current Tron block: {e}")
        return

    for deposit in pending:
        # If block_number is missing or looks like a timestamp (> 10 billion),
        # look up the actual block number from the transaction.
        if not deposit.block_number or deposit.block_number > 10_000_000_000:
            try:
                # Try standard transaction lookup first
                tx_url = f"{base_url}/v1/transactions/{deposit.tx_hash}"
                tx_resp = requests.get(tx_url, headers=headers, timeout=5)
                real_block = None
                if tx_resp.status_code == 200:
                    tx_data = tx_resp.json().get("data", [])
                    if tx_data:
                        real_block = tx_data[0].get(
                            "blockNumber", tx_data[0].get("block_number")
                        )

                # Fallback: TRC-20 transfers use /wallet/gettransactioninfobyid
                if not real_block:
                    info_url = f"{base_url}/wallet/gettransactioninfobyid"
                    info_resp = requests.post(
                        info_url,
                        json={"value": deposit.tx_hash},
                        headers=headers,
                        timeout=5,
                    )
                    if info_resp.status_code == 200:
                        info_data = info_resp.json()
                        real_block = info_data.get("blockNumber")

                if real_block and real_block < 10_000_000_000:
                    deposit.block_number = real_block
                    deposit.save(update_fields=["block_number"])
            except Exception as e:
                logger.warning(
                    f"Failed to resolve block_number for Tron deposit "
                    f"{deposit.id}: {e}"
                )

        if deposit.block_number and deposit.block_number < 10_000_000_000:
            confirmations = max(0, current_block - deposit.block_number + 1)

            # Security: confirmation monotonicity check (re-org detection)
            if not check_confirmation_monotonicity(deposit, confirmations):
                deposit.status = BlockchainDeposit.Status.CONFIRMING
                deposit.save(update_fields=["status"])
                continue

            deposit.confirmations = confirmations

            if confirmations >= deposit.required_confirmations:
                deposit.status = BlockchainDeposit.Status.CONFIRMED
            else:
                deposit.status = BlockchainDeposit.Status.CONFIRMING

            deposit.save(update_fields=["confirmations", "status"])

    logger.debug(f"Updated confirmations for {pending.count()} Tron deposits")


@shared_task
def process_pending_deposits():
    """
    Credit user wallet once required confirmations are reached.
    Processes CONFIRMED deposits that haven't been credited yet.

    Security hardening:
      - select_for_update() prevents double-crediting from concurrent workers
      - Re-org detection via block hash verification (ETH)
      - Address ownership validation before crediting
      - Dust threshold re-check at credit time
      - Atomic transaction wrapping per deposit
    """
    confirmed_ids = list(
        BlockchainDeposit.objects.filter(
            status=BlockchainDeposit.Status.CONFIRMED,
        ).values_list("id", flat=True)
    )

    for deposit_id in confirmed_ids:
        try:
            _credit_single_deposit(deposit_id)
        except Exception as e:
            logger.error(f"Failed to credit deposit {deposit_id}: {e}")

    # Also process legacy detecting/confirming that have enough confirmations
    pending = BlockchainDeposit.objects.filter(
        status__in=[BlockchainDeposit.Status.DETECTING, BlockchainDeposit.Status.CONFIRMING],
    )

    for deposit in pending:
        if deposit.confirmations >= deposit.required_confirmations:
            deposit.status = BlockchainDeposit.Status.CONFIRMED
            deposit.save(update_fields=["status"])


@db_transaction.atomic
def _credit_single_deposit(deposit_id: int):
    """
    Credit a single deposit atomically with full security checks.

    Uses select_for_update() to lock the deposit row, preventing
    concurrent workers from double-crediting the same deposit.
    """
    # Lock the deposit row to prevent concurrent crediting
    deposit = (
        BlockchainDeposit.objects
        .select_for_update()
        .filter(id=deposit_id, status=BlockchainDeposit.Status.CONFIRMED)
        .first()
    )

    if not deposit:
        return  # Already credited or status changed

    # Security check 1: Re-org detection (ETH block hash verification)
    if not verify_block_hash(deposit.chain, deposit):
        logger.critical(
            f"BLOCKING credit for deposit {deposit.id} due to re-org detection. "
            f"Reverting to CONFIRMING for re-verification."
        )
        deposit.status = BlockchainDeposit.Status.CONFIRMING
        deposit.save(update_fields=["status"])
        return

    # Security check 2: Verify destination address belongs to our system
    if not validate_deposit_address_ownership(deposit.to_address, deposit.currency):
        logger.critical(
            f"BLOCKING credit for deposit {deposit.id}: "
            f"address {deposit.to_address[:16]}... not found in our wallets"
        )
        return

    # Security check 3: Re-check dust threshold at credit time
    if is_dust_deposit(deposit.amount, deposit.currency):
        logger.warning(
            f"Dust deposit {deposit.id} reached CONFIRMED but below threshold. Skipping."
        )
        return

    # Security check 4: Stablecoin blacklist/freeze check
    if not check_stablecoin_blacklist(deposit.from_address, deposit.currency):
        logger.critical(
            f"BLOCKING credit for deposit {deposit.id}: "
            f"sender {deposit.from_address[:16]}... is blacklisted ({deposit.currency})"
        )
        return

    # Find the wallet
    wallet = Wallet.objects.filter(
        deposit_address=deposit.to_address,
        currency=deposit.currency,
    ).first()

    if not wallet:
        logger.warning(f"No wallet found for deposit to {deposit.to_address}")
        return

    # Credit the wallet (WalletService.credit uses its own select_for_update).
    # Use deterministic UUID5 from deposit chain+tx_hash to prevent double-credit
    # if this function is retried. Same deposit always produces same tx_id.
    tx_id = uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"deposit:{deposit.chain}:{deposit.tx_hash}",
    )
    WalletService.credit(
        wallet.id,
        deposit.amount,
        tx_id,
        f"Blockchain deposit: {deposit.chain} tx {deposit.tx_hash}",
    )
    deposit.status = BlockchainDeposit.Status.CREDITED
    deposit.credited_at = timezone.now()
    deposit.save(update_fields=["status", "credited_at"])

    logger.info(
        f"Credited {deposit.amount} {deposit.currency} to wallet {wallet.id} "
        f"(user={wallet.user_id}, tx={deposit.tx_hash[:16]}...)"
    )

    # Send deposit confirmed notification (email + push)
    try:
        from apps.core.email import send_deposit_confirmed_notification
        send_deposit_confirmed_notification(wallet.user, deposit)
    except Exception as e:
        logger.error(f"Deposit notification failed for {deposit.id}: {e}")

    # Broadcast updated balance via WebSocket
    try:
        from apps.core.broadcast import broadcast_user_balance
        broadcast_user_balance(wallet.user_id)
    except Exception as e:
        logger.warning(f"Balance broadcast failed for deposit {deposit.id}: {e}")


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def broadcast_withdrawal_task(self, transaction_id: str):
    """
    Broadcast a crypto withdrawal to the blockchain.

    Steps:
      1. Load the transaction and validate state
      2. Debit the wallet (unlock + debit atomically)
      3. Sign and broadcast the transaction
      4. Update transaction with tx_hash
      5. On failure: unlock funds (compensation)

    Currently implements Tron (TRC-20 USDT) broadcast.
    Other chains follow the same pattern — extend as needed.
    """
    from apps.payments.models import Transaction
    from apps.wallets.services import WalletService

    try:
        tx = Transaction.objects.get(id=transaction_id)
    except Transaction.DoesNotExist:
        logger.error(f"Withdrawal task: transaction {transaction_id} not found")
        return

    # Guard: only process PROCESSING withdrawals
    if tx.status != Transaction.Status.PROCESSING:
        logger.warning(
            f"Withdrawal task: tx {tx.id} is {tx.status}, expected PROCESSING. Skipping."
        )
        return

    network = tx.saga_data.get("network", "")
    destination_address = tx.saga_data.get("destination_address", "")
    locked_wallet_id = tx.saga_data.get("locked_wallet_id")
    locked_amount = Decimal(tx.saga_data.get("locked_amount", "0"))

    if not destination_address or not network:
        tx.status = Transaction.Status.FAILED
        tx.failure_reason = "Missing destination address or network"
        tx.save(update_fields=["status", "failure_reason", "updated_at"])
        # Unlock funds
        if locked_wallet_id and locked_amount > 0:
            WalletService.unlock_funds(locked_wallet_id, locked_amount)
        return

    try:
        # Step 1: Unlock and debit funds atomically
        with db_transaction.atomic():
            WalletService.unlock_funds(locked_wallet_id, locked_amount)
            WalletService.debit(
                locked_wallet_id,
                locked_amount,
                tx.id,
                f"Withdrawal to {destination_address[:16]}... ({network})",
            )
            tx.saga_data["funds_debited"] = True
            tx.save(update_fields=["saga_data"])

        # Step 2: Broadcast to blockchain
        tx_hash = _broadcast_to_chain(
            network=network,
            currency=tx.source_currency,
            destination_address=destination_address,
            amount=tx.source_amount,
        )

        # Step 3: Update transaction with tx_hash
        tx.tx_hash = tx_hash
        tx.status = Transaction.Status.CONFIRMING
        tx.save(update_fields=["tx_hash", "status", "updated_at"])

        logger.info(
            f"Withdrawal broadcast: {tx.source_amount} {tx.source_currency} "
            f"to {destination_address[:16]}... tx_hash={tx_hash[:24]}..."
        )

    except Exception as e:
        logger.error(f"Withdrawal broadcast failed for tx {tx.id}: {e}")

        # Compensation: if funds were debited, credit them back
        if tx.saga_data.get("funds_debited"):
            try:
                import uuid as uuid_mod
                reversal_tx_id = uuid_mod.uuid5(
                    uuid_mod.NAMESPACE_URL,
                    f"withdrawal-reversal:{tx.id}",
                )
                WalletService.credit(
                    locked_wallet_id,
                    locked_amount,
                    reversal_tx_id,
                    f"Reversal: failed withdrawal {tx.id}",
                )
                logger.info(f"Compensated: credited back {locked_amount} for failed withdrawal {tx.id}")
            except Exception as comp_error:
                logger.critical(
                    f"CRITICAL: Withdrawal compensation failed for tx {tx.id}: {comp_error}. "
                    f"MANUAL INTERVENTION REQUIRED."
                )
        else:
            # Funds were only locked, not debited — just unlock
            try:
                WalletService.unlock_funds(locked_wallet_id, locked_amount)
            except Exception as unlock_error:
                logger.critical(
                    f"CRITICAL: Failed to unlock funds for tx {tx.id}: {unlock_error}. "
                    f"MANUAL INTERVENTION REQUIRED."
                )

        tx.status = Transaction.Status.FAILED
        tx.failure_reason = str(e)[:500]
        tx.save(update_fields=["status", "failure_reason", "updated_at"])

        # Send failed transaction alert
        try:
            from apps.core.tasks import send_failed_transaction_alert_task
            send_failed_transaction_alert_task.delay(transaction_id=str(tx.id))
        except Exception:
            pass

        # Retry for transient errors (network timeouts, etc.)
        if self.request.retries < self.max_retries and _is_retryable_error(e):
            raise self.retry(exc=e)


def _broadcast_to_chain(network: str, currency: str, destination_address: str, amount: Decimal) -> str:
    """
    Broadcast a withdrawal transaction to the appropriate blockchain.

    Returns the transaction hash on success.
    Raises an exception on failure.

    Currently implements:
      - Tron (TRC-20 USDT) via tronpy
      - EVM (Ethereum/Polygon) via web3
      - Other chains: DEV mode auto-generates a hash

    Production: extend with real signing for each chain.
    """
    from django.conf import settings as django_settings

    # Dev mode: skip actual broadcast and return a mock tx hash
    if django_settings.DEBUG:
        import hashlib
        import time
        mock_hash = hashlib.sha256(
            f"{destination_address}{amount}{time.time()}".encode()
        ).hexdigest()
        logger.info(
            f"[DEV] Mock withdrawal broadcast: {amount} {currency} "
            f"to {destination_address[:16]}... on {network} -> hash={mock_hash[:24]}..."
        )

        # Auto-complete the withdrawal in dev mode
        from apps.payments.models import Transaction
        tx = Transaction.objects.filter(
            saga_data__destination_address=destination_address,
            status=Transaction.Status.CONFIRMING,
        ).order_by("-created_at").first()
        if tx:
            tx.status = Transaction.Status.COMPLETED
            tx.completed_at = timezone.now()
            tx.save(update_fields=["status", "completed_at", "updated_at"])

        return mock_hash

    if network == "tron" and currency == "USDT":
        return _broadcast_tron_trc20(destination_address, amount)
    elif network in ("ethereum", "polygon"):
        return _broadcast_evm(network, currency, destination_address, amount)
    elif network == "solana":
        return _broadcast_solana(currency, destination_address, amount)
    elif network == "bitcoin":
        return _broadcast_bitcoin(destination_address, amount)
    else:
        raise NotImplementedError(
            f"Withdrawal broadcast not yet implemented for {currency} on {network}. "
            f"Contact support to process this withdrawal manually."
        )


def _broadcast_tron_trc20(destination_address: str, amount: Decimal) -> str:
    """
    Broadcast a TRC-20 USDT transfer on Tron using tronpy.

    A14: key material is loaded just-in-time via `secure_keys.load_hot_wallet_key`
    (which prefers KMS decryption when configured) and the buffer is wiped
    immediately after the transaction is signed · so the signing key exists
    in process memory only for the duration of a single transaction build.
    """
    from django.conf import settings as django_settings
    from apps.blockchain.secure_keys import load_hot_wallet_key, wipe, HotWalletKeyMissing

    try:
        key_ba = load_hot_wallet_key("tron")
    except HotWalletKeyMissing as e:
        raise RuntimeError(str(e))

    try:
        from tronpy import Tron
        from tronpy.keys import PrivateKey

        network = getattr(django_settings, "TRON_NETWORK", "shasta")
        if network == "mainnet":
            client = Tron()
        else:
            client = Tron(network=network)

        contract_address = _get_usdt_contract()
        contract = client.get_contract(contract_address)

        priv_key = PrivateKey(bytes(key_ba))  # tronpy requires bytes; wiped below
        from_address = priv_key.public_key.to_base58check_address()

        # USDT has 6 decimals on TRC-20
        raw_amount = int(amount * Decimal("1000000"))

        txn = (
            contract.functions.transfer(destination_address, raw_amount)
            .with_owner(from_address)
            .fee_limit(30_000_000)  # 30 TRX fee limit
            .build()
            .sign(priv_key)
        )
        result = txn.broadcast()

        if result.get("result", False):
            tx_hash = result.get("txid", "")
            logger.info(f"Tron TRC-20 withdrawal broadcast: {tx_hash}")
            return tx_hash
        else:
            raise RuntimeError(f"Tron broadcast failed: {result}")

    except ImportError:
        raise RuntimeError(
            "tronpy is required for Tron withdrawals. Install with: pip install tronpy"
        )
    finally:
        # A14: zero the buffer so a later memory dump / Sentry capture / core
        # file cannot recover the signing key.
        wipe(key_ba)


def _broadcast_evm(network: str, currency: str, destination_address: str, amount: Decimal) -> str:
    """
    Broadcast an EVM (Ethereum/Polygon) withdrawal.

    For ETH: native transfer.
    For ERC-20 tokens (USDT, USDC): token transfer via contract.

    Requires ETH_HOT_WALLET_PRIVATE_KEY or POLYGON_HOT_WALLET_PRIVATE_KEY in settings.
    """
    from django.conf import settings as django_settings

    from apps.blockchain.secure_keys import load_hot_wallet_key, wipe, HotWalletKeyMissing

    if network == "polygon":
        rpc_url = getattr(django_settings, "POLYGON_RPC_URL", "")
        chain_key = "polygon"
    else:
        rpc_url = getattr(django_settings, "ETH_RPC_URL", "")
        chain_key = "eth"

    if not rpc_url:
        raise RuntimeError(
            f"{network.upper()} RPC URL not configured. Cannot broadcast {network} withdrawals."
        )

    try:
        key_ba = load_hot_wallet_key(chain_key)
    except HotWalletKeyMissing as e:
        raise RuntimeError(str(e))

    # `web3.py` accepts either a 0x-hex string or raw bytes. We feed bytes
    # so the private key never exists as an immutable str in memory.
    private_key = bytes(key_ba)

    try:
        from web3 import Web3

        w3 = Web3(Web3.HTTPProvider(rpc_url))

        if not w3.is_connected():
            raise RuntimeError(f"Cannot connect to {network} RPC: {rpc_url[:30]}...")

        account = w3.eth.account.from_key(private_key)

        # EIP-1559 fee estimation (Ethereum mainnet) or legacy gas price (Polygon/testnets)
        nonce = w3.eth.get_transaction_count(account.address)
        latest_block = w3.eth.get_block("latest")
        supports_eip1559 = "baseFeePerGas" in latest_block

        def _build_fee_params() -> dict:
            if supports_eip1559:
                base_fee = latest_block["baseFeePerGas"]
                priority_fee = w3.eth.max_priority_fee
                max_fee = base_fee * 2 + priority_fee
                return {
                    "maxFeePerGas": max_fee,
                    "maxPriorityFeePerGas": priority_fee,
                    "type": 2,
                }
            return {"gasPrice": w3.eth.gas_price}

        if currency in ("USDT", "USDC"):
            # ERC-20 token transfer
            token_contracts = {
                "ethereum": {
                    "USDT": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
                    "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                },
                "polygon": {
                    "USDT": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
                    "USDC": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
                },
            }
            contract_address = token_contracts.get(network, {}).get(currency)
            if not contract_address:
                raise RuntimeError(f"No contract address for {currency} on {network}")

            # Standard ERC-20 ABI for transfer
            erc20_abi = [
                {
                    "constant": False,
                    "inputs": [
                        {"name": "_to", "type": "address"},
                        {"name": "_value", "type": "uint256"},
                    ],
                    "name": "transfer",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                }
            ]
            contract = w3.eth.contract(
                address=Web3.to_checksum_address(contract_address),
                abi=erc20_abi,
            )
            # Both USDT and USDC have 6 decimals
            raw_amount = int(amount * Decimal("1000000"))
            tx = contract.functions.transfer(
                Web3.to_checksum_address(destination_address),
                raw_amount,
            ).build_transaction({
                "from": account.address,
                "nonce": nonce,
                "gas": 100_000,
                **_build_fee_params(),
            })
        else:
            # Native ETH transfer
            raw_amount = int(amount * Decimal("1000000000000000000"))  # 18 decimals
            tx = {
                "to": Web3.to_checksum_address(destination_address),
                "value": raw_amount,
                "gas": 21_000,
                "nonce": nonce,
                **_build_fee_params(),
            }

        signed_tx = w3.eth.account.sign_transaction(tx, private_key)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        hex_hash = tx_hash.hex()

        logger.info(f"EVM withdrawal broadcast on {network}: {hex_hash}")
        return hex_hash

    except ImportError:
        raise RuntimeError(
            "web3 is required for EVM withdrawals. Install with: pip install web3"
        )
    finally:
        # A14: wipe both the bytearray and the derived bytes view. `bytes`
        # is immutable so we can only drop the reference · the wipe on the
        # bytearray zeros the backing memory the `bytes` was copied from.
        try:
            wipe(key_ba)
        except Exception:
            pass
        private_key = None  # type: ignore[assignment]  # nosec: reset reference
        del private_key


def _broadcast_solana(currency: str, destination_address: str, amount: Decimal) -> str:
    """
    Broadcast a Solana withdrawal (native SOL or SPL token).

    For SOL: native system transfer.
    For USDT/USDC on Solana: SPL token transfer.

    A14: the hot-wallet keypair is loaded via `secure_keys.load_hot_wallet_key`
    just-in-time and wiped from process memory immediately after the tx is
    built. Stored format on disk is either base58 (default Solana keypair)
    or a JSON byte array · both flow through the same bytearray wrapper.
    """
    from django.conf import settings as django_settings
    from apps.blockchain.secure_keys import load_hot_wallet_key, wipe, HotWalletKeyMissing

    rpc_url = getattr(django_settings, "SOL_RPC_URL", "https://api.mainnet-beta.solana.com")

    try:
        key_ba = load_hot_wallet_key("sol")
    except HotWalletKeyMissing as e:
        raise RuntimeError(str(e))

    # `secure_keys` returns bytes for the non-hex path — Solana's base58 /
    # JSON-array formats land here as utf-8 encoded strings. Decode back to
    # str for `Keypair.from_*` without ever letting the key linger as an
    # immutable settings attribute.
    private_key = bytes(key_ba).decode("utf-8", errors="ignore")

    try:
        from solders.keypair import Keypair
        from solders.pubkey import Pubkey
        from solders.system_program import TransferParams, transfer
        from solders.transaction import Transaction as SolTransaction
        from solders.message import Message
        from solders.hash import Hash as SolHash
        import base64 as b64
        import requests as req
        import json as json_mod

        # Parse private key (support both base58 and JSON byte array)
        if private_key.startswith("["):
            key_bytes = bytes(json_mod.loads(private_key))
            sender = Keypair.from_bytes(key_bytes)
        else:
            sender = Keypair.from_base58_string(private_key)

        recipient = Pubkey.from_string(destination_address)

        if currency == "SOL":
            # Native SOL transfer (9 decimals = lamports)
            lamports = int(amount * Decimal("1000000000"))

            # Get recent blockhash
            resp = req.post(rpc_url, json={
                "jsonrpc": "2.0", "id": 1,
                "method": "getLatestBlockhash",
                "params": [{"commitment": "finalized"}],
            }, timeout=30).json()
            blockhash_str = resp["result"]["value"]["blockhash"]
            blockhash = SolHash.from_string(blockhash_str)

            # Build and sign transaction
            ix = transfer(TransferParams(
                from_pubkey=sender.pubkey(),
                to_pubkey=recipient,
                lamports=lamports,
            ))
            msg = Message.new_with_blockhash([ix], sender.pubkey(), blockhash)
            tx = SolTransaction.new([sender], msg, blockhash)

            # Send transaction
            tx_bytes = bytes(tx)
            tx_b64 = b64.b64encode(tx_bytes).decode("ascii")
            send_resp = req.post(rpc_url, json={
                "jsonrpc": "2.0", "id": 1,
                "method": "sendTransaction",
                "params": [tx_b64, {"encoding": "base64", "preflightCommitment": "confirmed"}],
            }, timeout=30).json()

            if "error" in send_resp:
                raise RuntimeError(f"Solana broadcast failed: {send_resp['error']}")

            tx_hash = send_resp["result"]
            logger.info(f"Solana SOL withdrawal broadcast: {tx_hash}")
            return tx_hash

        else:
            # SPL token transfer (USDT/USDC on Solana)
            # Uses raw instruction construction via solders (no separate spl-token lib needed)
            from solders.instruction import Instruction, AccountMeta

            SPL_TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
            ASSOCIATED_TOKEN_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")

            # Token mint addresses on Solana mainnet
            SPL_MINTS = {
                "USDT": Pubkey.from_string("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
                "USDC": Pubkey.from_string("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
            }

            mint = SPL_MINTS.get(currency)
            if not mint:
                raise RuntimeError(f"No SPL mint address for {currency} on Solana")

            # Both USDT and USDC have 6 decimals on Solana
            raw_amount = int(amount * Decimal("1000000"))

            # Derive Associated Token Accounts (ATAs) for sender and recipient
            def find_ata(owner: Pubkey, mint_addr: Pubkey) -> Pubkey:
                seeds = [bytes(owner), bytes(SPL_TOKEN_PROGRAM), bytes(mint_addr)]
                ata, _ = Pubkey.find_program_address(seeds, ASSOCIATED_TOKEN_PROGRAM)
                return ata

            sender_ata = find_ata(sender.pubkey(), mint)
            recipient_ata = find_ata(recipient, mint)

            # Check if recipient ATA exists; if not, create it
            ata_check = req.post(rpc_url, json={
                "jsonrpc": "2.0", "id": 1,
                "method": "getAccountInfo",
                "params": [str(recipient_ata), {"encoding": "base64"}],
            }, timeout=30).json()

            instructions = []

            if not ata_check.get("result", {}).get("value"):
                # Create Associated Token Account for recipient
                create_ata_ix = Instruction(
                    program_id=ASSOCIATED_TOKEN_PROGRAM,
                    accounts=[
                        AccountMeta(sender.pubkey(), is_signer=True, is_writable=True),
                        AccountMeta(recipient_ata, is_signer=False, is_writable=True),
                        AccountMeta(recipient, is_signer=False, is_writable=False),
                        AccountMeta(mint, is_signer=False, is_writable=False),
                        AccountMeta(Pubkey.from_string("11111111111111111111111111111111"), is_signer=False, is_writable=False),
                        AccountMeta(SPL_TOKEN_PROGRAM, is_signer=False, is_writable=False),
                    ],
                    data=b"",
                )
                instructions.append(create_ata_ix)

            # SPL Token transfer instruction (instruction index 3 = Transfer)
            transfer_data = b"\x03" + raw_amount.to_bytes(8, "little")
            transfer_ix = Instruction(
                program_id=SPL_TOKEN_PROGRAM,
                accounts=[
                    AccountMeta(sender_ata, is_signer=False, is_writable=True),
                    AccountMeta(recipient_ata, is_signer=False, is_writable=True),
                    AccountMeta(sender.pubkey(), is_signer=True, is_writable=False),
                ],
                data=transfer_data,
            )
            instructions.append(transfer_ix)

            # Get recent blockhash
            resp = req.post(rpc_url, json={
                "jsonrpc": "2.0", "id": 1,
                "method": "getLatestBlockhash",
                "params": [{"commitment": "finalized"}],
            }, timeout=30).json()
            blockhash = SolHash.from_string(resp["result"]["value"]["blockhash"])

            # Build and sign transaction
            msg = Message.new_with_blockhash(instructions, sender.pubkey(), blockhash)
            tx = SolTransaction.new([sender], msg, blockhash)

            # Send
            tx_bytes = bytes(tx)
            tx_b64 = b64.b64encode(tx_bytes).decode("ascii")
            send_resp = req.post(rpc_url, json={
                "jsonrpc": "2.0", "id": 1,
                "method": "sendTransaction",
                "params": [tx_b64, {"encoding": "base64", "preflightCommitment": "confirmed"}],
            }, timeout=30).json()

            if "error" in send_resp:
                raise RuntimeError(f"Solana SPL broadcast failed: {send_resp['error']}")

            tx_hash = send_resp["result"]
            logger.info(f"Solana SPL {currency} withdrawal broadcast: {tx_hash}")
            return tx_hash

    except ImportError:
        raise RuntimeError(
            "solders is required for Solana withdrawals. Install with: pip install solders"
        )
    finally:
        # A14: zero the loaded key bytearray and drop the str reference.
        try:
            wipe(key_ba)
        except Exception:
            pass
        private_key = None  # type: ignore[assignment]  # nosec: reset reference
        del private_key


def _broadcast_bitcoin(destination_address: str, amount: Decimal) -> str:
    """
    Broadcast a Bitcoin withdrawal using the bit library.

    Supports P2WPKH (native segwit bech32), P2SH-P2WPKH, and legacy addresses.
    Uses BlockCypher API for fee estimation and broadcast.

    Requires BTC_HOT_WALLET_PRIVATE_KEY (WIF format).

    Guarded by BTC_WITHDRAWALS_ENABLED. Set in production only after the
    native SegWit migration has been verified end-to-end against mainnet.
    """
    from django.conf import settings as django_settings

    if not getattr(django_settings, "BTC_WITHDRAWALS_ENABLED", False):
        raise RuntimeError(
            "BTC withdrawals are disabled by BTC_WITHDRAWALS_ENABLED=False. "
            "Enable only after verifying native SegWit addresses on mainnet."
        )

    from apps.blockchain.secure_keys import load_hot_wallet_key, wipe, HotWalletKeyMissing

    btc_network = getattr(django_settings, "BTC_NETWORK", "testnet")

    try:
        key_ba = load_hot_wallet_key("btc")
    except HotWalletKeyMissing as e:
        raise RuntimeError(f"{e} (WIF format required)")

    # WIF strings are base58check-encoded; secure_keys returns utf-8 bytes.
    private_key_wif = bytes(key_ba).decode("utf-8", errors="ignore")

    try:
        from bit import Key, PrivateKeyTestnet

        # Use testnet key for non-mainnet
        if btc_network == "mainnet":
            key = Key(private_key_wif)
        else:
            key = PrivateKeyTestnet(private_key_wif)

        # Convert BTC to satoshis (8 decimals)
        satoshis = int(amount * Decimal("100000000"))

        # Get current fee per byte from the network
        balance = key.get_balance("satoshi")
        if int(balance) < satoshis:
            raise RuntimeError(
                f"Insufficient BTC balance: have {balance} sat, need {satoshis} sat"
            )

        # Create and broadcast transaction
        tx_hash = key.send(
            [(destination_address, satoshis, "satoshi")],
            fee="normal",
        )

        logger.info(f"Bitcoin withdrawal broadcast: {tx_hash}")
        return tx_hash

    except ImportError:
        raise RuntimeError(
            "bit is required for Bitcoin withdrawals. Install with: pip install bit"
        )
    finally:
        # A14: zero the WIF bytearray. `bit.Key(...)` retains the key
        # internally so the process still holds it for the duration of
        # `key.send`, but the env-derived buffer is gone.
        try:
            wipe(key_ba)
        except Exception:
            pass
        private_key_wif = None  # type: ignore[assignment]  # nosec: reset reference
        del private_key_wif


def _is_retryable_error(error: Exception) -> bool:
    """Check if an error is transient and worth retrying."""
    retryable_messages = [
        "timeout",
        "connection",
        "temporarily unavailable",
        "rate limit",
        "503",
        "502",
    ]
    error_str = str(error).lower()
    return any(msg in error_str for msg in retryable_messages)

