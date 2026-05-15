"""
Payment provider factory · per-method routing between Daraja, SasaPay
and IntaSend.

Usage:
    from apps.mpesa.provider import get_payment_client
    client = get_payment_client()
    client.b2b_payment(...)   # Routes paybill (per PAYMENT_PROVIDER_PAYBILL)
    client.buy_goods(...)     # Routes till    (per PAYMENT_PROVIDER_TILL)
    client.b2c_payment(...)   # Routes B2C     (per PAYMENT_PROVIDER_B2C)
    client.stk_push(...)      # Routes STK     (per PAYMENT_PROVIDER_STK)

Env knobs:
    PAYMENT_PROVIDER          · default for every method (legacy single-knob)
    PAYMENT_PROVIDER_PAYBILL  · paybill (b2b_payment) override
    PAYMENT_PROVIDER_TILL     · till (buy_goods) override
    PAYMENT_PROVIDER_B2C      · send-mpesa (b2c_payment) override
    PAYMENT_PROVIDER_STK      · STK push (stk_push) override

Each per-method override falls back to PAYMENT_PROVIDER when empty.

Production routing as of 2026-05-15 (beta launch):
    paybill : intasend  · SasaPay returns SP01002 "not permitted per product
              assignment" on most Kenyan paybills; IntaSend has no per-paybill
              gating. KPLC token capture works on both via callback.
    till    : intasend  · same reason
    B2C     : sasapay   · float lives on SasaPay merchant account
    STK     : sasapay   · float lives on SasaPay merchant account

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


# Per-method env-var names. Each falls back to the legacy single-knob
# PAYMENT_PROVIDER when empty, so existing deploys keep working unchanged.
_METHOD_ENV_VARS = {
    "paybill": "PAYMENT_PROVIDER_PAYBILL",
    "till":    "PAYMENT_PROVIDER_TILL",
    "b2c":     "PAYMENT_PROVIDER_B2C",
    "stk":     "PAYMENT_PROVIDER_STK",
}


def _resolve_provider(method: str) -> str:
    """Return the provider name (daraja/sasapay/intasend) for a method.

    Per-method override wins; otherwise fall back to PAYMENT_PROVIDER;
    otherwise default to daraja.
    """
    legacy = getattr(settings, "PAYMENT_PROVIDER", "daraja") or "daraja"
    override = getattr(settings, _METHOD_ENV_VARS[method], "") or ""
    return (override or legacy).lower()


class PaymentProviderAdapter:
    """Unified interface around MpesaClient / SasaPayClient / IntaSendClient.

    Backends are loaded lazily on first use · construction is cheap.
    Routing is resolved once per adapter instance so callers can read
    `.routing_for("paybill")` without re-reading settings every call.
    """

    def __init__(self):
        self._routing = {m: _resolve_provider(m) for m in _METHOD_ENV_VARS}
        # Legacy single-provider name · still exposed for callers that
        # don't care about per-method routing (e.g. metrics labels).
        self._legacy_provider = (
            getattr(settings, "PAYMENT_PROVIDER", "daraja") or "daraja"
        ).lower()
        self._cached_clients: dict = {}
        logger.info(
            "PaymentProviderAdapter routing · paybill=%s till=%s b2c=%s stk=%s",
            self._routing["paybill"], self._routing["till"],
            self._routing["b2c"], self._routing["stk"],
        )

    def _client_for(self, method: str):
        """Return the right backend client for a method. Cached per-process
        so we don't reconstruct on every call."""
        provider = self._routing[method]
        cached = self._cached_clients.get(provider)
        if cached is not None:
            return cached
        if provider == "sasapay":
            from .sasapay_client import SasaPayClient
            client = SasaPayClient()
        elif provider == "intasend":
            from .intasend_client import IntaSendClient
            client = IntaSendClient()
        else:
            from .client import MpesaClient
            client = MpesaClient()
        self._cached_clients[provider] = client
        return client

    @property
    def provider_name(self) -> str:
        """Legacy field · returns the single-knob name. Use
        `routing_for(method)` for per-method introspection."""
        return self._legacy_provider

    # Backwards-compat read-only alias · old call-sites use `._client`
    # to hit the underlying SDK. Resolves to the B2C/STK provider (the
    # historical "primary" rail) so admin tools that grab `._client`
    # don't break when paybill/till were split off.
    @property
    def _client(self):  # noqa: D401 · legacy property
        return self._client_for("b2c")

    def routing_for(self, method: str) -> str:
        """`paybill`/`till`/`b2c`/`stk` → resolved provider name."""
        return self._routing[method]

    @property
    def is_sasapay(self) -> bool:
        return self._legacy_provider == "sasapay"

    @property
    def is_intasend(self) -> bool:
        return self._legacy_provider == "intasend"

    @property
    def supports_reversal(self) -> bool:
        """Only Daraja has a first-class automated-reversal API. SasaPay
        and IntaSend force manual reconciliation · the saga opens a
        REVERSAL_NOT_SUPPORTED case in those paths. Reversal applies to
        the B2C leg, so we check the B2C provider here."""
        return self._routing["b2c"] == "daraja"

    # ── B2B — Pay Paybill ──────────────────────────────────────────────

    def b2b_payment(self, paybill: str, account: str, amount: int,
                    remarks: str = "", reference: str = None) -> dict:
        provider = self._routing["paybill"]
        client = self._client_for("paybill")
        if provider == "sasapay":
            result = client.pay_paybill(
                receiver_code=paybill,
                account_ref=account,
                amount=float(amount),
                reference=reference,
            )
            # 2026-05-09 sync-error pass-through · the saga checks BOTH
            # `ResponseCode` and `status` to detect synchronous SasaPay
            # rejection (Utilities API uses `status: false`, B2B/B2C use
            # `ResponseCode != "0"`). Pass `status` through; default
            # ResponseCode to "0" only when both are missing.
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
        elif provider == "intasend":
            # IntaSendClient.pay_paybill already conforms to the adapter
            # contract (returns ConversationID/ResponseCode shape).
            return client.pay_paybill(
                paybill=paybill, account=account,
                amount=float(amount), reference=reference,
            )
        else:
            return client.b2b_payment(
                paybill=paybill, account=account,
                amount=amount, remarks=remarks,
            )

    # ── B2B — Pay Till (BuyGoods) ──────────────────────────────────────

    def buy_goods(self, till: str, amount: int,
                  remarks: str = "", reference: str = None) -> dict:
        provider = self._routing["till"]
        client = self._client_for("till")
        if provider == "sasapay":
            result = client.pay_till(
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
        elif provider == "intasend":
            return client.pay_till(
                till=till, amount=float(amount), reference=reference,
            )
        else:
            return client.buy_goods(
                till=till, amount=amount, remarks=remarks,
            )

    # ── B2C — Send to Mobile ──────────────────────────────────────────

    def b2c_payment(self, phone: str, amount: int,
                    remarks: str = "", transaction_id: str = "") -> dict:
        provider = self._routing["b2c"]
        client = self._client_for("b2c")
        if provider == "sasapay":
            result = client.send_to_mobile(
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
        elif provider == "intasend":
            return client.send_to_mobile(
                phone=phone, amount=float(amount),
                reason=remarks or "Payment",
                reference=transaction_id,
            )
        else:
            return client.b2c_payment(
                phone=phone, amount=amount,
                remarks=remarks, transaction_id=transaction_id,
            )

    # ── C2B — STK Push (collect payment) ──────────────────────────────

    def stk_push(self, phone: str, amount: int,
                 account_ref: str = "", description: str = "") -> dict:
        provider = self._routing["stk"]
        client = self._client_for("stk")
        if provider == "sasapay":
            result = client.stk_push(
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
        elif provider == "intasend":
            result = client.stk_push(
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
            return client.stk_push(
                phone=phone, amount=amount,
                account_ref=account_ref, description=description,
            )

    # ── Reversal ──────────────────────────────────────────────────────

    def reversal(self, transaction_id: str, amount: int, remarks: str = "") -> dict:
        # Reversal applies to the B2C leg, so route based on the B2C provider.
        provider = self._routing["b2c"]
        client = self._client_for("b2c")
        if provider == "sasapay":
            logger.warning(f"SasaPay reversal not supported. tx={transaction_id}")
            raise NotImplementedError(
                f"SasaPay does not support reversals. Transaction {transaction_id} "
                f"requires manual intervention."
            )
        elif provider == "intasend":
            logger.warning(f"IntaSend reversal not supported. tx={transaction_id}")
            raise NotImplementedError(
                f"IntaSend does not support automated reversals. "
                f"Transaction {transaction_id} requires manual intervention."
            )
        else:
            return client.reversal(
                transaction_id=transaction_id,
                amount=amount, remarks=remarks,
            )


def get_payment_client() -> PaymentProviderAdapter:
    """Factory function — returns the configured payment provider."""
    return PaymentProviderAdapter()
