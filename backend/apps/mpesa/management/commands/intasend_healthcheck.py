"""Verify IntaSend merchant account is ready to disburse.

Usage:
    docker exec cryptopay_web python manage.py intasend_healthcheck

Exits non-zero when any wallet has `can_disburse: false` so monitoring
can alert ops. Prints a human-readable summary of every wallet under
the merchant account.

2026-05-16 · written after discovering all 4 production wallets ship
with `can_disburse: false` (account-level kill switch from IntaSend
until B2B disbursement is approved). Without this check the failure
surface is a 10-minute "Confirming..." spinner for every paybill /
till / B2C user attempts. See memory/reference_intasend_wallet_disburse.md
for the ops escalation runbook.
"""
from __future__ import annotations

import sys

import requests
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Check IntaSend wallets for disbursement readiness."

    def add_arguments(self, parser):
        parser.add_argument(
            "--currency",
            default="KES",
            help="Currency to check (default: KES). Use 'all' for every wallet.",
        )
        parser.add_argument(
            "--min-balance",
            type=float,
            default=100.0,
            help="Minimum acceptable balance (default: 100 KES).",
        )

    def handle(self, *args, **options):
        from apps.mpesa.intasend_client import IntaSendClient

        client = IntaSendClient()
        url = f"{client.base_url}/api/v1/wallets/"
        try:
            resp = requests.get(url, headers=client._headers(), timeout=15)
        except requests.RequestException as e:
            self.stderr.write(self.style.ERROR(f"NETWORK · {e}"))
            sys.exit(2)

        if resp.status_code != 200:
            self.stderr.write(
                self.style.ERROR(
                    f"HTTP {resp.status_code} · {resp.text[:300]}",
                ),
            )
            sys.exit(3)

        wallets = (resp.json() or {}).get("results") or []
        ccy = options["currency"].upper()
        min_bal = options["min_balance"]

        any_ok = False
        any_broken = False
        for w in wallets:
            wccy = (w.get("currency") or "").upper()
            if ccy != "ALL" and wccy != ccy:
                continue
            disb = bool(w.get("can_disburse"))
            bal = float(w.get("current_balance") or 0)
            wid = w.get("wallet_id") or "?"
            label = w.get("label") or "?"
            mark = self.style.SUCCESS("OK") if (disb and bal >= min_bal) else self.style.ERROR("FAIL")
            self.stdout.write(
                f"[{mark}] wallet {wid} ({label}, {wccy}) · "
                f"can_disburse={disb} · balance={bal:.2f}"
            )
            if disb and bal >= min_bal:
                any_ok = True
            else:
                any_broken = True
                if not disb:
                    self.stdout.write(self.style.WARNING(
                        f"      ⚠ can_disburse=False · ops must enable B2B "
                        f"disbursement on the IntaSend merchant dashboard "
                        f"(or escalate to support@intasend.com referencing "
                        f"wallet_id={wid})."
                    ))
                if bal < min_bal:
                    self.stdout.write(self.style.WARNING(
                        f"      ⚠ balance {bal:.2f} {wccy} is below the "
                        f"--min-balance {min_bal:.2f} threshold · fund the "
                        f"wallet before paybill / till traffic can settle."
                    ))

        if not any_ok:
            self.stdout.write(self.style.ERROR(
                "\nAT LEAST ONE wallet must be can_disburse=True AND "
                "balance >= min_balance for IntaSend disbursements to work."
            ))
            sys.exit(1)
        if any_broken:
            self.stdout.write(self.style.WARNING(
                "\nSome wallets are broken; healthy wallets exist · OK."
            ))
        else:
            self.stdout.write(self.style.SUCCESS("\nAll checked wallets healthy."))
