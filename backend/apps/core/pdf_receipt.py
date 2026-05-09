"""PDF receipt generator for Cpay transactions.

Uses weasyprint to generate branded, well-designed PDF receipts
that match the ReceiptTemplate design spec — paper bg, emerald
gradient stripe, Coin-C watermark, hero amount card with SETTLED
pill, detail rows with dashed dividers, QR + verify footer.

2026-05-09 · the QR was a CSS dot pattern (decorative, not scannable).
Replaced with a real qrcode-encoded `https://cpay.co.ke/r/<short_id>`
that resolves to the verify-receipt page · phones can scan it from
print or PDF and land on the public verification view.
"""

import base64
import io
import logging
import os

from django.conf import settings
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

# Directory for storing generated receipts
RECEIPTS_DIR = os.path.join(settings.MEDIA_ROOT, "receipts")

# Public origin for receipt verify links · `cpay.co.ke/r/<short_id>`.
# Anonymous landing page, no auth required · the short_id alone doesn't
# leak PII because it's just the first 8 chars of the tx UUID.
_VERIFY_BASE_URL = "https://cpay.co.ke/r"


def _qr_data_uri(payload: str) -> str:
    """Return a base64 PNG data URI for the given payload, sized for the
    receipt footer (≈72×72 print, but we render at 256 px so the QR has
    enough error-correction headroom and stays sharp when zoomed).

    Uses qrcode + Pillow (both already in requirements.txt). Box size is
    bumped past the default so the dots are scannable from a phone held
    20 cm away · QR error correction Q (25 %) lets the centre Coin-C
    overlay sit on top later if we ever inline the brand mark.
    """
    import qrcode
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_Q,
        box_size=10,
        border=1,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0B1220", back_color="#FFFFFF").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def generate_receipt_pdf(transaction):
    """
    Generate a branded PDF receipt for a transaction.

    Args:
        transaction: Transaction model instance (with user relation loaded).

    Returns:
        str: Path to the generated PDF file, or None on failure.
    """
    os.makedirs(RECEIPTS_DIR, exist_ok=True)

    # Transaction type labels · exhaustive over Transaction.Type.choices.
    # Any value not explicitly mapped falls through to the raw enum; the
    # test at `apps/payments/test_audit_cycle2.py` enforces exhaustiveness.
    type_labels = {
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
    }

    # Recipient header + sub. Matches design: "KPLC Prepaid" + "Paybill 888880 · Acc 0711••••••"
    # For non-M-Pesa transaction types (swap / buy / sell / deposit /
    # withdrawal) we derive a crypto-flow header so the receipt isn't
    # blank — previously only M-Pesa tx types got any "Paid To" content.
    # 2026-05-09 · prefer `merchant_name` (resolved at quote time via
    # SasaPay account-validation, or captured from the B2B callback's
    # RecipientName) for the headline; the paybill/till + masked account
    # drops to the sub-line. Mirrors the "KPLC PREPAID · Paybill 888880"
    # treatment from the design canvas.
    recipient = ""
    recipient_sub = ""
    merchant_name = (getattr(transaction, "merchant_name", "") or "").strip()
    if transaction.mpesa_paybill:
        masked_acc = ""
        if transaction.mpesa_account:
            acc = str(transaction.mpesa_account)
            masked_acc = f" · Acc {acc[:4]}{'•' * max(0, len(acc) - 4)}"
        if merchant_name:
            recipient = merchant_name
            recipient_sub = f"Paybill {transaction.mpesa_paybill}{masked_acc}"
        else:
            recipient = "M-Pesa Paybill"
            recipient_sub = f"Paybill {transaction.mpesa_paybill}{masked_acc}"
    elif transaction.mpesa_till:
        if merchant_name:
            recipient = merchant_name
            recipient_sub = f"Till {transaction.mpesa_till}"
        else:
            recipient = "M-Pesa Till"
            recipient_sub = f"Till {transaction.mpesa_till}"
    elif transaction.mpesa_phone:
        # 2026-05-09 · prefer the M-Pesa RecipientName captured from
        # SasaPay's B2C result callback so the receipt shows e.g.
        # "Kevin Isaac Kareithi" + "+254712••••••" instead of a generic
        # "M-Pesa transfer" headline. The callback stores it onto
        # `merchant_name` even for B2C rails (see sasapay_views).
        phone = str(transaction.mpesa_phone)
        masked_phone = f"{phone[:6]}{'•' * max(0, len(phone) - 6)}" if len(phone) > 6 else phone
        if merchant_name:
            recipient = merchant_name
            recipient_sub = f"M-Pesa · {masked_phone}"
        else:
            recipient = "M-Pesa transfer"
            recipient_sub = masked_phone
    elif transaction.type == "SWAP":
        # "Swap · USDT → USDC" / "Swap · BTC → ETH"
        src = (transaction.source_currency or "").upper()
        dst = (transaction.dest_currency or "").upper()
        if src and dst:
            recipient = "Crypto Swap"
            recipient_sub = f"{src} → {dst}"
    elif transaction.type in ("BUY", "KES_DEPOSIT_C2B"):
        dst = (transaction.dest_currency or "").upper()
        if dst:
            recipient = "Crypto Purchase"
            recipient_sub = f"KES → {dst}"
    elif transaction.type == "SELL":
        src = (transaction.source_currency or "").upper()
        if src:
            recipient = "Crypto Sale"
            recipient_sub = f"{src} → KES"
    elif transaction.type == "DEPOSIT":
        src = (transaction.source_currency or "").upper()
        if src:
            recipient = "On-chain Deposit"
            recipient_sub = f"{src} credit"
    elif transaction.type == "WITHDRAWAL":
        src = (transaction.source_currency or "").upper()
        if src:
            recipient = "On-chain Withdrawal"
            recipient_sub = f"{src} debit"

    def fmt_fiat(val):
        """Format fiat amount: 1,000.00"""
        from decimal import Decimal
        if not val:
            return "0.00"
        d = Decimal(str(val)).quantize(Decimal("0.01"))
        return f"{d:,}"

    def fmt_crypto(val, currency):
        """Format crypto amount: strip trailing zeros, max 8 decimals."""
        from decimal import Decimal
        if not val:
            return "0"
        d = Decimal(str(val)).normalize()
        # Cap at 8 decimal places
        if abs(d.as_tuple().exponent) > 8:
            d = d.quantize(Decimal("0.00000001"))
        return str(d)

    def fmt_amount(val, currency):
        """Format based on currency type."""
        fiat = {"KES", "USD", "EUR", "GBP", "TZS", "UGX"}
        if currency and currency.upper() in fiat:
            return f"KSh {fmt_fiat(val)}" if currency.upper() == "KES" else f"{currency} {fmt_fiat(val)}"
        return f"{fmt_crypto(val, currency)} {currency}"

    source_cur = transaction.source_currency or ""
    dest_cur = transaction.dest_currency or ""

    # Chain / network for crypto source (matches design "USDT · TRON")
    chain_label = ""
    chain = getattr(transaction, "chain", None) or ""
    if source_cur and source_cur != "KES":
        if chain:
            chain_label = f"{source_cur} · {chain.upper()}"
        else:
            # Default network by currency
            default_chain = {"USDT": "TRON", "BTC": "BITCOIN", "ETH": "ERC-20", "SOL": "SOLANA", "USDC": "POLYGON"}.get(source_cur, "")
            chain_label = f"{source_cur} · {default_chain}" if default_chain else source_cur

    # Settlement time (completed_at - created_at)
    settlement_display = ""
    if transaction.completed_at and transaction.created_at:
        delta = transaction.completed_at - transaction.created_at
        secs = int(delta.total_seconds())
        if secs < 60:
            settlement_display = f"{secs} seconds"
        elif secs < 3600:
            settlement_display = f"{secs // 60} min {secs % 60} sec"
        else:
            settlement_display = f"{secs // 3600}h {(secs % 3600) // 60}min"

    # Crypto amount (no currency conversion)
    crypto_amount_display = ""
    if source_cur and source_cur != "KES":
        crypto_amount_display = f"{fmt_crypto(transaction.source_amount, source_cur)} {source_cur}"

    # Exchange rate — "129.35 KES / USDT" instead of verbose "1 X = KSh Y"
    rate_display = ""
    if transaction.exchange_rate and source_cur and source_cur != "KES":
        rate_display = f"{fmt_fiat(transaction.exchange_rate)} KES / {source_cur}"
    elif transaction.exchange_rate:
        rate_display = f"1 {source_cur} = KSh {fmt_fiat(transaction.exchange_rate)}"

    reference_short = str(transaction.id)[:8].upper()
    verify_url = f"{_VERIFY_BASE_URL}/{reference_short}"
    try:
        qr_data_uri = _qr_data_uri(verify_url)
    except Exception as e:
        # Fail-soft · if QR generation hits a Pillow/font edge case the
        # receipt still ships (without a scannable QR). The verify URL
        # text below the QR remains the human fallback.
        logger.warning(f"QR generation failed for tx {transaction.id}: {e}")
        qr_data_uri = ""

    context = {
        "tx": transaction,
        "user": transaction.user,
        "type_label": type_labels.get(transaction.type, transaction.type),
        "recipient": recipient,
        "recipient_sub": recipient_sub,
        "reference": f"CP-{str(transaction.id)[:6].upper()}-KE",
        "reference_short": reference_short,
        "mpesa_receipt": transaction.mpesa_receipt or "",
        "date": transaction.created_at.strftime("%d %b %Y · %H:%M EAT"),
        "source_display": fmt_amount(transaction.source_amount, source_cur),
        "dest_display": fmt_amount(transaction.dest_amount, dest_cur),
        "crypto_amount_display": crypto_amount_display,
        "chain_label": chain_label,
        "settlement_display": settlement_display,
        "fee_display": f"KES {fmt_fiat(transaction.fee_amount)}" if transaction.fee_amount else "Free",
        "network_fee_display": "KES 0.00 · sponsored",
        "excise_display": f"KES {fmt_fiat(transaction.excise_duty_amount)}" if transaction.excise_duty_amount else "",
        "rate_display": rate_display,
        # 2026-05-09 · real, scannable QR (replaces the CSS dot pattern).
        "verify_url": verify_url,
        "qr_data_uri": qr_data_uri,
    }

    html_content = render_to_string("pdf/receipt.html", context)

    pdf_filename = f"receipt_{str(transaction.id)[:8]}_{transaction.created_at.strftime('%Y%m%d')}.pdf"
    pdf_path = os.path.join(RECEIPTS_DIR, pdf_filename)

    try:
        from weasyprint import HTML

        HTML(string=html_content).write_pdf(pdf_path)
        logger.info(f"PDF receipt generated: {pdf_path}")
        return pdf_path
    except Exception as e:
        logger.error(f"PDF generation failed: {e}", exc_info=True)
        return None
