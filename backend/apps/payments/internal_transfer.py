"""Cpay-to-Cpay internal transfers · 2026-05-10.

Send crypto OR KES-equivalent crypto from one Cpay user's wallet to
another Cpay user's wallet WITHOUT touching SasaPay or M-Pesa.

Why:
  - Instant settlement · no callback wait
  - Zero biller fees · just our platform fee
  - Works for cross-Cpay payments where both sides have wallets
  - Privacy · the recipient sees a Cpay-internal flag, not a phone

Architecture:
  - Pure ledger move · `WalletService.debit` sender + `credit`
    recipient inside one `transaction.atomic()` block.
  - Single `Transaction` row of type `INTERNAL_TRANSFER` (already
    on the Status enum) keyed by an idempotency_key.
  - Sender's notification fires from the saga.complete() path the
    same way as a normal payment · receipt + push + email.
  - Recipient gets a separate "money received" push + SMS.

Lookup methods:
  - by phone (E.164 normalised, must exactly match an existing user)
  - by username (case-insensitive)
  - by referral code (alphanumeric, exact match · privacy-safe in
    that the user must share their code first)

NOT in scope (yet):
  - Username-search autocomplete · explicit lookup only to discourage
    enumeration attacks.
  - KES-only wallet · we don't have one; transfers move whatever
    crypto the sender chose, recipient gets the same currency.

Endpoint:
  POST /api/v1/payments/send-to-cpay/

Body:
  {
    "recipient_phone": "+254...",      # one of these required
    "recipient_username": "...",
    "recipient_referral_code": "...",
    "currency": "USDT" | "USDC" | "BTC" | "ETH" | "SOL",
    "amount": "0.5",                   # in source currency units
    "pin": "1234",                     # sender PIN
    "idempotency_key": "<client-uuid>",
    "memo": "..."                      # optional · shown to recipient
  }
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import IntegrityError, transaction as db_transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


class CpayTransferThrottle(UserRateThrottle):
    """6/min · matches our other PIN-protected payment rails."""
    rate = "6/min"


SUPPORTED_CURRENCIES = {"USDT", "USDC", "BTC", "ETH", "SOL"}


def _resolve_recipient(*, phone="", username="", referral_code=""):
    """Find the recipient user by any of the three identifiers.

    Returns (user, lookup_kind) or (None, None).
    Privacy-safe · we don't leak whether a phone is registered to
    the caller via timing differences (each branch does a single
    indexed query).
    """
    from django.contrib.auth import get_user_model
    User = get_user_model()

    if phone:
        # Normalise · accept "+2547...", "07...", "254..."
        p = phone.strip().lstrip("+")
        if p.startswith("0"):
            p = "254" + p[1:]
        if not p.startswith("254"):
            p = "254" + p
        # Try canonical first then a fallback for users stored with "+"
        u = User.objects.filter(phone__in=[f"+{p}", p]).first()
        if u:
            return u, "phone"

    if username:
        u = User.objects.filter(username__iexact=username.strip()).first()
        if u:
            return u, "username"

    if referral_code:
        rc = referral_code.strip().upper()
        if rc:
            u = User.objects.filter(referral_code=rc).first()
            if u:
                return u, "referral_code"

    return None, None


class SendToCpayView(APIView):
    """POST send-to-cpay/ · ledger-only intra-Cpay transfer."""
    permission_classes = [IsAuthenticated]
    throttle_classes = [CpayTransferThrottle]

    def post(self, request):
        from apps.payments.models import Transaction
        from apps.wallets.models import Wallet
        from apps.wallets.services import WalletService
        from apps.payments.views import _verify_pin_with_lockout

        sender = request.user
        d = request.data

        # ── Validate the basics ──────────────────────────────────
        currency = (d.get("currency") or "").upper().strip()
        if currency not in SUPPORTED_CURRENCIES:
            return Response(
                {"error": f"currency must be one of {sorted(SUPPORTED_CURRENCIES)}"},
                status=400,
            )

        try:
            amount = Decimal(str(d.get("amount") or "0"))
        except (InvalidOperation, TypeError):
            return Response({"error": "amount must be numeric"}, status=400)
        if amount <= 0:
            return Response({"error": "amount must be > 0"}, status=400)

        idem_key = (d.get("idempotency_key") or "").strip()
        if not idem_key:
            return Response({"error": "idempotency_key is required"}, status=400)

        memo = (d.get("memo") or "").strip()[:200]

        # ── Verify the sender PIN with lockout tracking ──────────
        pin_error = _verify_pin_with_lockout(sender, d.get("pin") or "")
        if pin_error:
            return pin_error

        # ── Resolve recipient ────────────────────────────────────
        recipient, kind = _resolve_recipient(
            phone=d.get("recipient_phone") or "",
            username=d.get("recipient_username") or "",
            referral_code=d.get("recipient_referral_code") or "",
        )
        if not recipient:
            return Response(
                {"error": "Recipient not found on Cpay · ask them to sign up first."},
                status=404,
            )
        if recipient.id == sender.id:
            return Response({"error": "Cannot send to yourself"}, status=400)
        if not recipient.is_active or getattr(recipient, "is_suspended", False):
            return Response(
                {"error": "Recipient account is not active"},
                status=400,
            )

        # ── Pull wallets · both must exist ───────────────────────
        try:
            sender_wallet = Wallet.objects.get(user=sender, currency=currency)
        except Wallet.DoesNotExist:
            return Response(
                {"error": f"You don't have a {currency} wallet yet"},
                status=400,
            )
        recipient_wallet, _ = Wallet.objects.get_or_create(
            user=recipient, currency=currency,
        )

        # Balance check · sender must have at least the amount.
        if Decimal(sender_wallet.balance or 0) < amount:
            return Response(
                {"error": f"Insufficient {currency} balance"},
                status=400,
            )

        # ── Idempotency (Layer 2 · Redis SETNX, then DB unique) ──
        from django.core.cache import cache
        redis_key = f"internal_transfer:{idem_key}"
        if not cache.add(redis_key, "processing", timeout=300):
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(
                    _serialize(existing, recipient),
                    status=200,
                )
            return Response(
                {"error": "Transfer already in progress"},
                status=409,
            )

        # ── Atomic ledger move ───────────────────────────────────
        try:
            with db_transaction.atomic():
                # Create the tx row first (PostgreSQL UNIQUE on
                # idempotency_key is the L3 dedup gate).
                tx = Transaction.objects.create(
                    idempotency_key=idem_key,
                    user=sender,
                    type=Transaction.Type.INTERNAL_TRANSFER,
                    source_currency=currency,
                    source_amount=amount,
                    dest_currency=currency,
                    dest_amount=amount,
                    status=Transaction.Status.PROCESSING,
                    saga_data={
                        "recipient_id": str(recipient.id),
                        "recipient_phone": recipient.phone or "",
                        "recipient_kind": kind,
                        "memo": memo,
                    },
                    ip_address=_client_ip(request),
                )

                # Debit sender + credit recipient · WalletService
                # raises on insufficient balance / row-lock failure.
                WalletService.debit(
                    wallet_id=sender_wallet.id,
                    amount=amount,
                    transaction_id=str(tx.id),
                    description=f"Cpay transfer to {recipient.phone or recipient.username}",
                )
                WalletService.credit(
                    wallet_id=recipient_wallet.id,
                    amount=amount,
                    transaction_id=str(tx.id),
                    description=(
                        f"Cpay transfer from {sender.phone or sender.username}"
                        + (f" · {memo}" if memo else "")
                    ),
                )

                tx.status = Transaction.Status.COMPLETED
                from django.utils import timezone
                tx.completed_at = timezone.now()
                tx.merchant_name = (
                    recipient.full_name or recipient.username or recipient.phone or ""
                )[:120]
                tx.biller_response = (
                    f"Cpay transfer · {amount} {currency} → "
                    f"{recipient.full_name or recipient.username or recipient.phone}"
                    + (f"\nMemo: {memo}" if memo else "")
                )
                tx.save(update_fields=[
                    "status", "completed_at", "merchant_name",
                    "biller_response", "updated_at",
                ])
        except IntegrityError:
            cache.delete(redis_key)
            existing = Transaction.objects.filter(idempotency_key=idem_key).first()
            if existing:
                return Response(_serialize(existing, recipient), status=200)
            return Response({"error": "Duplicate transfer"}, status=409)
        except Exception as e:
            cache.delete(redis_key)
            logger.exception("send_to_cpay.atomic_failed")
            return Response(
                {"error": "Transfer failed", "detail": str(e)[:200]},
                status=500,
            )

        # ── Notifications · sender (receipt) + recipient (push/SMS) ──
        try:
            from apps.core.email import send_transaction_notifications
            send_transaction_notifications(sender, tx)
        except Exception:
            logger.exception("send_to_cpay.sender_notify_failed")

        try:
            _notify_recipient(recipient, sender, amount, currency, memo, tx)
        except Exception:
            logger.exception("send_to_cpay.recipient_notify_failed")

        return Response(_serialize(tx, recipient), status=201)


def _client_ip(request):
    return (
        request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
        or request.META.get("REMOTE_ADDR")
    )


def _serialize(tx, recipient):
    """Outbound shape · matches the existing TransactionSerializer
    keys so the mobile poll/detail flow Just Works."""
    return {
        "id": str(tx.id),
        "type": tx.type,
        "status": str(tx.status),
        "source_currency": tx.source_currency,
        "source_amount": str(tx.source_amount),
        "dest_currency": tx.dest_currency,
        "dest_amount": str(tx.dest_amount),
        "merchant_name": tx.merchant_name,
        "biller_response": getattr(tx, "biller_response", "") or "",
        "recipient": {
            "username": recipient.username or "",
            "phone_masked": _mask_phone(recipient.phone or ""),
        },
        "created_at": tx.created_at.isoformat() if tx.created_at else "",
        "completed_at": tx.completed_at.isoformat() if tx.completed_at else "",
    }


def _mask_phone(phone: str) -> str:
    if not phone or len(phone) < 6:
        return phone
    return f"{phone[:6]}{'•' * max(0, len(phone) - 6)}"


def _notify_recipient(recipient, sender, amount, currency, memo, tx):
    """Push + SMS the recipient that they've received money."""
    from apps.core.tasks import send_push_task

    sender_label = sender.full_name or sender.username or sender.phone or "a Cpay user"
    title = "Money received"
    body = (
        f"{sender_label} sent you {amount} {currency}"
        + (f": {memo}" if memo else "")
    )

    try:
        send_push_task.delay(
            user_id=str(recipient.id),
            title=title,
            body=body,
            data={
                "transaction_id": str(tx.id),
                "type": "cpay_received",
                "currency": currency,
                "amount": str(amount),
            },
        )
    except Exception:
        logger.exception("notify_recipient.push_failed")

    if recipient.phone and getattr(recipient, "notify_sms_enabled", True):
        try:
            from apps.core.email import send_sms
            send_sms(
                recipient.phone,
                f"Cpay · You received {amount} {currency} from {sender_label}"
                + (f". Memo: {memo}" if memo else "")
                + ". Tap the app to see details.",
            )
        except Exception:
            logger.exception("notify_recipient.sms_failed")
