import csv
import json

from django.contrib import admin, messages
from django.http import HttpResponse
from django.urls import reverse
from django.utils import timezone
from django.utils.html import format_html

from . import admin_actions
from .models import PlatformLimit, ReconciliationCase, SavedPaybill, Transaction


def mark_as_reviewed(modeladmin, request, queryset):
    """Admin action: mark selected transactions as reviewed (adds to saga_data)."""
    for tx in queryset:
        tx.saga_data["reviewed_by"] = request.user.get_username()
        tx.saga_data["reviewed_at"] = timezone.now().isoformat()
    Transaction.objects.bulk_update(queryset, ["saga_data"])
    modeladmin.message_user(request, f"{queryset.count()} transaction(s) marked as reviewed.")


mark_as_reviewed.short_description = "Mark selected as reviewed"


def export_csv(modeladmin, request, queryset):
    """Admin action: export selected transactions to CSV."""
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="transactions_{timezone.now():%Y%m%d_%H%M%S}.csv"'

    writer = csv.writer(response)
    writer.writerow([
        "ID", "User", "Type", "Status",
        "Source Amount", "Source Currency",
        "Dest Amount", "Dest Currency",
        "Exchange Rate", "Fee Amount", "Fee Currency",
        "M-Pesa Paybill", "M-Pesa Till", "M-Pesa Account", "M-Pesa Receipt",
        "Chain", "TX Hash",
        "Created At", "Completed At",
    ])

    for tx in queryset.select_related("user"):
        writer.writerow([
            str(tx.id),
            tx.user.phone,
            tx.type,
            tx.status,
            tx.source_amount,
            tx.source_currency,
            tx.dest_amount,
            tx.dest_currency,
            tx.exchange_rate,
            tx.fee_amount,
            tx.fee_currency,
            tx.mpesa_paybill,
            tx.mpesa_till,
            tx.mpesa_account,
            tx.mpesa_receipt,
            tx.chain,
            tx.tx_hash,
            tx.created_at,
            tx.completed_at,
        ])

    return response


export_csv.short_description = "Export selected to CSV"


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = (
        "short_id", "user_phone", "type", "status",
        "source_amount", "source_currency",
        "dest_amount", "dest_currency",
        "fee_amount", "mpesa_receipt", "created_at",
    )
    list_filter = ("type", "status", "source_currency", "dest_currency", "chain")
    search_fields = ("idempotency_key", "user__phone", "mpesa_receipt", "tx_hash", "mpesa_paybill", "mpesa_till")
    readonly_fields = (
        "id", "idempotency_key", "saga_data", "saga_step",
        "ip_address", "device_id", "risk_score",
        "created_at", "updated_at", "completed_at",
    )
    date_hierarchy = "created_at"
    list_per_page = 50
    actions = [mark_as_reviewed, export_csv]

    fieldsets = (
        ("Transaction", {
            "fields": ("id", "idempotency_key", "user", "type", "status"),
        }),
        ("Amounts", {
            "fields": (
                "source_currency", "source_amount",
                "dest_currency", "dest_amount",
                "exchange_rate", "fee_amount", "fee_currency",
            ),
        }),
        ("M-Pesa", {
            "fields": ("mpesa_paybill", "mpesa_till", "mpesa_account", "mpesa_phone", "mpesa_receipt"),
        }),
        ("Blockchain", {
            "fields": ("chain", "tx_hash", "confirmations"),
        }),
        ("Metadata", {
            "fields": ("ip_address", "device_id", "risk_score", "failure_reason"),
            "classes": ("collapse",),
        }),
        ("Saga", {
            "fields": ("saga_step", "saga_data"),
            "classes": ("collapse",),
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at", "completed_at"),
        }),
    )

    def short_id(self, obj):
        return str(obj.id)[:8]
    short_id.short_description = "ID"

    def user_phone(self, obj):
        return obj.user.phone
    user_phone.short_description = "User"
    user_phone.admin_order_field = "user__phone"


@admin.register(SavedPaybill)
class SavedPaybillAdmin(admin.ModelAdmin):
    list_display = ("user", "label", "paybill_number", "account_number", "last_used_at", "created_at")
    list_filter = ("paybill_number",)
    search_fields = ("user__phone", "paybill_number", "account_number", "label")
    readonly_fields = ("id", "created_at")


# ── ReconciliationCase admin ─────────────────────────────────────────────
#
# 2026-05-08 · turns the ReconciliationCase queue from "rows in Postgres"
# into something ops can actually work. Severity-coloured pills, SLA
# countdown, transaction crosslinks, evidence pretty-printer, and bulk
# actions (assign-to-me, resolve, escalate, mark auto-resolved) all
# routed through `admin_actions` so the audit trail (notes column)
# stays consistent across the Django admin and the DRF admin API.

_SEVERITY_LABELS = {1: "INFO", 2: "LOW", 3: "MED", 4: "HIGH", 5: "CRIT"}
_SEVERITY_COLORS = {1: "#9CA3AF", 2: "#60A5FA", 3: "#FBBF24", 4: "#F97316", 5: "#DC2626"}
_STATUS_COLORS = {
    "open": "#F97316",
    "escalated": "#DC2626",
    "human_resolved": "#10B981",
    "auto_resolved": "#10B981",
}


@admin.register(ReconciliationCase)
class ReconciliationCaseAdmin(admin.ModelAdmin):
    list_display = (
        "short_id",
        "case_type_label",
        "status_pill",
        "severity_pill",
        "transaction_link",
        "user_phone",
        "kes_amount",
        "assigned_username",
        "age",
        "sla_countdown",
        "detected_at",
    )
    list_filter = ("status", "case_type", "severity", "assigned_to")
    list_select_related = ("transaction", "transaction__user", "assigned_to")
    search_fields = (
        "id",
        "transaction__id",
        "transaction__user__phone",
        "transaction__mpesa_receipt",
        "correlation_id",
    )
    readonly_fields = (
        "id",
        "transaction_link_full",
        "case_type",
        "detected_at",
        "sla_breach_at",
        "resolved_at",
        "correlation_id",
        "evidence_pretty",
        "created_at",
        "updated_at",
    )
    date_hierarchy = "detected_at"
    list_per_page = 50
    ordering = ("-severity", "sla_breach_at", "-detected_at")
    actions = [
        "action_assign_to_me",
        "action_resolve_human_review",
        "action_escalate",
        "action_mark_auto_resolved",
        "action_reopen",
    ]
    fieldsets = (
        ("Case", {
            "fields": (
                "id",
                "transaction_link_full",
                "case_type",
                "status",
                "severity",
                "assigned_to",
            ),
        }),
        ("Resolution", {
            "fields": ("resolution_action", "resolved_at", "notes"),
        }),
        ("SLA", {
            "fields": ("detected_at", "sla_breach_at", "correlation_id"),
        }),
        ("Evidence", {
            "fields": ("evidence_pretty",),
            "classes": ("collapse",),
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    # ── List display helpers ────────────────────────────────────────

    def short_id(self, obj):
        return str(obj.id)[:8]
    short_id.short_description = "ID"

    def case_type_label(self, obj):
        return obj.get_case_type_display()
    case_type_label.short_description = "Type"
    case_type_label.admin_order_field = "case_type"

    def status_pill(self, obj):
        color = _STATUS_COLORS.get(obj.status, "#6B7280")
        return format_html(
            '<span style="color:{};font-weight:600">{}</span>',
            color,
            obj.get_status_display(),
        )
    status_pill.short_description = "Status"
    status_pill.admin_order_field = "status"

    def severity_pill(self, obj):
        return format_html(
            '<span style="background:{};color:#fff;padding:2px 8px;'
            'border-radius:10px;font-size:11px;font-weight:600">{}</span>',
            _SEVERITY_COLORS.get(obj.severity, "#6B7280"),
            _SEVERITY_LABELS.get(obj.severity, str(obj.severity)),
        )
    severity_pill.short_description = "Sev"
    severity_pill.admin_order_field = "-severity"

    def transaction_link(self, obj):
        url = reverse("admin:payments_transaction_change", args=[obj.transaction_id])
        return format_html('<a href="{}">{}…</a>', url, str(obj.transaction_id)[:8])
    transaction_link.short_description = "Tx"
    transaction_link.admin_order_field = "transaction_id"

    def transaction_link_full(self, obj):
        url = reverse("admin:payments_transaction_change", args=[obj.transaction_id])
        tx = obj.transaction
        return format_html(
            '<a href="{}">{}</a> · {} {} → {} {} · <em>{}</em>',
            url,
            str(obj.transaction_id),
            tx.source_amount,
            tx.source_currency,
            tx.dest_amount,
            tx.dest_currency,
            tx.get_status_display(),
        )
    transaction_link_full.short_description = "Transaction"

    def user_phone(self, obj):
        return obj.transaction.user.phone
    user_phone.short_description = "User"
    user_phone.admin_order_field = "transaction__user__phone"

    def kes_amount(self, obj):
        if obj.transaction.dest_currency == "KES":
            return f"KES {obj.transaction.dest_amount:,.0f}"
        return f"{obj.transaction.dest_amount} {obj.transaction.dest_currency}"
    kes_amount.short_description = "Amount"

    def assigned_username(self, obj):
        return obj.assigned_to.get_username() if obj.assigned_to_id else "—"
    assigned_username.short_description = "Assigned"
    assigned_username.admin_order_field = "assigned_to__phone"

    def age(self, obj):
        secs = int((timezone.now() - obj.detected_at).total_seconds())
        if secs < 60:
            return f"{secs}s"
        if secs < 3600:
            return f"{secs // 60}m"
        if secs < 86400:
            return f"{secs // 3600}h"
        return f"{secs // 86400}d"
    age.short_description = "Age"

    def sla_countdown(self, obj):
        # Resolved cases · no countdown.
        if obj.status in {
            ReconciliationCase.Status.HUMAN_RESOLVED,
            ReconciliationCase.Status.AUTO_RESOLVED,
        }:
            return "—"
        if not obj.sla_breach_at:
            return "—"
        delta = obj.sla_breach_at - timezone.now()
        secs = int(delta.total_seconds())
        if secs < 0:
            return format_html(
                '<span style="color:#DC2626;font-weight:700">BREACHED</span>'
            )
        if secs < 60:
            return format_html('<span style="color:#F97316">{}s</span>', secs)
        if secs < 3600:
            return format_html('<span style="color:#F97316">{}m</span>', secs // 60)
        return format_html('<span style="color:#10B981">{}h</span>', secs // 3600)
    sla_countdown.short_description = "SLA"

    def evidence_pretty(self, obj):
        if not obj.evidence:
            return "—"
        try:
            payload = json.dumps(obj.evidence, indent=2, default=str, sort_keys=True)
        except (TypeError, ValueError):
            payload = repr(obj.evidence)
        return format_html(
            '<pre style="background:#F3F4F6;padding:8px;border-radius:4px;'
            'font-size:12px;overflow-x:auto;max-height:300px">{}</pre>',
            payload,
        )
    evidence_pretty.short_description = "Evidence"

    # ── Bulk actions ──────────────────────────────────────────────────

    def _run_bulk(self, request, queryset, fn, *, label, **kwargs):
        ok, fail, errors = 0, 0, []
        for case in queryset:
            try:
                fn(case, request.user, **kwargs)
                ok += 1
            except ValueError as e:
                fail += 1
                errors.append(f"{str(case.id)[:8]}: {e}")
        if ok:
            self.message_user(
                request,
                f"{ok} case(s) {label}." + (f" {fail} skipped." if fail else ""),
                messages.SUCCESS,
            )
        if fail and not ok:
            self.message_user(
                request,
                f"No cases {label}: " + "; ".join(errors[:5]),
                messages.WARNING,
            )

    @admin.action(description="Assign selected to me")
    def action_assign_to_me(self, request, queryset):
        self._run_bulk(
            request,
            queryset,
            lambda c, actor: admin_actions.assign_to(c, actor, actor),
            label="assigned",
        )

    @admin.action(description="Resolve as human-review")
    def action_resolve_human_review(self, request, queryset):
        self._run_bulk(
            request,
            queryset,
            lambda c, actor: admin_actions.resolve(c, actor, "human_review"),
            label="resolved",
        )

    @admin.action(description="Escalate to CRITICAL")
    def action_escalate(self, request, queryset):
        self._run_bulk(
            request,
            queryset,
            lambda c, actor: admin_actions.escalate(c, actor, reason="manual escalation"),
            label="escalated",
        )

    @admin.action(description="Mark as auto-resolved (no_action / not_applicable)")
    def action_mark_auto_resolved(self, request, queryset):
        self._run_bulk(
            request,
            queryset,
            lambda c, actor: admin_actions.auto_resolve(c, actor, "not_applicable"),
            label="auto-resolved",
        )

    @admin.action(description="Reopen selected")
    def action_reopen(self, request, queryset):
        self._run_bulk(
            request,
            queryset,
            lambda c, actor: admin_actions.reopen(c, actor, reason="manual reopen"),
            label="reopened",
        )


# ── PlatformLimit admin ──────────────────────────────────────────────────
#
# Singleton row · ops sets the safety caps on outgoing payments. Both
# the django.contrib.admin form (this) and the DRF endpoint at
# /api/v1/payments/admin/limits/ go through `platform_limits.update_limits()`
# so the AuditLog trail captures every change uniformly.


@admin.register(PlatformLimit)
class PlatformLimitAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "max_per_tx_kes",
        "max_per_hour_kes",
        "max_per_day_kes",
        "max_tx_per_hour_count",
        "hard_pause_pill",
        "last_updated_by",
        "updated_at",
    )
    fields = (
        "max_per_tx_kes",
        "max_per_hour_kes",
        "max_per_day_kes",
        "max_tx_per_hour_count",
        "hard_pause",
        "hard_pause_reason",
        "last_updated_by",
        "updated_at",
        "created_at",
    )
    readonly_fields = ("last_updated_by", "updated_at", "created_at")

    def hard_pause_pill(self, obj):
        if obj.hard_pause:
            return format_html(
                '<span style="color:#fff;background:#DC2626;padding:2px 8px;'
                'border-radius:10px;font-weight:700">PAUSED</span>'
            )
        return format_html(
            '<span style="color:#10B981;font-weight:600">live</span>'
        )
    hard_pause_pill.short_description = "Pause"
    hard_pause_pill.admin_order_field = "hard_pause"

    def has_add_permission(self, request):
        # Singleton · refuse adding a second row (UI-only · the model
        # itself doesn't enforce because Django admin uses bulk APIs
        # we don't want to brittle-couple to).
        return not PlatformLimit.objects.exists()

    def has_delete_permission(self, request, obj=None):
        # Never delete the singleton. Use hard_pause to stop payments.
        return False

    def save_model(self, request, obj, form, change):
        # Route through the service so the audit trail is identical
        # to what the DRF PATCH endpoint produces.
        from .platform_limits import update_limits

        update_limits(
            request.user,
            max_per_tx_kes=obj.max_per_tx_kes,
            max_per_hour_kes=obj.max_per_hour_kes,
            max_per_day_kes=obj.max_per_day_kes,
            max_tx_per_hour_count=obj.max_tx_per_hour_count,
            hard_pause=obj.hard_pause,
            hard_pause_reason=obj.hard_pause_reason,
        )
