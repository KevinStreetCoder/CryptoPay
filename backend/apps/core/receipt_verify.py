"""Public receipt-verify page · resolves the QR-encoded short code on a
printed/PDF receipt to a server-rendered HTML page that confirms the
transaction is real, settled, and matches what the receipt claims.

URL · `cpay.co.ke/r/<short>/` · Anonymous, no auth.

Design rationale:
  - The short code on the receipt is `str(transaction.id)[:8].upper()`
    (8 uppercase hex characters · ~32 bits of entropy).
  - That's enough to NOT collide with any user-set referral code in the
    same `/r/` namespace (referral codes are lowercase alphanumeric and
    typically 6-8 chars). The view sniffs the shape and routes:
      * 8 hex uppercase  → receipt verify (this view)
      * anything else    → 302 to the SPA's referral landing
        (cpay.co.ke/r/<code> handled by the mobile app router).
  - We DO NOT leak PII · the page shows the public "settled / amount /
    type / date / receipt ref" tuple, plus the M-Pesa receipt number
    if present. Recipient phone is masked.
  - Tampered receipts (anyone who edits the QR target manually) hit
    "receipt not found" and a contact-support CTA.
"""
import re
from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import render
from django.views.decorators.cache import cache_page
from django.views.decorators.http import require_GET

# 8 uppercase hex chars · matches `str(uuid4)[:8].upper()` from
# pdf_receipt.py. UUIDs use hex digits only, so we exclude G-Z.
_RECEIPT_SHORT_RE = re.compile(r"^[0-9A-F]{8}$")


def _mask_phone(phone: str) -> str:
    if not phone:
        return ""
    p = str(phone)
    if len(p) <= 6:
        return p
    return p[:6] + "•" * (len(p) - 6)


@require_GET
@cache_page(60)  # tx state changes are slow once COMPLETED · 60s is fine
def verify_receipt(request, code: str):
    """Public receipt-verify page · GET /r/<code>/"""
    from apps.payments.models import Transaction

    # Fast bail · doesn't look like a receipt code, send to the
    # referral SPA path. The mobile app's expo-router has the /r/<code>
    # screen registered; the static export resolves it client-side.
    if not _RECEIPT_SHORT_RE.match(code):
        return HttpResponseRedirect(f"https://app.cpay.co.ke/r/{code}")

    # Lookup by ID prefix · the short code is the first 8 of the UUID
    # in uppercase. UUIDs are stored lowercase, so we lowercase before
    # matching, and use `id__startswith` which the index can serve.
    matches = list(
        Transaction.objects
        .filter(id__startswith=code.lower())
        .select_related("user")[:2]
    )
    if not matches:
        return render(
            request,
            "verify/receipt_not_found.html",
            {"code": code},
            status=404,
        )
    if len(matches) > 1:
        # Two UUIDs sharing the first 8 hex digits is statistically
        # rare (1-in-4-billion chance per pair) but possible at scale.
        # Don't disclose either; tell the user to use the longer
        # reference printed on their receipt.
        return render(
            request,
            "verify/receipt_ambiguous.html",
            {"code": code},
            status=409,
        )

    tx = matches[0]
    # 2026-05-09 · resolved business name takes the headline slot ·
    # paybill/till + masked account drops to the sub-line. Same
    # treatment as the PDF receipt for consistency between the printed
    # receipt and the publicly-verifiable web view.
    merchant_name = (getattr(tx, "merchant_name", "") or "").strip()
    if tx.mpesa_paybill:
        recipient_label = merchant_name or "M-Pesa Paybill"
        recipient_detail = f"Paybill {tx.mpesa_paybill}"
        if tx.mpesa_account:
            acc = str(tx.mpesa_account)
            recipient_detail += f" · Acc {acc[:4]}{'•' * max(0, len(acc) - 4)}"
    elif tx.mpesa_till:
        recipient_label = merchant_name or "M-Pesa Till"
        recipient_detail = f"Till {tx.mpesa_till}"
    elif tx.mpesa_phone:
        recipient_label = "M-Pesa transfer"
        recipient_detail = _mask_phone(tx.mpesa_phone)
    else:
        recipient_label = ""
        recipient_detail = ""

    return render(request, "verify/receipt.html", {
        "tx": tx,
        "code": code,
        "reference": f"CP-{str(tx.id)[:6].upper()}-KE",
        "is_settled": tx.status == "completed",
        "type_label": {
            "PAYBILL_PAYMENT":  "Paybill Payment",
            "TILL_PAYMENT":     "Till Payment",
            "SEND_MPESA":       "M-Pesa Transfer",
            "BUY":              "Crypto Purchase",
            "SELL":             "Crypto Sale",
            "DEPOSIT":          "Crypto Deposit",
            "WITHDRAWAL":       "Withdrawal",
            "KES_DEPOSIT":      "KES Deposit",
            "KES_DEPOSIT_C2B":  "M-Pesa → Crypto",
            "SWAP":             "Crypto Swap",
            "INTERNAL_TRANSFER":"Internal Transfer",
            "FEE":              "Platform Fee",
        }.get(tx.type, tx.type),
        "recipient_label": recipient_label,
        "recipient_detail": recipient_detail,
        "masked_recipient": _mask_phone(tx.mpesa_phone) or tx.mpesa_paybill or tx.mpesa_till or "",
    })
