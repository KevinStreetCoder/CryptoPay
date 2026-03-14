from decimal import Decimal

from django.db import transaction as db_transaction

from .models import LedgerEntry, Wallet


class InsufficientBalanceError(Exception):
    pass


class WalletService:
    """Atomic wallet operations with double-entry ledger."""

    @staticmethod
    @db_transaction.atomic
    def credit(wallet_id, amount: Decimal, transaction_id, description: str = "") -> LedgerEntry:
        """Credit (add funds to) a wallet. Locks the row for update.

        Idempotent: if a LedgerEntry with the same transaction_id + wallet + CREDIT
        already exists, returns the existing entry without double-crediting.
        """
        if amount <= 0:
            raise ValueError(f"Credit amount must be positive, got {amount}")

        # Idempotency check: prevent double-credit with same transaction_id
        existing = LedgerEntry.objects.filter(
            transaction_id=transaction_id,
            wallet_id=wallet_id,
            entry_type=LedgerEntry.EntryType.CREDIT,
        ).first()
        if existing:
            return existing

        wallet = Wallet.objects.select_for_update().get(id=wallet_id)
        wallet.balance += amount
        wallet.save(update_fields=["balance"])

        return LedgerEntry.objects.create(
            transaction_id=transaction_id,
            wallet=wallet,
            entry_type=LedgerEntry.EntryType.CREDIT,
            amount=amount,
            balance_after=wallet.balance,
            description=description,
        )

    @staticmethod
    @db_transaction.atomic
    def debit(wallet_id, amount: Decimal, transaction_id, description: str = "") -> LedgerEntry:
        """Debit (remove funds from) a wallet. Checks available balance.

        Idempotent: if a LedgerEntry with the same transaction_id + wallet + DEBIT
        already exists, returns the existing entry without double-debiting.
        """
        if amount <= 0:
            raise ValueError(f"Debit amount must be positive, got {amount}")

        # Idempotency check: prevent double-debit with same transaction_id
        existing = LedgerEntry.objects.filter(
            transaction_id=transaction_id,
            wallet_id=wallet_id,
            entry_type=LedgerEntry.EntryType.DEBIT,
        ).first()
        if existing:
            return existing

        wallet = Wallet.objects.select_for_update().get(id=wallet_id)

        if wallet.available_balance < amount:
            raise InsufficientBalanceError(
                f"Insufficient balance. Available: {wallet.available_balance}, requested: {amount}"
            )

        wallet.balance -= amount
        wallet.save(update_fields=["balance"])

        return LedgerEntry.objects.create(
            transaction_id=transaction_id,
            wallet=wallet,
            entry_type=LedgerEntry.EntryType.DEBIT,
            amount=amount,
            balance_after=wallet.balance,
            description=description,
        )

    @staticmethod
    @db_transaction.atomic
    def lock_funds(wallet_id, amount: Decimal) -> None:
        """Lock funds for a pending transaction (deducted from available but still in balance)."""
        wallet = Wallet.objects.select_for_update().get(id=wallet_id)

        if wallet.available_balance < amount:
            raise InsufficientBalanceError(
                f"Insufficient balance to lock. Available: {wallet.available_balance}, requested: {amount}"
            )

        wallet.locked_balance += amount
        wallet.save(update_fields=["locked_balance"])

    @staticmethod
    @db_transaction.atomic
    def unlock_funds(wallet_id, amount: Decimal) -> None:
        """Unlock previously locked funds (e.g., on saga compensation)."""
        wallet = Wallet.objects.select_for_update().get(id=wallet_id)
        wallet.locked_balance = max(Decimal("0"), wallet.locked_balance - amount)
        wallet.save(update_fields=["locked_balance"])

    @staticmethod
    @db_transaction.atomic
    def transfer(
        from_wallet_id,
        to_wallet_id,
        amount: Decimal,
        transaction_id,
        description: str = "",
    ) -> tuple[LedgerEntry, LedgerEntry]:
        """Atomic transfer between two wallets with balanced ledger entries."""
        debit_entry = WalletService.debit(from_wallet_id, amount, transaction_id, f"Transfer out: {description}")
        credit_entry = WalletService.credit(to_wallet_id, amount, transaction_id, f"Transfer in: {description}")
        return debit_entry, credit_entry

    @staticmethod
    def create_user_wallets(user) -> list[Wallet]:
        """Create default wallets for a new user."""
        from .models import Currency

        wallets = []
        for currency in [Currency.USDC, Currency.USDT, Currency.BTC, Currency.SOL, Currency.ETH, Currency.KES]:
            wallet, _ = Wallet.objects.get_or_create(
                user=user,
                currency=currency,
            )
            wallets.append(wallet)
        return wallets
