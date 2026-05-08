"""Float-balance check for the active M-Pesa rail.

Provider-aware (2026-05-08):
  daraja    · async balance via Daraja's `account_balance()` API · the
              actual KES number arrives at the balance-callback URL,
              not in the direct response. This command initiates the
              query; the callback handler updates the circuit breaker.
  sasapay   · sync balance via `check_balance()` · the KES number is
              in the response body. Update the circuit breaker
              directly here.
  intasend  · IntaSend exposes wallet balances via the wallets API ·
              same sync pattern as SasaPay.

Usage:
    python manage.py check_float_balance
    python manage.py check_float_balance --threshold 100000

The Celery beat schedule runs this every 5 minutes. The circuit
breaker auto-trips when the float drops below FLOAT_EMERGENCY_KES,
auto-recovers when it climbs above FLOAT_RESUME_KES.
"""

import logging
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD_KES = 50_000


class Command(BaseCommand):
    help = "Check the active M-Pesa rail's float balance and update the circuit breaker."

    def add_arguments(self, parser):
        parser.add_argument(
            "--threshold",
            type=int,
            default=getattr(settings, "MPESA_FLOAT_THRESHOLD_KES", DEFAULT_THRESHOLD_KES),
            help="Minimum acceptable float balance in KES (default: 50,000)",
        )

    def handle(self, *args, **options):
        threshold = options["threshold"]
        provider = getattr(settings, "PAYMENT_PROVIDER", "daraja").lower()

        self.stdout.write(
            f"Checking {provider} float balance (threshold: KES {threshold:,})..."
        )

        if provider == "sasapay":
            self._handle_sasapay()
        elif provider == "intasend":
            self._handle_intasend()
        else:
            self._handle_daraja()

    # ── Provider handlers ──────────────────────────────────────────────

    def _handle_sasapay(self):
        """SasaPay balance is sync · update the breaker right here."""
        from apps.mpesa.sasapay_client import SasaPayClient, SasaPayError
        from apps.payments.circuit_breaker import PaymentCircuitBreaker

        try:
            result = SasaPayClient().check_balance()
        except SasaPayError as e:
            self.stdout.write(self.style.ERROR(f"SasaPay balance error: {e}"))
            logger.error("sasapay.balance.error", extra={"error": str(e)})
            return

        # SasaPay's response shape: `data` carries the per-account
        # tuple. Sum all merchant float pots so the breaker sees the
        # TOTAL liquid KES.
        accounts = result.get("data") or result.get("accounts") or result
        total_kes = Decimal("0")
        if isinstance(accounts, dict):
            for label in (
                "WorkingAccount", "UtilityAccount", "BulkPaymentAccount",
                "workingAccount", "utilityAccount", "bulkPaymentAccount",
            ):
                raw = accounts.get(label)
                if raw is None:
                    continue
                try:
                    total_kes += Decimal(str(raw))
                except (InvalidOperation, TypeError):
                    continue
            if total_kes == 0:
                # Fallback · single-balance shape.
                for label in ("Balance", "balance", "available_balance"):
                    raw = accounts.get(label)
                    if raw is not None:
                        try:
                            total_kes = Decimal(str(raw))
                            break
                        except (InvalidOperation, TypeError):
                            continue

        new_state = PaymentCircuitBreaker.update_from_float(total_kes)
        self.stdout.write(self.style.SUCCESS(
            f"SasaPay float: KES {total_kes:,.2f} · circuit breaker → {new_state}"
        ))
        logger.info(
            "sasapay.balance.ok",
            extra={"float_kes": str(total_kes), "breaker_state": new_state},
        )

    def _handle_intasend(self):
        """IntaSend balance via the wallets endpoint."""
        from apps.mpesa.intasend_client import IntaSendClient, IntaSendError
        from apps.payments.circuit_breaker import PaymentCircuitBreaker

        try:
            client = IntaSendClient()
            # IntaSend wallet listing · POST with empty body returns a
            # wallets array. We sum the KES wallets only.
            result = client._post("/api/v1/wallets/list/", {})  # noqa: SLF001
        except IntaSendError as e:
            self.stdout.write(self.style.ERROR(f"IntaSend balance error: {e}"))
            logger.error("intasend.balance.error", extra={"error": str(e)})
            return

        wallets = result.get("results") or result.get("wallets") or []
        total_kes = Decimal("0")
        for w in wallets:
            if (w.get("currency") or "").upper() != "KES":
                continue
            try:
                total_kes += Decimal(str(
                    w.get("available_balance") or w.get("balance") or "0"
                ))
            except (InvalidOperation, TypeError):
                continue

        new_state = PaymentCircuitBreaker.update_from_float(total_kes)
        self.stdout.write(self.style.SUCCESS(
            f"IntaSend float: KES {total_kes:,.2f} · circuit breaker → {new_state}"
        ))
        logger.info(
            "intasend.balance.ok",
            extra={"float_kes": str(total_kes), "breaker_state": new_state},
        )

    def _handle_daraja(self):
        """Daraja balance is async · the callback updates the breaker."""
        from apps.mpesa.client import MpesaClient, MpesaError

        try:
            client = MpesaClient()
            result = client.account_balance()
            response_code = result.get("ResponseCode", "")
            if response_code == "0":
                conv_id = result.get("ConversationID", "unknown")
                self.stdout.write(self.style.SUCCESS(
                    f"Balance query initiated · ConversationID: {conv_id}\n"
                    f"Result will arrive at the balance callback URL."
                ))
            else:
                desc = result.get("ResponseDescription", "Unknown error")
                self.stdout.write(self.style.ERROR(f"Balance query failed: {desc}"))
                logger.error("daraja.balance.error", extra={"desc": desc})
        except MpesaError as e:
            self.stdout.write(self.style.ERROR(f"Daraja API error: {e}"))
            logger.error("daraja.balance.error", extra={"error": str(e)})
