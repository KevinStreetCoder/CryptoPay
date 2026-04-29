"""
Payment provider factory · switches between Daraja, SasaPay and Kopo Kopo.

Usage:
    from apps.mpesa.provider import get_payment_client
    client = get_payment_client()
    client.pay_paybill(...)   # Routes to whichever provider is configured

Set PAYMENT_PROVIDER in .env:
    daraja   · Safaricom M-Pesa direct (default · requires CBK LNO)
    sasapay  · SasaPay PSP (CBK-licensed)
    kopokopo · Kopo Kopo aggregator (Daraja-approved merchant of record)

Each backend has a different method shape. This adapter normalises
them into a Daraja-compatible response (ConversationID, ResponseCode,
etc.) so the saga and the rest of the codebase don't have to know
which rail is currently in use.
"""

import logging
from django.conf import settings

logger = logging.getLogger(__name__)


class PaymentProviderAdapter:
    """Unified interface around MpesaClient / SasaPayClient / KopoKopoClient.

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
        elif provider == "kopokopo":
            from .kopokopo_client import KopoKopoClient
            self._client = KopoKopoClient()
            logger.info("Using Kopo Kopo payment provider")
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
    def is_kopokopo(self) -> bool:
        return self._provider_name == "kopokopo"

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
            return {
                "ConversationID": result.get("B2BRequestID", result.get("ConversationID", "")),
                "OriginatorConversationID": result.get("OriginatorConversationID",
                                                        result.get("MerchantTransactionReference", "")),
                "ResponseCode": result.get("ResponseCode", "0"),
                "ResponseDescription": result.get("detail", ""),
            }
        elif self.is_kopokopo:
            result = self._client.pay_paybill(
                paybill=paybill, account=account,
                amount=float(amount), reference=reference,
            )
            # K2 returns the resource Location URL · we treat it as the
            # ConversationID so the saga can find it later from the
            # callback (saga stores `kopokopo_pay_resource_url` on the tx).
            return {
                "ConversationID": result.get("k2_resource_url", ""),
                "OriginatorConversationID": result.get("destination_reference", ""),
                "ResponseCode": "0" if result.get("status_code", 0) in (200, 201) else "1",
                "ResponseDescription": "queued" if result.get("status_code") else "",
            }
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
            return {
                "ConversationID": result.get("B2BRequestID", result.get("ConversationID", "")),
                "OriginatorConversationID": result.get("OriginatorConversationID", ""),
                "ResponseCode": result.get("ResponseCode", "0"),
                "ResponseDescription": result.get("detail", ""),
            }
        elif self.is_kopokopo:
            result = self._client.pay_till(
                till=till, amount=float(amount), reference=reference,
            )
            return {
                "ConversationID": result.get("k2_resource_url", ""),
                "OriginatorConversationID": result.get("destination_reference", ""),
                "ResponseCode": "0" if result.get("status_code", 0) in (200, 201) else "1",
                "ResponseDescription": "queued" if result.get("status_code") else "",
            }
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
            return {
                "ConversationID": result.get("B2CRequestID", result.get("ConversationID", "")),
                "OriginatorConversationID": result.get("OriginatorConversationID", ""),
                "ResponseCode": result.get("ResponseCode", "0"),
                "ResponseDescription": result.get("detail", ""),
            }
        elif self.is_kopokopo:
            result = self._client.send_to_mobile(
                phone=phone, amount=float(amount),
                reason=remarks or "Payment",
                reference=transaction_id,
            )
            return {
                "ConversationID": result.get("k2_resource_url", ""),
                "OriginatorConversationID": result.get("destination_reference", ""),
                "ResponseCode": "0" if result.get("status_code", 0) in (200, 201) else "1",
                "ResponseDescription": "queued" if result.get("status_code") else "",
            }
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
        elif self.is_kopokopo:
            result = self._client.stk_push(
                phone=phone, amount=float(amount),
                account_ref=account_ref, description=description,
            )
            # K2's analogue to CheckoutRequestID is the resource URL
            # in the Location header. Saga stores it on the tx so the
            # callback can find the row.
            return {
                "CheckoutRequestID": result.get("k2_resource_url", ""),
                "MerchantRequestID": result.get("k2_resource_url", ""),
                "ResponseCode": "0" if result.get("status_code", 0) in (200, 201) else "1",
                "ResponseDescription": "stk_initiated" if result.get("status_code") else "",
                "CustomerMessage": "Check your phone for the M-Pesa popup.",
            }
        else:
            return self._client.stk_push(
                phone=phone, amount=amount,
                account_ref=account_ref, description=description,
            )

    # ── Reversal ──────────────────────────────────────────────────────

    def reversal(self, transaction_id: str, amount: int, remarks: str = "") -> dict:
        if self.is_sasapay:
            # SasaPay's reversal API is partial · the saga handles this
            # by opening a REVERSAL_NOT_SUPPORTED ReconciliationCase.
            logger.warning(f"SasaPay reversal not supported. tx={transaction_id}")
            raise NotImplementedError(
                f"SasaPay does not support reversals. Transaction {transaction_id} "
                f"requires manual intervention."
            )
        elif self.is_kopokopo:
            # K2's reversal IS first-class · this is one of the main
            # reasons we prefer Kopo Kopo for B2B over SasaPay. The
            # saga's compensate_mpesa works without having to open a
            # ReconciliationCase.
            result = self._client.reversal(
                transaction_id=transaction_id,
                amount=amount, remarks=remarks,
            )
            return {
                "ConversationID": result.get("k2_resource_url", ""),
                "OriginatorConversationID": "",
                "ResponseCode": "0" if result.get("status_code", 0) in (200, 201) else "1",
                "ResponseDescription": "reversal_queued" if result.get("status_code") else "",
            }
        else:
            return self._client.reversal(
                transaction_id=transaction_id,
                amount=amount, remarks=remarks,
            )


def get_payment_client() -> PaymentProviderAdapter:
    """Factory function — returns the configured payment provider."""
    return PaymentProviderAdapter()
