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
    """20/min · 2026-05-16. Was 6/min, which throttled users who
    hit a wrong-PIN or insufficient-funds error mid-flow and retried ·
    every failed-validation POST still counts toward the bucket, so a
    user fixing a typo could hit 6 attempts in <30 s and see "Too Many
    Requests". The PIN-lockout logic (3 wrong PINs → mandatory OTP)
    is the actual abuse defence; the rate limit is just a flood guard,
    so 20/min is a more appropriate ceiling."""
    rate = "20/min"


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
        # 2026-05-16 · User model has NO `username` field (USERNAME_FIELD
        # is `phone`). Match by `full_name` iexact instead · the closest
        # thing to a human-typeable identifier. Pre-fix this branch
        # silently returned None for every lookup.
        u = User.objects.filter(full_name__iexact=username.strip()).first()
        if u:
            return u, "full_name"

    if referral_code:
        rc = referral_code.strip().upper()
        if rc:
            # 2026-05-16 · `User.referral_code` is a reverse OneToOne to
            # `ReferralCode` (related_name="referral_code"), NOT a string
            # field. The previous `filter(referral_code=rc)` was matching
            # against the FK PK (user.id) which is never equal to a
            # 6-8 char referral code string · so referral-code lookup
            # NEVER actually found anybody. Query the related table's
            # `code` field with iexact for the documented case-insensitive
            # match.
            u = User.objects.filter(referral_code__code__iexact=rc).first()
            if u:
                return u, "referral_code"

    return None, None


class CpayLookupThrottle(UserRateThrottle):
    """60/min · pre-send recipient lookup. The mobile UI debounce-
    fires this as the user types a phone / username so we want it
    snappy; 60/min comfortably covers a fast typist (one query per
    char above length 4) without enabling enumeration."""
    rate = "60/min"


class CpayUserLookupView(APIView):
    """GET cpay-user-lookup/?q=<phone|username|referral_code>

    Pre-send recipient lookup used by the Send-to-Cpay mobile screen.
    Returns the resolved user's safe public profile so the sender can
    confirm "you are sending to Jane Doe (07••••6789)" BEFORE entering
    their PIN. Was previously inlined into POST send-to-cpay/ as a
    404-after-PIN-verify response · much worse UX (user types PIN,
    waits for a network round-trip, sees "Recipient not found").

    2026-05-16 · privacy-safe response shape:
      { "found": true, "id": "<short>", "display_name": "Jane D.",
        "phone_masked": "+254712••••89", "username": "janedoe", ... }
    For non-matches we return `{"found": false}` with HTTP 200 instead
    of 404 · 404 leaks "this identifier doesn't exist" to enumeration
    via response-time differences. 200/found:false reads exactly the
    same on the network as a real match from the sender's perspective.

    Throttled at 60/min/user (CpayLookupThrottle) to keep enumeration
    costly without breaking the typed-as-they-go UX.
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [CpayLookupThrottle]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response({"found": False, "error": "q is required"}, status=400)
        # Reuse the same detect-kind logic mobile uses so backend
        # and frontend agree on what "this string" represents.
        kind_kwargs = _detect_kind(q)
        recipient, kind = _resolve_recipient(**kind_kwargs)
        if not recipient or recipient.id == request.user.id:
            # Don't leak whether the identifier exists · same shape
            # for "no match" and "matches yourself". Sender will still
            # be blocked at POST time if they try to self-send.
            return Response({"found": False})
        if not recipient.is_active or getattr(recipient, "is_suspended", False):
            return Response({"found": False})

        display_name = (
            (getattr(recipient, "full_name", "") or "").strip()
            or ""
        )
        # Drop surname to first initial · "Jane D." · so we don't leak
        # the recipient's full identity to a random sender who typed
        # their phone. They still see enough to confirm right person.
        parts = display_name.split()
        if len(parts) >= 2:
            display_name = f"{parts[0]} {parts[-1][0]}."

        phone = getattr(recipient, "phone", "") or ""
        # Mask middle 4 digits · "+254712••••89".
        if len(phone) >= 8:
            phone_masked = phone[:7] + "••••" + phone[-2:]
        else:
            phone_masked = "••••" + phone[-2:] if len(phone) >= 2 else "••••"

        return Response({
            "found": True,
            "id": str(recipient.id)[:8],
            "display_name": display_name,
            "phone_masked": phone_masked,
            "matched_by": kind,  # so the UI can show "Matched by phone"
        })


def _detect_kind(q: str) -> dict:
    """Mirror the mobile-side detect-kind heuristic · phone / username /
    referral_code. Kept here so a malformed/older client never blocks
    backend resolution."""
    v = q.strip()
    if not v:
        return {}
    # Phone · "+2547...", "07...", "254..."
    bare = v.replace(" ", "").replace("-", "")
    import re
    if re.match(r"^(\+?254|0)\d{6,12}$", bare):
        return {"phone": bare}
    # Referral · ALL-CAPS alphanumeric 4-12
    if re.match(r"^[A-Z0-9]{4,12}$", v) and v == v.upper():
        return {"referral_code": v}
    return {"username": v}


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
    """Notify the recipient that they've received money across all four
    channels we support · push, SMS, email, in-app inbox.

    2026-05-16 · added EMAIL (via the new templates/email/money_received
    template) and IN-APP NOTIFICATION (via the notifications.services
    helper, so the user's inbox shows "Money received from Jane D."
    even if push was dismissed). Each channel runs in its own try/except
    so one carrier's hiccup doesn't drop the others.
    """
    from apps.core.tasks import send_push_task
    from apps.wallets.models import Wallet

    sender_full = (sender.full_name or "").strip()
    sender_phone = sender.phone or ""
    sender_label = (
        sender_full
        or (sender_phone[:6] + "•" * max(0, len(sender_phone) - 6))
        or "a Cpay user"
    )
    # "Jane D." style truncation for the email subject + body · keeps
    # the SENDER's full surname out of the recipient's email.
    if " " in sender_label:
        parts = sender_label.split()
        sender_label_display = f"{parts[0]} {parts[-1][0]}."
    else:
        sender_label_display = sender_label

    title = "Money received"
    body = (
        f"{sender_label_display} sent you {amount} {currency}"
        + (f": {memo}" if memo else "")
    )
    short_ref = str(tx.id)[:8].upper()

    # ── push ────────────────────────────────────────────────────────
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

    # ── SMS ─────────────────────────────────────────────────────────
    if recipient.phone and getattr(recipient, "notify_sms_enabled", True):
        try:
            from apps.core.email import send_sms
            send_sms(
                recipient.phone,
                f"Cpay · You received {amount} {currency} from "
                f"{sender_label_display}"
                + (f". Memo: {memo}" if memo else "")
                + ". Tap the app to see details.",
            )
        except Exception:
            logger.exception("notify_recipient.sms_failed")

    # ── email ───────────────────────────────────────────────────────
    if recipient.email:
        try:
            from apps.core.email import send_money_received_email
            from django.utils import timezone as _tz

            # Pull the post-credit balance so the email shows
            # "new balance: 0.0152 USDT" without a second DB hit at
            # template-render time.
            new_balance_str = ""
            try:
                w = Wallet.objects.get(user=recipient, currency=currency)
                new_balance_str = str(w.balance)
            except Wallet.DoesNotExist:
                pass

            # Mask the sender's phone so it can appear on the receipt
            # without leaking the full number.
            sender_sub = ""
            if sender_phone:
                if len(sender_phone) >= 8:
                    sender_sub = (
                        sender_phone[:7] + "••••" + sender_phone[-2:]
                    )
                else:
                    sender_sub = "••••" + sender_phone[-2:]

            send_money_received_email(
                recipient,
                amount=str(amount),
                currency=currency,
                sender_label=sender_label_display,
                sender_sub=sender_sub,
                reference=short_ref,
                memo=memo or "",
                timestamp=_tz.now().isoformat(timespec="seconds"),
                new_balance=new_balance_str,
                kes_equivalent=None,  # crypto-to-crypto · we don't compute the KES eq here
            )
        except Exception:
            logger.exception("notify_recipient.email_failed")

    # ── in-app inbox ────────────────────────────────────────────────
    try:
        from apps.notifications.services import notify_money_received
        notify_money_received(
            recipient,
            sender_label=sender_label_display,
            amount=str(amount),
            currency=currency,
            transaction_id=str(tx.id),
            memo=memo or "",
        )
    except Exception:
        logger.exception("notify_recipient.in_app_failed")
