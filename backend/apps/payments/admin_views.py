"""DRF admin endpoints for the ReconciliationCase queue.

All endpoints require `is_staff`. Mirrors the Django admin actions so
an in-app or web admin surface can drive the same audit-trail logic
without duplicating state-machine rules. Hand-rolled serialization
keeps the contract explicit and ties the response shape directly to
what an admin UI needs (severity labels, transaction crosslinks,
SLA countdowns) instead of dumping raw model fields.

Endpoints:
  GET  /api/v1/payments/admin/reconciliation/                · list + filter + paginate
  GET  /api/v1/payments/admin/reconciliation/stats/          · queue counts for dashboard tiles
  GET  /api/v1/payments/admin/reconciliation/<uuid>/         · detail (incl. evidence)
  POST /api/v1/payments/admin/reconciliation/<uuid>/assign/  · {user_id: "me" | "unassign" | uuid}
  POST /api/v1/payments/admin/reconciliation/<uuid>/resolve/ · {resolution_action, notes?, auto?}
  POST /api/v1/payments/admin/reconciliation/<uuid>/escalate/ · {reason?}
  POST /api/v1/payments/admin/reconciliation/<uuid>/reopen/   · {reason?}
"""
from __future__ import annotations

from django.db.models import Count
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import admin_actions
from .models import ReconciliationCase


class IsStaffUser(IsAuthenticated):
    """Same shape as `apps.accounts.views.IsStaffUser` · duplicated here
    to keep payments app independent of the accounts internal API."""

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_staff


# ── Serialization ────────────────────────────────────────────────────────


def _serialize_user(user):
    if not user:
        return None
    return {
        "id": str(user.id),
        "phone": getattr(user, "phone", ""),
        "username": user.get_username(),
    }


def _serialize_transaction(tx):
    return {
        "id": str(tx.id),
        "type": tx.type,
        "status": tx.status,
        "source_amount": str(tx.source_amount),
        "source_currency": tx.source_currency,
        "dest_amount": str(tx.dest_amount),
        "dest_currency": tx.dest_currency,
        "user_phone": tx.user.phone,
        "mpesa_receipt": tx.mpesa_receipt or None,
        "mpesa_paybill": tx.mpesa_paybill or None,
        "mpesa_till": tx.mpesa_till or None,
        "created_at": tx.created_at.isoformat() if tx.created_at else None,
        "completed_at": tx.completed_at.isoformat() if tx.completed_at else None,
    }


def _sla_seconds_remaining(case):
    """None if N/A, else int seconds (negative when breached)."""
    if not case.sla_breach_at:
        return None
    if case.status in {
        ReconciliationCase.Status.HUMAN_RESOLVED,
        ReconciliationCase.Status.AUTO_RESOLVED,
    }:
        return None
    return int((case.sla_breach_at - timezone.now()).total_seconds())


def _serialize_case(case, *, include_evidence=False):
    return {
        "id": str(case.id),
        "transaction_id": str(case.transaction_id),
        "case_type": case.case_type,
        "case_type_label": case.get_case_type_display(),
        "status": case.status,
        "status_label": case.get_status_display(),
        "severity": case.severity,
        "severity_label": case.get_severity_display(),
        "detected_at": case.detected_at.isoformat() if case.detected_at else None,
        "sla_breach_at": case.sla_breach_at.isoformat() if case.sla_breach_at else None,
        "sla_seconds_remaining": _sla_seconds_remaining(case),
        "resolved_at": case.resolved_at.isoformat() if case.resolved_at else None,
        "resolution_action": case.resolution_action,
        "assigned_to": _serialize_user(case.assigned_to),
        "correlation_id": case.correlation_id,
        "notes": case.notes,
        "transaction": _serialize_transaction(case.transaction),
        **({"evidence": case.evidence} if include_evidence else {}),
        "updated_at": case.updated_at.isoformat() if case.updated_at else None,
    }


# ── Helpers ─────────────────────────────────────────────────────────────


def _get_case(case_id):
    return (
        ReconciliationCase.objects
        .select_related("transaction", "transaction__user", "assigned_to")
        .filter(id=case_id)
        .first()
    )


def _not_found():
    return Response({"error": "Reconciliation case not found"}, status=404)


# ── Views ───────────────────────────────────────────────────────────────


class AdminReconCaseListView(APIView):
    """Filterable, paginated list. Default scope is the actionable queue
    (OPEN + ESCALATED) sorted by severity descending then SLA breach
    soonest. Query params:
      status[]      one or more of open / escalated / human_resolved / auto_resolved
      case_type[]   one or more of double_settlement / late_callback / orphan_b2b /
                    compensate_failed / reversal_not_supported
      severity_min  integer 1-5
      assigned_to   "me" / "unassigned" / <uuid>
      breached      "1" to filter only SLA-breached open cases
      limit, offset offset/limit pagination (limit ≤ 200)
    """

    permission_classes = [IsStaffUser]

    def get(self, request):
        qs = (
            ReconciliationCase.objects
            .select_related("transaction", "transaction__user", "assigned_to")
        )

        statuses = request.query_params.getlist("status")
        if statuses:
            qs = qs.filter(status__in=statuses)
        else:
            qs = qs.filter(status__in=[
                ReconciliationCase.Status.OPEN,
                ReconciliationCase.Status.ESCALATED,
            ])

        case_types = request.query_params.getlist("case_type")
        if case_types:
            qs = qs.filter(case_type__in=case_types)

        severity_min = request.query_params.get("severity_min")
        if severity_min:
            try:
                qs = qs.filter(severity__gte=int(severity_min))
            except ValueError:
                return Response(
                    {"error": "severity_min must be an integer 1-5"}, status=400
                )

        assigned = request.query_params.get("assigned_to")
        if assigned == "me":
            qs = qs.filter(assigned_to=request.user)
        elif assigned == "unassigned":
            qs = qs.filter(assigned_to__isnull=True)
        elif assigned:
            qs = qs.filter(assigned_to_id=assigned)

        if request.query_params.get("breached") == "1":
            qs = qs.filter(
                status=ReconciliationCase.Status.OPEN,
                sla_breach_at__lte=timezone.now(),
            )

        # Order: highest severity first, soonest breach next, oldest first.
        # `nulls_last` keeps cases with no SLA at the bottom of the breach
        # tier rather than scrambling the order with NULL-first defaults.
        qs = qs.order_by("-severity", "sla_breach_at", "detected_at")

        try:
            limit = min(int(request.query_params.get("limit", 50)), 200)
            offset = max(int(request.query_params.get("offset", 0)), 0)
        except ValueError:
            return Response({"error": "Invalid limit/offset"}, status=400)

        total = qs.count()
        items = [_serialize_case(c) for c in qs[offset:offset + limit]]
        return Response({
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": items,
        })


class AdminReconCaseDetailView(APIView):
    permission_classes = [IsStaffUser]

    def get(self, request, case_id):
        case = _get_case(case_id)
        if not case:
            return _not_found()
        return Response(_serialize_case(case, include_evidence=True))


class AdminReconCaseAssignView(APIView):
    permission_classes = [IsStaffUser]

    def post(self, request, case_id):
        case = _get_case(case_id)
        if not case:
            return _not_found()

        target_id = request.data.get("user_id")
        if not target_id or target_id == "me":
            assignee = request.user
        elif target_id == "unassign":
            assignee = None
        else:
            from apps.accounts.models import User
            try:
                assignee = User.objects.get(id=target_id)
            except (User.DoesNotExist, ValueError):
                return Response({"error": "Target user not found"}, status=404)
            if not assignee.is_staff:
                return Response(
                    {"error": "Cannot assign cases to non-staff users"},
                    status=400,
                )

        try:
            admin_actions.assign_to(case, request.user, assignee)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        return Response(_serialize_case(case, include_evidence=True))


class AdminReconCaseResolveView(APIView):
    permission_classes = [IsStaffUser]

    def post(self, request, case_id):
        case = _get_case(case_id)
        if not case:
            return _not_found()

        action = (request.data.get("resolution_action") or "human_review").strip()
        notes = (request.data.get("notes") or "").strip()
        is_auto = bool(request.data.get("auto"))

        try:
            if is_auto:
                admin_actions.auto_resolve(case, request.user, action, notes=notes)
            else:
                admin_actions.resolve(case, request.user, action, notes=notes)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        return Response(_serialize_case(case, include_evidence=True))


class AdminReconCaseEscalateView(APIView):
    permission_classes = [IsStaffUser]

    def post(self, request, case_id):
        case = _get_case(case_id)
        if not case:
            return _not_found()

        reason = (request.data.get("reason") or "").strip()
        try:
            admin_actions.escalate(case, request.user, reason=reason)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        return Response(_serialize_case(case, include_evidence=True))


class AdminReconCaseReopenView(APIView):
    permission_classes = [IsStaffUser]

    def post(self, request, case_id):
        case = _get_case(case_id)
        if not case:
            return _not_found()

        reason = (request.data.get("reason") or "").strip()
        try:
            admin_actions.reopen(case, request.user, reason=reason)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        return Response(_serialize_case(case, include_evidence=True))


class AdminReconCaseStatsView(APIView):
    """Tile data for an ops dashboard. Returns counts in the shapes the
    common dashboard tiles need · no per-case overhead."""

    permission_classes = [IsStaffUser]

    def get(self, request):
        # By status × severity matrix.
        by_status_severity: dict = {}
        for row in (
            ReconciliationCase.objects
            .values("status", "severity")
            .annotate(n=Count("id"))
        ):
            by_status_severity.setdefault(row["status"], {})[row["severity"]] = row["n"]

        # By case type for the actionable queue (open + escalated).
        actionable_qs = ReconciliationCase.objects.filter(
            status__in=[
                ReconciliationCase.Status.OPEN,
                ReconciliationCase.Status.ESCALATED,
            ]
        )
        by_case_type = {
            row["case_type"]: row["n"]
            for row in actionable_qs.values("case_type").annotate(n=Count("id"))
        }

        # SLA-breached count (open + past breach time).
        breached_open = ReconciliationCase.objects.filter(
            status=ReconciliationCase.Status.OPEN,
            sla_breach_at__lte=timezone.now(),
        ).count()

        actionable = actionable_qs.count()
        my_cases = actionable_qs.filter(assigned_to=request.user).count()
        unassigned = actionable_qs.filter(assigned_to__isnull=True).count()

        return Response({
            "actionable": actionable,
            "breached_open": breached_open,
            "my_cases": my_cases,
            "unassigned": unassigned,
            "by_status_severity": by_status_severity,
            "by_case_type": by_case_type,
            "as_of": timezone.now().isoformat(),
        })


# ── Platform limits admin (caps on outgoing volume) ─────────────────────


class AdminPlatformLimitsView(APIView):
    """Admin-settable safety caps on outgoing payments.

    GET   · returns current caps + sliding-window usage + remaining
            headroom. Layered with the float-driven circuit breaker:
              - circuit breaker  → reactive · pauses on low M-Pesa float
              - platform limits  → proactive · caps volume regardless of float

    PATCH · update one or more caps. Body fields (all optional · only
            present fields are updated):
              max_per_tx_kes         decimal · 0 disables the cap
              max_per_hour_kes       decimal · 0 disables the cap
              max_per_day_kes        decimal · 0 disables the cap
              max_tx_per_hour_count  int     · 0 disables the cap
              hard_pause             bool    · kill switch
              hard_pause_reason      string  · human-readable context

    Every PATCH writes a row to AuditLog (action=PLATFORM_LIMITS_UPDATED)
    with before/after diff so an incident review can reconstruct the
    sequence of admin changes.

    Bonus payload includes `circuit_breaker` block · admins typically
    want both readings on the same screen.
    """

    permission_classes = [IsStaffUser]

    def get(self, request):
        from .platform_limits import get_status as platform_status
        from .circuit_breaker import PaymentCircuitBreaker

        return Response({
            **platform_status(),
            "circuit_breaker": PaymentCircuitBreaker.get_status_dict(),
        })

    def patch(self, request):
        from .platform_limits import update_limits, get_status as platform_status

        # Whitelist updateable fields · ignore anything else for safety.
        allowed_fields = (
            "max_per_tx_kes",
            "max_per_hour_kes",
            "max_per_day_kes",
            "max_tx_per_hour_count",
            "hard_pause",
            "hard_pause_reason",
        )
        payload = {k: request.data[k] for k in allowed_fields if k in request.data}

        # Validate numeric fields shape early · clearer error than
        # the model layer's InvalidOperation cascade.
        for k in ("max_per_tx_kes", "max_per_hour_kes", "max_per_day_kes"):
            if k in payload:
                try:
                    val = float(payload[k])
                    if val < 0:
                        return Response(
                            {"error": f"{k} must be >= 0"}, status=400,
                        )
                except (TypeError, ValueError):
                    return Response(
                        {"error": f"{k} must be a decimal number"}, status=400,
                    )
        if "max_tx_per_hour_count" in payload:
            try:
                val = int(payload["max_tx_per_hour_count"])
                if val < 0:
                    return Response(
                        {"error": "max_tx_per_hour_count must be >= 0"},
                        status=400,
                    )
            except (TypeError, ValueError):
                return Response(
                    {"error": "max_tx_per_hour_count must be an integer"},
                    status=400,
                )

        update_limits(request.user, **payload)
        return Response(platform_status())
