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

    context = {
        "tx": transaction,
        "user": transaction.user,
        "type_label": type_labels.get(transaction.type, transaction.type),
        "recipient": recipient,
        "reference": str(transaction.id)[:8].upper(),
        "mpesa_receipt": transaction.mpesa_receipt or "Pending",
        "date": transaction.created_at.strftime("%B %d, %Y at %I:%M %p"),
        "source_display": f"{transaction.source_amount} {transaction.source_currency}",
        "dest_display": f"{transaction.dest_amount} {transaction.dest_currency}",
        "fee_display": f"KES {transaction.fee_amount}" if transaction.fee_amount else "Free",
        "excise_display": f"KES {transaction.excise_duty_amount}" if transaction.excise_duty_amount else "N/A",
        "rate_display": f"1 {transaction.source_currency} = KES {transaction.exchange_rate}" if transaction.exchange_rate else "",
    }

    html_content = render_to_string("pdf/receipt.html", context)

    pdf_filename = f"receipt_{str(transaction.id)[:8]}_{transaction.created_at.strftime('%Y%m%d')}.pdf"
    pdf_path = os.path.join(RECEIPTS_DIR, pdf_filename)

    try:
        from weasyprint import HTML

        HTML(string=html_content).write_pdf(pdf_path)
        logger.info(f"PDF receipt generated: {pdf_path}")
        return pdf_path
    except ImportError:
        # Fallback: save as HTML if weasyprint not installed
        html_path = pdf_path.replace(".pdf", ".html")
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html_content)
        logger.warning("weasyprint not installed, saved as HTML instead")
        return html_path
    except Exception as e:
        logger.error(f"PDF generation failed: {e}")
        return None
