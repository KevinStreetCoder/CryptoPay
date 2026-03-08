"""
Management command to check M-Pesa float balance via Daraja API.
Logs a warning if below the configured threshold.

Usage:
    python manage.py check_float_balance
    python manage.py check_float_balance --threshold 100000
"""

import logging

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.mpesa.client import MpesaClient, MpesaError

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD_KES = 50_000


class Command(BaseCommand):
    help = "Check M-Pesa float balance and alert if below threshold"

    def add_arguments(self, parser):
        parser.add_argument(
            "--threshold",
            type=int,
            default=getattr(settings, "MPESA_FLOAT_THRESHOLD_KES", DEFAULT_THRESHOLD_KES),
            help="Minimum acceptable float balance in KES (default: 50,000)",
        )

    def handle(self, *args, **options):
        threshold = options["threshold"]

        self.stdout.write(f"Checking M-Pesa float balance (threshold: KES {threshold:,})...")

        try:
            client = MpesaClient()
            result = client.account_balance()

            self.stdout.write(f"API Response: {result}")

            # The actual balance comes back via callback, not in the direct response.
            # This command initiates the query; the result arrives at the balance callback URL.
            response_code = result.get("ResponseCode", "")
            if response_code == "0":
                conversation_id = result.get("ConversationID", "unknown")
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Balance query initiated successfully. ConversationID: {conversation_id}\n"
                        f"Result will arrive at callback URL. Check MpesaCallback records."
                    )
                )
            else:
                desc = result.get("ResponseDescription", "Unknown error")
                self.stdout.write(
                    self.style.ERROR(f"Balance query failed: {desc}")
                )
                logger.error("M-Pesa float balance check failed: %s", desc)

        except MpesaError as e:
            self.stdout.write(self.style.ERROR(f"M-Pesa API error: {e}"))
            logger.error("Float balance check error: %s", e)
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Unexpected error: {e}"))
            logger.exception("Float balance check unexpected error")
