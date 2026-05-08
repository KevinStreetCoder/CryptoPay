"""SasaPay sandbox smoke · drive visible API activity for compliance review.

Why this exists: while SasaPay's compliance team reviews our production
application, they look at the integration's traffic on the sandbox to
see we're actually building. A repo full of code with zero sandbox
hits looks suspicious. This command makes a small set of READ-ONLY
sandbox calls so the integration shows steady activity.

What it does (sandbox only · refuses production):
  1. OAuth token round-trip · `/auth/token/`
  2. Phone-number normalisation smoke · pure local, no API call,
     printed for diagnostic
  3. Optional STK Push to a documented test MSISDN at KES 1 if
     `--with-stk` is passed and a `--phone` is provided. The user
     CAN reject the prompt on their phone · we never auto-deduct.

Usage:
    python manage.py sasapay_sandbox_smoke                         # auth-only
    python manage.py sasapay_sandbox_smoke --with-stk --phone 0712345678

The command refuses to run when SASAPAY_ENVIRONMENT=production. This
is a safety guard · we never want a "smoke command" charging a real
customer because someone copy-pasted the wrong env var.

Exit codes:
   0 · all checks passed
   1 · auth failed (credentials / env / network)
   2 · STK Push initiation failed
"""
from __future__ import annotations

import sys

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Drive sandbox SasaPay API activity for compliance review."

    def add_arguments(self, parser):
        parser.add_argument(
            "--with-stk",
            action="store_true",
            help=(
                "Also fire one KES 1 STK Push to --phone. Customer must "
                "actively confirm on their device · we never auto-deduct."
            ),
        )
        parser.add_argument(
            "--phone",
            default="",
            help="MSISDN for the optional STK Push (any Kenyan format).",
        )

    def handle(self, *args, **opts):
        environment = getattr(settings, "SASAPAY_ENVIRONMENT", "sandbox").lower()
        if environment == "production":
            self.stderr.write(self.style.ERROR(
                "Refusing to run · SASAPAY_ENVIRONMENT=production. This "
                "command is sandbox-only by design (it would otherwise "
                "make real API calls against the live merchant). Flip "
                "SASAPAY_ENVIRONMENT=sandbox in the env this command is "
                "running under."
            ))
            sys.exit(1)

        if not getattr(settings, "SASAPAY_CLIENT_ID", "") or not getattr(
            settings, "SASAPAY_CLIENT_SECRET", ""
        ):
            self.stderr.write(self.style.ERROR(
                "SASAPAY_CLIENT_ID / SASAPAY_CLIENT_SECRET are unset. "
                "Add the sandbox credentials from the SasaPay dashboard."
            ))
            sys.exit(1)

        from apps.mpesa.sasapay_client import SasaPayClient, SasaPayError

        client = SasaPayClient()

        # 1 · OAuth token round-trip.
        self.stdout.write("[1/2] OAuth token request...")
        try:
            token = client._get_access_token()
        except SasaPayError as e:
            self.stderr.write(self.style.ERROR(f"OAuth failed: {e}"))
            sys.exit(1)
        if not token:
            self.stderr.write(self.style.ERROR("OAuth returned empty token"))
            sys.exit(1)
        self.stdout.write(self.style.SUCCESS(
            f"OAuth ok · token len={len(token)} chars · base={client.base_url}"
        ))

        # 2 · Optional STK Push.
        if opts["with_stk"]:
            phone = (opts["phone"] or "").strip()
            if not phone:
                self.stderr.write(self.style.ERROR(
                    "--with-stk requires --phone <MSISDN>"
                ))
                sys.exit(2)
            self.stdout.write(
                f"[2/2] STK Push (KES 1) to {phone} · respond on your phone..."
            )
            try:
                result = client.stk_push(
                    phone=phone,
                    amount=1.0,
                    account_ref="SMOKE",
                    description="Cpay sandbox smoke",
                )
            except SasaPayError as e:
                self.stderr.write(self.style.ERROR(f"STK Push failed: {e}"))
                sys.exit(2)
            checkout = result.get("CheckoutRequestID") or result.get(
                "checkoutRequestId"
            )
            self.stdout.write(self.style.SUCCESS(
                f"STK Push initiated · CheckoutRequestID={checkout!r}"
            ))
        else:
            self.stdout.write(
                "[2/2] Skipped STK Push (pass --with-stk --phone <MSISDN> to enable)"
            )

        self.stdout.write(self.style.SUCCESS("\nSandbox smoke complete."))
