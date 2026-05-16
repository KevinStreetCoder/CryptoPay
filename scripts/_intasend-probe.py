"""Exhaustive probe of every IntaSend API path that could plausibly
unblock B2B disbursement on the Cpay merchant account.

Runs inside cryptopay_web:
  docker exec -i cryptopay_web python manage.py shell < this_file

Each probe is wrapped in try/except so a 4xx on one doesn't kill the
others · we want to see EVERY error message side-by-side so we can
either find a path that works OR write IntaSend the most precise
support ticket possible.
"""
from __future__ import annotations

import json
import requests
from apps.mpesa.intasend_client import IntaSendClient

c = IntaSendClient()
H = c._headers()
BASE = c.base_url

print(f"=== IntaSend base URL: {BASE} ===\n")


def hit(method: str, path: str, *, payload=None, params=None, label=""):
    url = f"{BASE}{path}"
    label = label or path
    try:
        if method == "GET":
            r = requests.get(url, headers=H, params=params, timeout=20)
        else:
            r = requests.post(url, headers=H, json=payload, timeout=20)
        print(f"[{label}] {method} {path} → HTTP {r.status_code}")
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:400]
        print(json.dumps(body, indent=2, default=str)[:1500])
    except Exception as e:
        print(f"[{label}] EXCEPTION: {type(e).__name__}: {e}")
    print()


# ── 1. Account profile / merchant info ──────────────────────────────
hit("GET", "/api/v1/profile/", label="profile")
hit("GET", "/api/v1/me/", label="me")
hit("GET", "/api/v1/account/", label="account")
hit("GET", "/api/v1/business/", label="business")
hit("GET", "/api/v1/merchant/", label="merchant")

# ── 2. Wallet listings (already know · just baseline) ──────────────
hit("GET", "/api/v1/wallets/", label="wallets-list")

# ── 3. Try send-money with requires_approval=YES (different gate) ──
print("=== send-money initiate · requires_approval=YES ===")
hit("POST", "/api/v1/send-money/initiate/", payload={
    "provider": "MPESA-B2B",
    "currency": "KES",
    "requires_approval": "YES",          # ← changed
    "device_id": "cpay-probe",
    "api_ref": "probe-ra-yes",
    "transactions": [{
        "name": "probe", "account": "888880",
        "account_number": "14403172431",
        "amount": 10, "narrative": "probe"
    }],
}, label="initiate-RA-YES")

# ── 4. Try send-money WITHOUT specifying provider (some accounts use payment URL) ─
print("=== /api/v1/payment/mpesa-b2b/ shape ===")
hit("POST", "/api/v1/payment/mpesa-b2b/", payload={
    "amount": 10, "currency": "KES",
    "paybill": "888880", "account_number": "14403172431",
    "api_ref": "probe-b2b-direct",
}, label="payment-b2b-direct")

# ── 5. Try the alternative "Mpesa Disbursement" path ───────────────
print("=== /api/v1/disbursement/mpesa/ ===")
hit("POST", "/api/v1/disbursement/mpesa/", payload={
    "amount": 10, "phone_number": "254700111111",
    "narrative": "probe", "currency": "KES",
}, label="disbursement-mpesa")

# ── 6. Try the customer-collection path (paybill VIA STK) ──────────
# This is the OTHER direction: instead of disbursing FROM us, ask
# the customer to pay via STK. Doesn't fit our crypto-to-paybill
# flow but confirms the account can at least DO something.
print("=== /api/v1/checkout/ ===")
hit("POST", "/api/v1/checkout/", payload={
    "amount": 10, "currency": "KES",
    "phone_number": "254700111111",
    "first_name": "probe", "last_name": "probe",
    "email": "probe@example.com",
    "api_ref": "probe-checkout",
}, label="checkout")

# ── 7. Pending approvals list (if requires_approval=YES works) ─────
hit("GET", "/api/v1/send-money/approval/", label="pending-approvals")

# ── 8. Try buy-goods (till) channel · same shape as paybill ────────
print("=== send-money initiate · TILL (buy-goods) ===")
hit("POST", "/api/v1/send-money/initiate/", payload={
    "provider": "MPESA-B2B",
    "currency": "KES",
    "requires_approval": "NO",
    "device_id": "cpay-probe",
    "api_ref": "probe-till",
    "transactions": [{
        "name": "probe-till", "account": "5629642",
        "amount": 10, "narrative": "probe"
    }],
}, label="initiate-till")

# ── 9. STK Push (collection) as a sanity check that ANYTHING works ─
print("=== STK Push (collection) ===")
hit("POST", "/api/v1/payment/mpesa-stk-push/", payload={
    "phone_number": "254700111111",
    "amount": 10,
    "api_ref": "probe-stk",
}, label="stk-push")

print("\n=== PROBE COMPLETE ===")
print("Look at each [LABEL] response above:")
print(" - HTTP 200/201 with a useful body  → that path works on our account")
print(" - 400 with specific 'not enabled'  → that product needs ops action")
print(" - 401/403                          → auth issue (wrong env, expired key)")
print(" - 404                              → endpoint doesn't exist / typo")
