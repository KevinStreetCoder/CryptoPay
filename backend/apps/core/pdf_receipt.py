"""PDF receipt generator for CryptoPay transactions.

Uses weasyprint to generate branded, well-designed PDF receipts
with the CryptoPay logo, transaction details, and reference number.
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

    # Recipient info
    recipient = ""
    if transaction.mpesa_paybill:
        recipient = f"Paybill {transaction.mpesa_paybill}"
        if transaction.mpesa_account:
            recipient += f" (Acc: {transaction.mpesa_account})"
    elif transaction.mpesa_till:
        recipient = f"Till {transaction.mpesa_till}"
    elif transaction.mpesa_phone:
        recipient = f"M-Pesa {transaction.mpesa_phone}"

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

    context = {
        "tx": transaction,
        "user": transaction.user,
        "type_label": type_labels.get(transaction.type, transaction.type),
        "recipient": recipient,
        "reference": str(transaction.id)[:8].upper(),
        "mpesa_receipt": transaction.mpesa_receipt or "Pending",
        "date": transaction.created_at.strftime("%B %d, %Y at %I:%M %p"),
        "source_display": fmt_amount(transaction.source_amount, source_cur),
        "dest_display": fmt_amount(transaction.dest_amount, dest_cur),
        "fee_display": f"KSh {fmt_fiat(transaction.fee_amount)}" if transaction.fee_amount else "Free",
        "excise_display": f"KSh {fmt_fiat(transaction.excise_duty_amount)}" if transaction.excise_duty_amount else "N/A",
        "rate_display": f"1 {source_cur} = KSh {fmt_fiat(transaction.exchange_rate)}" if transaction.exchange_rate else "",
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
