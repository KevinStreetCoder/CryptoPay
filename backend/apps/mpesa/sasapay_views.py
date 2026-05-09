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
import re
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
    # 2026-05-09 · the B2B/B2C result callback carries `RecipientName`
    # · the actual business / phone holder name as recorded by M-Pesa.
    # If our pre-flight `account-validation` lookup missed (e.g. SasaPay
    # was rate-limited, paybill new and not yet cached), use this as
    # the authoritative fallback so the receipt isn't blank. Don't
    # overwrite a value we already resolved · the pre-flight name is
    # often more recognisable to the customer (trade name vs the legal
    # entity name M-Pesa registered).
    update_fields = ["mpesa_receipt", "status", "completed_at", "updated_at"]
    callback_recipient = (data.get("RecipientName") or "").strip()
    if callback_recipient and not tx.merchant_name:
        tx.merchant_name = callback_recipient[:120]
        update_fields.append("merchant_name")
    tx.save(update_fields=update_fields)

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
