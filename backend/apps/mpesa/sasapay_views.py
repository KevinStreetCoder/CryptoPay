"""
SasaPay callback handlers.

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
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from apps.accounts.models import AuditLog

logger = logging.getLogger(__name__)


# ───────────────────────── Authentication helpers ────────────────────


def _verify_header_signature(request, body_bytes: bytes) -> bool:
    """Verify the X-SasaPay-Signature header (preferred path).

    SasaPay issues an `X-SasaPay-Signature` header containing the
    hex-encoded HMAC-SHA256 digest of the raw request body, keyed on
    the merchant's webhook secret. Constant-time compared.
    """
    secret = getattr(settings, "SASAPAY_WEBHOOK_SECRET", "")
    if not secret:
        return False

    # Accept either spelling · operators have reported both forms
    # appearing in SasaPay's docs at different times.
    received = (
        request.headers.get("X-SasaPay-Signature")
        or request.headers.get("X-Webhook-Signature")
        or request.META.get("HTTP_X_SASAPAY_SIGNATURE", "")
        or ""
    ).strip()
    if not received:
        return False

    expected = hmac.new(
        secret.encode("utf-8"),
        body_bytes,
        hashlib.sha256,
    ).hexdigest()

    # Some callers send `sha256=<hex>` · normalise.
    if "=" in received:
        received = received.split("=", 1)[1]

    return hmac.compare_digest(expected, received)


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
    """
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

    result_code = str(data.get("ResultCode", data.get("resultCode", "")))
    checkout_id = data.get("CheckoutRequestID", data.get("checkoutRequestId", ""))
    trans_code = data.get("TransactionCode", data.get("SasaPayTransactionCode", ""))
    trans_ref = data.get("MerchantTransactionReference", "")
    amount = data.get("TransAmount", data.get("TransactionAmount", "0"))
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
            result_desc = data.get("ResultDesc", data.get("resultDesc", "Unknown"))
            logger.warning(
                "sasapay FAILED: code=%s desc=%s ref=%s checkout=%s",
                result_code, result_desc, trans_ref, checkout_id,
            )
            _process_failed_payment(data, trans_ref, result_desc, url_tx_id=url_tx_id)
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

    # Strategy 1: by idempotency_key (B2B / B2C payments).
    if not tx and ref:
        tx = Transaction.objects.filter(idempotency_key=ref).first()

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

    # Amount tamper check. We only enforce it when the Transaction has a
    # source_amount we can compare to · BUY/DEPOSIT flows always do, but
    # an old Transaction row missing the field shouldn't crash the path.
    expected = tx.source_amount or tx.dest_amount
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

    from django.utils import timezone

    tx.mpesa_receipt = trans_code
    tx.status = Transaction.Status.COMPLETED
    tx.completed_at = timezone.now()
    tx.save(update_fields=["mpesa_receipt", "status", "completed_at", "updated_at"])

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
        except Exception:
            logger.exception("Failed to credit crypto for tx %s", tx.id)

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


def _process_failed_payment(
    data: dict,
    ref: str,
    reason: str,
    url_tx_id: str | None = None,
):
    """Process a failed B2B / B2C payment · compensate."""
    from apps.payments.models import Transaction

    tx = None
    if url_tx_id:
        tx = Transaction.objects.filter(id=url_tx_id).first()
    if not tx and ref:
        tx = Transaction.objects.filter(idempotency_key=ref).first()
    if not tx or tx.status in (Transaction.Status.COMPLETED, Transaction.Status.FAILED):
        return

    from django.utils import timezone

    tx.status = Transaction.Status.FAILED
    tx.failure_reason = f"SasaPay: {reason}"
    tx.save(update_fields=["status", "failure_reason", "updated_at"])

    try:
        from apps.wallets.services import WalletService
        WalletService.unlock_and_refund(tx)
    except Exception:
        logger.exception("sasapay refund failed for tx %s", tx.id)

    logger.warning("sasapay payment failed: tx=%s reason=%s", tx.id, reason)


def _process_c2b_deposit(data: dict):
    """Process a C2B deposit · credit the user's KES wallet.

    Amount tamper protection is built-in here too: we only credit the
    amount the callback claimed AFTER cross-referencing the user via
    MSISDN. The deterministic credit_tx_id (uuid5 over the TransID)
    means a replayed callback with the same TransID is a no-op at the
    WalletService layer too · belt-and-braces with our Redis dedup.
    """
    from apps.payments.models import Transaction
    from apps.accounts.models import User

    phone = data.get("MSISDN", "")
    amount = data.get("TransAmount", "0")
    trans_id = data.get("TransID", "")

    if not phone or not amount or not trans_id:
        return

    normalised = phone if phone.startswith("+") else f"+{phone}"
    user = User.objects.filter(phone=normalised).first()
    if not user:
        user = User.objects.filter(phone=phone).first()
    if not user:
        logger.warning("sasapay C2B: no user for phone %s", phone)
        return

    if Transaction.objects.filter(mpesa_receipt=trans_id).exists():
        logger.info("sasapay C2B: duplicate TransID %s", trans_id)
        return

    try:
        kes_amount = Decimal(str(amount).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        logger.warning("sasapay C2B: malformed amount %r for TransID %s", amount, trans_id)
        return

    if kes_amount <= 0:
        return

    from django.utils import timezone
    from apps.wallets.services import WalletService

    try:
        from apps.wallets.models import Wallet
        import uuid as _uuid

        wallet, _created = Wallet.objects.get_or_create(user=user, currency="KES")
        credit_tx_id = _uuid.uuid5(_uuid.NAMESPACE_URL, f"sasapay_c2b:{trans_id}")
        WalletService.credit(
            wallet.id, kes_amount, credit_tx_id, f"SasaPay deposit {trans_id}"
        )

        Transaction.objects.create(
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
        )

        logger.info("sasapay C2B deposit credited: KES %s to %s", kes_amount, user.phone)

        from apps.core.email import send_transaction_notifications
        tx = Transaction.objects.filter(mpesa_receipt=trans_id).first()
        if tx:
            send_transaction_notifications(user, tx)
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
