"""ReconciliationCase state transitions · shared by Django admin + DRF.

Single source of truth for assign / resolve / auto_resolve / escalate /
reopen. Each transition appends a timestamped audit line to `notes`
with the actor's username so the queue is self-documenting · no
separate audit table to query.

Why a module of pure functions instead of model methods · the Django
admin and the DRF admin API both invoke these. Putting them on the
model risks them being called from hot paths (saga, signals) where
the audit trail and validation make less sense. A dedicated module
keeps the contract explicit: "these are the only legal mutations
once a case is in the queue."
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from django.utils import timezone

from .models import ReconciliationCase

if TYPE_CHECKING:
    from apps.accounts.models import User


_RESOLVED_STATUSES = {
    ReconciliationCase.Status.HUMAN_RESOLVED,
    ReconciliationCase.Status.AUTO_RESOLVED,
}
_ASSIGNABLE_STATUSES = {
    ReconciliationCase.Status.OPEN,
    ReconciliationCase.Status.ESCALATED,
}


def _audit(case: ReconciliationCase, actor: Optional["User"], action: str, detail: str = "") -> None:
    """Append a timestamped audit line to case.notes.

    Mutates the case in memory · caller is responsible for save().
    """
    actor_name = actor.get_username() if actor else "system"
    line = f"\n[{timezone.now().isoformat()}] {actor_name} · {action}"
    if detail:
        line += f" · {detail}"
    case.notes = (case.notes or "") + line


def assign_to(
    case: ReconciliationCase,
    actor: "User",
    assignee: Optional["User"],
) -> ReconciliationCase:
    """Assign or unassign · `assignee=None` clears the assignment.

    Allowed only on OPEN / ESCALATED cases · resolved cases stay frozen.
    """
    if case.status not in _ASSIGNABLE_STATUSES:
        raise ValueError(
            f"Cannot reassign a {case.get_status_display()} case "
            f"(reopen first)."
        )
    prev = case.assigned_to
    case.assigned_to = assignee
    new_label = assignee.get_username() if assignee else "unassigned"
    prev_label = prev.get_username() if prev else "unassigned"
    _audit(case, actor, f"assigned to {new_label}", detail=f"was {prev_label}")
    case.save(update_fields=["assigned_to", "notes", "updated_at"])
    return case


def resolve(
    case: ReconciliationCase,
    actor: "User",
    resolution_action: str,
    notes: str = "",
) -> ReconciliationCase:
    """Mark HUMAN_RESOLVED · for ops manually fixing a case."""
    if case.status in _RESOLVED_STATUSES:
        raise ValueError(
            f"Case already {case.get_status_display()} · reopen to amend."
        )
    case.status = ReconciliationCase.Status.HUMAN_RESOLVED
    case.resolution_action = resolution_action
    case.resolved_at = timezone.now()
    detail = f"action={resolution_action}"
    if notes:
        detail += f" · {notes.strip()}"
    _audit(case, actor, "resolved", detail=detail)
    case.save(update_fields=[
        "status", "resolution_action", "resolved_at", "notes", "updated_at",
    ])
    return case


def auto_resolve(
    case: ReconciliationCase,
    actor: Optional["User"],
    resolution_action: str,
    notes: str = "",
) -> ReconciliationCase:
    """Mark AUTO_RESOLVED · system-driven recovery (clawback succeeded,
    duplicate already credited, callback was a no-op replay, etc.).
    Same audit semantics as `resolve` but a different terminal status
    so analytics can split human vs system recovery."""
    if case.status in _RESOLVED_STATUSES:
        raise ValueError(
            f"Case already {case.get_status_display()} · reopen to amend."
        )
    case.status = ReconciliationCase.Status.AUTO_RESOLVED
    case.resolution_action = resolution_action
    case.resolved_at = timezone.now()
    detail = f"action={resolution_action}"
    if notes:
        detail += f" · {notes.strip()}"
    _audit(case, actor, "auto-resolved", detail=detail)
    case.save(update_fields=[
        "status", "resolution_action", "resolved_at", "notes", "updated_at",
    ])
    return case


def escalate(
    case: ReconciliationCase,
    actor: "User",
    reason: str = "",
) -> ReconciliationCase:
    """Manual escalation · only legal from OPEN. The daily sweep does
    the same flip automatically when sla_breach_at lapses; this lets
    ops escalate eagerly without waiting for the SLA clock."""
    if case.status != ReconciliationCase.Status.OPEN:
        raise ValueError(
            f"Can only escalate OPEN cases (was {case.get_status_display()})."
        )
    case.status = ReconciliationCase.Status.ESCALATED
    case.severity = max(case.severity, ReconciliationCase.Severity.CRITICAL)
    _audit(case, actor, "escalated", detail=reason or "manual")
    case.save(update_fields=["status", "severity", "notes", "updated_at"])
    return case


def reopen(
    case: ReconciliationCase,
    actor: "User",
    reason: str = "",
) -> ReconciliationCase:
    """Reopen a resolved or escalated case · for when a fix doesn't stick.

    Clears resolved_at + resolution_action so the case re-enters the
    actionable queue. Severity is preserved · the case got that bad
    once and might still be that bad.
    """
    if case.status == ReconciliationCase.Status.OPEN:
        raise ValueError("Case is already OPEN.")
    case.status = ReconciliationCase.Status.OPEN
    case.resolved_at = None
    case.resolution_action = ""
    _audit(case, actor, "reopened", detail=reason or "manual")
    case.save(update_fields=[
        "status", "resolved_at", "resolution_action", "notes", "updated_at",
    ])
    return case
