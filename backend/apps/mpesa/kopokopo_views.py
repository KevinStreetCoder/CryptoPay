"""
Kopo Kopo K2-Connect callback handler.

Receives async event notifications for every K2 operation we kicked
off · STK Push results, Pay outcomes, reversal completions. K2 fires
all of them at the single callback URL we register per app, with a
JSON body shaped roughly like:

    {
      "topic": "buygoods_transaction_received",   // or other event
      "id":    "e83b1f3e-8ad6-4cee-b4ec-b6c1a2c0c32b",
      "created_at": "2025-04-30T08:42:00.000Z",
      "event": {
        "type":     "Buygoods Transaction",
        "resource": { ... transaction-specific fields ... },
        "errors":   null
      },
      "_links": {
        "self":          "https://api.kopokopo.com/api/v2/...",
        "resource_url":  "https://api.kopokopo.com/api/v2/..."
      }
    }

Defence layers (mirrors `apps/mpesa/sasapay_views.py:_verify_*`):

  1. IP allow-list at the middleware layer
     · `MpesaIPWhitelistMiddleware` extends to KOPOKOPO_ALLOWED_IPS.
  2. HMAC signature header verification on every callback.
     K2 sends `X-KopoKopo-Signature` containing the hex digest of
     HMAC-SHA256(KOPOKOPO_API_KEY, raw_body). Constant-time compared.
  3. Per-callback Redis SETNX dedup keyed on the K2 event `id`.
     · prevents replay even within the IP allow-list window.
  4. Amount tamper check · for incoming-payment callbacks the
     payload's `amount.value` must match the pending Transaction's
     `source_amount` within 1 KES; mismatch is a hard reject.

Security model is identical to the SasaPay path; the codepath splits
only because the JSON shapes differ.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

logger = logging.getLogger(__name__)


# ───────────────────────── Authentication helpers ────────────────────


def _verify_header_signature(request, body_bytes: bytes) -> bool:
    """Verify the K2-issued `X-KopoKopo-Signature` header.

    K2 signs every callback with HMAC-SHA256 of the raw body, keyed on
    the merchant's API key (the same KOPOKOPO_API_KEY we configure for
    server-to-server auth). The header value is the hex digest;
    constant-time compared so a timing oracle can't leak the secret.
    """
    secret = getattr(settings, "KOPOKOPO_API_KEY", "") or getattr(
        settings, "KOPOKOPO_WEBHOOK_SECRET", "",
    )
    if not secret:
        return False

    received = (
        request.headers.get("X-KopoKopo-Signature")
        or request.META.get("HTTP_X_KOPOKOPO_SIGNATURE", "")
        or ""
    ).strip()
    if not received:
        return False

    expected = hmac.new(
        secret.encode("utf-8"), body_bytes, hashlib.sha256,
    ).hexdigest()

    # Some K2 dashboards prefix the value with `sha256=` · normalise.
    if "=" in received:
        received = received.split("=", 1)[1]

    return hmac.compare_digest(expected, received)


def _dedup_key_from_payload(payload: dict) -> str | None:
    """Return a stable Redis key for replay-protection, or None if we
    can't derive one (treat as missing dedup info · the caller chooses
    how strict to be)."""
    event_id = payload.get("id")
    if event_id and isinstance(event_id, str):
        return f"k2_callback_seen:{event_id}"
    return None


# ───────────────────────── Per-event handlers ────────────────────────


def _handle_buygoods_received(payload: dict) -> dict:
    """User just paid us via STK Push (incoming_payments succeeded).

    Mirrors `apps/mpesa/views.py::STKCallbackView` for Daraja · finds the
    pending Cpay Transaction by the K2 reference we stamped at STK
    initiation, marks it COMPLETED, credits the user's crypto wallet
    (BUY flow), and triggers the success notifications.
    """
    from decimal import Decimal, InvalidOperation
    from django.db import transaction as db_tx
    from django.utils import timezone

    from apps.payments.models import Transaction
    from apps.wallets.models import Wallet
    from apps.wallets.services import WalletService
    from .models import MpesaCallback

    event = payload.get("event") or {}
    resource = event.get("resource") or {}
    links = payload.get("_links") or {}

    k2_resource_url = links.get("self") or links.get("resource_url") or ""
    amount_str = (resource.get("amount") or "0").strip()
    reference = (resource.get("reference") or "").strip()
    sender_phone = (resource.get("sender_phone_number") or "").strip()
    till_number = (resource.get("till_number") or "").strip()
    state = (resource.get("status") or "").lower()

    # Accept K2's varied success terms · "Success", "Received", "Completed".
    success = state in {"success", "received", "completed"}

    # Persist the raw callback for ops audits, regardless of outcome.
    callback_row = MpesaCallback.objects.create(
        merchant_request_id=payload.get("id", ""),
        checkout_request_id=k2_resource_url,
        result_code=0 if success else 1,
        result_desc=resource.get("system") or state or "kopokopo",
        mpesa_receipt=resource.get("reference") or "",
        phone=sender_phone,
        amount=amount_str,
        raw_payload=payload,
    )

    if not success:
        logger.info("kopokopo callback · non-success state %r, no credit", state)
        return {"ok": True, "credited": False, "reason": "state_not_success"}

    # Match the pending tx · we stamped `account_ref` into K2's metadata
    # at STK init, so the saga can find its row.
    with db_tx.atomic():
        tx = Transaction.objects.select_for_update().filter(
            saga_data__kopokopo_resource_url=k2_resource_url,
        ).first()
        if not tx:
            # Fallback · match by reference field (the metadata we sent).
            tx = Transaction.objects.select_for_update().filter(
                saga_data__kopokopo_reference=reference,
            ).first()

        if not tx:
            logger.warning(
                "kopokopo callback · no pending tx for resource %s · reference %r",
                k2_resource_url, reference,
            )
            return {"ok": True, "credited": False, "reason": "no_matching_tx"}

        callback_row.transaction = tx
        callback_row.save(update_fields=["transaction"])

        if tx.status in (
            Transaction.Status.COMPLETED,
            Transaction.Status.FAILED,
            Transaction.Status.REVERSED,
        ):
            logger.info("kopokopo callback · tx %s already terminal, skipping", tx.id)
            return {"ok": True, "credited": False, "reason": "already_terminal"}

        # Amount tamper check · same 1-KES tolerance as the Daraja path.
        try:
            paid = Decimal(amount_str)
            expected = Decimal(str(tx.source_amount or 0))
            if abs(paid - expected) > Decimal("1"):
                logger.critical(
                    "kopokopo amount mismatch · tx %s expected %s got %s · rejecting credit",
                    tx.id, expected, paid,
                )
                tx.status = Transaction.Status.FAILED
                tx.failure_reason = "amount_mismatch"
                tx.save(update_fields=["status", "failure_reason", "updated_at"])
                return {"ok": True, "credited": False, "reason": "amount_mismatch"}
        except (InvalidOperation, TypeError, ValueError):
            logger.exception("kopokopo amount parse failed for tx %s", tx.id)

        # BUY flow · credit crypto + mark COMPLETED atomically. Same
        # deterministic-tx-id pattern as the Daraja path · prevents
        # double-credit on retry.
        if tx.type == Transaction.Type.BUY and tx.dest_currency and tx.dest_amount:
            import uuid as _uuid

            tx.mpesa_receipt = reference
            tx.status = Transaction.Status.COMPLETED
            tx.completed_at = timezone.now()
            tx.save(update_fields=[
                "mpesa_receipt", "status", "completed_at", "updated_at",
            ])

            wallet, _ = Wallet.objects.get_or_create(
                user=tx.user, currency=tx.dest_currency,
            )
            credit_tx_id = _uuid.uuid5(
                _uuid.NAMESPACE_URL, f"buy_credit:{tx.id}",
            )
            try:
                WalletService.credit(
                    wallet.id, tx.dest_amount, credit_tx_id,
                    f"Buy {tx.dest_currency}: K2 reference {reference}",
                )
            except Exception:
                logger.critical(
                    "kopokopo BUY · credit failed for tx %s · MANUAL CREDIT REQUIRED",
                    tx.id, exc_info=True,
                )
                return {"ok": True, "credited": False, "reason": "credit_error"}
        else:
            tx.mpesa_receipt = reference
            tx.status = Transaction.Status.COMPLETED
            tx.completed_at = timezone.now()
            tx.save(update_fields=[
                "mpesa_receipt", "status", "completed_at", "updated_at",
            ])

    # Best-effort post-completion notifications (email / SMS / push).
    try:
        from apps.core.email import send_transaction_notifications
        send_transaction_notifications(tx.user, tx)
    except Exception:
        logger.exception("kopokopo notification dispatch failed for tx %s", tx.id)

    return {"ok": True, "credited": True, "transaction_id": str(tx.id)}


def _handle_pay_result(payload: dict) -> dict:
    """K2 finished a Pay (paybill / till / mobile / bank) we initiated.

    Mirror of the Daraja B2B/B2C result path · saga's `complete()` is
    what closes out a successful payout, `compensate_*` is what runs on
    failure.
    """
    from django.db import transaction as db_tx
    from apps.payments.models import Transaction
    from apps.payments.saga import PaymentSaga

    event = payload.get("event") or {}
    resource = event.get("resource") or {}
    links = payload.get("_links") or {}
    k2_resource_url = links.get("self") or links.get("resource_url") or ""
    state = (resource.get("status") or "").lower()
    success = state in {"success", "completed"}

    with db_tx.atomic():
        tx = Transaction.objects.select_for_update().filter(
            saga_data__kopokopo_pay_resource_url=k2_resource_url,
        ).first()
        if not tx:
            logger.warning("kopokopo pay callback · no pending tx for %s", k2_resource_url)
            return {"ok": True, "matched": False}

        if tx.status in (Transaction.Status.COMPLETED, Transaction.Status.FAILED):
            return {"ok": True, "matched": True, "skipped": "terminal"}

        saga = PaymentSaga(tx)
        if success:
            receipt = (resource.get("transaction_reference") or "").strip()
            saga.complete(mpesa_receipt=receipt or k2_resource_url)
        else:
            failure = resource.get("system_error_message") or state or "kopokopo_failure"
            saga.compensate_mpesa()  # Saga handles ReconciliationCase + alerts.
            tx.status = Transaction.Status.FAILED
            tx.failure_reason = failure
            tx.save(update_fields=["status", "failure_reason", "updated_at"])

    return {"ok": True, "matched": True}


# ───────────────────────── Public callback entry point ───────────────


@csrf_exempt
@require_POST
def kopokopo_callback(request, token: str | None = None):
    """K2 webhook receiver · single endpoint for every event topic.

    URL forms:
      * /api/v1/kopokopo/callback/                 (header-signed only)
      * /api/v1/kopokopo/callback/<token>/         (URL-token + optional header)

    Returns 200 OK with a small JSON body. K2 retries on non-2xx, so we
    swallow internal exceptions after they're logged · DO NOT bubble
    up a 500 unless we genuinely cannot parse the request.
    """
    body_bytes = request.body or b""
    debug = bool(getattr(settings, "DEBUG", False))

    if not _verify_header_signature(request, body_bytes):
        if debug:
            logger.warning(
                "kopokopo_callback: accepting unsigned request in DEBUG. "
                "Set KOPOKOPO_API_KEY in production to enforce HMAC."
            )
        else:
            logger.warning(
                "kopokopo_callback rejected · no valid signature "
                "(ip=%s, content-length=%s)",
                request.META.get("REMOTE_ADDR"), len(body_bytes),
            )
            return JsonResponse({"error": "unauthorized"}, status=403)

    try:
        payload = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.warning("kopokopo_callback: malformed JSON body")
        return JsonResponse({"error": "malformed_json"}, status=400)

    # Replay protection · K2 retries failed callbacks with the same
    # event id; we want a single processing pass even if the IP
    # whitelist lets the dupe through.
    dedup_key = _dedup_key_from_payload(payload)
    if dedup_key:
        if not cache.add(dedup_key, "1", timeout=60 * 60 * 24):
            logger.info("kopokopo_callback: duplicate %s, no-op", dedup_key)
            return JsonResponse({"ok": True, "duplicate": True})

    topic = (payload.get("topic") or "").lower()
    try:
        if topic in {
            "buygoods_transaction_received",
            "buygoods_transaction_reversed",
            "incoming_payment",
            "incoming_payment_received",
        }:
            result = _handle_buygoods_received(payload)
        elif topic in {
            "b2b_transaction_received",
            "settlement_transfer_completed",
            "pay_completed",
            "pay_response",
        }:
            result = _handle_pay_result(payload)
        else:
            logger.info("kopokopo_callback: unhandled topic %r", topic)
            result = {"ok": True, "unhandled_topic": topic}
    except Exception:
        logger.exception("kopokopo_callback: unexpected error processing payload")
        result = {"ok": True, "error": "logged_for_ops_review"}

    return JsonResponse(result, status=200)


@csrf_exempt
@require_POST
def kopokopo_ipn(request):
    """Optional IPN endpoint · K2 sends IPN-style notifications for some
    events on a different schedule than the standard webhook. We accept
    them at /api/v1/kopokopo/ipn/ and route through the same handler so
    the security and dedup paths are identical.
    """
    return kopokopo_callback(request)
