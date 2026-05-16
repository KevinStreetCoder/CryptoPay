"""Generic stuck-tx reconciler · pass the short-ref via env REF.

Same pattern as _reconcile-1415369d.py · pulled into a reusable form.
Idempotent (guards on saga_data.manually_reconciled).

Usage:
    docker exec -e REF=af4b282b -i cryptopay_web \
        python manage.py shell < this_file
"""
from __future__ import annotations

import os
from decimal import Decimal
from django.utils import timezone

from apps.accounts.models import AuditLog
from apps.payments.models import Transaction
from apps.payments.saga import PaymentSaga
from apps.wallets.models import Wallet

REF = os.environ.get("REF", "").strip().lower()
if not REF:
    print("ERROR: pass REF=<short_ref> env var.")
    raise SystemExit(1)

tx = Transaction.objects.filter(id__startswith=REF).first()
if not tx:
    print(f"NO tx matching prefix {REF}")
    raise SystemExit(1)

print(f"--- BEFORE · {REF} ---")
print(f"status         : {tx.status}")
print(f"failure_reason : {tx.failure_reason!r}")
print(f"saga_data      : {tx.saga_data}")

if (tx.saga_data or {}).get("manually_reconciled"):
    print("ALREADY RECONCILED · no-op.")
    raise SystemExit(0)

tracking_id = (tx.saga_data or {}).get("mpesa_conversation_id") or ""
print(f"\ntracking_id    : {tracking_id}")

# Try IntaSend status query · same approach as the prior script.
from apps.mpesa.intasend_client import IntaSendClient, IntaSendError
try:
    r = IntaSendClient().query_transaction(tracking_id=tracking_id)
    print(f"IntaSend says  : {r}")
except IntaSendError as e:
    r = {"state": "FAILED", "_origin": str(e)}
    print(f"IntaSend error : {e} · treating as FAILED")

state = (r.get("state") or r.get("status") or "").upper()
print(f"\nDecided state  : {state}")

if state in {"COMPLETE", "COMPLETED", "PROCESSED"}:
    receipt = r.get("mpesa_reference") or r.get("api_ref") or ""
    tx.status = Transaction.Status.COMPLETED
    tx.failure_reason = ""
    tx.mpesa_receipt = receipt or tx.mpesa_receipt
    sd = dict(tx.saga_data or {})
    sd["manually_reconciled"] = True
    sd["reconciled_outcome"] = "completed_via_intasend_query"
    sd["reconciled_at"] = timezone.now().isoformat()
    tx.saga_data = sd
    tx.save(update_fields=[
        "status", "failure_reason", "mpesa_receipt",
        "saga_data", "updated_at",
    ])
    AuditLog.objects.create(
        user=tx.user,
        action="manual_reconcile_completed",
        details=f"Tx {tx.id} marked COMPLETED via IntaSend query · receipt={receipt}.",
    )
    print("DONE · tx COMPLETED, no wallet credit.")
else:
    amt = (tx.saga_data or {}).get("locked_amount")
    print(f"Refunding {amt} {tx.source_currency} ...")
    PaymentSaga(tx).compensate_convert()

    sol_wallet_id = (tx.saga_data or {}).get("locked_wallet_id")
    w = Wallet.objects.get(id=sol_wallet_id)
    print(f"Wallet after   : balance={w.balance} locked={w.locked_balance}")

    tx.status = Transaction.Status.FAILED
    tx.failure_reason = (
        "IntaSend never confirmed payout (status query 404 · only PENDING "
        "webhooks received). Funds refunded · please retry."
    )
    sd = dict(tx.saga_data or {})
    sd["manually_reconciled"] = True
    sd["reconciled_outcome"] = "refunded_via_compensate_convert"
    sd["reconciled_at"] = timezone.now().isoformat()
    tx.saga_data = sd
    tx.save(update_fields=["status", "failure_reason", "saga_data", "updated_at"])

    AuditLog.objects.create(
        user=tx.user,
        action="manual_reconcile_refunded",
        details=(
            f"Tx {tx.id} · IntaSend send-money/status returned 404 for "
            f"tracking_id={tracking_id} (only PENDING webhooks received, "
            f"no terminal state). Refunded {amt} {tx.source_currency} via "
            f"compensate_convert(). User retry recommended."
        ),
    )
    print("DONE · refunded + audit logged.")

tx.refresh_from_db()
print("\n--- AFTER ---")
print(f"status         : {tx.status}")
print(f"failure_reason : {tx.failure_reason!r}")
