"""IntaSend Payment API client.

Replaces the Kopo Kopo K2-Connect rail (2026-05-08) · IntaSend is the
secondary aggregator alongside CBK-licensed SasaPay (primary) while we
chase the Daraja Letter-of-No-Objection from CBK (tertiary).

Order of preference at the saga layer:
  1. SasaPay   (CBK-licensed PSP, primary)
  2. IntaSend  (this client · approved 2026-05-08)
  3. Daraja    (direct M-Pesa, blocked on CBK LNO)

Auth model: a single static `Authorization: Bearer ISSecretKey_…`
header. No OAuth bearer-token round-trip (contrast SasaPay's
client-credentials grant). Keys come from `INTASEND_API_SECRET` env var; the publishable
key (`INTASEND_PUBLISHABLE_KEY`) is for frontend SDK use and unused
server-side.

API surface implemented · matches the SasaPayClient interface so the
provider adapter routes transparently:
  - stk_push           (C2B · /api/v1/payment/mpesa-stk-push/)
  - pay_paybill        (B2B paybill via send-money/initiate, MPESA-B2B)
  - pay_till           (B2B till    via send-money/initiate, MPESA-B2B)
  - send_to_mobile     (B2C         via send-money/initiate, MPESA-B2C)
  - query_transaction  (status      via /api/v1/payment/status/)
  - reversal           (NOT SUPPORTED · IntaSend has no reversal API ·
                        the saga opens REVERSAL_NOT_SUPPORTED case
                        identical to the SasaPay path)

Sources:
  https://developers.intasend.com/docs/authentication
  https://developers.intasend.com/reference (API index)
  https://github.com/IntaSend/intasend-python (transfer.py provider names)
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class IntaSendError(Exception):
    """IntaSend API error."""


# ── Phone normalisation ────────────────────────────────────────────────
#
# IntaSend accepts E.164 (+254712...) but its B2C send-money is happiest
# with the bare 254712… form. Normalise once at the boundary so callers
# can pass any of the four common Kenyan formats.

def _normalise_phone(raw: str) -> str:
    """Convert any sane Kenyan-mobile representation to +254XXXXXXXXX.

    Raises ValueError on garbage so a bad number can't silently 400 the
    upstream API call.
    """
    s = (raw or "").strip().replace(" ", "").replace("-", "")
    if not s:
        raise ValueError("Empty phone number")

    if s.startswith("+254") and len(s) == 13 and s[4:].isdigit():
        return s
    if s.startswith("254") and len(s) == 12 and s.isdigit():
        return "+" + s
    if s.startswith("0") and len(s) == 10 and s.isdigit():
        return "+254" + s[1:]
    if s.startswith("7") and len(s) == 9 and s.isdigit():
        return "+254" + s
    if s.startswith("1") and len(s) == 9 and s.isdigit():
        # Safaricom's 01-prefix range (introduced 2022).
        return "+254" + s
    raise ValueError(f"Unrecognised Kenyan phone format: {raw!r}")


def _bare_254(phone_e164: str) -> str:
    """Convert +254XXX… → 254XXX… for IntaSend's preferred shape."""
    return phone_e164.lstrip("+")


# ── Client ─────────────────────────────────────────────────────────────


class IntaSendClient:
    SANDBOX_BASE = "https://sandbox.intasend.com"
    PRODUCTION_BASE = "https://payment.intasend.com"

    def __init__(self):
        self.environment = getattr(settings, "INTASEND_ENVIRONMENT", "sandbox")
        self.base_url = (
            self.PRODUCTION_BASE
            if self.environment == "production"
            else self.SANDBOX_BASE
        )
        self.api_secret = getattr(settings, "INTASEND_API_SECRET", "")
        self.publishable_key = getattr(settings, "INTASEND_PUBLISHABLE_KEY", "")
        self.callback_url = getattr(settings, "INTASEND_CALLBACK_URL", "")
        self.wallet_id = getattr(settings, "INTASEND_WALLET_ID", "") or None

    # ── Internals ──────────────────────────────────────────────────────

    def _headers(self) -> dict:
        if not self.api_secret:
            raise IntaSendError(
                "INTASEND_API_SECRET is not configured. Set it in the env "
                "before invoking the IntaSend rail."
            )
        return {
            "Authorization": f"Bearer {self.api_secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _post(self, path: str, payload: dict, *, timeout: int = 30) -> dict:
        url = f"{self.base_url}{path}"
        try:
            resp = requests.post(
                url, json=payload, headers=self._headers(), timeout=timeout,
            )
        except requests.exceptions.RequestException as e:
            raise IntaSendError(f"IntaSend network error on {path}: {e}") from e

        # Decode body even on non-2xx · IntaSend returns a JSON error body.
        try:
            data = resp.json()
        except ValueError:
            data = {"raw": resp.text[:500]}

        if not resp.ok:
            logger.warning(
                "intasend.api_error",
                extra={"path": path, "status": resp.status_code, "body": data},
            )
            detail = data.get("detail") or data.get("error") or resp.text[:200]
            raise IntaSendError(
                f"IntaSend {resp.status_code} on {path}: {detail}"
            )
        return data

    # ── C2B · STK Push (collect) ────────────────────────────────────────

    def stk_push(
        self,
        phone: str,
        amount: float,
        account_ref: str = "",
        description: str = "",
        email: Optional[str] = None,
    ) -> dict:
        """Initiate an M-Pesa STK Push to the customer's phone.

        IntaSend wants the bare 254XXX… form and treats `narrative`
        like Daraja's `AccountReference` (visible on the M-Pesa SMS).
        """
        normalised = _normalise_phone(phone)
        api_ref = str(uuid.uuid4())

        payload = {
            "phone_number": _bare_254(normalised),
            "amount": int(round(float(amount))),
            "currency": "KES",
            "api_ref": api_ref,
            "narrative": (description or account_ref or "Payment")[:64],
        }
        if email:
            payload["email"] = email

        data = self._post("/api/v1/payment/mpesa-stk-push/", payload)
        # IntaSend response carries `invoice` with id + state, plus a
        # top-level `tracking_id`. Saga stores tracking_id so the
        # callback can resolve back to the originating Transaction.
        invoice = data.get("invoice") or {}
        return {
            "InvoiceID": invoice.get("invoice_id") or data.get("id", ""),
            "TrackingID": data.get("tracking_id") or invoice.get("tracking_id", ""),
            "ResponseCode": "0",
            "ResponseDescription": invoice.get("state", "PENDING"),
            "CustomerMessage": "Check your phone for the M-Pesa prompt.",
            "raw": data,
        }

    # ── B2B · Pay paybill / till ───────────────────────────────────────
    #
    # IntaSend's transfer module collapses both into the MPESA-B2B
    # provider on /send-money/initiate/. Per the SDK convention the
    # paybill case adds a separate account_number; till payments just
    # carry the till in the `account` field. This shape is consistent
    # with how M-Pesa B2B works under the hood.

    def pay_paybill(
        self,
        paybill: str,
        account: str,
        amount: float,
        reference: Optional[str] = None,
        narrative: str = "Bill payment",
    ) -> dict:
        """B2B Paybill · pays an M-Pesa paybill on behalf of the merchant
        wallet.

        2026-05-16 · payload corrected per IntaSend's official docs at
        https://developers.intasend.com/docs/m-pesa-b2b:

          - `account_type` MUST be the literal string "PayBill"
            (case-sensitive · "PayBill", NOT "paybill"/"Paybill").
          - `account_reference` is the field name for the bill account
            number we were sending as `account_number`. IntaSend
            silently dropped our `account_number` field and the M-Pesa
            B2B leg then failed with TF103 "Initiation failed" because
            the bill couldn't be matched without an account reference.

        Previously every paybill we sent through IntaSend failed with
        TF103. The wallet's `can_disburse: false` flag was a red
        herring · we were actually sending a malformed payload that
        IntaSend's M-Pesa B2B handler couldn't process. Confirmed via
        the API docs the user pasted from
        https://developers.intasend.com (the official IntaSend
        developer hub) which document the exact field shape.
        """
        return self._send_money(
            provider="MPESA-B2B",
            transactions=[{
                "name": (reference or "Cpay")[:32],
                "account": str(paybill),
                "account_type": "PayBill",
                "account_reference": str(account),
                "amount": int(round(float(amount))),
                "narrative": narrative[:64],
            }],
            reference=reference,
        )

    def pay_till(
        self,
        till: str,
        amount: float,
        reference: Optional[str] = None,
        narrative: str = "BuyGoods",
    ) -> dict:
        """B2B Till · pays an M-Pesa BuyGoods till.

        2026-05-16 · `account_type: "TillNumber"` (case-sensitive · NOT
        "Till" / "till" / "BuyGoods") added per IntaSend's docs. Same
        root-cause family as pay_paybill above · the missing
        account_type field caused IntaSend to reject every till send
        with TF103.
        """
        return self._send_money(
            provider="MPESA-B2B",
            transactions=[{
                "name": (reference or "Cpay")[:32],
                "account": str(till),
                "account_type": "TillNumber",
                "amount": int(round(float(amount))),
                "narrative": narrative[:64],
            }],
            reference=reference,
        )

    def send_to_mobile(
        self,
        phone: str,
        amount: float,
        reason: str = "Payment",
        reference: Optional[str] = None,
    ) -> dict:
        """B2C · sends KES from our IntaSend wallet to a mobile number.

        Used by withdrawals and the saga's b2c clawback path when a
        late-callback opens a recoverable double-settlement case.
        """
        normalised = _normalise_phone(phone)
        return self._send_money(
            provider="MPESA-B2C",
            transactions=[{
                "name": (reference or "Customer")[:32],
                "account": _bare_254(normalised),
                "amount": int(round(float(amount))),
                "narrative": reason[:64],
            }],
            reference=reference,
        )

    def _send_money(
        self,
        *,
        provider: str,
        transactions: list,
        reference: Optional[str],
    ) -> dict:
        """Initiate-and-approve the send-money flow as a single logical
        operation. IntaSend supports a two-step `initiate → approve` if
        `requires_approval=YES`; we set NO so the saga doesn't have to
        track an extra state machine. The wallet selection is implicit
        when `wallet_id` is empty (uses the merchant's default wallet)."""
        api_ref = reference or str(uuid.uuid4())
        payload = {
            "provider": provider,
            "currency": "KES",
            "transactions": transactions,
            "requires_approval": "NO",
            "device_id": "cpay-saga",
            "api_ref": api_ref,
        }
        if self.callback_url:
            payload["callback_url"] = self.callback_url
        if self.wallet_id:
            payload["wallet_id"] = self.wallet_id

        data = self._post("/api/v1/send-money/initiate/", payload)
        # 2026-05-16 · pull tracking_id from the per-transaction entry FIRST.
        # IntaSend's send-money response shape is:
        #   { "file_id": "<batch>", "transactions": [{ "tracking_id": "...", ... }] }
        # The top-level `tracking_id` field does NOT exist on send-money
        # responses; the previous code's order put it first which always
        # fell through to file_id. Webhooks deliver the PER-TRANSACTION
        # tracking_id, so we must persist THAT for the callback path's
        # `_find_pending_tx` lookup to match. We also keep file_id as a
        # secondary identifier for the status query (which queries by
        # file_id for send-money batches).
        first_tx = (data.get("transactions") or [{}])[0] or {}
        per_tx_tracking_id = first_tx.get("tracking_id") or ""
        per_tx_status = (first_tx.get("status") or "").strip()
        per_tx_code = (first_tx.get("status_code") or "").strip()
        file_id = data.get("file_id") or ""
        wallet = data.get("wallet") or {}

        # 2026-05-16 · synchronous fail-fast on TF101/102/103 in the
        # initiate response.
        #
        # The initiate POST returns 201 (HTTP-successful) even when the
        # disbursement itself can't proceed. The TRUE failure signal is
        # `transactions[0].status_code` of TF101 / TF102 / TF103 or
        # the literal "Initiation failed" status string. When this
        # appears synchronously, we know the M-Pesa B2B leg won't run
        # (bad paybill, wrong account_reference, account not enabled
        # for B2B, etc) so we raise immediately rather than parking
        # the tx in CONFIRMING for 10 minutes.
        #
        # 2026-05-16 update · REMOVED the `wallet.can_disburse: false`
        # check. Empirically this flag returns `false` even on
        # transactions that successfully complete (verified via live
        # till disburse 5629642 · M-Pesa receipt UEGUEAPMIV, status
        # TS100). `can_disburse` is not a hard disbursement gate; the
        # earlier reading of it was wrong. The TF103 signature alone
        # is the correct failure detection.
        FAIL_STATES = {"INITIATION FAILED", "INITIATION_FAILED", "FAILED",
                       "REJECTED"}
        FAIL_CODES = {"TF101", "TF102", "TF103"}
        if (
            per_tx_status.upper() in FAIL_STATES
            or per_tx_code.upper() in FAIL_CODES
        ):
            raise IntaSendError(
                f"IntaSend initiate failed sync · "
                f"status={per_tx_status!r} code={per_tx_code!r}"
            )

        # Final fallback to the legacy field if the new shape isn't present
        # (defensive · IntaSend has bumped shapes before).
        tracking_id = per_tx_tracking_id or file_id or data.get("tracking_id", "")
        # Normalise to the provider-adapter contract: the saga reads
        # ConversationID + ResponseCode and persists ConversationID on
        # the Transaction so the callback path can re-resolve the row.
        # `intasend_file_id` is exposed in the raw dict so the saga can
        # stash it alongside the tracking_id for status-query use.
        return {
            "ConversationID": tracking_id,
            "OriginatorConversationID": api_ref,
            "ResponseCode": "0",
            "ResponseDescription": data.get("state", "QUEUED"),
            "intasend_file_id": file_id,
            "intasend_tracking_id": per_tx_tracking_id,
            "raw": data,
        }

    # ── Status query ─────────────────────────────────────────────────

    def query_transaction(
        self,
        invoice_id: Optional[str] = None,
        tracking_id: Optional[str] = None,
        *,
        kind: str = "auto",
    ) -> dict:
        """Poll a payment by invoice or tracking id.

        2026-05-16 · IntaSend uses TWO separate status endpoints:

          - `/api/v1/payment/status/`      · COLLECTION (C2B) only.
                                             Accepts {invoice_id, checkout_id}.
          - `/api/v1/send-money/status/`   · SEND-MONEY (B2B/B2C/PESALINK).
                                             Accepts {file_id, tracking_id}.

        Previously we hit the collection endpoint for everything · the
        send-money status query always returned `{"detail": "Invoice with
        specified id does not exist"}` even when the tracking_id was a
        valid in-flight send-money payment. That's why tx 1415369d and
        af4b282b both showed "404 from IntaSend" → spurious failure.

        `kind` controls the endpoint:
          - "collection" / "c2b"  · forces /payment/status/
          - "send_money" / "b2b" / "b2c"  · forces /send-money/status/
          - "auto" (default) · best-effort: try send-money first if we
            were passed a tracking_id (the param send-money status uses)
            and fall back to collection. Send-money is the riskier case
            for our beta cohort (every paybill goes through it).
        """
        if not (invoice_id or tracking_id):
            raise IntaSendError(
                "query_transaction requires invoice_id or tracking_id",
            )

        kind = (kind or "auto").lower()
        send_money_aliases = {"send_money", "send-money", "b2b", "b2c", "payout"}
        collection_aliases = {"collection", "c2b", "stk"}

        def _hit_send_money() -> dict:
            # 2026-05-17 · CRITICAL · `/api/v1/send-money/status/`
            # REQUIRES `tracking_id` in the payload. Passing only
            # `file_id` returns:
            #   400 {"type":"client_error","errors":[{"code":
            #     "invalid_request_data","detail":"tracking_id is required"}]}
            # Production tx C87DC5F2 lost 60 KES because the cron
            # called _hit_send_money with file_id alone, IntaSendError
            # raised, the saga waited 10 min and compensated · even
            # though IntaSend had already disbursed via M-Pesa B2B.
            #
            # If the caller only has a file_id (legacy txs that didn't
            # capture the per-tx tracking_id at initiate time), we
            # cannot use the send-money status endpoint at all · raise
            # a typed error so query_transaction falls back to the
            # collection endpoint or surfaces the limitation to the
            # cron.
            if not tracking_id:
                raise IntaSendError(
                    "send-money status endpoint requires tracking_id "
                    "(file_id alone is not accepted by IntaSend). "
                    "Caller must persist per-tx tracking_id at initiate "
                    "time and pass it here."
                )
            payload = {"tracking_id": tracking_id}
            if invoice_id:
                # Belt-and-braces · include file_id alongside tracking_id
                # when caller has both. IntaSend doesn't require it but
                # accepts it for disambiguation on rare batch ID
                # collisions.
                payload["file_id"] = invoice_id
            return self._post("/api/v1/send-money/status/", payload)

        def _hit_collection() -> dict:
            payload = {}
            if invoice_id:
                payload["invoice_id"] = invoice_id
            if tracking_id:
                payload["tracking_id"] = tracking_id
            return self._post("/api/v1/payment/status/", payload)

        if kind in send_money_aliases:
            return _hit_send_money()
        if kind in collection_aliases:
            return _hit_collection()

        # Auto · try send-money first (most B2B/B2C beta traffic), fall
        # back to collection on 404. The IntaSendError carries the body
        # so we can sniff for the "does not exist" 404 sentinel.
        try:
            return _hit_send_money()
        except IntaSendError as sm_err:
            err_text = str(sm_err).lower()
            if "does not exist" in err_text or "404" in err_text:
                # Maybe it's actually a collection · second attempt.
                return _hit_collection()
            raise

    # ── Pre-flight account-name lookup ───────────────────────────────

    def lookup_paybill(self, paybill: str, account: str = "") -> dict:
        """Validate a paybill + (optional) account number BEFORE
        initiating a B2B disbursement.

        2026-05-17 · N5 fix · audit found we never pre-flight a
        paybill / till. A user typing the wrong number hits the B2B
        path, IntaSend charges us ~KES 10 for the failed attempt,
        and we eat the loss while they wait for the M-Pesa
        reversal. Calling this BEFORE `pay_paybill` returns the
        merchant's M-Pesa-registered name (so the mobile PIN modal
        can show "Paying KENYA POWER PREPAID" not "Paying 888880").

        Returns a dict with at least:
            {"account_name": "KENYA POWER PREPAID", "valid": True}
        Raises `IntaSendError` on a 4xx · caller should treat that
        as "paybill invalid · user mistyped".

        Cached 300s in Redis · the same paybill/account is queried
        on every payment of the same biller, and IntaSend rate-limits
        the validation endpoint at ~30 req/min.
        """
        from django.core.cache import cache as _cache  # noqa: PLC0415
        cache_key = f"intasend:paybill_lookup:{paybill}:{account or 'noacc'}"
        cached = _cache.get(cache_key)
        if cached is not None:
            return cached
        payload = {"account_number": str(paybill)}
        if account:
            payload["account_reference"] = str(account)
        # The validation endpoint path · IntaSend docs name it
        # `/api/v1/send-money/validate/` (synonyms: `account-validate/`
        # in some tier docs). Try the canonical one first.
        try:
            resp = self._post("/api/v1/send-money/validate/", payload)
        except IntaSendError as e:
            if "404" in str(e) or "not found" in str(e).lower():
                resp = self._post("/api/v1/send-money/account-validate/", payload)
            else:
                raise
        # Normalise the shape · IntaSend returns
        #   {"account_name": "...", "is_valid": true, "provider": "MPESA-B2B"}
        # or in some legacy tiers {"name": "...", "valid": true}.
        out = {
            "account_name": (
                resp.get("account_name")
                or resp.get("name")
                or ""
            ),
            "valid": bool(
                resp.get("is_valid", resp.get("valid", True))
            ),
            "provider": resp.get("provider") or "MPESA-B2B",
            "raw": resp,
        }
        _cache.set(cache_key, out, timeout=300)
        return out

    def lookup_till(self, till: str) -> dict:
        """Same shape as `lookup_paybill` but for a till number.

        Returns `{"account_name": "...", "valid": ..., ...}`.
        """
        return self.lookup_paybill(paybill=till)

    # ── Reversal · NOT SUPPORTED ─────────────────────────────────────

    def reversal(self, transaction_id: str, amount: int = 0, remarks: str = "") -> dict:
        """IntaSend has no reversal API on the public surface. The saga
        opens a REVERSAL_NOT_SUPPORTED ReconciliationCase identical to
        the SasaPay path · ops resolves manually via IntaSend support
        + the user's M-Pesa receipt."""
        raise NotImplementedError(
            f"IntaSend does not support automated reversals. "
            f"Transaction {transaction_id} requires a manual reconciliation."
        )
