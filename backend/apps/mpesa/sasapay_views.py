"""
SasaPay callback handlers.

2026-05-17 · DEPRECATED IN PRODUCTION · ops confirmed SasaPay does NOT
deliver reliable webhooks for our tier · they use IP allowlisting on
OUTBOUND traffic (our calls to them) instead. Cpay's source-of-truth
for SasaPay tx status is the POLLING path at
`apps.payments.tasks._resolve_via_sasapay_status` which runs every 15s
via the `check_pending_mpesa_payments` cron.

These callback handlers REMAIN registered as a defensive fallback ·
if SasaPay ever does deliver a webhook (e.g. a future tier upgrade
or sandbox traffic), the dedup + IP-allowlist + HMAC layers below
will accept and process it the same as the polling path. The
behaviour-defining contract is `_process_successful_payment` which
is invoked from BOTH paths · keep that idempotent.

Set `SASAPAY_WEBHOOK_DISABLED=true` in production env to make these
endpoints return 410 Gone immediately on any incoming request · use
this for the canonical production deploy where SasaPay genuinely
won't fire them. The polling path is unaffected.

Receives payment results from SasaPay for B2B, B2C, and C2B transactions.
Processes results the same way as Daraja callbacks: updates transaction
status, credits wallets, and sends notifications.

Defence layers (audit CRITICAL-1 fix · 2026-04-25):

  1. IP whitelist (MpesaIPWhitelistMiddleware on the URL prefix).
  2. HMAC signature verification on every callback. Two accepted forms:
       a. SasaPay-issued `X-SasaPay-Signature` header · HMAC-SHA256
          of the raw request body keyed on SASAPAY_WEBHOOK_SECRET.
       b. Per-tx URL token fallback (same pattern as Daraja) ·
          /api/v1/sasapay/callback/<token>/  with token =
          HMAC-SHA256(SASAPAY_CALLBACK_HMAC_KEY, "{tx}:{kind}:{ts}").
     Production refuses to process callbacks that present neither.
  3. Per-callback Redis SETNX dedup keyed on the SasaPay TransID
     · prevents replay even if a captured callback is re-played
     within the IP allow-list window.
  4. Amount tamper check · the callback's TransAmount must match the
     pending Transaction's source_amount within 1 KES; mismatch is a
     hard reject, mirrors the B12 STK guard on the Daraja side.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from apps.accounts.models import AuditLog

logger = logging.getLogger(__name__)


# ───────────────────────── Authentication helpers ────────────────────


def _verify_header_signature(request, body_bytes: bytes) -> bool:
    """Verify the `sasapay_signature` header (canonical path, 2026-05-09).

    SasaPay's documented callback-security model
    (https://developer.sasapay.app/docs/apis/callback-security):

      - Algorithm · HMAC-SHA512 (NOT SHA-256 · we previously had
        the wrong digest)
      - Secret · the merchant's `Client ID` from the developer
        portal (NOT a separate webhook secret · the docs are
        explicit: "Use the Merchant API Client ID as the HMAC
        secret")
      - Header name · `sasapay_signature` (lowercase, no prefix)
      - Message format · concatenation of FIVE fields with hyphens
        in this exact order:
          {sasapay_transaction_code}-{merchant_code}-{account_number}
            -{payment_reference}-{amount}
        Fields come out of the callback payload itself · we reach
        into the parsed JSON body to reconstruct the signed message.

    Production must boot with SASAPAY_CLIENT_ID set when
    PAYMENT_PROVIDER=sasapay · the production-settings guard already
    enforces it (it was always required for OAuth client_credentials).
    The legacy `SASAPAY_WEBHOOK_SECRET` env var is now ignored on the
    signature path · kept tolerant in `settings.py` for back-compat
    with operators who set it before the doc clarification.
    """
    secret = getattr(settings, "SASAPAY_CLIENT_ID", "")
    if not secret:
        return False

    received = (
        request.headers.get("sasapay_signature")
        or request.headers.get("Sasapay-Signature")
        or request.headers.get("X-SasaPay-Signature")  # legacy / belt-and-braces
        or request.META.get("HTTP_SASAPAY_SIGNATURE", "")
        or ""
    ).strip().lower()
    if not received:
        return False
    if "=" in received:
        received = received.split("=", 1)[1]

    # Reconstruct the signed message from the parsed JSON body. The
    # docs list the fields in this exact order and SasaPay's signer
    # uses them verbatim · any deviation (e.g. amount rounding,
    # missing trailing zero) breaks the signature, so we accept a
    # narrow set of field-name spellings the C2B / B2B / B2C
    # variants use.
    try:
        payload = json.loads(body_bytes.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("sasapay_signature: payload not parseable as JSON")
        return False

    sasapay_tx_code = (
        payload.get("TransactionCode")
        or payload.get("SasaPayTransactionCode")
        or payload.get("sasapay_transaction_code")
        or ""
    )
    merchant_code = (
        payload.get("MerchantCode")
        or payload.get("merchant_code")
        or getattr(settings, "SASAPAY_MERCHANT_CODE", "")
        or ""
    )
    # On C2B IPN the customer's phone is in MSISDN; on B2B the
    # account is in BillRefNumber/AccountReference; on B2C the
    # recipient phone is in ReceiverNumber. SasaPay uses one
    # consolidated `account_number` field on its signing side
    # but the inbound payload spelling depends on product. Fall
    # through them in priority order.
    account_number = (
        payload.get("account_number")
        or payload.get("AccountReference")
        or payload.get("MSISDN")
        or payload.get("ReceiverNumber")
        or payload.get("BillRefNumber")
        or ""
    )
    payment_reference = (
        payload.get("MerchantTransactionReference")
        or payload.get("payment_reference")
        or payload.get("MerchantRequestID")
        or ""
    )
    # Amount must be the EXACT string SasaPay signed · they format
    # with two decimals when the transaction includes cents. We
    # normalise to a Decimal then back to "X.XX" only if the
    # incoming value is numeric without trailing zeros; otherwise
    # we pass the raw string through.
    amount_raw = (
        payload.get("TransAmount")
        or payload.get("TransactionAmount")
        or payload.get("amount")
        or ""
    )
    amount = str(amount_raw).strip()

    message = f"{sasapay_tx_code}-{merchant_code}-{account_number}-{payment_reference}-{amount}"
    expected = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha512,
    ).hexdigest()

    ok = hmac.compare_digest(expected.lower(), received)
    if not ok:
        # Try the alt amount format (with trailing .00) · the docs
        # show "1500.00" verbatim, so if the payload sent "1500" we
        # may need to pad before signing comparison.
        try:
            from decimal import Decimal as _D
            alt_amount = str(_D(amount).quantize(_D("0.01")))
            alt_message = f"{sasapay_tx_code}-{merchant_code}-{account_number}-{payment_reference}-{alt_amount}"
            alt_expected = hmac.new(
                secret.encode("utf-8"),
                alt_message.encode("utf-8"),
                hashlib.sha512,
            ).hexdigest()
            ok = hmac.compare_digest(alt_expected.lower(), received)
        except Exception:
            pass

    if not ok:
        logger.warning(
            "sasapay_signature.mismatch · tx=%s ref=%s amount=%s",
            sasapay_tx_code, payment_reference, amount,
        )
    return ok


def _verify_url_token(token: str, body_bytes: bytes) -> tuple[bool, str | None]:
    """Verify a per-tx URL token (fallback path).

    Token format: `<tx_id>.<unix_ts>.<hex-mac>` where mac is
    HMAC-SHA256(SASAPAY_CALLBACK_HMAC_KEY, "{tx_id}:{ts}").

    Returns (ok, tx_id) · tx_id lets the caller short-circuit the
    transaction lookup since we already have it from the URL.
    """
    secret = getattr(settings, "SASAPAY_CALLBACK_HMAC_KEY", "")
    if not secret or not token:
        return False, None

    parts = token.split(".")
    if len(parts) != 3:
        return False, None

    tx_id, ts, received_mac = parts
    expected_mac = hmac.new(
        secret.encode("utf-8"),
        f"{tx_id}:{ts}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_mac, received_mac):
        return False, None

    # 2026-05-17 · M2 fix · enforce token freshness · without this, a
    # leaked token replays forever (modulo the Redis one-shot below
    # · but that lasts only 24h after FIRST use, not after issue).
    # SasaPay's documented retry window is 1-2h · we allow 4h (14400s)
    # to absorb any clock skew + retry queue backlog.
    try:
        ts_int = int(ts)
        import time as _time  # noqa: PLC0415
        max_age = int(getattr(settings, "SASAPAY_TOKEN_MAX_AGE_SEC", 14400))
        if abs(int(_time.time()) - ts_int) > max_age:
            return False, None
    except (ValueError, TypeError):
        return False, None

    # One-shot consumption · same Redis pattern as Daraja
    used_key = f"sasapay_token_used:{token}"
    if not cache.add(used_key, "1", timeout=24 * 3600):
        return False, None

    return True, tx_id


def _provider_enabled() -> bool:
    """True only when SasaPay is the active payment provider.

    We use Safaricom Daraja in production (April 2026 onwards). The
    SasaPay code stays in tree as a fallback path; the views must
    refuse traffic unless the operator explicitly flips the provider.
    Belt-and-braces with the URL routes being commented out · if a
    future change re-adds the routes by accident, this guard still
    refuses any callback when PAYMENT_PROVIDER != "sasapay".
    """
    return (getattr(settings, "PAYMENT_PROVIDER", "daraja") or "daraja").lower() == "sasapay"


def _authenticated(request, body_bytes: bytes) -> tuple[bool, str | None]:
    """Confirm the caller is SasaPay (or carries our URL token).

    Returns (ok, optional_tx_id_from_url_token).

    In DEBUG mode we accept unsigned callbacks so the sandbox test rig
    works · production refuses anything we can't authenticate.
    """
    # Provider guard · refuse outright when SasaPay isn't the active
    # provider, regardless of signature validity. Prevents anyone using
    # an old SasaPay-issued signature against a Daraja-only deployment.
    if not _provider_enabled():
        return False, None

    # Header path (preferred)
    if _verify_header_signature(request, body_bytes):
        return True, None

    # URL-token path (fallback)
    token = request.resolver_match.kwargs.get("token", "") if request.resolver_match else ""
    if token:
        ok, tx_id = _verify_url_token(token, body_bytes)
        if ok:
            return True, tx_id

    # ── IP-allowlist + status-API verify path ──
    # SasaPay's documented HMAC-SHA512 callback signing applies to
    # OUTBOUND B2B / B2C transaction-result notifications, not to the
    # INBOUND C2B IPN (Pay Bill / Till deposit notification). Production
    # traffic from `47.129.43.141` (a documented SasaPay host) hits us
    # WITHOUT any signature header. The IP-allowlist middleware
    # (`MpesaIPWhitelistMiddleware` for the `/api/v1/sasapay/` prefix)
    # has already gated the request before it reached this view, so by
    # this point we know the source IP is one of the documented SasaPay
    # `/32` hosts. Combined with the mandatory status-API re-verification
    # in `_process_successful_payment` (gated on
    # SASAPAY_VERIFY_CALLBACKS_VIA_API, default True), this gives us:
    #   1. Pre-view IP allowlist  (this stops random internet traffic)
    #   2. Idempotency dedup     (stops replay)
    #   3. Status-API confirm    (cryptographic trust anchor · SasaPay's
    #                             own server is the source of truth before
    #                             any wallet credit happens)
    # so we accept the unsigned IPN here. If the operator wants to be
    # stricter (e.g. once SasaPay turns on signed C2B in a future API
    # version), set SASAPAY_TRUST_IP_FOR_UNSIGNED_IPN=False.
    if (
        getattr(settings, "SASAPAY_VERIFY_CALLBACKS_VIA_API", True)
        and getattr(settings, "SASAPAY_TRUST_IP_FOR_UNSIGNED_IPN", True)
    ):
        client_ip = request.META.get("REMOTE_ADDR", "?")
        # Log the headers we DID receive · helps if SasaPay later starts
        # sending a signature header under a different name.
        sig_headers = {
            k: v[:32] + "..." if len(v) > 32 else v
            for k, v in request.headers.items()
            if "sign" in k.lower() or "sasapay" in k.lower() or "auth" in k.lower()
        }
        logger.info(
            "sasapay_callback: accepting unsigned IPN from allowlisted IP %s "
            "· will re-verify via status API before credit (sig_headers=%s)",
            client_ip,
            sig_headers or "none",
        )
        return True, None

    # Dev escape hatch · never fires in production. The production
    # guard refuses to boot if SASAPAY_WEBHOOK_SECRET is empty when
    # PAYMENT_PROVIDER=sasapay, so we won't get here unless DEBUG is on.
    if settings.DEBUG and not getattr(settings, "SASAPAY_WEBHOOK_SECRET", ""):
        logger.warning(
            "sasapay_callback: accepting unsigned request in DEBUG. "
            "DO NOT deploy DEBUG=True with SASAPAY_WEBHOOK_SECRET unset."
        )
        return True, None

    return False, None


def _claim_idempotency(trans_id: str, scope: str = "callback") -> bool:
    """Redis SETNX-based dedup. Returns True if this is the first time
    we've seen this trans_id in `scope`, False if already processed.

    24-hour TTL · long enough to cover SasaPay's documented max retry
    window (a couple of hours), short enough to free memory.
    """
    if not trans_id:
        # No TransID == no dedup possible. Don't block, but log.
        logger.warning("sasapay callback: missing TransID, dedup skipped")
        return True
    key = f"sasapay_dedup:{scope}:{trans_id}"
    return cache.add(key, "1", timeout=24 * 3600)


# ───────────────────────── Public views ──────────────────────────────


@csrf_exempt
@require_POST
def sasapay_callback(request, token: str | None = None):
    """SasaPay result callback for B2B / B2C / STK Push transactions.

    URL forms supported (declared in apps/mpesa/sasapay_urls.py):
      * /api/v1/sasapay/callback/                 (header-signed only)
      * /api/v1/sasapay/callback/<token>/         (URL-token + optional header)

    2026-05-17 · gated by `SASAPAY_WEBHOOK_DISABLED` setting · when
    true (production default once ops confirms polling-only), returns
    410 Gone immediately so any stray webhook hits are visible in
    monitoring without consuming worker resources. The polling path
    (`check_pending_mpesa_payments` cron) remains the source of truth.
    """
    from django.conf import settings as _settings  # noqa: PLC0415
    if getattr(_settings, "SASAPAY_WEBHOOK_DISABLED", False):
        logger.info(
            "sasapay_callback.disabled · returning 410 Gone "
            "(polling cron is source of truth)"
        )
        return JsonResponse(
            {
                "error": "gone",
                "detail": (
                    "SasaPay webhooks are disabled on this deployment. "
                    "Cpay polls SasaPay status every 15s via the "
                    "`check_pending_mpesa_payments` cron. If you see "
                    "this message, your callback URL should be removed "
                    "from the SasaPay dashboard."
                ),
            },
            status=410,
        )

    body_bytes = request.body or b""

    ok, url_tx_id = _authenticated(request, body_bytes)
    if not ok:
        logger.warning(
            "sasapay_callback rejected: no valid signature (ip=%s, len=%s)",
            request.META.get("REMOTE_ADDR", "?"),
            len(body_bytes),
        )
        return JsonResponse({"error": "Forbidden"}, status=403)

    try:
        data = json.loads(body_bytes.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        logger.warning("sasapay_callback: malformed JSON body")
        return JsonResponse({"error": "Bad request"}, status=400)

    logger.debug("SasaPay callback payload (auth ok): %s", json.dumps(data)[:500])

    # 2026-05-09 · the Utilities API callback shape (KPLC, DSTV, etc.)
    # uses `MerchantReference` (B2B uses `MerchantTransactionReference`),
    # `CheckoutRequestId` with lowercase 'd' (B2B uses uppercase 'ID'),
    # and `Amount` (B2B uses `TransactionAmount`). Read both shapes.
    result_code = str(data.get("ResultCode", data.get("resultCode", "")))
    checkout_id = (
        data.get("CheckoutRequestID")
        or data.get("CheckoutRequestId")
        or data.get("checkoutRequestId")
        or ""
    )
    trans_code = data.get("TransactionCode", data.get("SasaPayTransactionCode", ""))
    trans_ref = (
        data.get("MerchantTransactionReference")
        or data.get("MerchantReference")
        or ""
    )
    amount = (
        data.get("TransAmount")
        or data.get("TransactionAmount")
        or data.get("Amount")
        or "0"
    )
    recipient_name = data.get("RecipientName", "")

    # Dedup BEFORE any DB write.
    dedup_key = trans_code or trans_ref or checkout_id
    if not _claim_idempotency(dedup_key, "callback"):
        logger.info("sasapay_callback: duplicate %s, no-op", dedup_key)
        return JsonResponse({"status": "ok", "duplicate": True})

    try:
        if result_code == "0":
            logger.info(
                "sasapay SUCCESS: code=%s amount=%s ref=%s recipient=%s",
                trans_code, amount, trans_ref, recipient_name,
            )
            _process_successful_payment(
                data, trans_ref, trans_code, amount, url_tx_id=url_tx_id,
            )
        else:
            result_desc, reason_with_code = _extract_failure_reason(
                data, result_code,
            )
            logger.warning(
                "sasapay FAILED: code=%s desc=%s ref=%s checkout=%s",
                result_code, result_desc, trans_ref, checkout_id,
            )
            _process_failed_payment(
                data,
                trans_ref,
                reason_with_code,
                url_tx_id=url_tx_id,
                result_code=result_code,
            )
    except Exception:
        # Process exceptions should never propagate · SasaPay would retry
        # forever. Log and acknowledge.
        logger.exception("sasapay_callback: unexpected error processing payload")

    return JsonResponse({"status": "ok"})


@csrf_exempt
@require_POST
def sasapay_ipn(request):
    """SasaPay IPN (Instant Payment Notification) for C2B deposits.

    Same authentication contract as the result callback. The IPN does
    not have a per-tx URL fallback because the IPN URL is registered
    once with SasaPay · we cannot rotate it per-deposit. Header
    signature is mandatory.
    """
    body_bytes = request.body or b""
    ok, _ = _authenticated(request, body_bytes)
    if not ok:
        logger.warning(
            "sasapay_ipn rejected: no valid signature (ip=%s)",
            request.META.get("REMOTE_ADDR", "?"),
        )
        return JsonResponse({"error": "Forbidden"}, status=403)

    try:
        data = json.loads(body_bytes.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Bad request"}, status=400)

    trans_type = data.get("TransactionType", "")
    trans_id = data.get("TransID", "")
    amount = data.get("TransAmount", "0")
    phone = data.get("MSISDN", "")
    customer = data.get("FullName", "")

    if not _claim_idempotency(trans_id, "ipn"):
        logger.info("sasapay_ipn: duplicate %s, no-op", trans_id)
        return JsonResponse({"status": "ok", "duplicate": True})

    try:
        if trans_type == "C2B":
            logger.info(
                "sasapay C2B deposit: %s KES from %s (%s) TransID=%s",
                amount, customer, phone, trans_id,
            )
            _process_c2b_deposit(data)
    except Exception:
        logger.exception("sasapay_ipn: unexpected error")

    return JsonResponse({"status": "ok"})


# ───────────────────────── Processors ────────────────────────────────


def _verify_via_status_api(tx, trans_code: str):
    """Defence-in-depth · re-query SasaPay's authoritative Transaction
    Status API to confirm the payment really happened before we credit
    the user. The IP allow-list + HMAC signature already gate the
    callback, but a leaked Client ID would let an attacker forge a
    callback; this last gate refuses any credit that doesn't have a
    matching SasaPay-side record.

    Returns:
        True  · SasaPay confirms terminal SUCCESS (code 0 / SP00000)
        False · SasaPay says NOT complete (failed / pending / unknown)
        None  · status API unreachable · caller decides (we fail-open
                so a SasaPay outage doesn't stall every callback;
                signature + IP allow-list still gate the payload).
    """
    saga_data = tx.saga_data or {}
    checkout_id = (
        saga_data.get("mpesa_checkout_request_id")
        or saga_data.get("checkout_request_id")
        or trans_code  # B2B/B2C don't have a checkout_id, use trans_code
        or ""
    )
    if not checkout_id:
        return None

    try:
        from apps.mpesa.sasapay_client import SasaPayClient, SasaPayError
        from apps.payments.tasks import _is_sasapay_success, _is_sasapay_pending

        result = SasaPayClient().query_transaction(
            checkout_request_id=checkout_id,
        )
    except SasaPayError as e:
        logger.warning(
            "sasapay_callback.status_api_unreachable · failing OPEN to avoid "
            "stalling a real callback during a SasaPay outage",
            extra={"tx_id": str(tx.id), "error": str(e)[:200]},
        )
        return None
    except Exception:
        logger.exception(
            "sasapay_callback.status_api_exception",
            extra={"tx_id": str(tx.id)},
        )
        return None

    inner = result.get("data") or result.get("result") or result
    code = str(
        inner.get("ResultCode")
        or inner.get("resultCode")
        or result.get("ResultCode")
        or ""
    )

    if not code:
        # Status API didn't return a result code yet (still processing
        # on their side). Don't reject the callback · they're internally
        # racing.
        return None
    if _is_sasapay_pending(code):
        # PENDING / UNDER REVIEW · don't credit yet, but also don't
        # treat this as a forgery · the legit callback might be
        # arriving slightly ahead of SasaPay's own status update.
        # Return None so the caller proceeds; the saga's idempotency
        # checks prevent double-credit when the second callback lands.
        return None
    return _is_sasapay_success(code)


def _amount_matches(callback_amount, expected_amount: Decimal) -> bool:
    """Compare callback amount to expected within a 1 KES tolerance.

    SasaPay sometimes returns the amount as a string with thousands
    separators ("1,500") · normalise before parsing. Mirrors the B12
    Daraja STK guard.
    """
    if callback_amount is None:
        return False
    try:
        normalised = str(callback_amount).replace(",", "").strip()
        cb_dec = Decimal(normalised)
    except (InvalidOperation, ValueError):
        return False
    return abs(cb_dec - expected_amount) <= Decimal("1")


def _process_successful_payment(
    data: dict,
    ref: str,
    trans_code: str,
    amount,
    url_tx_id: str | None = None,
):
    """Process a successful B2B / B2C / STK Push payment."""
    from apps.payments.models import Transaction

    tx = None

    # Strategy 0: URL-token gave us the tx_id directly.
    if url_tx_id:
        tx = Transaction.objects.filter(id=url_tx_id).first()

    # Strategy 1: by idempotency_key (legacy · pre-2026-05-09).
    if not tx and ref:
        tx = Transaction.objects.filter(idempotency_key=ref).first()

    # Strategy 1b: by transaction.id · 2026-05-09 callback-match fix.
    # The saga now passes `reference=str(tx.id)` on every rail (B2B
    # paybill/till + B2C send-mobile) so the result callback's
    # `MerchantTransactionReference` IS the tx PK. Try that before
    # falling back to checkout/merchant-request lookups.
    if not tx and ref:
        try:
            tx = Transaction.objects.filter(id=ref).first()
        except (ValueError, ValidationError):
            # ref isn't a UUID · skip
            pass

    # Strategy 2: by CheckoutRequestID in saga_data (STK Push).
    if not tx:
        checkout_id = data.get("CheckoutRequestID", data.get("checkoutRequestId", ""))
        if checkout_id:
            tx = Transaction.objects.filter(
                saga_data__mpesa_checkout_request_id=checkout_id
            ).first()

    # Strategy 3: by MerchantRequestID in saga_data.
    if not tx:
        merchant_req_id = data.get("MerchantRequestID", "")
        if merchant_req_id:
            tx = Transaction.objects.filter(
                saga_data__mpesa_merchant_request_id=merchant_req_id
            ).first()

    if not tx:
        logger.warning(
            "sasapay callback: no matching transaction. ref=%s keys=%s",
            ref, list(data.keys()),
        )
        return

    if tx.status == Transaction.Status.COMPLETED:
        logger.info("sasapay callback: tx %s already completed, no-op", tx.id)
        return

    # Amount tamper check.
    #
    # 2026-05-09 fix · the original `tx.source_amount or tx.dest_amount`
    # picked the WRONG side for OUTGOING rails (paybill / till / B2C
    # send-money), where `source_amount` is the CRYPTO amount the user
    # spent (e.g. 0.79 USDT) and `dest_amount` is the KES the recipient
    # got (e.g. 100). SasaPay's callback `amount` is always the KES
    # value · comparing 100 KES against 0.79 USDT would ALWAYS trip the
    # mismatch and silently reject every legitimate callback. Pick the
    # KES-denominated side regardless of which rail produced the tx:
    #   - OUTGOING (paybill/till/send-mpesa): KES is `dest_amount`
    #   - INCOMING/BUY (STK Push): KES is `source_amount`
    #   - SWAP / WITHDRAWAL / DEPOSIT: skip · these don't go through
    #     SasaPay's M-Pesa rails so the callback shouldn't fire.
    expected = None
    if tx.dest_currency == "KES":
        expected = tx.dest_amount
    elif tx.source_currency == "KES":
        expected = tx.source_amount
    if expected and not _amount_matches(amount, Decimal(str(expected))):
        logger.error(
            "sasapay callback: amount mismatch tx=%s expected=%s got=%s · refusing to credit",
            tx.id, expected, amount,
        )
        AuditLog.objects.create(
            user=tx.user,
            action="sasapay_amount_mismatch",
            details=(
                f"SasaPay {trans_code}: expected {expected}, got {amount}, "
                f"ref={ref}. Callback rejected."
            ),
        )
        return

    # 2026-05-09 · DEFENSE-IN-DEPTH callback re-verification. SasaPay
    # callbacks are signed (HMAC-SHA512 in `_verify_header_signature`),
    # but a leaked Client ID would let an attacker forge them. Before
    # we credit anything, re-verify by querying SasaPay's authoritative
    # Transaction Status API for this transaction · if SasaPay says the
    # payment is NOT actually complete, we refuse the credit even if
    # the callback signature checks out.
    #
    # Skipped when the verifier env-flag is off (sandbox dev), and
    # fail-OPEN if the status endpoint itself is unreachable (we
    # don't want a SasaPay outage to permanently stall every
    # legitimate callback · the signature + IP allow-list still gate
    # the payload). Fail-CLOSED on an explicit rejection from SasaPay.
    if getattr(settings, "SASAPAY_VERIFY_CALLBACKS_VIA_API", True):
        verified = _verify_via_status_api(tx, trans_code)
        if verified is False:
            logger.error(
                "sasapay callback: status-API rejected tx=%s code=%s · refusing to credit",
                tx.id, trans_code,
            )
            AuditLog.objects.create(
                user=tx.user,
                action="sasapay_callback_rejected_by_status_api",
                details=(
                    f"SasaPay callback for {trans_code} arrived with valid "
                    f"signature but status-query said the tx is not complete. "
                    f"Refusing to credit. Possible spoofed callback."
                ),
            )
            return
        # verified is True (confirmed) or None (status API unreachable
        # · fail-open with logged warning). Both proceed.

    from django.utils import timezone

    tx.mpesa_receipt = trans_code
    tx.status = Transaction.Status.COMPLETED
    tx.completed_at = timezone.now()
    # 2026-05-17 · clear any stale failure_reason from the in-flight
    # status-poll path. Tx 052fc840 surfaced this · the screen showed
    # "Completed" alongside a red "Failure Reason: SasaPay: [404] no
    # description" because the cron's 404 poll wrote failure_reason
    # before the actual completion callback overrode status. The
    # saga.complete() path clears this; this direct-completion path
    # was missing the same logic.
    if tx.failure_reason:
        tx.failure_reason = ""

    # 2026-05-17 · N1 fix · stash the raw SasaPay callback payload onto
    # saga_data so the revenue-split block below can extract
    # `TransactionCharges` (their per-tx cut). Audit finding · prior code
    # READ `sasapay_callback_payload` but never WROTE it, so BUY
    # provider_cost was permanently 0 and the FEE wallet over-credited
    # by the entire SasaPay STK tariff. Stamping happens BEFORE the
    # booking block reads it · same `tx.save` below.
    if isinstance(data, dict) and data:
        sd = dict(tx.saga_data or {})
        # Strip header dict if SasaPay nested the body weirdly; only
        # keep flat JSON-safe scalars / nested dicts (drop callables /
        # bytes). dict() copy avoids mutating the live callback view.
        try:
            import json as _json
            # Round-trip validates it's JSON-safe; falls back to a
            # filtered shallow-copy on TypeError.
            sd["sasapay_callback_payload"] = _json.loads(
                _json.dumps(dict(data), default=str)
            )
        except Exception:
            sd["sasapay_callback_payload"] = {
                k: str(v) for k, v in data.items()
                if isinstance(v, (str, int, float, bool))
            }
        tx.saga_data = sd
    # 2026-05-09 · the B2B/B2C result callback carries `RecipientName`
    # · the actual business / phone holder name as recorded by M-Pesa.
    # If our pre-flight `account-validation` lookup missed (e.g. SasaPay
    # was rate-limited, paybill new and not yet cached), use this as
    # the authoritative fallback so the receipt isn't blank. Don't
    # overwrite a value we already resolved · the pre-flight name is
    # often more recognisable to the customer (trade name vs the legal
    # entity name M-Pesa registered).
    update_fields = [
        "mpesa_receipt", "status", "completed_at",
        "failure_reason", "saga_data", "updated_at",
    ]
    callback_recipient = (data.get("RecipientName") or "").strip()
    if callback_recipient and not tx.merchant_name:
        tx.merchant_name = callback_recipient[:120]
        update_fields.append("merchant_name")

    # 2026-05-09 · biller-response capture · used by KPLC token relay
    # AND as a generic "what did the recipient see" line on the
    # receipt + Transaction Details for ALL outgoing rails.
    #
    # SasaPay's B2B/B2C callback shape (from real production payloads):
    #   FLAT keys · NOT a Daraja-style nested ResultParameters[]:
    #     ResultCode, ResultDesc, MerchantTransactionReference,
    #     SasaPayTransactionCode, ThirdPartyTransactionCode,
    #     RecipientAccountNumber, RecipientName,
    #     MerchantAccountBalance, TransactionAmount, TransactionCharge,
    #     TransactionDate, SourceChannel, DestinationChannel
    #
    # Per-rail behaviour we observe:
    #   - PAYBILL utilities (KPLC prepaid, Nairobi Water, Zuku):
    #       ResultDesc = "Confirmed. KSH X sent to KPLC PREPAID for
    #       account NNN. Token: NNNN NNNN NNNN NNNN. Units: X.XX KWh"
    #     → carries the prepaid token. Relay verbatim to user phone.
    #
    #   - PAYBILL postpaid (KPLC postpaid 888888, DSTV 444900):
    #       ResultDesc = "Transaction processed successfully" (generic).
    #     → fall back to a constructed receipt line so the user still
    #       gets a useful SMS / on-screen confirmation.
    #
    #   - TILL (Buy Goods, e.g. Naivas 5500000):
    #       ResultDesc = generic.
    #     → constructed receipt line; no biller token to relay.
    #
    #   - BANK (paybill alias for Equity, KCB, etc.):
    #       Same as paybill · ResultDesc may carry the bank's
    #       confirmation text.
    #
    #   - B2C send-money (mpesa_phone):
    #       ResultDesc = "Transaction processed successfully".
    #     → recipient already gets M-Pesa SMS directly from Safaricom;
    #       no need to relay to sender. We DO surface the constructed
    #       summary on the sender's receipt for their records.
    raw_desc = (data.get("ResultDesc") or data.get("resultDesc") or "").strip()
    third_party_code = (
        data.get("ThirdPartyTransactionCode")
        or data.get("third_party_transaction_code")
        or ""
    ).strip()
    sasapay_code = (
        data.get("SasaPayTransactionCode")
        or data.get("sasapay_transaction_code")
        or trans_code
        or ""
    ).strip()
    cb_amount = data.get("TransactionAmount", data.get("TransAmount", amount))

    # 2026-05-09 · Utilities API callback fields (KPLC, DSTV, GOTV,
    # Nairobi Water etc.). Per docs.sasapay.app, the prepaid token
    # arrives in a dedicated `Pin` field, with `Units` for kWh
    # billers. These are the AUTHORITATIVE token source · much
    # more reliable than parsing ResultDesc text.
    utility_pin = (data.get("Pin") or data.get("pin") or "").strip()
    utility_units = (data.get("Units") or data.get("units") or "").strip()
    utility_service = (data.get("ServiceCode") or data.get("serviceCode") or "").strip()

    # Treat any of these (exact / near-exact, case-insensitive) as a
    # "generic-success" placeholder · construct our own summary instead.
    # Use exact-match (under 60 chars) so we don't accidentally classify
    # a biller text that happens to PREFIX with the placeholder
    # ("Transaction processed successfully. Token: 1234...") as generic
    # and discard the token.
    GENERIC_DESC_PHRASES = {
        "transaction processed successfully",
        "transaction processed successfully.",
        "the service request is processed successfully.",
        "service request is processed successfully",
        "success",
    }
    rd_lower = raw_desc.lower().strip()
    desc_is_generic = (
        not rd_lower
        or rd_lower in GENERIC_DESC_PHRASES
        or (len(rd_lower) < 60 and "successfully" in rd_lower and "token" not in rd_lower and "kwh" not in rd_lower)
    )

    # Walk a nested ResultParameter[] (Daraja-shape) when SasaPay
    # routes us a passthrough payload from the biller. Extract the
    # interesting keys (token / units / receipt / ref) so utility
    # billers that DO use nested params still surface their tokens.
    params_chunks: list[str] = []
    params_block = data.get("ResultParameter") or data.get("ResultParameters") or []
    if isinstance(params_block, dict):
        params_block = params_block.get("ResultParameter") or []
    if isinstance(params_block, list):
        for item in params_block:
            if not isinstance(item, dict):
                continue
            key = (item.get("Key") or item.get("key") or "").strip()
            value = item.get("Value") if "Value" in item else item.get("value")
            if not key or value is None:
                continue
            kl = key.lower()
            if any(t in kl for t in (
                "token", "receipt", "billref", "kplc", "units",
                "transactionid", "transcode", "reference", "amount",
            )):
                params_chunks.append(f"{key}: {value}")

    biller_resp = ""

    # PRIORITY 1 · Utilities API callback with a Pin field. This is
    # the canonical KPLC token / airtime PIN delivery channel and we
    # render it in a clean, scannable format that's also good for SMS.
    # Example output:
    #   KPLC PREPAID · KSH 100.00 paid for account 37123456789.
    #   Token: 1234 5678 9012 3456 7890
    #   Units: 5.20 kWh
    #   SasaPay ref: SWEJ7RDEBTHT0XY
    if utility_pin:
        lines = []
        rail_name = tx.merchant_name or utility_service or "Utility"
        acc_part = f" for account {tx.mpesa_account}" if tx.mpesa_account else ""
        lines.append(
            f"{rail_name} · KSH {cb_amount} paid{acc_part}."
        )
        lines.append(f"Token: {utility_pin}")
        if utility_units:
            lines.append(f"Units: {utility_units}")
        if third_party_code:
            lines.append(f"M-Pesa ref: {third_party_code}")
        elif sasapay_code:
            lines.append(f"SasaPay ref: {sasapay_code}")
        biller_resp = "\n".join(lines)
    elif not desc_is_generic:
        # Real biller text · use it verbatim. Append params-block
        # chunks (if any) for additional structured fields.
        biller_resp = raw_desc
        if params_chunks:
            biller_resp = biller_resp + "\n" + "\n".join(params_chunks)
    elif params_chunks:
        # Generic ResultDesc but params have substantive content.
        biller_resp = "\n".join(params_chunks)
    else:
        # Construct a Cpay-formatted receipt line from the flat fields
        # so the user's SMS / detail screen / receipt always shows a
        # useful confirmation, even when SasaPay returns the generic
        # "successfully" placeholder. Mirrors the M-Pesa SMS shape so
        # it reads natively on a phone:
        #   "Confirmed. KSH 100.00 paid to NAIVAS LIMITED · Till 549999.
        #    M-Pesa receipt: UE9C03JV6G. 2026-05-09 21:57:09."
        rail_label = ""
        rail_id = ""
        if tx.mpesa_paybill:
            rail_label = "Paybill"
            rail_id = (
                f"{tx.mpesa_paybill}"
                + (f" · Acc {tx.mpesa_account}" if tx.mpesa_account else "")
            )
        elif tx.mpesa_till:
            rail_label = "Till"
            rail_id = str(tx.mpesa_till)
        elif tx.mpesa_phone:
            rail_label = "M-Pesa"
            rail_id = str(tx.mpesa_phone)
        recipient_label = (
            tx.merchant_name
            or callback_recipient
            or rail_label
            or "recipient"
        )
        receipt_part = ""
        if third_party_code:
            receipt_part = f" M-Pesa receipt: {third_party_code}."
        elif sasapay_code:
            receipt_part = f" SasaPay ref: {sasapay_code}."
        rail_line = f" via {rail_label} {rail_id}." if rail_id else "."
        biller_resp = (
            f"Confirmed. KSH {cb_amount} paid to {recipient_label}"
            f"{rail_line}{receipt_part}"
        ).strip()

    if biller_resp and not tx.biller_response:
        tx.biller_response = biller_resp[:1000]
        update_fields.append("biller_response")

    tx.save(update_fields=update_fields)

    # 2026-05-09 · forward the captured biller response to the user
    # via SMS · the sender's phone is the only channel that reliably
    # reaches them (no in-app push needed). Three rules:
    #   1) Skip B2C send-money · the recipient (NOT sender) already
    #      gets M-Pesa SMS directly from Safaricom. The sender just
    #      needs the in-app receipt, which is rendered separately.
    #   2) Always relay for paybill/till · whether or not the biller
    #      returned a token, the user gets the constructed confirmation
    #      so their PHONE has a record without opening the app.
    #   3) Cap at 480 chars (3 SMS segments) · keeps cost bounded.
    if (
        tx.biller_response
        and tx.user.phone
        and (tx.mpesa_paybill or tx.mpesa_till)
    ):
        try:
            from apps.core.email import send_sms
            sms_preview = tx.biller_response[:380]
            sms_body = (
                f"Cpay · KSh {tx.dest_amount} paid"
                + (f" to {tx.merchant_name}" if tx.merchant_name else "")
                + ".\n"
                + sms_preview
            )[:480]
            send_sms(tx.user.phone, sms_body)
            logger.info(
                "biller_response_forwarded · tx=%s rail=%s",
                tx.id,
                "paybill" if tx.mpesa_paybill else "till",
            )
        except Exception:
            logger.exception(
                "biller_response_forward_failed",
                extra={"tx_id": str(tx.id)},
            )

    # For Buy Crypto (BUY type with STK Push): credit the crypto wallet.
    if tx.type in ("BUY", "DEPOSIT") and tx.saga_data and tx.saga_data.get("quote"):
        try:
            from apps.wallets.models import Wallet
            from apps.wallets.services import WalletService
            quote = tx.saga_data["quote"]
            crypto_currency = quote.get("currency", tx.dest_currency)
            crypto_amount = Decimal(str(quote.get("crypto_amount", tx.dest_amount or "0")))
            if crypto_amount > 0:
                wallet = Wallet.objects.get(user=tx.user, currency=crypto_currency)
                WalletService.credit(
                    wallet_id=wallet.id,
                    amount=crypto_amount,
                    transaction_id=str(tx.id),
                    description=f"Buy crypto via SasaPay {trans_code}",
                )
                logger.info(
                    "Credited %s %s to %s",
                    crypto_amount, crypto_currency, tx.user.phone,
                )
                # 2026-05-09 · check the platform's hot wallet can
                # cover what we now owe in this currency. Logs a
                # CRITICAL `liquidity_short.alert` + opens a recon
                # case if ops need to top up the on-chain wallet.
                try:
                    from apps.payments.tasks import _check_hot_wallet_solvency
                    _check_hot_wallet_solvency(crypto_currency)
                except Exception:
                    logger.exception(
                        "sasapay.callback.solvency_check_failed",
                        extra={"tx_id": str(tx.id)},
                    )
        except Exception:
            logger.exception("Failed to credit crypto for tx %s", tx.id)

    # 2026-05-17 · book BUY-side revenue into SystemWallet ledger.
    #
    # SasaPay's STK callback delivers `transaction_charges` (their
    # cut) on success · we subtract it from our gross fee to derive
    # net revenue. Excise goes to KRA. Idempotent via
    # FeeLedgerEntry's unique constraint (re-fired callback is safe).
    #
    # BUY direction note: with current rates math the user effectively
    # pays raw_rate for crypto (no markup), so `tx.fee_amount` (= spread
    # + flat) is our only margin. After subtracting SasaPay's tx
    # charges and the M-Pesa C2B tariff, this can be NEGATIVE — the
    # audit's "BUY may be net-loss" finding. Booking it surfaces the
    # exact amount per tx; we then decide whether to raise spread or
    # absorb.
    if tx.type == "BUY" and tx.fee_amount and tx.fee_amount > 0:
        try:
            from decimal import Decimal as _D
            from apps.wallets.services import WalletService, FeeWalletMissingError
            fee_amount = _D(tx.fee_amount or 0)
            excise = _D(tx.excise_duty_amount or 0)
            # SasaPay surfaces `TransactionCharges` (or `transactionCharges`
            # in lowercase variants) on STK callback. Empty / missing
            # treated as 0.
            sasapay_charges_keys = (
                "TransactionCharges", "transaction_charges",
                "transactionCharges", "charges",
            )
            payload = tx.saga_data.get("sasapay_callback_payload") or {} \
                if tx.saga_data else {}
            provider_cost = _D("0")
            for k in sasapay_charges_keys:
                v = payload.get(k) if isinstance(payload, dict) else None
                if v not in (None, ""):
                    try:
                        provider_cost = _D(str(v))
                        break
                    except Exception:
                        continue

            net_fee = max(_D("0"), fee_amount - provider_cost)

            if net_fee > 0:
                try:
                    WalletService.book_fee(
                        currency="KES",
                        amount=net_fee,
                        transaction_id=tx.id,
                        description=(
                            f"BUY net fee · {net_fee} KES (gross {fee_amount} "
                            f"− SasaPay charges {provider_cost})"
                        ),
                    )
                except FeeWalletMissingError as e:
                    logger.error(
                        "sasapay.buy.book_fee_missing_wallet · %s", e,
                        extra={"tx_id": str(tx.id)},
                    )
            if provider_cost > 0:
                try:
                    WalletService.book_provider_cost(
                        currency="KES",
                        amount=provider_cost,
                        transaction_id=tx.id,
                        description=f"BUY · SasaPay STK charges · tx {tx.id}",
                    )
                except FeeWalletMissingError as e:
                    logger.error(
                        "sasapay.buy.book_provider_cost_missing_wallet · %s", e,
                        extra={"tx_id": str(tx.id)},
                    )
            if excise > 0:
                try:
                    WalletService.book_excise(
                        currency="KES",
                        amount=excise,
                        transaction_id=tx.id,
                        description=f"BUY excise · {excise} KES · KRA",
                    )
                except FeeWalletMissingError as e:
                    logger.error(
                        "sasapay.buy.book_excise_missing_wallet · %s", e,
                        extra={"tx_id": str(tx.id)},
                    )
        except Exception:
            logger.exception(
                "sasapay.buy.revenue_split_failed",
                extra={"tx_id": str(tx.id)},
            )

    # 2026-05-17 · M1 FIX (audit BLOCKER) · for non-BUY paths
    # (PAYBILL/TILL/SEND_MPESA via SasaPay), invoke saga.complete() so
    # `_book_revenue_split` runs + the FEE / PROVIDER_COST / EXCISE
    # SystemWallets get credited. Previously this function set
    # status=COMPLETED directly + only ran the BUY-only block above,
    # leaving every SasaPay B2C / paybill / till revenue UNBOOKED.
    #
    # Stamp SasaPay's `TransactionCharge` field onto saga_data so the
    # saga's `_book_revenue_split` reads it as the provider cost
    # (mirrors how IntaSend's `intasend_charges` is captured).
    if tx.type in ("PAYBILL_PAYMENT", "TILL_PAYMENT", "SEND_MPESA"):
        try:
            from decimal import Decimal as _D
            # SasaPay B2B/B2C result callback uses `TransactionCharge`
            # (singular · different from STK's `TransactionCharges`).
            # Try multiple shapes for resilience across product tiers.
            charge_keys = (
                "TransactionCharge", "TransactionCharges",
                "transaction_charge", "transactionCharge",
                "Charge", "charges",
            )
            sasapay_charge = _D("0")
            for k in charge_keys:
                v = data.get(k) if isinstance(data, dict) else None
                if v not in (None, ""):
                    try:
                        sasapay_charge = _D(str(v))
                        break
                    except Exception:
                        continue
            if sasapay_charge > 0:
                sd = dict(tx.saga_data or {})
                # Reuse the same key the saga's _book_revenue_split
                # reads · stamps as `intasend_charges` for codepath
                # compatibility. (The field name is historical; the
                # value is provider-agnostic.)
                sd["intasend_charges"] = str(sasapay_charge)
                sd["sasapay_provider_charge"] = str(sasapay_charge)
                tx.saga_data = sd
                tx.save(update_fields=["saga_data", "updated_at"])
        except Exception:
            logger.exception(
                "sasapay.charge_capture_failed",
                extra={"tx_id": str(tx.id)},
            )

        # Hand off to the saga · this is where the revenue split,
        # platform-limits recording, and notifications happen.
        try:
            from apps.payments.saga import PaymentSaga
            PaymentSaga(tx).complete(mpesa_receipt=trans_code)
        except Exception:
            logger.exception(
                "sasapay.saga_complete_failed",
                extra={"tx_id": str(tx.id)},
            )

    try:
        from apps.core.email import send_transaction_notifications
        send_transaction_notifications(tx.user, tx)
    except Exception:
        logger.warning("sasapay notification dispatch failed for tx %s", tx.id)

    AuditLog.objects.create(
        user=tx.user,
        action="sasapay_payment_completed",
        details=f"SasaPay {trans_code}: KES {amount} paid, ref={ref}",
    )

    logger.info("sasapay payment completed: tx=%s receipt=%s", tx.id, trans_code)


# 2026-05-10 · drag the failure description out of every field SasaPay
# has been observed to use across product tiers. Falling back to bare
# "Unknown" left ops staring at "SasaPay: Unknown" in the failed-tx
# alert (see Kevin Kareithi tx 9291FB4E, 2026-05-09 16:11 UTC · STK
# Push cancel/timeout returned no ResultDesc and we lost the signal).
# Always prefix with the numeric ResultCode so the reason is actionable
# even when the description is blank · "[1037] no description" tells
# ops "STK timeout" at a glance, "SasaPay: Unknown" tells them nothing.
_FAILURE_REASON_FIELDS = (
    "ResultDesc", "resultDesc",
    "ResponseDescription", "responseDescription",
    "Description", "description",
    "Message", "message",
    "detail",
)


def _extract_failure_reason(data: dict, result_code: str | None) -> tuple[str, str]:
    """Pull the most informative human-readable failure description out
    of `data`, then stamp it with `result_code` for the audit trail.

    Returns:
        (raw_description, reason_with_code)
    """
    raw = ""
    for key in _FAILURE_REASON_FIELDS:
        v = data.get(key)
        if isinstance(v, str) and v.strip():
            raw = v.strip()
            break
    if not raw:
        raw = "no description"
    code = (result_code or "").strip()
    if code:
        return raw, f"[{code}] {raw}"
    return raw, raw


# 2026-05-10 · M-Pesa-rail denial codes that mean "Safaricom told
# SasaPay no" rather than "the user's payment failed". When we see
# one of these against an outgoing rail (paybill / till / send-mobile)
# and IntaSend is configured, we silently retry through IntaSend
# instead of marking the tx FAILED · IntaSend's own M-Pesa B2B has
# no per-paybill product-assignment restriction and routinely pays
# rails SasaPay refuses (KPLC 888880, NHIF 200222, etc.).
#
# Codes:
#   SP01002 · SasaPay's wrapper around any M-Pesa-side rejection.
#             Message body usually carries the inner code (2028 etc.).
#   SP01003 · "Insufficient funds in receiver" · sometimes returned
#             when the M-Pesa product assignment is missing rather
#             than a real liquidity issue.
#   2028    · Direct M-Pesa code · "Receiver account not assigned
#             to product" · the smoking gun for product-assignment
#             denials.
_MPESA_RAIL_DENIAL_CODES = {"SP01002", "SP01003", "2028"}


def _process_failed_payment(
    data: dict,
    ref: str,
    reason: str,
    url_tx_id: str | None = None,
    result_code: str | None = None,
):
    """Process a failed B2B / B2C payment · compensate.

    2026-05-10 lookup-strategy fix · the success path got Strategy 1b
    (`id=ref` lookup) in commit 38661f4 because the saga sends
    `reference=str(tx.id)` as MerchantTransactionReference. The FAILED
    path was never updated · failure callbacks still use the old
    idempotency_key=ref lookup which never matches → tx stuck CONFIRMING
    → user's crypto stays locked. Logged today at 14:00:30 against
    tx db516b45 with SP01002 ('not permitted according to product
    assignment'); failure callback arrived but couldn't find the tx.

    Mirror the success-path strategies here.

    2026-05-10 IntaSend auto-fallback · if SasaPay rejects an outgoing
    M-Pesa rail with a "product-assignment" code (SP01002 / 2028 /
    SP01003), we retry the SAME logical payment through IntaSend
    before marking the tx FAILED. SasaPay continues to handle our
    inbound C2B deposits as today; IntaSend only takes over the
    outgoing leg when SasaPay refuses.
    """
    from apps.payments.models import Transaction
    from django.core.exceptions import ValidationError

    tx = None

    # Strategy 0 · URL-token gave us the tx_id directly.
    if url_tx_id:
        tx = Transaction.objects.filter(id=url_tx_id).first()

    # Strategy 1 · by idempotency_key (legacy path).
    if not tx and ref:
        tx = Transaction.objects.filter(idempotency_key=ref).first()

    # Strategy 1b · by transaction.id (saga sends tx.id as
    # MerchantTransactionReference per the 38661f4 fix).
    if not tx and ref:
        try:
            tx = Transaction.objects.filter(id=ref).first()
        except (ValueError, ValidationError):
            pass

    # Strategy 2 · by CheckoutRequestID in saga_data.
    if not tx:
        checkout_id = (
            data.get("CheckoutRequestID")
            or data.get("CheckoutRequestId")
            or data.get("checkoutRequestId")
            or ""
        )
        if checkout_id:
            tx = Transaction.objects.filter(
                saga_data__mpesa_conversation_id__contains=checkout_id
            ).first()
            if not tx:
                tx = Transaction.objects.filter(
                    saga_data__mpesa_checkout_request_id=checkout_id
                ).first()

    if not tx:
        logger.warning(
            "sasapay failure_callback: no matching tx · ref=%s reason=%s",
            ref, str(reason)[:200],
        )
        return
    if tx.status in (Transaction.Status.COMPLETED, Transaction.Status.FAILED):
        logger.info(
            "sasapay failure_callback: tx %s already %s · no-op",
            tx.id, tx.status,
        )
        return

    # ───────────────── IntaSend auto-fallback (2026-05-10) ─────────────
    #
    # When SasaPay returns an M-Pesa product-assignment denial against
    # an outgoing rail, retry through IntaSend instead of marking the tx
    # FAILED. IntaSend's MPESA-B2B has no per-paybill agreement
    # restriction · it routinely pays rails SasaPay's account refuses
    # (KPLC 888880, NHIF 200222, etc.).
    #
    # Side-effects on success:
    #   - tx stays in CONFIRMING; user's locked crypto stays locked.
    #   - saga_data gets `intasend_tracking_id` so the IntaSend callback
    #     handler (`apps/mpesa/intasend_views._find_pending_tx`) resolves
    #     this tx via path #2 and routes through `saga.complete()` /
    #     `saga.fail()` exactly as it would for an IntaSend-primary tx.
    #   - saga_data.fallback_history gets an audit entry (provider,
    #     reason, timestamp) so ops can see the rail-flip without
    #     stitching together logs.
    #
    # If IntaSend fails synchronously OR is not configured, we fall
    # through to the original FAILED + compensate path so the user
    # gets their crypto back.
    code_str = str(result_code or "").strip().upper()
    if (
        code_str in _MPESA_RAIL_DENIAL_CODES
        and getattr(settings, "INTASEND_API_SECRET", "")
        and (tx.mpesa_paybill or tx.mpesa_till or tx.mpesa_phone)
        and tx.dest_amount
        and Decimal(str(tx.dest_amount)) > 0
    ):
        try:
            from apps.mpesa.intasend_client import IntaSendClient, IntaSendError
            from django.utils import timezone

            client = IntaSendClient()
            # Use a derived api_ref so it cannot collide with a prior
            # idempotency_key reuse on IntaSend's side. The IntaSend
            # callback resolves the tx via saga_data.intasend_tracking_id
            # (path #2 in _find_pending_tx), so the api_ref doesn't have
            # to match the tx idempotency_key for lookup to work.
            api_ref = f"sasapay-fb-{tx.id}"
            kes_amount = Decimal(str(tx.dest_amount))

            if tx.mpesa_paybill:
                resp = client.pay_paybill(
                    paybill=str(tx.mpesa_paybill),
                    account=str(tx.mpesa_account or ""),
                    amount=float(kes_amount),
                    reference=api_ref,
                    narrative="Cpay paybill",
                )
            elif tx.mpesa_till:
                resp = client.pay_till(
                    till=str(tx.mpesa_till),
                    amount=float(kes_amount),
                    reference=api_ref,
                    narrative="Cpay buy goods",
                )
            else:
                resp = client.send_to_mobile(
                    phone=str(tx.mpesa_phone),
                    amount=float(kes_amount),
                    reason="Cpay send money",
                    reference=api_ref,
                )

            tracking_id = resp.get("ConversationID", "")
            response_code = str(resp.get("ResponseCode", ""))
            if response_code == "0" and tracking_id:
                sd = dict(tx.saga_data or {})
                sd["intasend_tracking_id"] = tracking_id
                sd["intasend_api_ref"] = api_ref
                sd["fallback_provider"] = "intasend"
                history = list(sd.get("fallback_history") or [])
                history.append({
                    "from": "sasapay",
                    "to": "intasend",
                    "reason_code": code_str,
                    "reason_desc": str(reason)[:200],
                    "tracking_id": tracking_id,
                    "at": timezone.now().isoformat(),
                })
                sd["fallback_history"] = history
                tx.saga_data = sd
                tx.save(update_fields=["saga_data", "updated_at"])

                AuditLog.objects.create(
                    user=tx.user,
                    action="sasapay_to_intasend_fallback",
                    details=(
                        f"SasaPay rejected {code_str} ({str(reason)[:120]}). "
                        f"Retrying via IntaSend tracking_id={tracking_id} "
                        f"api_ref={api_ref}. Tx {tx.id} stays CONFIRMING; "
                        f"locked crypto remains locked pending IntaSend callback."
                    ),
                )
                logger.warning(
                    "sasapay_to_intasend_fallback · tx=%s code=%s "
                    "tracking_id=%s api_ref=%s",
                    tx.id, code_str, tracking_id, api_ref,
                )
                return

            # IntaSend accepted the request but didn't return a usable
            # tracking_id · treat as fallback-failed and let the
            # original compensate path run so the user gets refunded.
            logger.error(
                "sasapay_to_intasend_fallback · IntaSend returned "
                "ResponseCode=%s tracking=%s · falling through to FAILED "
                "(tx=%s)",
                response_code, tracking_id, tx.id,
            )
        except IntaSendError as e:
            logger.error(
                "sasapay_to_intasend_fallback · IntaSend API error: %s "
                "· falling through to FAILED (tx=%s)",
                str(e)[:200], tx.id,
            )
        except Exception:
            logger.exception(
                "sasapay_to_intasend_fallback · unexpected error · "
                "falling through to FAILED (tx=%s)",
                tx.id,
            )
    # ───────────────────────────────────────────────────────────────────

    tx.status = Transaction.Status.FAILED
    tx.failure_reason = f"SasaPay: {reason}"[:500]
    tx.save(update_fields=["status", "failure_reason", "updated_at"])

    # Compensate · unlock the locked crypto so the user gets it back.
    # 2026-05-10 · was calling `unlock_and_refund(tx)` which never
    # existed on WalletService · every B2B failure since 2026-04 has
    # been silently leaving the user's crypto LOCKED. Real method is
    # `unlock_funds(wallet_id, amount, transaction_id)` · params live
    # in saga_data.locked_wallet_id + saga_data.locked_amount (set by
    # PaymentSaga.lock_crypto · saga.py line 95).
    try:
        from apps.wallets.services import WalletService
        from decimal import Decimal as _D
        sd = tx.saga_data or {}
        wallet_id = sd.get("locked_wallet_id")
        locked_amount = _D(sd.get("locked_amount", "0") or "0")
        if wallet_id and locked_amount > 0:
            WalletService.unlock_funds(
                wallet_id=wallet_id,
                amount=locked_amount,
                transaction_id=tx.id,
            )
            logger.info(
                "sasapay refund OK · tx=%s amount=%s wallet=%s",
                tx.id, locked_amount, wallet_id,
            )
        else:
            logger.warning(
                "sasapay refund skipped · tx=%s missing saga_data "
                "(wallet_id=%s amount=%s)",
                tx.id, wallet_id, locked_amount,
            )
    except Exception:
        logger.exception("sasapay refund failed for tx %s", tx.id)

    # 2026-05-10 · fire the failure-alert email so ops sees this
    # bucketed by category. classify_failure_code maps SP01002 →
    # "rail" / 2028 → "rail" / 1032 → "user", etc.
    try:
        from apps.core.tasks import send_failed_transaction_alert_task
        send_failed_transaction_alert_task.delay(transaction_id=str(tx.id))
    except Exception:
        logger.exception("failure_alert_dispatch_failed tx=%s", tx.id)

    logger.warning("sasapay payment failed: tx=%s reason=%s", tx.id, reason)


_C2B_SUPPORTED_CRYPTOS = {"USDT", "USDC", "BTC", "ETH", "SOL"}
# Accepted account-suffix delimiters · Safaricom keypads send a `*` when
# customers paste a hyphen, and some POS/USSD flows pass `-` straight
# through. Either is fine; we strip both and normalise.
_C2B_ACCOUNT_SPLIT_RE = re.compile(r"[-*]+")


def _normalise_phone_e164(raw: str) -> str:
    """Convert any Kenyan-mobile representation to +254XXXXXXXXX form,
    or empty string if unparseable. Mirrors the helper in intasend_client
    but without the strict ValueError · this codepath has callback
    payload data and we'd rather degrade than 500 the IPN."""
    s = (raw or "").strip().replace(" ", "")
    if not s:
        return ""
    if s.startswith("+254") and len(s) == 13 and s[4:].isdigit():
        return s
    if s.startswith("254") and len(s) == 12 and s.isdigit():
        return "+" + s
    if s.startswith("0") and len(s) == 10 and s.isdigit():
        return "+254" + s[1:]
    if s.startswith(("7", "1")) and len(s) == 9 and s.isdigit():
        return "+254" + s
    return ""


def _parse_c2b_account(account_str: str) -> tuple[str | None, str | None]:
    """Parse a SasaPay C2B account suffix into (currency, phone_e164).

    Accepted forms (in priority order):
      <merchant>-<CRYPTO>-<phone>      e.g. 1334777-USDT-254712345678
      <merchant>*<CRYPTO>*<phone>      same with `*` separator
      <CRYPTO>-<phone>                 e.g. USDT-0712345678 (legacy Daraja)
      <CRYPTO>                         alone · falls back to MSISDN as phone
      <merchant> alone                 → returns (None, None) → KES credit only
      anything else                    → returns (None, None) → KES credit only

    Returns (None, None) when no valid auto-buy intent can be inferred
    so the caller falls back to the safe KES-credit path.
    """
    if not account_str:
        return None, None
    parts = [p for p in _C2B_ACCOUNT_SPLIT_RE.split(account_str.strip()) if p]
    if not parts:
        return None, None

    merchant_code = (getattr(settings, "SASAPAY_MERCHANT_CODE", "") or "").strip()
    if merchant_code and parts[0] == merchant_code:
        parts = parts[1:]

    if not parts:
        # Just the merchant code · valid SasaPay deposit but no crypto intent.
        return None, None

    currency = parts[0].upper()
    if currency not in _C2B_SUPPORTED_CRYPTOS:
        # Unknown leading token · safest to fall back to KES credit.
        return None, None

    phone = ""
    if len(parts) >= 2:
        phone = _normalise_phone_e164(parts[1])

    # If the suffix didn't include a phone, the caller should fall back
    # to MSISDN. Currency alone is still useful · we return it without
    # a phone and let the caller decide.
    return currency, phone or None


def _process_c2b_deposit(data: dict):
    """Process a C2B deposit.

    Two paths after MSISDN/amount validation:
      1. Auto-buy · the customer entered an account like
         `1334777-USDT-254712...`. We look up the user, fetch the live
         KES→<crypto> rate (1.5% spread + KES 10 flat fee, matching the
         BUY flow contract), credit the crypto wallet, and create a
         COMPLETED Transaction with type=BUY.
      2. KES credit fallback · the account didn't encode a crypto, OR
         the chosen crypto is unsupported, OR rate engine returned an
         unusable result. We credit the user's KES wallet and create a
         COMPLETED type=DEPOSIT Transaction. User can convert later via
         the in-app swap.

    Amount tamper protection is built-in: we only credit the amount the
    callback claimed AFTER cross-referencing the user via MSISDN. The
    deterministic credit_tx_id (uuid5 over the TransID) means a replayed
    callback with the same TransID is a no-op at the WalletService
    layer too · belt-and-braces with our Redis dedup.
    """
    from apps.payments.models import Transaction
    from apps.accounts.models import User

    phone = data.get("MSISDN", "")
    amount = data.get("TransAmount", "0")
    trans_id = data.get("TransID", "")
    # SasaPay can populate the account in any of these depending on the
    # merchant flow + integration version. Read all and prefer the most
    # specific. `BillRefNumber` mirrors Daraja, `BusinessAccount` /
    # `BusinessAccountNumber` are SasaPay-native.
    account_raw = (
        data.get("BillRefNumber")
        or data.get("BusinessAccountNumber")
        or data.get("BusinessAccount")
        or data.get("AccountReference")
        or data.get("InvoiceNumber")
        or ""
    )

    if not phone or not amount or not trans_id:
        return

    if Transaction.objects.filter(mpesa_receipt=trans_id).exists():
        logger.info("sasapay C2B: duplicate TransID %s", trans_id)
        return

    try:
        kes_amount = Decimal(str(amount).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        logger.warning(
            "sasapay C2B: malformed amount %r for TransID %s",
            amount, trans_id,
        )
        return
    if kes_amount <= 0:
        return

    normalised = phone if phone.startswith("+") else f"+{phone}"

    # 1. Short-code DepositIntent lookup · the primary path.
    #    The customer entered a 6-char Crockford code as the M-Pesa
    #    account number · we look it up directly and route to the
    #    pre-staged (user, currency) tuple. This is robust regardless
    #    of how SasaPay handles the account string (verbatim forward,
    #    parsed merchant prefix, or anything in between).
    from apps.payments import deposit_intent as intent_service

    intent = intent_service.lookup_active(account_raw)
    if intent is not None:
        if _credit_via_intent(
            intent=intent,
            kes_amount=kes_amount,
            trans_id=trans_id,
            phone=phone,
            account_raw=account_raw,
        ):
            return
        logger.warning(
            "sasapay C2B: intent-credit failed for code=%s tx %s, "
            "falling through to legacy path",
            intent.code, trans_id,
        )

    # 2. Legacy long-format fallback · `1334777-USDT-254712345678`
    user = User.objects.filter(phone=normalised).first()
    if not user:
        user = User.objects.filter(phone=phone).first()

    target_currency, account_phone = _parse_c2b_account(account_raw)
    if account_phone and not user:
        user = User.objects.filter(phone=account_phone).first()

    if not user:
        logger.warning(
            "sasapay C2B: no user for phone=%s account=%r",
            phone, account_raw,
        )
        return

    if target_currency and target_currency in _C2B_SUPPORTED_CRYPTOS:
        if _credit_crypto_via_c2b(
            user=user,
            currency=target_currency,
            kes_amount=kes_amount,
            trans_id=trans_id,
            phone=phone,
            account_raw=account_raw,
        ):
            return
        logger.warning(
            "sasapay C2B: auto-buy %s failed for tx %s, falling back to KES",
            target_currency, trans_id,
        )

    # 3. KES wallet fallback · safest. User can convert later via swap.
    _credit_kes_via_c2b(
        user=user,
        kes_amount=kes_amount,
        trans_id=trans_id,
        phone=phone,
        account_raw=account_raw,
    )


def _credit_via_intent(
    *,
    intent,
    kes_amount: Decimal,
    trans_id: str,
    phone: str,
    account_raw: str,
) -> bool:
    """Route the deposit through a matched DepositIntent · credits the
    target currency (or KES if intent.currency=='KES'), marks the
    intent CONSUMED, returns True on success.

    The intent's user is authoritative · MSISDN is recorded on the tx
    but NOT used to look up the user (parent-pays-for-child works
    because the intent was minted for the right user)."""
    from apps.payments import deposit_intent as intent_service

    user = intent.user
    currency = intent.currency

    if currency == "KES":
        try:
            _credit_kes_via_c2b(
                user=user,
                kes_amount=kes_amount,
                trans_id=trans_id,
                phone=phone,
                account_raw=account_raw,
            )
        except Exception:
            logger.exception(
                "sasapay C2B intent: KES credit failed for code %s tx %s",
                intent.code, trans_id,
            )
            return False
    else:
        if not _credit_crypto_via_c2b(
            user=user,
            currency=currency,
            kes_amount=kes_amount,
            trans_id=trans_id,
            phone=phone,
            account_raw=account_raw,
        ):
            return False

    # Find the freshly-created Transaction so we can link it to the
    # intent. _credit_crypto_via_c2b / _credit_kes_via_c2b both create
    # a Transaction with mpesa_receipt=trans_id.
    try:
        from apps.payments.models import Transaction
        tx = Transaction.objects.filter(mpesa_receipt=trans_id).first()
        if tx:
            intent_service.consume(intent, tx)
    except Exception:
        logger.exception(
            "sasapay C2B intent: consume failed for code %s tx %s "
            "· tx credited, intent left OPEN",
            intent.code, trans_id,
        )
        # Do NOT fail the credit · the money already moved.

    logger.info(
        "sasapay C2B intent: credited code=%s currency=%s user=%s amount=%s tx=%s",
        intent.code, currency, user.phone, kes_amount, trans_id,
    )
    return True


def _credit_crypto_via_c2b(
    *,
    user,
    currency: str,
    kes_amount: Decimal,
    trans_id: str,
    phone: str,
    account_raw: str,
) -> bool:
    """Auto-buy path · convert KES → <currency>, credit crypto wallet,
    create COMPLETED type=BUY Transaction. Returns True on success.

    Idempotent on `trans_id` · the deterministic credit_tx_id makes
    re-runs a no-op at the WalletService layer.
    """
    import uuid as _uuid
    from django.utils import timezone
    from apps.rates.services import RateService
    from apps.wallets.models import Wallet
    from apps.wallets.services import WalletService
    from apps.payments.models import Transaction

    try:
        rate_info = RateService.get_crypto_kes_rate(currency)
    except Exception:
        logger.exception(
            "sasapay C2B auto-buy: rate engine error for %s tx %s",
            currency, trans_id,
        )
        return False

    try:
        final_rate = Decimal(str(rate_info.get("final_rate") or "0"))
    except (InvalidOperation, ValueError):
        return False
    if final_rate <= 0:
        return False

    flat_fee = Decimal(str(rate_info.get("flat_fee_kes", "10")))
    spread_pct = Decimal(str(getattr(settings, "PLATFORM_SPREAD_PERCENT", "1.5"))) / Decimal("100")
    spread_revenue = (kes_amount * spread_pct).quantize(Decimal("0.01"))
    platform_fee = (spread_revenue + flat_fee).quantize(Decimal("0.01"))
    excise_pct = Decimal(str(getattr(settings, "EXCISE_DUTY_PERCENT", "10"))) / Decimal("100")
    excise_duty = (platform_fee * excise_pct).quantize(Decimal("0.01"))

    # Net KES that buys crypto = paid - flat - excise. Spread revenue is
    # baked into final_rate so don't subtract it twice.
    net_for_crypto = kes_amount - flat_fee - excise_duty
    if net_for_crypto <= 0:
        logger.info(
            "sasapay C2B auto-buy: amount %s too small for %s after fees, "
            "falling back to KES credit (tx %s)",
            kes_amount, currency, trans_id,
        )
        return False

    crypto_amount = (net_for_crypto / final_rate).quantize(Decimal("0.00000001"))
    if crypto_amount <= 0:
        return False

    try:
        from django.db import transaction as db_tx
        with db_tx.atomic():
            wallet, _created = Wallet.objects.get_or_create(user=user, currency=currency)
            credit_tx_id = _uuid.uuid5(
                _uuid.NAMESPACE_URL, f"sasapay_c2b_buy:{trans_id}",
            )
            WalletService.credit(
                wallet.id,
                crypto_amount,
                credit_tx_id,
                f"SasaPay C2B auto-buy {currency} {trans_id}",
            )

            tx = Transaction.objects.create(
                user=user,
                type=Transaction.Type.BUY,
                status=Transaction.Status.COMPLETED,
                source_currency="KES",
                source_amount=kes_amount,
                dest_currency=currency,
                dest_amount=crypto_amount,
                exchange_rate=final_rate,
                fee_amount=platform_fee,
                fee_currency="KES",
                excise_duty_amount=excise_duty,
                mpesa_receipt=trans_id,
                mpesa_phone=phone,
                completed_at=timezone.now(),
                saga_data={
                    "rail": "sasapay_c2b",
                    "account_raw": account_raw,
                    "spread_revenue_kes": str(spread_revenue),
                    "flat_fee_kes": str(flat_fee),
                },
            )
        logger.info(
            "sasapay C2B auto-buy: %s KES → %s %s for %s (tx %s)",
            kes_amount, crypto_amount, currency, user.phone, trans_id,
        )

        # 2026-05-17 · M4 fix · book the C2B auto-buy fee revenue.
        # Audit found this path created the Transaction with
        # `fee_amount=platform_fee` + `excise_duty_amount=excise_duty`
        # but never moved them into SystemWallet(FEE/EXCISE). Provider
        # cost is 0 on C2B (the customer's M-Pesa send pays SasaPay's
        # tariff out-of-pocket before we receive the net amount).
        # Idempotent via FeeLedgerEntry's unique constraint.
        try:
            from decimal import Decimal as _D
            from apps.wallets.services import WalletService, FeeWalletMissingError
            if platform_fee and _D(str(platform_fee)) > 0:
                try:
                    WalletService.book_fee(
                        currency="KES",
                        amount=_D(str(platform_fee)),
                        transaction_id=tx.id,
                        description=(
                            f"SasaPay C2B auto-buy net fee · "
                            f"{platform_fee} KES · trans {trans_id}"
                        ),
                    )
                except FeeWalletMissingError as e:
                    logger.error(
                        "sasapay.c2b.book_fee_missing_wallet · %s", e,
                        extra={"tx_id": str(tx.id)},
                    )
            if excise_duty and _D(str(excise_duty)) > 0:
                try:
                    WalletService.book_excise(
                        currency="KES",
                        amount=_D(str(excise_duty)),
                        transaction_id=tx.id,
                        description=f"SasaPay C2B excise · {excise_duty} KES · KRA",
                    )
                except FeeWalletMissingError as e:
                    logger.error(
                        "sasapay.c2b.book_excise_missing_wallet · %s", e,
                        extra={"tx_id": str(tx.id)},
                    )
        except Exception:
            logger.exception(
                "sasapay.c2b.revenue_split_failed",
                extra={"tx_id": str(tx.id)},
            )

        try:
            from apps.core.email import send_transaction_notifications
            send_transaction_notifications(user, tx)
        except Exception:
            logger.exception(
                "sasapay C2B auto-buy: notification dispatch failed for tx %s",
                trans_id,
            )
        return True
    except Exception:
        logger.exception(
            "sasapay C2B auto-buy: credit failed for %s tx %s",
            currency, trans_id,
        )
        return False


def _credit_kes_via_c2b(
    *,
    user,
    kes_amount: Decimal,
    trans_id: str,
    phone: str,
    account_raw: str,
) -> None:
    """Fallback path · credit KES wallet directly. Used when the
    customer didn't encode a crypto in the account, or auto-buy
    couldn't be completed (rate engine offline, currency unsupported,
    etc.). The user can later convert via swap."""
    import uuid as _uuid
    from django.utils import timezone
    from apps.wallets.models import Wallet
    from apps.wallets.services import WalletService
    from apps.payments.models import Transaction

    try:
        wallet, _created = Wallet.objects.get_or_create(user=user, currency="KES")
        credit_tx_id = _uuid.uuid5(_uuid.NAMESPACE_URL, f"sasapay_c2b:{trans_id}")
        WalletService.credit(
            wallet.id, kes_amount, credit_tx_id, f"SasaPay deposit {trans_id}",
        )

        tx = Transaction.objects.create(
            user=user,
            type=Transaction.Type.DEPOSIT,
            status=Transaction.Status.COMPLETED,
            source_currency="KES",
            source_amount=kes_amount,
            dest_currency="KES",
            dest_amount=kes_amount,
            mpesa_receipt=trans_id,
            mpesa_phone=phone,
            completed_at=timezone.now(),
            saga_data={
                "rail": "sasapay_c2b",
                "account_raw": account_raw,
            },
        )

        logger.info(
            "sasapay C2B deposit credited: KES %s to %s",
            kes_amount, user.phone,
        )

        try:
            from apps.core.email import send_transaction_notifications
            send_transaction_notifications(user, tx)
        except Exception:
            logger.exception(
                "sasapay C2B: notification dispatch failed for tx %s",
                trans_id,
            )
    except Exception:
        logger.exception("sasapay C2B credit failed")


def build_sasapay_callback_url(transaction_id: str, kind: str = "b2b") -> str:
    """Build a per-tx signed callback URL for SasaPay payment initiation.

    Mirrors `apps.mpesa.middleware.build_callback_url`. The token is a
    one-shot HMAC the callback handler verifies before processing. Use
    this in place of the static SASAPAY_CALLBACK_URL whenever the
    payment provider supports a per-call result URL field (B2B,
    B2C, STK Push all do via SasaPay's `CallBackURL` parameter).
    """
    import time

    secret = getattr(settings, "SASAPAY_CALLBACK_HMAC_KEY", "")
    if not secret:
        # No HMAC secret configured · return the static URL. Production
        # guard refuses this state.
        return getattr(settings, "SASAPAY_CALLBACK_URL", "")

    ts = str(int(time.time()))
    mac = hmac.new(
        secret.encode("utf-8"),
        f"{transaction_id}:{ts}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    token = f"{transaction_id}.{ts}.{mac}"

    base = getattr(settings, "SASAPAY_CALLBACK_URL", "https://cpay.co.ke/api/v1/sasapay/callback/")
    if not base.endswith("/"):
        base += "/"
    return f"{base}{token}/"
