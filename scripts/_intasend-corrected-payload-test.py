"""Validate the corrected IntaSend B2B payload against the live API.

Sends KSh 10 to paybill 888880 + KSh 10 to till 5629642 with the
NEW payload shape (account_type + account_reference) and verifies
the response shows a NON-failed initial state (i.e. NOT TF103).

If this passes, the disbursement should actually settle to M-Pesa.
Run inside cryptopay_web:
  docker exec -i cryptopay_web python manage.py shell < this_file
"""
import json
import requests
from apps.mpesa.intasend_client import IntaSendClient

c = IntaSendClient()
H = c._headers()
BASE = c.base_url


def fire(payload, label):
    url = f"{BASE}/api/v1/send-money/initiate/"
    r = requests.post(url, headers=H, json=payload, timeout=20)
    print(f"\n=== {label} ===")
    print(f"HTTP {r.status_code}")
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text[:300]}
    txs = data.get("transactions") or []
    inner = txs[0] if txs else {}
    print(f"  batch status : {data.get('status')} / {data.get('status_code')}")
    print(f"  inner status : {inner.get('status')} / {inner.get('status_code')}")
    print(f"  amount       : {inner.get('amount')}")
    print(f"  account      : {inner.get('account')}")
    print(f"  account_type : {inner.get('account_type')}")
    print(f"  account_ref  : {inner.get('account_reference')}")
    print(f"  paid_amount  : {data.get('paid_amount')}")
    print(f"  failed_amount: {data.get('failed_amount')}")
    print(f"  tracking_id  : {data.get('tracking_id')}")
    print(f"  wallet bal   : {(data.get('wallet') or {}).get('current_balance')}")
    return data


# 1. Paybill · NEW payload shape
paybill_resp = fire({
    "provider": "MPESA-B2B",
    "currency": "KES",
    "requires_approval": "NO",
    "api_ref": "corrected-paybill",
    "transactions": [{
        "name": "Cpay-test",
        "account": "888880",
        "account_type": "PayBill",
        "account_reference": "14403172431",
        "amount": 10,
        "narrative": "Corrected payload probe",
    }],
}, "PayBill with account_type='PayBill' + account_reference")

# 2. Till · NEW payload shape
till_resp = fire({
    "provider": "MPESA-B2B",
    "currency": "KES",
    "requires_approval": "NO",
    "api_ref": "corrected-till",
    "transactions": [{
        "name": "Cpay-test",
        "account": "5629642",
        "account_type": "TillNumber",
        "amount": 10,
        "narrative": "Corrected till probe",
    }],
}, "Till with account_type='TillNumber'")

# 3. Wait a few seconds + re-query final state
import time
print("\n--- Waiting 8s for inner status to settle ---")
time.sleep(8)

for label, resp in [("PayBill", paybill_resp), ("Till", till_resp)]:
    tid = resp.get("tracking_id")
    if not tid:
        continue
    r = requests.post(f"{BASE}/api/v1/send-money/status/", headers=H,
                      json={"tracking_id": tid}, timeout=15)
    s = r.json()
    inner = (s.get("transactions") or [{}])[0]
    print(f"\n[POLL · {label}]")
    print(f"  batch: {s.get('status')} / {s.get('status_code')}")
    print(f"  inner: {inner.get('status')} / {inner.get('status_code')}  "
          f"description={inner.get('status_description')!r}")
    print(f"  paid={s.get('paid_amount')} failed={s.get('failed_amount')} "
          f"wallet_bal={(s.get('wallet') or {}).get('current_balance')}")
