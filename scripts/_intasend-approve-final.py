"""Approve the pending paybill batch (YDLPNQ3) by sending the FULL
transactions array along with the tracking_id.

The earlier probe got HTTP 400 "Inconsistent number of transaction"
on /api/v1/send-money/approve/ with just {tracking_id}. The error
phrasing suggests we need to pass the transactions list that
matches what was initiated.
"""
import json
import requests
from apps.mpesa.intasend_client import IntaSendClient

c = IntaSendClient()
H = c._headers()
BASE = c.base_url

# The paybill batch that's sitting in BP103 (Preview and approve).
TRACKING = "3c6c234c-46ff-44e1-89b0-8e4f9a1ca9cf"

# Same transactions list we initiated with.
TXNS = [{
    "name": "probe",
    "account": "888880",
    "account_number": "14403172431",
    "amount": 10,
    "narrative": "probe",
}]


def post(path, payload, label):
    r = requests.post(f"{BASE}{path}", headers=H, json=payload, timeout=20)
    print(f"[{label}] POST {path} → HTTP {r.status_code}")
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:400]
    print(json.dumps(body, indent=2, default=str)[:1800])
    print()


# Variant 1 · full transactions
post("/api/v1/send-money/approve/", {
    "tracking_id": TRACKING,
    "transactions": TXNS,
}, "approve-with-txns")

# Variant 2 · transactions + currency + provider (matches initiate shape)
post("/api/v1/send-money/approve/", {
    "tracking_id": TRACKING,
    "transactions": TXNS,
    "currency": "KES",
    "provider": "MPESA-B2B",
}, "approve-with-initiate-shape")

# Variant 3 · file_id + transactions
post("/api/v1/send-money/approve/", {
    "file_id": "YDLPNQ3",
    "transactions": TXNS,
}, "approve-with-file-id")

# Variant 4 · with nonce
post("/api/v1/send-money/approve/", {
    "tracking_id": TRACKING,
    "transactions": TXNS,
    "nonce": "c85fe8",
}, "approve-with-nonce")
