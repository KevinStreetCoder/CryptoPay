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
    """120/min · 2026-05-16 raise. The mobile typeahead fires a query
    on EVERY keystroke past length 3 (debounced 350ms · so a fast
    typist who types "John Njongoro" without long pauses generates
    11 queries in ~2 s). On top of that, the form re-fires queries
    when the user toggles back and forth between picks. The 60/min
    floor was tripping legitimate users mid-form ("Too many requests"
    toast on Send-to-Cpay). 120/min stays cheap (one cached query
    per char) but still rate-limits any actual enumeration script."""
    rate = "120/min"


def _safe_profile(recipient, kind: str) -> dict:
    """Privacy-trimmed profile · surname → first initial, masked phone."""
    display_name = (getattr(recipient, "full_name", "") or "").strip()
    parts = display_name.split()
    if len(parts) >= 2:
        display_name = f"{parts[0]} {parts[-1][0]}."
    phone = getattr(recipient, "phone", "") or ""
    if len(phone) >= 8:
        phone_masked = phone[:7] + "••••" + phone[-2:]
    else:
        phone_masked = "••••" + phone[-2:] if len(phone) >= 2 else "••••"
    return {
        "id": str(recipient.id)[:8],
        "display_name": display_name or "Cpay user",
        "phone_masked": phone_masked,
        "matched_by": kind,
    }


class CpayUserLookupView(APIView):
    """GET cpay-user-lookup/?q=<phone|name|referral_code>[&suggest=1]

    Two modes:

      (default) · single-result match · returns `{"found": true, ...}`
      when ONE unambiguous recipient is identified, or `{"found": false}`
      otherwise (200, never 404 · enumeration-resistant). Used for the
      Continue-button gating on the send form.

      ?suggest=1 · multi-result typeahead · returns up to 5 matches as
      `{"results": [...]}`. Used by the typeahead dropdown on the
      send-to-cpay form so the sender can pick from multiple "John"s
      by phone-suffix or name. Each entry has the same privacy-safe
      profile shape (display_name with surname → initial, masked
      phone, matched_by). Searches across full_name (icontains),
      phone (suffix), and referral code.

    Throttled at 60/min/user (CpayLookupThrottle) to keep enumeration
    costly without breaking the typed-as-they-go UX.
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [CpayLookupThrottle]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response({"found": False, "error": "q is required"}, status=400)
        suggest = (request.query_params.get("suggest") or "").lower() in {"1", "true", "yes"}

        if suggest:
            return self._suggest(request, q)

        # Single-result · canonical match via _resolve_recipient.
        kind_kwargs = _detect_kind(q)
        recipient, kind = _resolve_recipient(**kind_kwargs)
        if not recipient or recipient.id == request.user.id:
            return Response({"found": False})
        if not recipient.is_active or getattr(recipient, "is_suspended", False):
            return Response({"found": False})
        return Response({"found": True, **_safe_profile(recipient, kind)})

    def _suggest(self, request, q: str):
        """Multi-result typeahead. Searches:
          - full_name icontains
          - phone endswith (last-N digits typed)
          - referral code iexact
        Returns up to 5 results (the UI can scroll).
        """
        from django.db.models import Q
        from django.contrib.auth import get_user_model
        User = get_user_model()

        # Lower bound · don't fan out a query for 1-2 char prefixes,
        # which would match nearly every user. 3+ chars is the floor
        # for a meaningful search.
        if len(q) < 3:
            return Response({"results": []})

        qs = User.objects.filter(is_active=True).exclude(id=request.user.id)

        # Build OR filter across the three fields. Phone suffix match
        # is anchored on endswith so "5454" finds anyone whose phone
        # ends with those four digits (matches the masked-phone hint
        # the user sees in the result card).
        filters = (
            Q(full_name__icontains=q)
            | Q(phone__endswith=q.lstrip("+").lstrip("0"))
        )
        # Referral code lookup via the OneToOne (related table).
        # Only fires when the input looks like an alnum code · avoids
        # joining for every typed-as-they-go fragment.
        import re as _re
        if _re.match(r"^[A-Za-z0-9]{4,12}$", q):
            filters |= Q(referral_code__code__iexact=q)

        matches = list(
            qs.filter(filters)
              .order_by("full_name", "phone")[:5]
        )

        # Decide the matched-by hint per result based on which branch
        # actually matched · keeps the UI labels honest.
        def _hint(u):
            if u.full_name and q.lower() in u.full_name.lower():
                return "full_name"
            if u.phone and u.phone.endswith(q.lstrip("+").lstrip("0")):
                return "phone"
            return "referral_code"

        return Response({
            "results": [
                _safe_profile(u, _hint(u)) for u in matches
            ],
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
        # 2026-05-16 · accept BOTH prefixed (`recipient_phone`) and
        # unprefixed (`phone`) keys. The mobile send-to-cpay screen
        # spreads its detectRecipientKind() result directly into the
        # POST body using the unprefixed keys ({phone}/{username}/
        # {referral_code}); the backend was only reading the prefixed
        # variants and `_resolve_recipient` silently returned None for
        # every send. Pre-flight lookup worked because it uses the
        # unprefixed keys too · POST 404'd consistently. Reading both
        # keeps the existing tests + any old clients working without
        # forcing a synchronised release.
        recipient, kind = _resolve_recipient(
            phone=(d.get("recipient_phone") or d.get("phone") or ""),
            username=(d.get("recipient_username") or d.get("username") or ""),
            referral_code=(
                d.get("recipient_referral_code")
                or d.get("referral_code")
                or ""
            ),
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
