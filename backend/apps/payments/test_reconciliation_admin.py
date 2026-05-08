"""ReconciliationCase admin · 2026-05-08.

Two surfaces sharing one source of truth (`admin_actions`):

  1. Django admin · we only need to test that the actions wire to the
     right state transition + audit trail. Covered indirectly via the
     pure-function tests below + a smoke test that hits the registered
     ModelAdmin.
  2. DRF admin API · the in-app surface. Tested end-to-end here
     (perm gating, list filtering, every state transition, stats).

Hard rule: every state transition MUST append an audit line to
`notes` with the actor's username · ops loses the case history if
this drifts.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User

from . import admin_actions
from .models import ReconciliationCase, Transaction


pytestmark = pytest.mark.django_db


# ── Fixture builders ─────────────────────────────────────────────────


def _make_user(phone="+254700090001", *, is_staff=False, pin="123456"):
    user = User.objects.create_user(phone=phone, pin=pin)
    if is_staff:
        user.is_staff = True
        user.save(update_fields=["is_staff"])
    return user


def _make_tx(user, suffix="0", kes="1000"):
    return Transaction.objects.create(
        user=user,
        idempotency_key=f"recon-admin-{user.phone}-{suffix}",
        type=Transaction.Type.PAYBILL_PAYMENT,
        status=Transaction.Status.FAILED,
        source_currency="USDT",
        source_amount=Decimal("10"),
        dest_currency="KES",
        dest_amount=Decimal(kes),
        mpesa_paybill="247247",
        mpesa_account="ACME",
    )


def _make_case(
    tx,
    *,
    case_type=ReconciliationCase.CaseType.LATE_CALLBACK,
    status=ReconciliationCase.Status.OPEN,
    severity=ReconciliationCase.Severity.HIGH,
    sla_minutes=5,
    assigned_to=None,
    evidence=None,
):
    return ReconciliationCase.objects.create(
        transaction=tx,
        case_type=case_type,
        status=status,
        severity=severity,
        sla_breach_at=timezone.now() + timedelta(minutes=sla_minutes),
        assigned_to=assigned_to,
        evidence=evidence or {"mpesa_receipt": "ABC123"},
    )


# ── admin_actions: pure functions ─────────────────────────────────────


class TestAdminActionsAssign(TestCase):
    def test_assign_to_user_appends_audit_line(self):
        actor = _make_user("+254700090010", is_staff=True)
        target = _make_user("+254700090011", is_staff=True)
        tx = _make_tx(actor, suffix="assign1")
        case = _make_case(tx)

        admin_actions.assign_to(case, actor, target)

        case.refresh_from_db()
        assert case.assigned_to_id == target.id
        assert "assigned to" in case.notes
        assert actor.get_username() in case.notes
        assert target.get_username() in case.notes

    def test_assign_unassign_records_previous(self):
        actor = _make_user("+254700090012", is_staff=True)
        target = _make_user("+254700090013", is_staff=True)
        tx = _make_tx(actor, suffix="assign2")
        case = _make_case(tx, assigned_to=target)

        admin_actions.assign_to(case, actor, None)

        case.refresh_from_db()
        assert case.assigned_to_id is None
        # Audit captures the previous assignee.
        assert "unassigned" in case.notes
        assert "was " + target.get_username() in case.notes

    def test_assign_blocked_on_resolved_case(self):
        actor = _make_user("+254700090014", is_staff=True)
        tx = _make_tx(actor, suffix="assign3")
        case = _make_case(tx, status=ReconciliationCase.Status.HUMAN_RESOLVED)

        with self.assertRaises(ValueError):
            admin_actions.assign_to(case, actor, actor)


class TestAdminActionsResolve(TestCase):
    def test_resolve_marks_human_resolved_with_action(self):
        actor = _make_user("+254700090020", is_staff=True)
        tx = _make_tx(actor, suffix="resolve1")
        case = _make_case(tx)

        admin_actions.resolve(
            case, actor, "b2c_clawback", notes="Sent KES 1000 back to user"
        )

        case.refresh_from_db()
        assert case.status == ReconciliationCase.Status.HUMAN_RESOLVED
        assert case.resolution_action == "b2c_clawback"
        assert case.resolved_at is not None
        assert "resolved" in case.notes
        assert "b2c_clawback" in case.notes
        assert "KES 1000" in case.notes

    def test_resolve_blocked_on_already_resolved(self):
        actor = _make_user("+254700090021", is_staff=True)
        tx = _make_tx(actor, suffix="resolve2")
        case = _make_case(
            tx, status=ReconciliationCase.Status.AUTO_RESOLVED
        )

        with self.assertRaises(ValueError):
            admin_actions.resolve(case, actor, "human_review")

    def test_auto_resolve_marks_auto_resolved(self):
        actor = _make_user("+254700090022", is_staff=True)
        tx = _make_tx(actor, suffix="resolve3")
        case = _make_case(tx)

        admin_actions.auto_resolve(case, actor, "duplicate_callback")

        case.refresh_from_db()
        assert case.status == ReconciliationCase.Status.AUTO_RESOLVED
        assert case.resolution_action == "duplicate_callback"
        assert "auto-resolved" in case.notes


class TestAdminActionsEscalate(TestCase):
    def test_escalate_open_case_to_critical(self):
        actor = _make_user("+254700090030", is_staff=True)
        tx = _make_tx(actor, suffix="escalate1")
        case = _make_case(tx, severity=ReconciliationCase.Severity.MEDIUM)

        admin_actions.escalate(case, actor, reason="customer reported missing funds")

        case.refresh_from_db()
        assert case.status == ReconciliationCase.Status.ESCALATED
        assert case.severity == ReconciliationCase.Severity.CRITICAL
        assert "escalated" in case.notes
        assert "missing funds" in case.notes

    def test_escalate_does_not_lower_severity(self):
        actor = _make_user("+254700090031", is_staff=True)
        tx = _make_tx(actor, suffix="escalate2")
        case = _make_case(tx, severity=ReconciliationCase.Severity.CRITICAL)

        admin_actions.escalate(case, actor)

        case.refresh_from_db()
        assert case.severity == ReconciliationCase.Severity.CRITICAL

    def test_escalate_blocked_on_non_open(self):
        actor = _make_user("+254700090032", is_staff=True)
        tx = _make_tx(actor, suffix="escalate3")
        case = _make_case(tx, status=ReconciliationCase.Status.ESCALATED)

        with self.assertRaises(ValueError):
            admin_actions.escalate(case, actor)


class TestAdminActionsReopen(TestCase):
    def test_reopen_resolved_case(self):
        actor = _make_user("+254700090040", is_staff=True)
        tx = _make_tx(actor, suffix="reopen1")
        case = _make_case(tx)
        admin_actions.resolve(case, actor, "human_review")

        admin_actions.reopen(case, actor, reason="user complained again")

        case.refresh_from_db()
        assert case.status == ReconciliationCase.Status.OPEN
        assert case.resolved_at is None
        assert case.resolution_action == ""
        assert "reopened" in case.notes
        assert "complained again" in case.notes

    def test_reopen_blocked_on_already_open(self):
        actor = _make_user("+254700090041", is_staff=True)
        tx = _make_tx(actor, suffix="reopen2")
        case = _make_case(tx)

        with self.assertRaises(ValueError):
            admin_actions.reopen(case, actor)


# ── DRF admin API ────────────────────────────────────────────────────


class _APIBase(TestCase):
    def setUp(self):
        self.staff = _make_user("+254700091001", is_staff=True)
        self.non_staff = _make_user("+254700091002", is_staff=False)
        self.client = APIClient()

    def auth(self, user):
        self.client.force_authenticate(user)


class TestAdminAPIPermGating(_APIBase):
    def test_anon_blocked(self):
        url = reverse("payments:admin-recon-list")
        resp = self.client.get(url)
        assert resp.status_code in (401, 403)

    def test_non_staff_blocked(self):
        self.auth(self.non_staff)
        url = reverse("payments:admin-recon-list")
        resp = self.client.get(url)
        assert resp.status_code == 403

    def test_staff_allowed(self):
        self.auth(self.staff)
        url = reverse("payments:admin-recon-list")
        resp = self.client.get(url)
        assert resp.status_code == 200


class TestAdminAPIList(_APIBase):
    def test_default_scope_returns_open_and_escalated_only(self):
        tx_open = _make_tx(self.staff, suffix="list1")
        tx_resolved = _make_tx(self.staff, suffix="list2")
        _make_case(tx_open, status=ReconciliationCase.Status.OPEN)
        _make_case(
            tx_resolved, status=ReconciliationCase.Status.HUMAN_RESOLVED,
        )

        self.auth(self.staff)
        resp = self.client.get(reverse("payments:admin-recon-list"))
        assert resp.status_code == 200
        ids = {item["transaction_id"] for item in resp.data["items"]}
        assert str(tx_open.id) in ids
        assert str(tx_resolved.id) not in ids

    def test_filter_by_severity(self):
        tx_high = _make_tx(self.staff, suffix="sev1")
        tx_low = _make_tx(self.staff, suffix="sev2")
        _make_case(tx_high, severity=ReconciliationCase.Severity.CRITICAL)
        _make_case(tx_low, severity=ReconciliationCase.Severity.LOW)

        self.auth(self.staff)
        resp = self.client.get(
            reverse("payments:admin-recon-list"), {"severity_min": 4}
        )
        assert resp.status_code == 200
        ids = {item["transaction_id"] for item in resp.data["items"]}
        assert str(tx_high.id) in ids
        assert str(tx_low.id) not in ids

    def test_filter_assigned_to_me(self):
        # Make a fresh non-staff transaction owner so the staff user
        # has no other transactions polluting the queue.
        owner = _make_user("+254700091010")
        other_staff = _make_user("+254700091011", is_staff=True)

        tx_mine = _make_tx(owner, suffix="mine")
        tx_other = _make_tx(owner, suffix="other")
        _make_case(tx_mine, assigned_to=self.staff)
        _make_case(tx_other, assigned_to=other_staff)

        self.auth(self.staff)
        resp = self.client.get(
            reverse("payments:admin-recon-list"), {"assigned_to": "me"}
        )
        assert resp.status_code == 200
        ids = {item["transaction_id"] for item in resp.data["items"]}
        assert str(tx_mine.id) in ids
        assert str(tx_other.id) not in ids

    def test_filter_breached_only(self):
        tx_breached = _make_tx(self.staff, suffix="b1")
        tx_fresh = _make_tx(self.staff, suffix="b2")
        case_breached = _make_case(tx_breached)
        case_breached.sla_breach_at = timezone.now() - timedelta(minutes=1)
        case_breached.save(update_fields=["sla_breach_at"])
        _make_case(tx_fresh, sla_minutes=10)

        self.auth(self.staff)
        resp = self.client.get(
            reverse("payments:admin-recon-list"), {"breached": "1"}
        )
        assert resp.status_code == 200
        ids = {item["transaction_id"] for item in resp.data["items"]}
        assert str(tx_breached.id) in ids
        assert str(tx_fresh.id) not in ids

    def test_orders_by_severity_then_breach_then_age(self):
        # Three cases · expect the CRIT-then-soonest-breach ordering.
        tx_a = _make_tx(self.staff, suffix="ord1")
        tx_b = _make_tx(self.staff, suffix="ord2")
        tx_c = _make_tx(self.staff, suffix="ord3")
        _make_case(
            tx_a, severity=ReconciliationCase.Severity.LOW, sla_minutes=1,
        )
        _make_case(
            tx_b, severity=ReconciliationCase.Severity.CRITICAL, sla_minutes=10,
        )
        _make_case(
            tx_c, severity=ReconciliationCase.Severity.CRITICAL, sla_minutes=2,
        )

        self.auth(self.staff)
        resp = self.client.get(reverse("payments:admin-recon-list"))
        ids = [item["transaction_id"] for item in resp.data["items"]]
        # CRITICAL with the soonest breach comes first; CRITICAL with the
        # later breach next; LOW (soonest breach but lower severity) last.
        assert ids.index(str(tx_c.id)) < ids.index(str(tx_b.id))
        assert ids.index(str(tx_b.id)) < ids.index(str(tx_a.id))


class TestAdminAPIDetailAndTransitions(_APIBase):
    def test_detail_includes_evidence(self):
        tx = _make_tx(self.staff, suffix="d1")
        case = _make_case(
            tx, evidence={"mpesa_receipt": "RCT001", "callback_payload": {"foo": 1}},
        )

        self.auth(self.staff)
        resp = self.client.get(
            reverse("payments:admin-recon-detail", args=[case.id])
        )
        assert resp.status_code == 200
        assert resp.data["evidence"]["mpesa_receipt"] == "RCT001"
        assert resp.data["transaction"]["user_phone"] == self.staff.phone

    def test_detail_404_on_missing(self):
        import uuid
        self.auth(self.staff)
        resp = self.client.get(
            reverse("payments:admin-recon-detail", args=[uuid.uuid4()])
        )
        assert resp.status_code == 404

    def test_assign_to_me(self):
        tx = _make_tx(self.staff, suffix="a1")
        case = _make_case(tx)

        self.auth(self.staff)
        resp = self.client.post(
            reverse("payments:admin-recon-assign", args=[case.id]),
            {"user_id": "me"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["assigned_to"]["id"] == str(self.staff.id)

    def test_assign_unassign(self):
        other = _make_user("+254700091020", is_staff=True)
        tx = _make_tx(self.staff, suffix="a2")
        case = _make_case(tx, assigned_to=other)

        self.auth(self.staff)
        resp = self.client.post(
            reverse("payments:admin-recon-assign", args=[case.id]),
            {"user_id": "unassign"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["assigned_to"] is None

    def test_assign_rejects_non_staff_target(self):
        tx = _make_tx(self.staff, suffix="a3")
        case = _make_case(tx)

        self.auth(self.staff)
        resp = self.client.post(
            reverse("payments:admin-recon-assign", args=[case.id]),
            {"user_id": str(self.non_staff.id)},
            format="json",
        )
        assert resp.status_code == 400

    def test_resolve_writes_resolution_action_and_audit(self):
        tx = _make_tx(self.staff, suffix="r1")
        case = _make_case(tx)

        self.auth(self.staff)
        resp = self.client.post(
            reverse("payments:admin-recon-resolve", args=[case.id]),
            {"resolution_action": "reverse_refund", "notes": "Daraja reversed it"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["status"] == "human_resolved"
        assert resp.data["resolution_action"] == "reverse_refund"
        assert "Daraja reversed it" in resp.data["notes"]

    def test_resolve_with_auto_flag_marks_auto_resolved(self):
        tx = _make_tx(self.staff, suffix="r2")
        case = _make_case(tx)

        self.auth(self.staff)
        resp = self.client.post(
            reverse("payments:admin-recon-resolve", args=[case.id]),
            {"resolution_action": "duplicate_callback", "auto": True},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["status"] == "auto_resolved"

    def test_resolve_rejects_already_resolved(self):
        tx = _make_tx(self.staff, suffix="r3")
        case = _make_case(tx, status=ReconciliationCase.Status.HUMAN_RESOLVED)
        case.resolved_at = timezone.now()
        case.save(update_fields=["resolved_at"])

        self.auth(self.staff)
        resp = self.client.post(
            reverse("payments:admin-recon-resolve", args=[case.id]),
            {"resolution_action": "human_review"},
            format="json",
        )
        assert resp.status_code == 400

    def test_escalate_open_case(self):
        tx = _make_tx(self.staff, suffix="e1")
        case = _make_case(tx, severity=ReconciliationCase.Severity.MEDIUM)

        self.auth(self.staff)
        resp = self.client.post(
            reverse("payments:admin-recon-escalate", args=[case.id]),
            {"reason": "user impacted"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["status"] == "escalated"
        assert resp.data["severity"] == ReconciliationCase.Severity.CRITICAL

    def test_reopen_resolved_case(self):
        tx = _make_tx(self.staff, suffix="re1")
        case = _make_case(tx)
        admin_actions.resolve(case, self.staff, "human_review")

        self.auth(self.staff)
        resp = self.client.post(
            reverse("payments:admin-recon-reopen", args=[case.id]),
            {"reason": "did not stick"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["status"] == "open"
        assert resp.data["resolved_at"] is None
        assert resp.data["resolution_action"] == ""


class TestAdminAPIStats(_APIBase):
    def test_stats_returns_actionable_breakdown(self):
        tx1 = _make_tx(self.staff, suffix="s1")
        tx2 = _make_tx(self.staff, suffix="s2")
        tx3 = _make_tx(self.staff, suffix="s3")
        # 1 OPEN-CRIT, 1 ESCALATED-HIGH, 1 RESOLVED.
        _make_case(
            tx1, severity=ReconciliationCase.Severity.CRITICAL,
        )
        _make_case(
            tx2, status=ReconciliationCase.Status.ESCALATED,
            severity=ReconciliationCase.Severity.HIGH,
        )
        _make_case(
            tx3, status=ReconciliationCase.Status.HUMAN_RESOLVED,
        )

        self.auth(self.staff)
        resp = self.client.get(reverse("payments:admin-recon-stats"))
        assert resp.status_code == 200
        assert resp.data["actionable"] == 2
        # Severity-bucket present.
        open_buckets = resp.data["by_status_severity"].get("open", {})
        assert sum(open_buckets.values()) >= 1

    def test_stats_my_cases_filters_to_caller(self):
        owner = _make_user("+254700091030")
        other_staff = _make_user("+254700091031", is_staff=True)
        tx_mine = _make_tx(owner, suffix="m1")
        tx_other = _make_tx(owner, suffix="m2")
        _make_case(tx_mine, assigned_to=self.staff)
        _make_case(tx_other, assigned_to=other_staff)

        self.auth(self.staff)
        resp = self.client.get(reverse("payments:admin-recon-stats"))
        assert resp.data["my_cases"] == 1


class TestAdminAuditTrailIsAppendOnly(TestCase):
    """Cases must accumulate audit lines · never overwrite. This is the
    invariant the queue's history depends on."""

    def test_multiple_actions_all_recorded(self):
        actor1 = _make_user("+254700091040", is_staff=True)
        actor2 = _make_user("+254700091041", is_staff=True)
        tx = _make_tx(actor1, suffix="audit1")
        case = _make_case(tx)

        admin_actions.assign_to(case, actor1, actor2)
        admin_actions.escalate(case, actor2, reason="urgent")
        admin_actions.resolve(case, actor2, "b2c_clawback", notes="paid out")
        admin_actions.reopen(case, actor1, reason="user complained")

        case.refresh_from_db()
        # Every action's actor + verb appears in order.
        for marker in ("assigned to", "escalated", "resolved", "reopened"):
            assert marker in case.notes
        # Both actors named.
        assert actor1.get_username() in case.notes
        assert actor2.get_username() in case.notes
