"""Find the IntaSend approve-disbursement endpoint.

We just initiated 2 send-money batches with requires_approval=YES
that are now sitting in BP103/BP104 "Preview and approve". Try every
plausible approve URL to find the one that commits them.

Run:
  docker exec -i cryptopay_web python manage.py shell < this_file
"""
import json
import requests
from apps.mpesa.intasend_client import IntaSendClient

c = IntaSendClient()
H = c._headers()
BASE = c.base_url

# Two test batches from the earlier probe · we'll try to approve both.
# These are LIVE pending approvals on our account right now.
PAYBILL_FILE_ID = "YDLPNQ3"
PAYBILL_TRACKING = "3c6c234c-46ff-44e1-89b0-8e4f9a1ca9cf"
TILL_FILE_ID = "KQDBROO"
TILL_TRACKING = "3575f1cd-2a92-4511-8d55-9a92f788d042"


def hit(method: str, path: str, *, payload=None, label=""):
    url = f"{BASE}{path}"
    label = label or path
    try:
        if method == "GET":
            r = requests.get(url, headers=H, timeout=15)
        else:
            r = requests.post(url, headers=H, json=payload, timeout=15)
        print(f"[{label}] {method} {path} → HTTP {r.status_code}")
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:300]
        print(json.dumps(body, indent=2, default=str)[:1200])
    except Exception as e:
        print(f"[{label}] EXCEPTION: {type(e).__name__}: {e}")
    print()


# ── Try every plausible approve URL ────────────────────────────────
for path in [
    "/api/v1/send-money/approve/",
    "/api/v1/send-money/approval/",
    "/api/v1/send-money/approval/approve/",
    "/api/v1/payment/send-money/approve/",
    "/api/v1/payment/send-money/approval/",
]:
    for payload in [
        {"tracking_id": PAYBILL_TRACKING},
        {"file_id": PAYBILL_FILE_ID},
        {"tracking_id": PAYBILL_TRACKING, "file_id": PAYBILL_FILE_ID},
    ]:
        hit("POST", path, payload=payload,
            label=f"approve {path} payload={list(payload.keys())}")

# ── Also try the "checkout"-style approval path with the nonce ────
# The initiate response includes `nonce: "c85fe8"` · maybe approval
# uses that.
hit("POST", "/api/v1/send-money/approve/", payload={
    "tracking_id": PAYBILL_TRACKING,
    "nonce": "c85fe8",
}, label="approve with nonce")

# ── See the current state of the pending batches ──────────────────
print("=== status check via tracking_id ===")
for tracking in [PAYBILL_TRACKING, TILL_TRACKING]:
    hit("POST", "/api/v1/send-money/status/", payload={
        "tracking_id": tracking,
    }, label=f"status {tracking[:8]}")
