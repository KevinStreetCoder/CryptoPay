"""PDF receipt generator for Cpay transactions.

Uses weasyprint to generate branded, well-designed PDF receipts
that match the ReceiptTemplate design spec — paper bg, emerald
gradient stripe, Coin-C watermark, hero amount card with SETTLED
pill, detail rows with dashed dividers, QR + verify footer.
"""

import logging
import os

from django.conf import settings
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

# Directory for storing generated receipts
RECEIPTS_DIR = os.path.join(settings.MEDIA_ROOT, "receipts")


def generate_receipt_pdf(transaction):
    """
    Generate a branded PDF receipt for a transaction.

    Args:
        transaction: Transaction model instance (with user relation loaded).

    Returns:
        str: Path to the generated PDF file, or None on failure.
    """
    os.makedirs(RECEIPTS_DIR, exist_ok=True)

    # Transaction type labels
    type_labels = {
        "PAYBILL_PAYMENT": "Paybill Payment",
        "TILL_PAYMENT": "Till Payment",
        "SEND_MPESA": "M-Pesa Transfer",
        "BUY": "Crypto Purchase",
        "DEPOSIT": "Crypto Deposit",
        "WITHDRAWAL": "Withdrawal",
        "INTERNAL_TRANSFER": "Internal Transfer",
    }

    # Recipient header + sub (matches design: "KPLC Prepaid" + "Paybill 888880 · Acc 0711••••••")
    recipient = ""
    recipient_sub = ""
    if transaction.mpesa_paybill:
        recipient = "M-Pesa Paybill"
        masked_acc = ""
        if transaction.mpesa_account:
            acc = str(transaction.mpesa_account)
            masked_acc = f" · Acc {acc[:4]}{'•' * max(0, len(acc) - 4)}"
        recipient_sub = f"Paybill {transaction.mpesa_paybill}{masked_acc}"
    elif transaction.mpesa_till:
        recipient = "M-Pesa Till"
        recipient_sub = f"Till {transaction.mpesa_till}"
    elif transaction.mpesa_phone:
        recipient = "M-Pesa transfer"
        phone = str(transaction.mpesa_phone)
        masked_phone = f"{phone[:6]}{'•' * max(0, len(phone) - 6)}" if len(phone) > 6 else phone
        recipient_sub = masked_phone

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

    context = {
        "tx": transaction,
        "user": transaction.user,
        "type_label": type_labels.get(transaction.type, transaction.type),
        "recipient": recipient,
        "recipient_sub": recipient_sub,
        "reference": f"CP-{str(transaction.id)[:6].upper()}-KE",
        "reference_short": str(transaction.id)[:8].upper(),
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
