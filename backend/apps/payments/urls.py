from django.urls import path

from . import admin_views, views, sasapay_admin_views, internal_transfer

app_name = "payments"

urlpatterns = [
    path("pay-bill/", views.PayBillView.as_view(), name="pay-bill"),
    path("pay-till/", views.PayTillView.as_view(), name="pay-till"),
    path("send-mpesa/", views.SendMpesaView.as_view(), name="send-mpesa"),
    # Send-to-Bank · thin wrapper around Pay Bill keyed by bank slug.
    path("send-to-bank/", views.SendToBankView.as_view(), name="send-to-bank"),
    path("banks/", views.BankListView.as_view(), name="banks-list"),
    path("buy-crypto/", views.BuyCryptoView.as_view(), name="buy-crypto"),
    path("swap/", views.SwapView.as_view(), name="swap"),
    path("deposit/quote/", views.DepositQuoteView.as_view(), name="deposit-quote"),
    path("deposit/<uuid:transaction_id>/status/", views.DepositStatusView.as_view(), name="deposit-status"),
    path("<uuid:transaction_id>/status/", views.DepositStatusView.as_view(), name="transaction-status"),
    path("deposit/c2b-instructions/", views.C2BInstructionsView.as_view(), name="c2b-instructions"),
    # 2026-05-08 · short-code deposit-intent flow · safer than the long
    # account format because it doesn't depend on SasaPay forwarding
    # the customer-entered string verbatim in BillRefNumber.
    path("deposit/intent/", views.DepositIntentView.as_view(), name="deposit-intent"),
    # 2026-05-09 · Hosted checkout · returns a SasaPay-hosted page URL
    # supporting Card / Airtel / M-Pesa / SasaPay-Wallet in one form.
    # Mobile clients open this URL via expo-web-browser and SasaPay
    # IPNs back to /api/v1/sasapay/callback/ on completion.
    path("checkout/", views.HostedCheckoutView.as_view(), name="hosted-checkout"),
    path("withdraw/", views.WithdrawView.as_view(), name="withdraw"),
    path("withdraw/<uuid:transaction_id>/status/", views.WithdrawStatusView.as_view(), name="withdraw-status"),
    path("withdraw/fee/", views.WithdrawFeeView.as_view(), name="withdraw-fee"),
    path("history/", views.TransactionHistoryView.as_view(), name="history"),
    path("activity/", views.UnifiedActivityView.as_view(), name="activity"),
    path("transactions/export/", views.TransactionExportView.as_view(), name="transaction-export"),
    path("<uuid:transaction_id>/receipt/", views.TransactionReceiptView.as_view(), name="transaction-receipt"),
    # B18: authenticated endpoint that returns a signed one-shot URL for the receipt.
    path("<uuid:transaction_id>/receipt/sign/", views.TransactionReceiptSignView.as_view(), name="transaction-receipt-sign"),
    path("circuit-breaker/", views.CircuitBreakerStatusView.as_view(), name="circuit-breaker"),
    # Saved Paybills
    path("saved-paybills/", views.SavedPaybillListCreateView.as_view(), name="saved-paybills"),
    path("saved-paybills/<uuid:pk>/", views.SavedPaybillDeleteView.as_view(), name="saved-paybill-delete"),
    # ── Admin: ReconciliationCase queue (staff only) ──────────────────
    # 2026-05-08 · turns the ReconciliationCase rows into an operable
    # queue for ops. Mirrors the Django admin actions so an in-app
    # surface can drive the same audit-trail logic.
    path(
        "admin/reconciliation/",
        admin_views.AdminReconCaseListView.as_view(),
        name="admin-recon-list",
    ),
    path(
        "admin/reconciliation/stats/",
        admin_views.AdminReconCaseStatsView.as_view(),
        name="admin-recon-stats",
    ),
    path(
        "admin/reconciliation/<uuid:case_id>/",
        admin_views.AdminReconCaseDetailView.as_view(),
        name="admin-recon-detail",
    ),
    path(
        "admin/reconciliation/<uuid:case_id>/assign/",
        admin_views.AdminReconCaseAssignView.as_view(),
        name="admin-recon-assign",
    ),
    path(
        "admin/reconciliation/<uuid:case_id>/resolve/",
        admin_views.AdminReconCaseResolveView.as_view(),
        name="admin-recon-resolve",
    ),
    path(
        "admin/reconciliation/<uuid:case_id>/escalate/",
        admin_views.AdminReconCaseEscalateView.as_view(),
        name="admin-recon-escalate",
    ),
    path(
        "admin/reconciliation/<uuid:case_id>/reopen/",
        admin_views.AdminReconCaseReopenView.as_view(),
        name="admin-recon-reopen",
    ),
    # ── Admin: platform limits + float guard (2026-05-08) ─────────────
    # Admin-settable caps on outgoing payment volume. Layered above
    # the float-driven circuit breaker · stops a hot-wallet compromise
    # from draining treasury even when the float reading still looks
    # healthy. GET returns current caps + usage + circuit breaker.
    # PATCH updates caps with full audit trail.
    path(
        "admin/limits/",
        admin_views.AdminPlatformLimitsView.as_view(),
        name="admin-platform-limits",
    ),
    # ── 2026-05-10 · SasaPay management endpoints (full docs audit) ───
    # Admin (is_staff): live float, manual rebalance, sync verify
    path(
        "admin/sasapay/balance/",
        sasapay_admin_views.SasaPayBalanceView.as_view(),
        name="admin-sasapay-balance",
    ),
    path(
        "admin/sasapay/rebalance/",
        sasapay_admin_views.SasaPayRebalanceView.as_view(),
        name="admin-sasapay-rebalance",
    ),
    path(
        "admin/sasapay/verify/<str:trans_code>/",
        sasapay_admin_views.SasaPayVerifyTransactionView.as_view(),
        name="admin-sasapay-verify",
    ),
    # Mobile-callable · pre-flight UX
    path(
        "utilities/bill-query/",
        sasapay_admin_views.BillQueryView.as_view(),
        name="bill-query",
    ),
    path(
        "account/validate/",
        sasapay_admin_views.AccountValidateView.as_view(),
        name="account-validate",
    ),
    path(
        "banks-live/",
        sasapay_admin_views.BanksListView.as_view(),
        name="banks-live",
    ),
    # ── 2026-05-10 · Cpay-to-Cpay internal transfer (no SasaPay hop) ──
    path(
        "send-to-cpay/",
        internal_transfer.SendToCpayView.as_view(),
        name="send-to-cpay",
    ),
]
