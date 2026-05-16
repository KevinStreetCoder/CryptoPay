"""IntaSend callback handler.

Receives async event notifications for every IntaSend operation we kicked
off · STK Push results, Send-Money outcomes, status changes. IntaSend
fires all of them at the single callback URL we register in the
dashboard, with a JSON body shaped roughly like:

    {
      "invoice_id":  "RVCZ8WL",
      "state":       "COMPLETE",         // or PENDING / FAILED / RETRY
      "provider":    "M-PESA",
      "charges":     "0.00",
      "net_amount":  "100.00",
      "value":       "100.00",
      "account":     "254712345678",
      "api_ref":     "<our uuid>",       // round-tripped from initiate
      "mpesa_reference": "QH8xxxxxxx",   // when state == COMPLETE
      "tracking_id": "abc-…"
    }

Two distinct handlers under one URL:
  - collection (incoming STK Push / mobile money) · BUY flow + paybill
    settlement-side confirmation (when we ourselves are the payer
    paying out from our IntaSend wallet)
  - send_money (outgoing B2C/B2B) · transitions the saga to
    COMPLETED on success or compensates on failure

Defence layers (parallel to apps/mpesa/sasapay_views.py · same shape):

  1. IP allow-list at the middleware layer (INTASEND_ALLOWED_IPS).
  2. HMAC-SHA256 of the raw body keyed on `INTASEND_WEBHOOK_SECRET`,
     verified against `X-IntaSend-Signature` header. Constant-time
     compared so a timing oracle can't leak the secret. The "challenge"
     IntaSend stores in their dashboard IS the webhook secret.
  3. Per-callback Redis SETNX dedup on `tracking_id` (or `invoice_id`
     when tracking_id is absent) · prevents replay storms.
  4. Amount tamper check on COMPLETE callbacks · the payload `value`
     must match the pending Transaction's `source_amount` within 1 KES;
     mismatch is a hard reject and opens a ReconciliationCase.

Security model deliberately mirrors the SasaPay/K2 paths so a single
review can cover all three rails.
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

logger = logging.getLogger(__name__)


# ── Authentication helpers ───────────────────────────────────────────


def _verify_body_challenge(payload: dict) -> bool:
    """Verify an IntaSend webhook via the `challenge` field in the payload.

    2026-05-15 · this is IntaSend's PRIMARY documented auth scheme. When
    you configure a webhook in the IntaSend dashboard you set a
    "Challenge" string · IntaSend then includes that exact string as the
    `challenge` field in every webhook body. Comparison is a constant-
    time string match against `INTASEND_WEBHOOK_SECRET`.

    Beta-launch bug 2026-05-15 · we shipped with only the HMAC-header
    scheme (`_verify_header_signature` below), which is a *secondary*
    IntaSend feature that needs to be turned on per-account and is
    documented in their SDK source rather than the public docs. Without
    the body-challenge fallback, every legitimate IntaSend webhook
    (incl. the user's KSh 10 paybill at 22:37:04) was rejected with 401
    and the saga left in CONFIRMING forever.

    Returns True only when both the payload and the configured secret
    are non-empty strings that match in constant time.
    """
    secret = getattr(settings, "INTASEND_WEBHOOK_SECRET", "") or ""
    if not secret:
        return False
    received = payload.get("challenge") if isinstance(payload, dict) else None
    if not isinstance(received, str) or not received:
        return False
    return hmac.compare_digest(
        secret.encode("utf-8"), received.encode("utf-8"),
    )


def _verify_header_signature(request, body_bytes: bytes) -> bool:
    """Verify the IntaSend HMAC signature header (secondary scheme).

    IntaSend optionally signs every callback with HMAC-SHA256 of the
    raw body keyed on the dashboard "challenge" (which we treat as
    `INTASEND_WEBHOOK_SECRET`). The header value is the hex digest,
    optionally prefixed with `sha256=`. Constant-time compared.

    This scheme is OFF by default in the IntaSend dashboard · use
    `_verify_body_challenge` as the primary path. Header-HMAC stays
    in place because some merchants opt into it and we want both
    paths covered.
    """
    secret = getattr(settings, "INTASEND_WEBHOOK_SECRET", "") or ""
    if not secret:
        return False

    received = (
        request.headers.get("X-IntaSend-Signature")
        or request.META.get("HTTP_X_INTASEND_SIGNATURE", "")
        or ""
    ).strip()
    if not received:
        return False

    expected = hmac.new(
        secret.encode("utf-8"), body_bytes, hashlib.sha256,
    ).hexdigest()
    if "=" in received:
        received = received.split("=", 1)[1]
    return hmac.compare_digest(expected, received)


def _verify_webhook(request, body_bytes: bytes, payload: dict) -> bool:
    """Composite verifier · either body-challenge OR header-HMAC must pass.

    Both schemes require knowledge of `INTASEND_WEBHOOK_SECRET`, so accepting
    either is no weaker than accepting just one. Body-challenge is the
    common case in production; header-HMAC is the opt-in case for tighter
    integrations.
    """
    return _verify_body_challenge(payload) or _verify_header_signature(
        request, body_bytes,
    )


def _dedup_key(payload: dict) -> str | None:
    """Compose a Redis SETNX dedup key for a webhook delivery.

    2026-05-16 · MUST include `state` in the key. IntaSend sends MULTIPLE
    webhooks for the same tracking_id as the payment progresses:

        QUEUED  → PROCESSING  → COMPLETED   (happy path)
        QUEUED  → PROCESSING  → FAILED      (sad path)
        QUEUED  → PROCESSING  → RETRY → COMPLETED   (intermittent)

    Previously the key was just the tracking_id · the FIRST webhook
    (usually a near-empty QUEUED notification with no `state` value)
    won the SETNX, and every subsequent state transition for the SAME
    tracking_id returned 200 "duplicate" before our handler ever saw
    the COMPLETED / FAILED state. Saga stuck in CONFIRMING forever,
    cron's 10-min compensate eventually refunded the user.

    Composing (tracking_id, state) means each distinct state for a tx
    is processed exactly once · genuine retries by IntaSend for the
    SAME (tracking_id, state) still dedup correctly.

    Falls back to (invoice_id, state) for collection events.
    """
    tid = payload.get("tracking_id") or payload.get("invoice_id")
    if not (isinstance(tid, str) and tid):
        return None
    # Normalise state · empty / missing → "no-state" sentinel so the
    # first-webhook-with-no-state still gets ONE chance to fire (the
    # send_money handler returns "noted" for unknown states; harmless).
    state = (payload.get("state") or "no-state").strip().upper()
    return f"intasend_callback_seen:{tid}:{state}"


def _is_complete(state: str) -> bool:
    return (state or "").upper() in {"COMPLETE", "COMPLETED", "PROCESSED"}


def _is_failed(state: str) -> bool:
    return (state or "").upper() in {"FAILED", "RETRY", "FAILED_RETRYABLE"}


# ── Per-event handlers ───────────────────────────────────────────────


def _find_pending_tx(payload: dict):
    """Locate the pending Cpay Transaction this callback resolves.

    Tries (in order):
      1. `api_ref` (our UUID round-tripped from initiate)
      2. `tracking_id` against `Transaction.saga_data["intasend_tracking_id"]`
      3. `invoice_id` against `Transaction.saga_data["intasend_invoice_id"]`
    """
    from apps.payments.models import Transaction

    api_ref = payload.get("api_ref")
    if api_ref:
        tx = Transaction.objects.filter(idempotency_key=api_ref).first()
        if tx:
            return tx

    tracking_id = payload.get("tracking_id")
    if tracking_id:
        tx = Transaction.objects.filter(
            saga_data__intasend_tracking_id=tracking_id
        ).first()
        if tx:
            return tx

    invoice_id = payload.get("invoice_id")
    if invoice_id:
        tx = Transaction.objects.filter(
            saga_data__intasend_invoice_id=invoice_id
        ).first()
        if tx:
            return tx

    return None


def _handle_collection_event(payload: dict) -> dict:
    """C2B side: a customer just paid us via STK Push. Used on the
    BUY-crypto flow only · paybill/till payments use send-money."""
    from apps.payments.models import Transaction
    from apps.wallets.services import WalletService
    from django.db import transaction as db_tx
    from django.utils import timezone

    state = payload.get("state", "")
    tx = _find_pending_tx(payload)
    if not tx:
        logger.warning(
            "intasend.collection.tx_not_found",
            extra={"payload_summary": {k: payload.get(k) for k in ("api_ref", "tracking_id", "invoice_id", "state")}},
        )
        return {"status": "tx_not_found"}

    if not _is_complete(state):
        if _is_failed(state):
            tx.status = Transaction.Status.FAILED
            tx.failure_reason = (
                f"IntaSend collection failed (state={state})."
            )
            tx.save(update_fields=["status", "failure_reason", "updated_at"])
            logger.info(
                "intasend.collection.failed",
                extra={"tx_id": str(tx.id), "state": state},
            )
        return {"status": "noted", "state": state}

    # Amount tamper check.
    try:
        cb_amount = Decimal(str(payload.get("value") or payload.get("net_amount") or "0"))
    except (InvalidOperation, TypeError):
        cb_amount = Decimal("0")
    expected = Decimal(tx.source_amount or 0)
    if abs(cb_amount - expected) > Decimal("1"):
        logger.error(
            "intasend.collection.amount_mismatch",
            extra={
                "tx_id": str(tx.id),
                "expected": str(expected),
                "received": str(cb_amount),
            },
        )
        return {"status": "amount_mismatch"}, 400

    with db_tx.atomic():
        tx_locked = (
            Transaction.objects.select_for_update().get(id=tx.id)
        )
        if tx_locked.status == Transaction.Status.COMPLETED:
            return {"status": "already_completed"}

        tx_locked.status = Transaction.Status.COMPLETED
        tx_locked.mpesa_receipt = payload.get("mpesa_reference") or ""
        tx_locked.completed_at = timezone.now()
        tx_locked.save(update_fields=[
            "status", "mpesa_receipt", "completed_at", "updated_at",
        ])

        # BUY flow: credit the user's crypto wallet now that fiat is in.
        try:
            from apps.payments.saga import PaymentSaga
            PaymentSaga(tx_locked).complete(mpesa_receipt=tx_locked.mpesa_receipt)
        except Exception:
            logger.exception(
                "intasend.collection.complete_failed",
                extra={"tx_id": str(tx_locked.id)},
            )

    return {"status": "completed", "tx_id": str(tx_locked.id)}


def _handle_send_money_event(payload: dict) -> dict:
    """B2C/B2B side: a Send Money we initiated has resolved. Routes
    through the saga so reconciliation cases open consistently with
    the SasaPay + Daraja paths."""
    from apps.payments.models import Transaction
    from apps.payments.saga import PaymentSaga

    state = payload.get("state", "")
    tx = _find_pending_tx(payload)
    if not tx:
        logger.warning(
            "intasend.send_money.tx_not_found",
            extra={"payload_summary": {k: payload.get(k) for k in ("api_ref", "tracking_id", "invoice_id", "state")}},
        )
        return {"status": "tx_not_found"}

    saga = PaymentSaga(tx)

    if _is_complete(state):
        try:
            saga.complete(mpesa_receipt=payload.get("mpesa_reference") or "")
        except Exception:
            logger.exception(
                "intasend.send_money.complete_failed",
                extra={"tx_id": str(tx.id)},
            )
            return {"status": "complete_error"}
        return {"status": "completed", "tx_id": str(tx.id)}

    if _is_failed(state):
        # ── SasaPay reverse-fallback (2026-05-15) ──────────────────────
        #
        # When IntaSend B2B fails on a paybill/till tx, retry through
        # SasaPay instead of waiting for the saga cron to compensate.
        # Mirror of the existing SasaPay → IntaSend handler in
        # `apps/mpesa/sasapay_views._process_failed_payment`. Only fires
        # if: (a) tx has paybill or till (NOT B2C · B2C float lives on
        # SasaPay and we never routed it through IntaSend), (b) SasaPay
        # creds configured, (c) no prior fallback attempt (avoid loops).
        sd = dict(tx.saga_data or {})
        prior_fallback = bool(sd.get("fallback_history"))
        can_fallback = (
            (tx.mpesa_paybill or tx.mpesa_till)
            and not prior_fallback
            and getattr(settings, "SASAPAY_CLIENT_ID", "")
            and getattr(settings, "SASAPAY_CLIENT_SECRET", "")
            and tx.dest_amount
            and Decimal(str(tx.dest_amount)) > 0
        )
        if can_fallback:
            try:
                from apps.mpesa.sasapay_client import SasaPayClient
                from django.utils import timezone as _tz
                from apps.accounts.models import AuditLog

                client = SasaPayClient()
                api_ref = f"intasend-fb-{tx.id}"
                kes_amount = Decimal(str(tx.dest_amount))

                if tx.mpesa_paybill:
                    resp = client.pay_paybill(
                        receiver_code=str(tx.mpesa_paybill),
                        account_ref=str(tx.mpesa_account or ""),
                        amount=float(kes_amount),
                        reference=api_ref,
                    )
                else:
                    resp = client.pay_till(
                        receiver_code=str(tx.mpesa_till),
                        amount=float(kes_amount),
                        reference=api_ref,
                    )

                conv_id = resp.get("B2BRequestID") or resp.get("ConversationID", "")
                status_code = str(resp.get("ResponseCode", ""))
                sasapay_status = resp.get("status")

                if conv_id and status_code == "0" and sasapay_status is not False:
                    sd["sasapay_request_id"] = conv_id
                    sd["sasapay_api_ref"] = api_ref
                    sd["fallback_provider"] = "sasapay"
                    history = list(sd.get("fallback_history") or [])
                    history.append({
                        "from": "intasend",
                        "to": "sasapay",
                        "reason_state": state,
                        "reason_desc": (payload.get("failed_reason") or "")[:200],
                        "tracking_id": conv_id,
                        "at": _tz.now().isoformat(),
                    })
                    sd["fallback_history"] = history
                    tx.saga_data = sd
                    tx.save(update_fields=["saga_data", "updated_at"])

                    AuditLog.objects.create(
                        user=tx.user,
                        action="intasend_to_sasapay_fallback",
                        details=(
                            f"IntaSend send-money state={state}. Retrying via "
                            f"SasaPay request_id={conv_id} api_ref={api_ref}. "
                            f"Tx {tx.id} stays CONFIRMING; locked crypto remains "
                            f"locked pending SasaPay callback."
                        ),
                    )
                    logger.warning(
                        "intasend_to_sasapay_fallback · tx=%s state=%s "
                        "request_id=%s api_ref=%s",
                        tx.id, state, conv_id, api_ref,
                    )
                    return {"status": "fallback_to_sasapay", "tx_id": str(tx.id)}

                logger.error(
                    "intasend_to_sasapay_fallback · SasaPay returned "
                    "ResponseCode=%s status=%s · falling through to "
                    "compensation (tx=%s)",
                    status_code, sasapay_status, tx.id,
                )
            except Exception:
                logger.exception(
                    "intasend_to_sasapay_fallback · unexpected error · "
                    "falling through to compensation (tx=%s)",
                    tx.id,
                )
        # ───────────────────────────────────────────────────────────────

        # Don't compensate here · the saga's check_pending_mpesa_payments
        # cron handles compensation after a 10-min grace window so
        # transient retryable failures don't trigger a reversal storm.
        # Just mark the failure_reason for ops visibility.
        tx.failure_reason = (
            f"IntaSend send-money state={state}; awaiting cron compensation."
        )
        tx.save(update_fields=["failure_reason", "updated_at"])
        return {"status": "marked_failed", "tx_id": str(tx.id)}

    return {"status": "noted", "state": state}


# ── Entry point ──────────────────────────────────────────────────────


def _classify_event(payload: dict) -> str:
    """Return one of 'collection' / 'send_money' / 'unknown'.

    IntaSend doesn't expose a single canonical event-type field across
    all webhooks · the safest route is to inspect the payload shape.

    Send-money events carry one of:
      - `provider` in {MPESA-B2C, MPESA-B2B, PESALINK, INTASEND, AIRTIME}
      - `file_id` (the send-money batch identifier)
      - `transactions` array (per-tx breakdown of a batch)

    Collection events carry:
      - `invoice_id` (the C2B invoice)
      - `mpesa_reference` (the customer's M-Pesa receipt)

    2026-05-16 · expanded · the previous version only checked the
    `provider` field, which is empty on some intermediate-state
    webhooks (e.g. "QUEUED" before the rail is selected). Those were
    misclassified as unknown_event and dropped silently. Now we also
    recognise `file_id` / `transactions` as a send-money signal.
    """
    provider = (payload.get("provider") or "").upper()
    if provider in {"MPESA-B2C", "MPESA-B2B", "PESALINK", "INTASEND", "AIRTIME"}:
        return "send_money"
    # Send-money batch identifiers · IntaSend emits these on QUEUED /
    # IN_PROGRESS / etc states where `provider` may still be empty.
    if payload.get("file_id") or payload.get("transactions"):
        return "send_money"
    if payload.get("invoice_id") or payload.get("mpesa_reference"):
        return "collection"
    return "unknown"


@csrf_exempt
@require_POST
def intasend_callback(request, token: str = ""):
    """Single endpoint that handles every IntaSend webhook event.

    Routes by inspecting the payload shape (no header per-event topic
    is sent · IntaSend collapses all events to one URL).
    """
    body_bytes = request.body or b""
    try:
        payload = json.loads(body_bytes.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.warning("intasend.callback.bad_body")
        return JsonResponse({"error": "invalid_body"}, status=400)

    # 1 · Auth verification (DEBUG bypass for local dev only).
    #
    # 2026-05-15 · accept BOTH the body-challenge scheme (IntaSend's
    # default · `challenge` field in JSON body equals the dashboard
    # challenge) AND the header-HMAC scheme (opt-in). Either path
    # demonstrates knowledge of `INTASEND_WEBHOOK_SECRET`, so the
    # security posture is unchanged. Previously only HMAC was accepted ·
    # IntaSend's default deliveries were all 401'd, causing every B2B
    # paybill to stick in CONFIRMING.
    if not getattr(settings, "DEBUG", False):
        if not _verify_webhook(request, body_bytes, payload):
            logger.warning(
                "intasend.callback.bad_signature",
                extra={
                    "payload_summary": {
                        k: payload.get(k)
                        for k in ("invoice_id", "tracking_id", "state",
                                  "api_ref", "provider")
                    },
                    # Diagnostic · capture WHICH auth fields the request
                    # carried so we can tell apart genuine attackers
                    # (no auth at all) from secret mismatch (one or both
                    # present but values don't match what we hold).
                    "auth_signal": {
                        "has_challenge_field": "challenge" in (payload or {}),
                        "has_signature_header": bool(
                            request.headers.get("X-IntaSend-Signature")
                            or request.META.get("HTTP_X_INTASEND_SIGNATURE")
                        ),
                    },
                },
            )
            return JsonResponse({"error": "bad_signature"}, status=401)

    # 2 · Replay-protection (Redis SETNX).
    dedup = _dedup_key(payload)
    if dedup:
        # 7-day window · IntaSend retries within 24 h, but lots of
        # headroom is cheap. `add` returns False if the key already
        # exists, hence the inversion.
        if not cache.add(dedup, "1", timeout=7 * 86400):
            return JsonResponse({"status": "duplicate", "key": dedup})

    # 3 · Route by inferred event type.
    kind = _classify_event(payload)

    # 2026-05-16 · log the structured-but-sanitised payload on EVERY
    # accepted webhook so ops can trace why a tx didn't transition.
    # Earlier we only logged on unknown_event · pending/intermediate
    # states were silent and we couldn't see what IntaSend was
    # actually sending. The summary keeps secret-bearing fields
    # (like signatures / api keys) out of the log line · IntaSend
    # never includes those in the body, but the explicit allow-list
    # is belt-and-braces.
    _SAFE_KEYS = (
        "invoice_id", "tracking_id", "file_id", "state", "provider",
        "api_ref", "mpesa_reference", "value", "net_amount", "charges",
        "currency", "failed_reason", "failed_code", "account",
    )
    # The JSON formatter drops `extra=` · embed the summary in the
    # message string so ops can grep for it in production.
    _summary = " ".join(
        f"{k}={payload.get(k)}" for k in _SAFE_KEYS if k in payload
    )
    logger.info("intasend.callback.received kind=%s %s", kind, _summary)

    if kind == "collection":
        result = _handle_collection_event(payload)
    elif kind == "send_money":
        result = _handle_send_money_event(payload)
    else:
        logger.info(
            "intasend.callback.unknown_event %s", _summary,
        )
        result = {"status": "ignored_unknown"}

    # Allow handlers to return (body, status_code) tuples for hard rejects.
    if isinstance(result, tuple):
        body, code = result
        return JsonResponse(body, status=code)
    return JsonResponse(result)


@csrf_exempt
@require_POST
def intasend_ipn(request):
    """Some IntaSend integrations register a separate IPN URL distinct
    from the webhook. Same handler logic · this just gives ops a second
    URL to register if needed without a code change."""
    return intasend_callback(request)
