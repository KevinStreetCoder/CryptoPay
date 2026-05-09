"""
Payment provider factory · switches between Daraja, SasaPay and IntaSend.

Usage:
    from apps.mpesa.provider import get_payment_client
    client = get_payment_client()
    client.pay_paybill(...)   # Routes to whichever provider is configured

Set PAYMENT_PROVIDER in .env:
    daraja    · Safaricom M-Pesa direct (default · blocked on CBK LNO
                · keep configured for the day approval lands)
    sasapay   · SasaPay PSP (CBK-licensed · primary rail)
    intasend  · IntaSend aggregator (secondary rail · approved 2026-05-08)

Each backend has a different method shape. This adapter normalises
them into a Daraja-compatible response (ConversationID, ResponseCode,
etc.) so the saga and the rest of the codebase don't have to know
which rail is currently in use.

History · the previous secondary rail was Kopo Kopo K2-Connect. Replaced
with IntaSend on 2026-05-08 after IntaSend approval landed before
Kopo Kopo's. The K2 client + webhook + tests were removed in the same
commit · K2 had no production callbacks before retirement.
"""

import logging
from django.conf import settings

logger = logging.getLogger(__name__)


class PaymentProviderAdapter:
    """Unified interface around MpesaClient / SasaPayClient / IntaSendClient.

    The three backends have different method names and response shapes ·
    this adapter normalises them so callers (saga, views) only need to
    know about Daraja-shaped results.
    """

    def __init__(self):
        provider = getattr(settings, "PAYMENT_PROVIDER", "daraja")
        self._provider_name = provider

        if provider == "sasapay":
            from .sasapay_client import SasaPayClient
            self._client = SasaPayClient()
            logger.info("Using SasaPay payment provider")
        elif provider == "intasend":
            from .intasend_client import IntaSendClient
            self._client = IntaSendClient()
            logger.info("Using IntaSend payment provider")
        else:
            from .client import MpesaClient
            self._client = MpesaClient()
            logger.info("Using Daraja payment provider")

    @property
    def provider_name(self) -> str:
        return self._provider_name

    @property
    def is_sasapay(self) -> bool:
        return self._provider_name == "sasapay"

    @property
    def is_intasend(self) -> bool:
        return self._provider_name == "intasend"

    @property
    def supports_reversal(self) -> bool:
        """Only Daraja has a first-class automated-reversal API. SasaPay
        and IntaSend force manual reconciliation · the saga opens a
        REVERSAL_NOT_SUPPORTED case in those paths."""
        return self._provider_name == "daraja"

    # ── B2B — Pay Paybill ──────────────────────────────────────────────

    def b2b_payment(self, paybill: str, account: str, amount: int,
                    remarks: str = "", reference: str = None) -> dict:
        if self.is_sasapay:
            result = self._client.pay_paybill(
                receiver_code=paybill,
                account_ref=account,
                amount=float(amount),
                reference=reference,
            )
            # 2026-05-09 sync-error pass-through · the saga checks BOTH
            # `ResponseCode` and `status` to detect synchronous SasaPay
            # rejection (Utilities API uses `status: false`, B2B/B2C use
            # `ResponseCode != "0"`). The adapter previously stripped
            # `status` AND defaulted ResponseCode to "0" when missing,
            # which masked Utilities-style failures as successes. Now
            # we pass `status` through and only default ResponseCode
            # when both are missing (treat as success only if SasaPay
            # said neither failed).
            sasapay_status = result.get("status")
            sasapay_code = result.get("ResponseCode")
            return {
                "ConversationID": result.get("B2BRequestID", result.get("ConversationID", "")),
                "OriginatorConversationID": result.get(
                    "OriginatorConversationID",
                    result.get("MerchantTransactionReference", ""),
                ),
                "ResponseCode": sasapay_code if sasapay_code is not None else (
                    "0" if sasapay_status is not False else "1"
                ),
                "status": sasapay_status,
                "ResponseDescription": result.get("detail")
                                       or result.get("message")
                                       or result.get("ResponseDescription")
                                       or "",
                "_raw": result,
            }
        elif self.is_intasend:
            result = self._client.pay_paybill(
                paybill=paybill, account=account,
                amount=float(amount), reference=reference,
            )
            # IntaSendClient already conforms to the adapter contract.
            return result
        else:
            return self._client.b2b_payment(
                paybill=paybill, account=account,
                amount=amount, remarks=remarks,
            )

    # ── B2B — Pay Till (BuyGoods) ──────────────────────────────────────

    def buy_goods(self, till: str, amount: int,
                  remarks: str = "", reference: str = None) -> dict:
        if self.is_sasapay:
            result = self._client.pay_till(
                receiver_code=till,
                amount=float(amount),
                reference=reference,
            )
            sasapay_status = result.get("status")
            sasapay_code = result.get("ResponseCode")
            return {
                "ConversationID": result.get("B2BRequestID", result.get("ConversationID", "")),
                "OriginatorConversationID": result.get("OriginatorConversationID", ""),
                "ResponseCode": sasapay_code if sasapay_code is not None else (
                    "0" if sasapay_status is not False else "1"
                ),
                "status": sasapay_status,
                "ResponseDescription": result.get("detail")
                                       or result.get("message")
                                       or result.get("ResponseDescription")
                                       or "",
                "_raw": result,
            }
        elif self.is_intasend:
            return self._client.pay_till(
                till=till, amount=float(amount), reference=reference,
            )
        else:
            return self._client.buy_goods(
                till=till, amount=amount, remarks=remarks,
            )

    # ── B2C — Send to Mobile ──────────────────────────────────────────

    def b2c_payment(self, phone: str, amount: int,
                    remarks: str = "", transaction_id: str = "") -> dict:
        if self.is_sasapay:
            result = self._client.send_to_mobile(
                phone=phone,
                amount=float(amount),
                reason=remarks,
                reference=transaction_id,
            )
            sasapay_status = result.get("status")
            sasapay_code = result.get("ResponseCode")
            return {
                "ConversationID": result.get("B2CRequestID", result.get("ConversationID", "")),
                "OriginatorConversationID": result.get("OriginatorConversationID", ""),
                "ResponseCode": sasapay_code if sasapay_code is not None else (
                    "0" if sasapay_status is not False else "1"
                ),
                "status": sasapay_status,
                "ResponseDescription": result.get("detail")
                                       or result.get("message")
                                       or result.get("ResponseDescription")
                                       or "",
                "_raw": result,
            }
        elif self.is_intasend:
            return self._client.send_to_mobile(
                phone=phone, amount=float(amount),
                reason=remarks or "Payment",
                reference=transaction_id,
            )
        else:
            return self._client.b2c_payment(
                phone=phone, amount=amount,
                remarks=remarks, transaction_id=transaction_id,
            )

    # ── C2B — STK Push (collect payment) ──────────────────────────────

    def stk_push(self, phone: str, amount: int,
                 account_ref: str = "", description: str = "") -> dict:
        if self.is_sasapay:
            result = self._client.stk_push(
                phone=phone,
                amount=float(amount),
                account_ref=account_ref,
                description=description,
            )
            return {
                "CheckoutRequestID": result.get("CheckoutRequestID", ""),
                "MerchantRequestID": result.get("MerchantRequestID", ""),
                "ResponseCode": result.get("ResponseCode", "0"),
                "ResponseDescription": result.get("detail", ""),
                "CustomerMessage": result.get("CustomerMessage", ""),
            }
        elif self.is_intasend:
            result = self._client.stk_push(
                phone=phone, amount=float(amount),
                account_ref=account_ref, description=description,
            )
            return {
                "CheckoutRequestID": result.get("InvoiceID", ""),
                "MerchantRequestID": result.get("TrackingID", ""),
                "ResponseCode": result.get("ResponseCode", "0"),
                "ResponseDescription": result.get(
                    "ResponseDescription", "stk_initiated",
                ),
                "CustomerMessage": result.get(
                    "CustomerMessage",
                    "Check your phone for the M-Pesa prompt.",
                ),
            }
        else:
            return self._client.stk_push(
                phone=phone, amount=amount,
                account_ref=account_ref, description=description,
            )

    # ── Reversal ──────────────────────────────────────────────────────

    def reversal(self, transaction_id: str, amount: int, remarks: str = "") -> dict:
        if self.is_sasapay:
            logger.warning(f"SasaPay reversal not supported. tx={transaction_id}")
            raise NotImplementedError(
                f"SasaPay does not support reversals. Transaction {transaction_id} "
                f"requires manual intervention."
            )
        elif self.is_intasend:
            logger.warning(f"IntaSend reversal not supported. tx={transaction_id}")
            raise NotImplementedError(
                f"IntaSend does not support automated reversals. "
                f"Transaction {transaction_id} requires manual intervention."
            )
        else:
            return self._client.reversal(
                transaction_id=transaction_id,
                amount=amount, remarks=remarks,
            )


def get_payment_client() -> PaymentProviderAdapter:
    """Factory function — returns the configured payment provider."""
    return PaymentProviderAdapter()
