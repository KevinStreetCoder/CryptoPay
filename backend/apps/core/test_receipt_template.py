"""PDF receipt template rendering tests.

2026-05-16 · regression tests for two production bugs in the receipt:

  1. Multi-line `{# ... #}` block leaked template source into the
     rendered HTML (Django comment syntax is single-line only ·
     multi-line needs `{% comment %} ... {% endcomment %}`). A real
     beta user printed a receipt that contained the literal text
     "2026-05-09 fix · Status enum values are lowercase ...".

  2. Status pill collapsed every non-completed / non-failed status
     into PENDING · misleading for CONFIRMING / PROCESSING txs (they
     are NOT pending, they are actively in-flight). Four explicit
     branches now: SETTLED / FAILED / PROCESSING / PENDING.

  3. Failed receipts didn't surface the `failure_reason` field, so
     the user got a generic FAILED badge with no explanation. The
     template now shows a red banner with the reason when present.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from django.template.loader import render_to_string
from django.test import TestCase

from apps.accounts.models import User
from apps.payments.models import Transaction


pytestmark = pytest.mark.django_db


def _ctx_for(tx):
    """Minimum context the template needs · matches what
    apps/core/pdf_receipt.py:generate_receipt_pdf() builds."""
    return {
        "tx": tx,
        "reference": f"CP-{str(tx.id)[:6].upper()}-KE",
        "date": "16 May 2026 · 05:08 EAT",
        "dest_display": "KSh 10.00",
        "recipient": "M-Pesa Paybill",
        "recipient_sub": "Paybill 888880 · Acc 144031...",
        "chain_label": "SOL · SOLANA",
        "type_label": "Paybill Payment",
        "rows": [
            {"k": "Crypto amount", "v": "0.001 SOL"},
            {"k": "Platform fee", "v": "KES 10.15"},
        ],
        "qr_data_uri": "data:image/png;base64,",
        "verify_url": "https://cpay.co.ke/r/abc12345",
        "tagline": "CPAY KENYA LTD · cpay.co.ke",
    }


class TestReceiptTemplateRendering(TestCase):
    """Per-test setUp · the django_prometheus DB wrapper closes the
    connection between tests in some run orders, so `setUpTestData`
    (class-scoped) can hand subsequent tests a stale connection. Each
    test creates its own user · cheaper than class-fixture rescue."""

    def setUp(self):
        self.user = User.objects.create_user(
            email=f"receipt-{uuid4().hex[:8]}@example.com",
            phone=f"+25470{uuid4().int % 10000000:07d}",
            password="testing12345",
        )

    def _make_tx(self, *, status, failure_reason=""):
        tx = Transaction.objects.create(
            user=self.user,
            idempotency_key=str(uuid4()),
            type=Transaction.Type.PAYBILL_PAYMENT,
            status=status,
            source_currency="SOL",
            source_amount=Decimal("0.00186542"),
            dest_currency="KES",
            dest_amount=Decimal("10"),
            fee_amount=Decimal("10.15"),
            fee_currency="KES",
            mpesa_paybill="888880",
            mpesa_account="144031...",
            failure_reason=failure_reason,
            saga_data={},
        )
        return tx

    # ── (1) the leaked-comment regression ────────────────────────────

    def test_template_does_not_leak_jinja_style_comments(self):
        """The previous `{# ... #}` multi-line comment leaked into the
        rendered HTML. Django's `{# #}` is single-line ONLY · the
        multi-line variant got rendered as plain text and appeared in
        the printed PDF. The template now uses single-line `{# ... #}`
        only, or HTML `<!-- ... -->` for in-source notes (WeasyPrint
        strips HTML comments from the actual PDF output)."""
        tx = self._make_tx(status=Transaction.Status.COMPLETED)
        html = render_to_string("pdf/receipt.html", _ctx_for(tx))
        # Hard-coded fragments of the SPECIFIC comment that leaked in
        # production (printed on the user's KSh 10 → 888880 receipt).
        forbidden_substrings = [
            "Status enum values are lowercase",
            "tx.status == 'COMPLETED'",
            "previous comparison",
            "ALWAYS false",
            "single-line ONLY",
            # Django-comment-tag markers shouldn't appear either ·
            # `{#` opens, `#}` closes; if they're in the rendered HTML
            # that means the template rendered comment markup as text.
            "{# ",
            " #}",
        ]
        for s in forbidden_substrings:
            assert s not in html, (
                f"Template leaked comment text: {s!r} appears in "
                f"rendered HTML."
            )

    # ── (2) status pill expansion ────────────────────────────────────

    def test_completed_status_renders_settled_pill(self):
        tx = self._make_tx(status=Transaction.Status.COMPLETED)
        html = render_to_string("pdf/receipt.html", _ctx_for(tx))
        assert "SETTLED" in html
        assert "FAILED" not in html
        assert "PROCESSING" not in html

    def test_failed_status_renders_failed_pill(self):
        tx = self._make_tx(
            status=Transaction.Status.FAILED,
            failure_reason="IntaSend never confirmed payout.",
        )
        html = render_to_string("pdf/receipt.html", _ctx_for(tx))
        assert "FAILED" in html
        assert "pill-failed" in html
        assert "SETTLED" not in html

    def test_confirming_status_renders_processing_not_pending(self):
        # The whole point of this expansion · a tx mid-flight shouldn't
        # claim PENDING (which suggests "not started yet"); it's
        # actively talking to the rail.
        tx = self._make_tx(status=Transaction.Status.CONFIRMING)
        html = render_to_string("pdf/receipt.html", _ctx_for(tx))
        assert "PROCESSING" in html
        assert "SETTLED" not in html
        assert "FAILED" not in html

    def test_processing_status_renders_processing(self):
        tx = self._make_tx(status=Transaction.Status.PROCESSING)
        html = render_to_string("pdf/receipt.html", _ctx_for(tx))
        assert "PROCESSING" in html

    def test_pending_status_renders_pending(self):
        tx = self._make_tx(status=Transaction.Status.PENDING)
        html = render_to_string("pdf/receipt.html", _ctx_for(tx))
        assert "PENDING" in html

    # ── (3) failure-reason banner ────────────────────────────────────

    def test_failed_receipt_shows_failure_reason_banner(self):
        tx = self._make_tx(
            status=Transaction.Status.FAILED,
            failure_reason="IntaSend never confirmed payout. Funds refunded.",
        )
        html = render_to_string("pdf/receipt.html", _ctx_for(tx))
        # The reason itself appears in the body so the receipt-holder
        # knows WHY the payment didn't settle.
        assert "IntaSend never confirmed payout" in html
        # Banner copy that explains the disposition.
        assert "Payment did not settle" in html

    def test_completed_receipt_omits_failure_banner(self):
        tx = self._make_tx(status=Transaction.Status.COMPLETED)
        html = render_to_string("pdf/receipt.html", _ctx_for(tx))
        assert "Payment did not settle" not in html

    def test_failed_with_blank_reason_omits_banner_but_keeps_pill(self):
        # Defensive · a FAILED tx with no reason still gets the FAILED
        # pill, but we don't emit an empty banner.
        tx = self._make_tx(
            status=Transaction.Status.FAILED, failure_reason="",
        )
        html = render_to_string("pdf/receipt.html", _ctx_for(tx))
        assert "FAILED" in html
        assert "Payment did not settle" not in html
