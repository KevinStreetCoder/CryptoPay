"""
Payment provider factory — switches between Daraja and SasaPay.

Usage:
    from apps.mpesa.provider import get_payment_client
    client = get_payment_client()
    client.pay_paybill(...)  # Routes to Daraja or SasaPay

Set PAYMENT_PROVIDER=sasapay in .env to use SasaPay.
Default is "daraja" (Safaricom M-Pesa direct).
"""

import logging
from django.conf import settings

logger = logging.getLogger(__name__)


class PaymentProviderAdapter:
    """
    Unified interface that wraps either MpesaClient or SasaPayClient.
    Both clients have different method names — this adapter normalizes them.
    """

    def __init__(self):
        provider = getattr(settings, "PAYMENT_PROVIDER", "daraja")
        self._provider_name = provider

        if provider == "sasapay":
            from .sasapay_client import SasaPayClient
            self._client = SasaPayClient()
            logger.info("Using SasaPay payment provider")
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
            # Normalize response to match Daraja format
            return {
                "ConversationID": result.get("B2BRequestID", result.get("ConversationID", "")),
                "OriginatorConversationID": result.get("OriginatorConversationID",
                                                        result.get("MerchantTransactionReference", "")),
                "ResponseCode": result.get("ResponseCode", "0"),
                "ResponseDescription": result.get("detail", ""),
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
        else:
            return self._client.stk_push(
                phone=phone, amount=amount,
                account_ref=account_ref, description=description,
            )

    # ── Reversal ──────────────────────────────────────────────────────

    def reversal(self, transaction_id: str, amount: int, remarks: str = "") -> dict:
        if self.is_sasapay:
            # SasaPay doesn't have a reversal API — raise so callers know it failed
            logger.warning(f"SasaPay reversal not supported. tx={transaction_id}")
            raise NotImplementedError(
                f"SasaPay does not support reversals. Transaction {transaction_id} "
                f"requires manual intervention."
            )
        else:
            return self._client.reversal(
                transaction_id=transaction_id,
                amount=amount, remarks=remarks,
            )


def get_payment_client() -> PaymentProviderAdapter:
    """Factory function — returns the configured payment provider."""
    return PaymentProviderAdapter()
