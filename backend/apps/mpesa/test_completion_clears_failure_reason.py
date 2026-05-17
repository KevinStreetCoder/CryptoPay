"""Tests for the 2026-05-17 fix · completion paths clear stale failure_reason.

Tx 052fc840 surfaced this bug: the Transaction Details screen showed
the green "Completed" badge alongside a red "Failure Reason: SasaPay:
[404] no description" panel · contradictory + alarming for the user.

Root cause · the saga's status-poll path writes `failure_reason` when
it sees a transient 404 / pending status. The actual completion
callback then sets `status = COMPLETED` but the direct-completion
paths in `sasapay_views._process_successful_payment` +
`intasend_views._handle_collection_event` did NOT clear the stale
failure_reason. Only `saga.complete()` had that logic.

Fix · both direct-completion paths now clear `failure_reason` when
setting status to COMPLETED. These tests pin the contract.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.test import TestCase

from apps.accounts.models import User
from apps.payments.models import Transaction


pytestmark = pytest.mark.django_db


def _make_tx(*, status, failure_reason="", tx_type="BUY", amount_kes=111.15):
    user = User.objects.create_user(
        email=f"clear-{uuid.uuid4()}@example.com",
        phone=f"+25470020{uuid.uuid4().int % 10000:04d}",
        password="t",
    )
    return Transaction.objects.create(
        user=user,
        type=tx_type,
        status=status,
        # BUY: source = KES (amount user pays), dest = crypto
        # OUTGOING (paybill/till/B2C): source = crypto, dest = KES
        source_currency="KES" if tx_type == "BUY" else "USDT",
        source_amount=Decimal(str(amount_kes)) if tx_type == "BUY" else Decimal("0.87"),
        dest_currency="USDT" if tx_type == "BUY" else "KES",
        dest_amount=Decimal("0.87") if tx_type == "BUY" else Decimal(str(amount_kes)),
        fee_amount=Decimal("11.50"),
        fee_currency="KES",
        excise_duty_amount=Decimal("1.15"),
        failure_reason=failure_reason,
        mpesa_phone="+254700000001",
        idempotency_key=f"clear-{uuid.uuid4()}",
        chain="USDT",
        saga_data={},
    )


class TestSasapayClearsStaleFailureReason(TestCase):
    """SasaPay's STK / B2B / B2C result callback completion path.

    Calls the real `_process_successful_payment` with the `url_tx_id`
    arg so the function locates our test tx by ID instead of fishing
    through merchant ref lookups."""

    @patch("apps.core.email.send_transaction_notifications")
    @patch("apps.mpesa.sasapay_views._verify_via_status_api", return_value=True)
    def test_completion_clears_existing_failure_reason(self, _verify, _notif):
        from apps.mpesa.sasapay_views import _process_successful_payment

        tx = _make_tx(
            status=Transaction.Status.CONFIRMING,
            failure_reason="SasaPay: [404] no description",
        )

        _process_successful_payment(
            data={
                "MerchantTransactionReference": "ref-123",
                "SasaPayTransactionCode": "SPEJ7RF5XTLOSJ8",
                "RecipientName": "Test User",
                "ResultDesc": "Confirmed.",
                "ResultCode": "0",
                "TransactionAmount": "111.15",
            },
            ref="ref-123",
            trans_code="SPEJ7RF5XTLOSJ8",
            amount=Decimal("111.15"),
            url_tx_id=str(tx.id),
        )

        tx.refresh_from_db()
        assert tx.status == Transaction.Status.COMPLETED
        assert tx.mpesa_receipt == "SPEJ7RF5XTLOSJ8"
        # KEY ASSERTION · the stale "SasaPay: [404]" must be gone.
        assert tx.failure_reason == "", (
            f"stale failure_reason NOT cleared on completion: "
            f"{tx.failure_reason!r}"
        )

    @patch("apps.core.email.send_transaction_notifications")
    @patch("apps.mpesa.sasapay_views._verify_via_status_api", return_value=True)
    def test_completion_with_no_stale_reason_is_a_noop(self, _verify, _notif):
        from apps.mpesa.sasapay_views import _process_successful_payment

        tx = _make_tx(
            status=Transaction.Status.CONFIRMING,
            failure_reason="",
            amount_kes=100,
        )
        _process_successful_payment(
            data={
                "ResultDesc": "Confirmed.",
                "ResultCode": "0",
                "TransactionAmount": "100",
            },
            ref="ref-clean",
            trans_code="SPEJ-CLEAN",
            amount=Decimal("100"),
            url_tx_id=str(tx.id),
        )

        tx.refresh_from_db()
        assert tx.status == Transaction.Status.COMPLETED
        assert tx.failure_reason == ""


class TestIntasendCollectionClearsStaleFailureReason(TestCase):
    """IntaSend STK collection callback completion path.

    Rather than invoke the full handler (lookup logic, locking, saga
    chain), pin the contract at the code level: the source file must
    contain a `failure_reason = ""` clear in the completion block.
    A regression that removes this would re-introduce the 052fc840
    stale-message UX bug.
    """

    def test_failure_reason_clear_logic_present(self):
        # Read the source file and look for the clear statement in
        # the collection completion block. Fragile but it's the
        # cleanest pin for a contract whose full integration test
        # would require ~20 mocks.
        import pathlib
        src = pathlib.Path(
            "/app/apps/mpesa/intasend_views.py"
        ).read_text(encoding="utf-8")

        # Look for the collection-specific completion line. We use
        # the unique assignment `tx_locked.status = Transaction.Status.COMPLETED`
        # which appears only in `_handle_collection_event`.
        assert "tx_locked.status = Transaction.Status.COMPLETED" in src, (
            "expected collection-block completion marker not present"
        )

        block_start = src.find("tx_locked.status = Transaction.Status.COMPLETED")
        block = src[block_start : block_start + 800]
        assert 'tx_locked.failure_reason = ""' in block, (
            "IntaSend collection completion block must clear "
            "failure_reason · current block:\n" + block
        )
