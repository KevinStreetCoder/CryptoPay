from decimal import Decimal

from django.db import transaction as db_transaction

from .models import FeeLedgerEntry, LedgerEntry, SystemWallet, Wallet


class InsufficientBalanceError(Exception):
    pass


class FeeWalletMissingError(RuntimeError):
    """Raised when book_fee/book_provider_cost/book_excise/book_gas_reserve
    can't locate the destination SystemWallet for the given currency.

    Failing LOUD beats silently swallowing revenue. The seed_system_wallets
    management command creates every (wallet_type × currency) row at
    deploy time; this error means someone bypassed it OR deactivated a
    row that's now in the hot path. Ops should re-run the seed."""


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

        entry = LedgerEntry.objects.create(
            transaction_id=transaction_id,
            wallet=wallet,
            entry_type=LedgerEntry.EntryType.CREDIT,
            amount=amount,
            balance_after=wallet.balance,
            description=description,
        )
        # 2026-05-15 · bust the wallet-list cache so the dashboard sees
        # the new balance on its next read. Lazy import to avoid the
        # services-> views circular at module load.
        try:
            from apps.wallets.views import invalidate_wallet_cache
            invalidate_wallet_cache(wallet.user_id)
        except Exception:
            pass  # never let a cache miss block a credit
        return entry

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

        entry = LedgerEntry.objects.create(
            transaction_id=transaction_id,
            wallet=wallet,
            entry_type=LedgerEntry.EntryType.DEBIT,
            amount=amount,
            balance_after=wallet.balance,
            description=description,
        )
        try:
            from apps.wallets.views import invalidate_wallet_cache
            invalidate_wallet_cache(wallet.user_id)
        except Exception:
            pass
        return entry

    @staticmethod
    @db_transaction.atomic
    def lock_funds(wallet_id, amount: Decimal, transaction_id=None) -> None:
        """
        Lock funds for a pending transaction.

        When `transaction_id` is passed, the lock is idempotent via a
        Redis flag `wallet.lock:{tx}:{wallet}` held for 1 h — a second
        call with the same (tx, wallet) pair is a no-op. This closes
        the audit cycle-2 HIGH 2 finding where a saga retry could
        double-lock (and leave the user permanently "insufficient
        balance" until ops unlocked manually).

        Callers without a transaction_id (legacy sites) keep the
        non-idempotent behaviour; a future sweep should pass one.
        """
        from django.core.cache import cache

        if transaction_id is not None:
            lock_key = f"wallet.lock:{transaction_id}:{wallet_id}"
            # cache.add is atomic SET NX; False means the lock has
            # already been applied for this (tx, wallet) pair.
            if not cache.add(lock_key, "1", timeout=3600):
                return

        wallet = Wallet.objects.select_for_update().get(id=wallet_id)

        if wallet.available_balance < amount:
            raise InsufficientBalanceError(
                f"Insufficient balance to lock. Available: {wallet.available_balance}, requested: {amount}"
            )

        wallet.locked_balance += amount
        wallet.save(update_fields=["locked_balance"])

    @staticmethod
    @db_transaction.atomic
    def unlock_funds(wallet_id, amount: Decimal, transaction_id=None) -> None:
        """
        Unlock previously locked funds (e.g., on saga compensation).

        When `transaction_id` is passed, uses a matching Redis flag
        `wallet.unlock:{tx}:{wallet}` to guard against a retried
        compensator double-unlocking (the `max(0, …)` below already
        floors to zero but would quietly suppress a real bug).
        """
        from django.core.cache import cache

        if transaction_id is not None:
            unlock_key = f"wallet.unlock:{transaction_id}:{wallet_id}"
            if not cache.add(unlock_key, "1", timeout=3600):
                return
            # Release the matching lock flag so a future explicit
            # relock for the same tx (e.g. saga re-run) works.
            cache.delete(f"wallet.lock:{transaction_id}:{wallet_id}")

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

    # ── System-wallet bookkeeping (2026-05-17) ─────────────────────
    #
    # Four destination buckets · all share the same idempotent
    # double-entry pattern via FeeLedgerEntry. Callers MUST go through
    # these helpers · NEVER mutate `SystemWallet.balance` directly
    # (the old SWAP path did and that's why every retry would have
    # double-booked).
    #
    # Idempotency contract · FeeLedgerEntry has
    #     UniqueConstraint(transaction_id, system_wallet, entry_type)
    # so the same source-tx booking the same destination twice will
    # silently return the FIRST entry instead of raising. Callers can
    # call these helpers from BOTH the webhook handler AND the cron
    # safety-net without fear of double-credit.

    @staticmethod
    @db_transaction.atomic
    def _book_to_system_wallet(
        wallet_type: str,
        currency: str,
        amount: Decimal,
        transaction_id,
        description: str = "",
        chain: str = "",
    ) -> FeeLedgerEntry:
        """Internal · credit a SystemWallet(wallet_type, currency)
        atomically with idempotency.

        - `wallet_type` is one of `SystemWallet.WalletType.*` values
          (e.g. "fee", "provider_cost", "excise", "gas_reserve").
        - `currency` is the SystemWallet currency (KES for fiat
          buckets, "USDT"/"TRX" etc. for gas reserves).
        - `transaction_id` is the SOURCE Transaction whose completion
          triggered this booking. Used for the idempotency key.
        - `chain` is an optional filter when more than one wallet
          exists per (wallet_type, currency) · e.g. GAS_RESERVE/TRX
          would always live under chain=tron. Defaults to empty string
          which matches the canonical "single wallet per type+currency"
          deployment.

        Returns the FeeLedgerEntry (new or existing).
        Raises `FeeWalletMissingError` if no active SystemWallet matches.
        """
        if amount is None or Decimal(str(amount)) <= 0:
            raise ValueError(
                f"book amount must be positive, got {amount!r}"
            )
        amount = Decimal(str(amount))

        # Lookup the destination · respect (wallet_type, currency)
        # uniqueness from SystemWallet.Meta.unique_together. The
        # `chain` filter is optional · empty string means "any chain"
        # which works because the seed creates rows with chain="" for
        # the fiat-side wallets.
        qs = SystemWallet.objects.select_for_update().filter(
            wallet_type=wallet_type,
            currency=currency,
            is_active=True,
        )
        if chain:
            qs = qs.filter(chain=chain)
        sw = qs.first()
        if sw is None:
            raise FeeWalletMissingError(
                f"No active SystemWallet for wallet_type={wallet_type!r} "
                f"currency={currency!r} chain={chain!r}. Run "
                f"`python manage.py seed_system_wallets` to create the "
                f"missing rows."
            )

        # Idempotency check · same (tx, sw, type) returns the prior
        # entry without re-crediting.
        existing = FeeLedgerEntry.objects.filter(
            transaction_id=transaction_id,
            system_wallet=sw,
            entry_type=FeeLedgerEntry.EntryType.CREDIT,
        ).first()
        if existing:
            return existing

        sw.balance += amount
        sw.save(update_fields=["balance", "updated_at"])

        return FeeLedgerEntry.objects.create(
            transaction_id=transaction_id,
            system_wallet=sw,
            entry_type=FeeLedgerEntry.EntryType.CREDIT,
            amount=amount,
            balance_after=sw.balance,
            description=description or "",
        )

    @staticmethod
    def book_fee(currency: str, amount: Decimal, transaction_id,
                 description: str = "") -> FeeLedgerEntry:
        """Credit the FEE SystemWallet · this is OUR net revenue
        AFTER provider cost + excise duty are split out.

        Call from saga.complete() (paybill/till/B2C/buy) AFTER you've
        already booked the provider cost separately via
        `book_provider_cost`. The fee amount passed here should be:
            tx.fee_amount - intasend_charges_kes
        for M-Pesa rail txs, or `tx.fee_amount` for paths with no
        provider cost (e.g. internal swap fee).
        """
        return WalletService._book_to_system_wallet(
            SystemWallet.WalletType.FEE, currency, amount,
            transaction_id, description,
        )

    @staticmethod
    def book_provider_cost(currency: str, amount: Decimal, transaction_id,
                           description: str = "") -> FeeLedgerEntry:
        """Credit the PROVIDER_COST SystemWallet · the cost-of-revenue
        line for IntaSend / SasaPay / Daraja charges. Reported as a
        cost on the income statement; cumulatively shows how much we
        pay each rail provider over time."""
        return WalletService._book_to_system_wallet(
            SystemWallet.WalletType.PROVIDER_COST, currency, amount,
            transaction_id, description,
        )

    @staticmethod
    def book_excise(currency: str, amount: Decimal, transaction_id,
                    description: str = "") -> FeeLedgerEntry:
        """Credit the EXCISE SystemWallet · 16% (or whatever the
        EXCISE_DUTY_PERCENT setting says) tax we collect on behalf of
        KRA. NEVER counted as our revenue; the EXCISE wallet balance
        is what we owe KRA on the next remittance cycle."""
        return WalletService._book_to_system_wallet(
            SystemWallet.WalletType.EXCISE, currency, amount,
            transaction_id, description,
        )

    @staticmethod
    @db_transaction.atomic
    def reverse_system_wallet_booking(
        wallet_type: str,
        currency: str,
        transaction_id,
        description: str = "",
        chain: str = "",
    ) -> FeeLedgerEntry | None:
        """Reverse a prior credit to a SystemWallet via a balanced
        DEBIT FeeLedgerEntry · idempotent + audited.

        2026-05-17 · N2 fix · `compensate_convert` runs when the saga
        unwinds a tx that already booked revenue (e.g. callback fired
        complete() → fee booked → late anomaly triggers
        compensate_convert). Without an inverse, FEE / PROVIDER_COST /
        EXCISE SystemWallet balances would drift higher than the actual
        net revenue.

        Strategy · look up the prior CREDIT FeeLedgerEntry for this
        (transaction_id, system_wallet). If found, create a balancing
        DEBIT entry for the same amount + decrement the SystemWallet
        balance. Returns the new DEBIT entry, or None if no prior
        credit existed (no-op · safe to call eagerly).

        Idempotency · the DEBIT shares `transaction_id` but uses a
        different `entry_type`, so FeeLedgerEntry's UniqueConstraint
        (tx_id, system_wallet, entry_type) admits both CREDIT and
        DEBIT once each. Repeated calls return the existing DEBIT
        without re-debiting.
        """
        qs = SystemWallet.objects.select_for_update().filter(
            wallet_type=wallet_type,
            currency=currency,
            is_active=True,
        )
        if chain:
            qs = qs.filter(chain=chain)
        sw = qs.first()
        if sw is None:
            # No wallet · can't have booked, so nothing to reverse.
            return None

        # Find the prior CREDIT entry (the one we're reversing).
        credit_entry = FeeLedgerEntry.objects.filter(
            transaction_id=transaction_id,
            system_wallet=sw,
            entry_type=FeeLedgerEntry.EntryType.CREDIT,
        ).first()
        if credit_entry is None:
            # Nothing to reverse · the tx never booked here.
            return None

        # Idempotency check · DEBIT already exists from a prior call?
        existing_debit = FeeLedgerEntry.objects.filter(
            transaction_id=transaction_id,
            system_wallet=sw,
            entry_type=FeeLedgerEntry.EntryType.DEBIT,
        ).first()
        if existing_debit:
            return existing_debit

        # Reverse · decrement the SystemWallet by the credited amount,
        # log a DEBIT entry that closes the loop.
        amount = credit_entry.amount
        if sw.balance < amount:
            # Defensive · shouldn't happen unless an op manually
            # adjusted the wallet. Log + skip rather than negative.
            import logging as _logging
            _logging.getLogger(__name__).error(
                "wallet.reverse_booking.balance_below_credit",
                extra={
                    "tx_id": str(transaction_id),
                    "wallet_type": wallet_type,
                    "currency": currency,
                    "balance": str(sw.balance),
                    "credit_amount": str(amount),
                },
            )
            return None

        sw.balance -= amount
        sw.save(update_fields=["balance", "updated_at"])
        return FeeLedgerEntry.objects.create(
            transaction_id=transaction_id,
            system_wallet=sw,
            entry_type=FeeLedgerEntry.EntryType.DEBIT,
            amount=amount,
            balance_after=sw.balance,
            description=description or (
                f"Reversal of prior credit · "
                f"original ledger entry id={credit_entry.id}"
            ),
        )

    @staticmethod
    def unbook_fee(currency: str, transaction_id,
                   description: str = "") -> FeeLedgerEntry | None:
        """Reverse a prior `book_fee` credit for the given tx."""
        return WalletService.reverse_system_wallet_booking(
            SystemWallet.WalletType.FEE, currency, transaction_id, description,
        )

    @staticmethod
    def unbook_provider_cost(currency: str, transaction_id,
                             description: str = "") -> FeeLedgerEntry | None:
        return WalletService.reverse_system_wallet_booking(
            SystemWallet.WalletType.PROVIDER_COST, currency, transaction_id, description,
        )

    @staticmethod
    def unbook_excise(currency: str, transaction_id,
                      description: str = "") -> FeeLedgerEntry | None:
        return WalletService.reverse_system_wallet_booking(
            SystemWallet.WalletType.EXCISE, currency, transaction_id, description,
        )

    @staticmethod
    def unbook_gas_reserve(currency: str, transaction_id,
                           description: str = "",
                           chain: str = "") -> FeeLedgerEntry | None:
        return WalletService.reverse_system_wallet_booking(
            SystemWallet.WalletType.GAS_RESERVE, currency, transaction_id,
            description, chain=chain,
        )

    @staticmethod
    def book_gas_reserve(currency: str, amount: Decimal, transaction_id,
                         description: str = "", chain: str = "") -> FeeLedgerEntry:
        """Credit the GAS_RESERVE SystemWallet · the portion of a
        crypto-withdrawal fee earmarked to fund the next on-chain
        broadcast (TRX for TRC-20, ETH for ERC-20, SOL gas for
        Solana). Currently `Transaction.fee_amount` covers BOTH our
        margin AND the on-chain gas · ops decides the split via
        `WITHDRAWAL_NETWORK_FEES` setting. The gas_reserve helper
        gives us visibility into how much we should keep aside vs how
        much is true revenue."""
        return WalletService._book_to_system_wallet(
            SystemWallet.WalletType.GAS_RESERVE, currency, amount,
            transaction_id, description, chain=chain,
        )
