"""SasaPay management endpoints · admin + mobile helpers.

Built 2026-05-10 from the full docs audit at docs.sasapay.app.

Routes (all under /api/v1/payments/):

  Admin (is_staff required) · for the ops dashboard:
    GET  admin/sasapay/balance/                · live Working/Utility/Bulk
    POST admin/sasapay/rebalance/              · move Working → Utility
    GET  admin/sasapay/verify/<trans_code>/    · sync verify any tx via SasaPay
    POST admin/sasapay/sync-banks/             · refresh channel-codes cache

  Authenticated user (mobile-callable) · for pre-flight UX:
    POST utilities/bill-query/                 · pre-pay DSTV/GOTV/water lookup
    POST account/validate/                     · pre-pay phone holder lookup
    GET  banks/                                · cached SasaPay channel codes

Design rules:
  - All wraps `apps.mpesa.sasapay_client.SasaPayClient` · single auth
    + retry path.
  - Mobile-callable endpoints rate-limit per user (UserRateThrottle)
    so an attacker can't enumerate phone holders by mass-querying.
  - Admin endpoints are is_staff only · not exposed to the APK.
  - Cache hits where the upstream is rarely changing (banks: 24h,
    bill-query: 5min, account-validate: 1h) so we don't hammer
    SasaPay's quota.
"""
from __future__ import annotations

import logging

from django.conf import settings
from django.core.cache import cache
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


class IsStaff(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_staff


def _client():
    """Lazy SasaPay client · only constructed when an endpoint is hit."""
    from apps.mpesa.sasapay_client import SasaPayClient
    return SasaPayClient()


def _provider_is_sasapay() -> bool:
    return (getattr(settings, "PAYMENT_PROVIDER", "daraja") or "daraja").lower() == "sasapay"


# ───────────────────────── Admin · Balance ────────────────────────────


class SasaPayBalanceView(APIView):
    """GET admin/sasapay/balance/

    Returns the live merchant balance broken down by account label
    (Working, Utility, Bulk Payment, Charges Paid). Per the docs at
    docs.sasapay.app/docs/check-balance/. Admin-only.
    """
    permission_classes = [IsStaff]

    def get(self, request):
        if not _provider_is_sasapay():
            return Response(
                {"error": "PAYMENT_PROVIDER is not 'sasapay'"},
                status=503,
            )
        try:
            raw = _client().check_balance()
        except Exception as e:
            logger.exception("sasapay_balance.failed")
            return Response(
                {"error": "SasaPay balance query failed", "detail": str(e)[:200]},
                status=502,
            )

        # Docs response shape: {statusCode, message, data: {CurrencyCode,
        # OrgAccountBalance, Accounts: [{account_label, account_balance}]}}
        data = raw.get("data") or raw
        accounts = data.get("Accounts") or []
        # Surface a flat "labels" map for fast UI access alongside the
        # raw list for any extra fields.
        labels = {
            (a.get("account_label") or "").strip(): a.get("account_balance", 0)
            for a in accounts
        }
        return Response({
            "currency": data.get("CurrencyCode") or "KES",
            "total_balance": data.get("OrgAccountBalance"),
            "accounts": accounts,
            "labels": labels,  # quick lookup: response["labels"]["Utility Account"]
            "raw": raw if request.query_params.get("debug") else None,
        })


class SasaPayRebalanceView(APIView):
    """POST admin/sasapay/rebalance/

    Body: {"amount": "100.00"}
    Manually trigger a Working → Utility internal fund movement.
    The auto-rebalance celery task (apps.mpesa.sasapay_tasks.
    auto_rebalance_utility) does this automatically every 5 min when
    Utility drops below `SASAPAY_MIN_UTILITY_KES` · this admin route
    is for manual top-ups outside the schedule.
    """
    permission_classes = [IsStaff]

    def post(self, request):
        if not _provider_is_sasapay():
            return Response({"error": "Not on SasaPay"}, status=503)
        try:
            amount = float(request.data.get("amount") or 0)
        except (TypeError, ValueError):
            return Response({"error": "amount must be numeric"}, status=400)
        if amount <= 0:
            return Response({"error": "amount must be > 0"}, status=400)

        try:
            result = _client().move_funds_to_utility(amount=amount)
        except Exception as e:
            logger.exception("sasapay_rebalance.failed")
            return Response(
                {"error": "Rebalance failed", "detail": str(e)[:200]},
                status=502,
            )
        return Response({"ok": True, "amount": amount, "raw": result})


class SasaPayVerifyTransactionView(APIView):
    """GET admin/sasapay/verify/<trans_code>/

    Calls the docs.sasapay.app/docs/verifytransaction/ endpoint to
    return the SasaPay-side authoritative state of any transaction
    code. Critical for disputes and callback failures · "the user
    says they paid but we never got the callback".
    """
    permission_classes = [IsStaff]

    def get(self, request, trans_code: str):
        if not _provider_is_sasapay():
            return Response({"error": "Not on SasaPay"}, status=503)
        try:
            raw = _client().verify_transaction(trans_code)
        except Exception as e:
            logger.exception("sasapay_verify.failed")
            return Response(
                {"error": "Verify failed", "detail": str(e)[:200]},
                status=502,
            )
        return Response(raw)


# ────────────────────── Mobile-callable · Bill Query ──────────────────


class BillQueryThrottle(UserRateThrottle):
    """60/min · 2026-05-16 raise · the paybill UI auto-queries the
    bill name once the paybill number is 5-7 digits. Combined with
    the user typing the account number, a single live-validation
    session burns 4-6 requests; with the prior 30/min cap a user
    paying multiple bills in quick succession would hit 429.

    `scope = 'bill_query'` · isolated bucket so this doesn't burn
    the user's shared `throttle_user_<id>` slot (see CpayTransfer
    throttle for the same fix-pattern)."""
    scope = "bill_query"
    rate = "60/min"


class BillQueryView(APIView):
    """POST utilities/bill-query/

    Body: {
      "service_code": "SP-DSTV" | "SP-GOTV" | "SP-NRB-WATER",
      "account_number": "12345678",
      "customer_mobile": "254712345678" (optional · falls back to user.phone),
    }

    Returns the dueAmount, dueDate, customerName from SasaPay so the
    mobile app can show "John Doe · KES 1,200 due 2026-06-15" before
    the user confirms payment. Cached 5 min per (service_code,
    account_number) so a user pressing query twice doesn't hit the
    upstream twice.
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [BillQueryThrottle]

    SUPPORTED_CODES = {"SP-DSTV", "SP-GOTV", "SP-NRB-WATER"}

    def post(self, request):
        if not _provider_is_sasapay():
            return Response({"error": "Bill query only available on SasaPay"}, status=503)

        service_code = (request.data.get("service_code") or "").strip().upper()
        account_number = (request.data.get("account_number") or "").strip()
        customer_mobile = (
            (request.data.get("customer_mobile") or "").strip()
            or (request.user.phone or "").lstrip("+")
        )

        if service_code not in self.SUPPORTED_CODES:
            return Response(
                {"error": f"Unsupported service_code · accepted: {sorted(self.SUPPORTED_CODES)}"},
                status=400,
            )
        if not account_number:
            return Response({"error": "account_number is required"}, status=400)
        if not customer_mobile:
            return Response({"error": "customer_mobile is required"}, status=400)

        cache_key = f"sasapay_bill_query:{service_code}:{account_number}"
        cached = cache.get(cache_key)
        if cached:
            return Response({**cached, "cached": True})

        try:
            raw = _client().query_bill(
                service_code=service_code,
                account_number=account_number,
                customer_mobile=customer_mobile,
            )
        except Exception as e:
            logger.warning(
                "bill_query.failed · service=%s acct=%s err=%s",
                service_code, account_number, str(e)[:200],
            )
            return Response(
                {"error": "Bill query failed", "detail": str(e)[:200]},
                status=502,
            )

        if not raw.get("status"):
            return Response(
                {"error": raw.get("detail") or raw.get("message") or "Lookup failed"},
                status=404,
            )

        data = raw.get("data") or {}
        out = {
            "service_code": service_code,
            "account_number": account_number,
            "customer_name": data.get("customerName") or "",
            "due_amount": data.get("dueAmount") or "",
            "due_date": data.get("dueDate") or "",
            "currency": data.get("currency") or "KES",
            "raw": raw if request.query_params.get("debug") else None,
        }
        cache.set(cache_key, out, timeout=300)  # 5 min
        return Response(out)


# ─────────────────── Mobile-callable · Account Validate ───────────────


class AccountValidateThrottle(UserRateThrottle):
    """60/min · 2026-05-16. Was 30/min; the mobile send-money screen
    auto-validates as the user types a phone number, and a 10-digit
    Kenyan phone produces up to 7 validate calls (one per char from
    length>=4 onwards · UI debounced at 400ms means a user typing
    fast hits the cap inside 60s without misuse). Validation is still
    a privacy-sensitive endpoint, so we keep enumeration costly · 60/min
    per authenticated user is the floor that still feels snappy in the
    legitimate UX. Use BillQueryThrottle (also 60/min) as the matched
    pair for paybill name lookups.

    `scope = 'account_validate'` · isolated cache bucket so this
    doesn't burn the user's shared `throttle_user_<id>` slot."""
    scope = "account_validate"
    rate = "60/min"


class AccountValidateView(APIView):
    """POST account/validate/

    Body: {
      "channel_code": "63902" (M-Pesa) | "63903" (Airtel) | "63907" (T-Kash) | bank code,
      "account_number": "254712345678" (or paybill / bank account #),
    }

    Returns the SasaPay-resolved holder name. Used by the mobile
    Send-to-M-Pesa screen to render "Sending to: John Doe" before the
    user confirms · eliminates wrong-number losses. Cached 1 h per
    (channel, account) so repeated lookups are free.
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [AccountValidateThrottle]

    def post(self, request):
        if not _provider_is_sasapay():
            return Response({"error": "Account validate only on SasaPay"}, status=503)

        channel_code = (request.data.get("channel_code") or "63902").strip()
        account_number = (request.data.get("account_number") or "").strip()
        if not account_number:
            return Response({"error": "account_number is required"}, status=400)

        # Normalise phones to E.164 (254XXXXXXXXX) for M-Pesa.
        if channel_code == "63902" and account_number.startswith(("0", "+")):
            account_number = account_number.lstrip("+")
            if account_number.startswith("0"):
                account_number = "254" + account_number[1:]

        cache_key = f"sasapay_validate:{channel_code}:{account_number}"
        cached = cache.get(cache_key)
        if cached is not None:
            return Response({**cached, "cached": True})

        try:
            raw = _client().validate_account(account_number, channel=channel_code)
        except Exception as e:
            logger.warning(
                "account_validate.failed · channel=%s err=%s",
                channel_code, str(e)[:200],
            )
            return Response(
                {"error": "Validation failed", "detail": str(e)[:200]},
                status=502,
            )

        if not raw.get("status"):
            return Response(
                {"error": raw.get("detail") or "Account not found"},
                status=404,
            )
        details = raw.get("account_details") or {}
        out = {
            "account_number": account_number,
            "account_name": details.get("account_name") or "",
            "channel_code": details.get("channel_code") or channel_code,
            "channel_name": details.get("channel_name") or "",
        }
        # 1 h cache · same TTL as our existing phone-holder lookup.
        cache.set(cache_key, out, timeout=3600)
        return Response(out)


# ─────────────────────── Mobile-callable · Banks list ─────────────────


class BanksListView(APIView):
    """GET banks/

    Returns the SasaPay channel-codes list (banks + their codes).
    Cached 24 h in Redis · the list rarely changes. Falls through to
    the existing `apps.payments.views.BankListView` static list when
    SasaPay returns empty (e.g. `PAYMENT_PROVIDER=daraja`).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        cache_key = "sasapay_channel_codes_v1"
        cached = cache.get(cache_key)
        if cached:
            return Response({"banks": cached, "cached": True})

        if not _provider_is_sasapay():
            return Response({"banks": [], "cached": False})

        try:
            from apps.mpesa.sasapay_client import SasaPayClient
            raw = SasaPayClient()._request("GET", "/payments/channel-codes/")
        except Exception as e:
            logger.warning("channel_codes.fetch_failed err=%s", str(e)[:200])
            return Response({"banks": [], "error": str(e)[:200]}, status=200)

        banks = raw.get("data") or []
        # Normalise keys for the mobile client.
        out = [
            {"slug": (b.get("bank_code") or "").strip(),
             "name": (b.get("bank_name") or "").strip(),
             "code": (b.get("bank_code") or "").strip()}
            for b in banks if b.get("bank_code")
        ]
        cache.set(cache_key, out, timeout=86400)
        return Response({"banks": out, "cached": False})
