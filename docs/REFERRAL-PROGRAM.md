# CryptoPay Referral Program — Implementation Spec

Status: **Specification approved. Pending implementation.**
Owner: Kevin. Last updated: 2026-04-19.

## 1-Page Summary

**What.** A phone-native, code-based referral program for CryptoPay's Kenyan user base. Every user gets a short unique code (e.g. `KEV8F2`) and a branded share URL (`cpay.co.ke/r/KEV8F2`). Invites are tracked end-to-end from share → tap → signup → first qualifying M-Pesa payment. Both referrer and referee earn KES fee credits (not free cash) on qualification, payable as reductions on future transaction fees.

**Why.** CryptoPay charges a 1.5% margin on crypto↔KES conversions plus KES 10 flat. K-shaped CAC is the #1 blocker to scale; WhatsApp word-of-mouth is the cheapest acquisition channel in Kenya (higher trust than paid SMS/FB). A fee-credit reward (not cash) keeps it margin-safe, avoids AML overhead of free cashouts, and compounds retention.

**User flow (5 bullets).**
1. User opens **Settings → Invite Friends**, sees their code, taps "Share on WhatsApp", and a pre-filled Swahili/English message with `cpay.co.ke/r/KEV8F2` fires off.
2. Friend taps the link, lands on a branded public page ("Kevin gave you KES 50 off your first payment"), clicks "Claim & Sign Up" → deep-link opens the app (or web) with the code stored locally + in a signed cookie.
3. Friend registers normally; backend binds the `Referral` row at signup and starts a 60-day attribution window.
4. When friend makes their first completed M-Pesa payment ≥ KES 500, a Celery task mints two `RewardLedger` entries (KES 50 each, `status=HELD`).
5. After a 7-day clawback window, rewards flip to `AVAILABLE` and both users get email + SMS + push. The credit is auto-applied to the next transaction's fee line.

## Reward Economics

- **Referrer bonus:** KES 50 fee credit on referee's first qualifying payment.
- **Referee bonus:** KES 50 fee credit, auto-applied to their first payment's fee line.
- **Qualifying threshold:** completed M-Pesa payment of ≥ **KES 500**. At 1.5% margin + KES 10, a KES 500 tx yields ~KES 17.50 gross margin; KES 100 total payout = 5.7 tx to break even — accretive at Kenyan ARPU.
- **Credit expiry:** 180 days from `available`.
- **Attribution window:** 60 days from signup to first qualifying tx.
- **Clawback window:** 7 days `held` before `available`.
- **Per-referrer cap:** **20 rewarded referrals per calendar month**, **100 lifetime**.
- **Per-device cap:** 1 signup per device fingerprint.
- **Min referrer age:** account must be ≥ 24h old and have ≥ 1 completed transaction.

## Implementation Plan — 8 Stages

### Stage 1 — Scaffold the `referrals` Django app

New `apps.referrals` registered in `INSTALLED_APPS`, mirroring the shape of `apps.notifications`.

Files to add:
- `backend/apps/referrals/{apps,admin,models,serializers,views,urls,tasks,services,signals,constants,fraud,throttles}.py`
- `backend/apps/referrals/migrations/__init__.py`

Files to modify:
- `backend/config/settings/base.py` — add to `LOCAL_APPS`.
- `backend/config/urls.py` — add `path("api/v1/referrals/", include("apps.referrals.urls"))`.

### Stage 2 — Data model + migrations

Four tables:

- **`ReferralCode`** — OneToOne with `accounts.User`. Fields: `user`, `code` (6–8 char alphanumeric, exclude `0OI1L`), `is_active`, `total_invites_sent`. Unique on `UPPER(code)`.
- **`Referral`** — one per (referrer, referee) pair. `referee` OneToOne (a user can only be referred once, ever). Fields: UUID pk, `referrer`, `referee`, `code_used` (denormalized), `status` ∈ {pending, signed_up, qualified, rewarded, clawed_back, rejected_fraud}, `signup_ip`, `signup_device_id`, `signup_country`, `attributed_at`, `qualified_at`, `rewarded_at`, `qualifying_transaction`, `attribution_window_ends_at`, `fraud_reason`.
- **`RewardLedger`** — immutable append-only ledger. Fields: `user`, `amount_kes`, `kind` ∈ {referrer_bonus, referee_bonus, admin_grant, clawback, consumed}, `referral` (null), `status` ∈ {held, available, consumed, clawed_back, expired}, `held_until`, `expires_at`, `consumed_by_transaction`, `idempotency_key` (unique). Balance = `SUM(amount_kes) WHERE status IN ('available','held')`.
- **`ReferralEvent`** — audit log. `event_type` ∈ {code_viewed, code_shared, link_clicked, signup_attributed, qualified, rewarded, clawed_back, fraud_flagged}.

Data migration `0002_backfill_codes.py` creates a `ReferralCode` for every existing `User`.

### Stage 3 — Reward economics + configuration

`backend/config/settings/base.py` gets a `REFERRAL_PROGRAM = {...}` block with every tunable — including `ENABLED` master switch.

`backend/apps/referrals/constants.py` exposes typed getters: `get_referrer_bonus_kes()`, `is_qualifying_tx(tx)`. Single source of truth for tasks, views, admin.

### Stage 4 — Attribution plumbing

**Signup attribution** — `RegisterSerializer` gains optional `referral_code`. On user create, write a `Referral(status=signed_up)`, capture IP + device_id + country, set 60-day attribution window.

**First-payment qualifier** — `apps.payments.saga::PaymentSaga` completion hook calls `referrals.services.check_qualification(tx)`. If referee, tx qualifying, within window → mark `qualified_at` + enqueue `grant_referral_rewards`.

**Reward granting** — `apps.referrals.tasks.grant_referral_rewards` inside `transaction.atomic()` + `select_for_update()`. Creates two `RewardLedger(status=held)` rows with 7-day `held_until`. Schedules `release_held_reward.apply_async(eta=held_until)`.

**Credit consumption** — `apps.payments.services` checks available credit before fee calc. Applies `min(credit_available, fee_amount)` as a `consumed` ledger row bound to the tx.

### Stage 5 — REST API

All JWT-authed except the public code-landing lookup:

- `GET /api/v1/referrals/me/` — my code, share URL, share messages (en + sw), totals.
- `GET /api/v1/referrals/history/` — paginated, anonymized.
- `POST /api/v1/referrals/share-event/` — client reports share happened. Fire-and-forget.
- `GET /r/{code}/public/` — public, 5-min cached. Rate-limited 30/min/IP.
- `POST /api/v1/referrals/validate/` — pre-signup code check.
- Admin: `/api/v1/referrals/admin/leaderboard/`, `/admin/{id}/clawback/`, `/admin/{id}/reject/`.

### Stage 6 — Mobile + web UI

- `mobile/app/settings/referrals.tsx` — dashboard (code card, share buttons, stats strip, referral list, empty state).
- `mobile/app/r/[code].tsx` — public landing via Expo Router. Unauth. Uses brand `EmailHeader`-matching layout.
- `mobile/app/r/_layout.tsx` — bypasses auth gate.
- `mobile/src/api/referrals.ts` — typed API client.
- `mobile/src/lib/referralShare.ts` — wraps `expo-sharing`, `expo-clipboard`, WhatsApp deep-link. EN + SW message templates.
- `mobile/src/components/ReferralCard.tsx`, `ReferralBanner.tsx`.
- Modify `mobile/app/_layout.tsx` — deep-link handler, public-route exemption for `/r/*`.
- Modify `mobile/app/auth/register.tsx`, `auth/google-complete-profile.tsx` — pick up stored code.
- Modify `mobile/app/settings/index.tsx` — "Invite Friends" menu item with `gift-outline` icon and "NEW" badge.

### Stage 7 — Anti-abuse guardrails

`backend/apps/referrals/fraud.py` with `FraudChecker.check_signup()`:

- Same `device_id` as existing user → reject.
- Same IPv4 /24 + phone prefix within 24h → hold, alert admin.
- Referee phone in blocklist → reject.
- Referrer has ≥3 clawbacks in 30 days → auto-pause.
- Referrer < 24h old → reject.
- Referee already signed up → silently ignore code.
- KYC tier 0 on referee → qualifying threshold raised to KES 1000.

### Stage 8 — Admin + docs

- `backend/apps/referrals/admin.py` — Django admin with inline events, bulk clawback, CSV export.
- `mobile/app/settings/admin-referrals.tsx` — top referrers, pending clawbacks, fraud alerts.
- Update `docs/PROGRESS.md`, `mobile/app/settings/help.tsx` ("How does Invite Friends work?"), `README.md`.

## Anti-Abuse Checklist

- [ ] Self-referral blocked (phone, email equality).
- [ ] `referee` OneToOne constraint.
- [ ] Device fingerprint dedup at signup.
- [ ] IP-subnet + phone-prefix collision alert.
- [ ] KYC-tier-0 qualifying threshold raised.
- [ ] 7-day hold before `available`.
- [ ] Referrer ≥ 24h old + ≥ 1 completed tx.
- [ ] 20/month, 100/lifetime caps.
- [ ] Credit fee-only (cannot be cashed out).
- [ ] Credit expires 180 days after `available`.
- [ ] Admin clawback writes compensating row (never deletes).
- [ ] `ReferralEvent` audit log on every state change.
- [ ] Rate-limit public endpoints (30/min/IP).
- [ ] `REFERRAL_PROGRAM.ENABLED` feature flag.
- [ ] Suspended users cannot earn or redeem.

## Risks / Open Questions

1. **VAT / excise duty on fee credits.** Do we compute excise on the pre-credit fee or net? Owner: finance. Default: excise on pre-credit fee (safer).
2. **Qualifying threshold vs conversion.** KES 500 may be too high — revisit if conversion <20%.
3. **iOS universal links.** Requires `apple-app-site-association` at `cpay.co.ke/.well-known/`. Fallback: signed cookie on landing page.
4. **WhatsApp spam perception.** No auto-send; always user-initiated. Quality default message.
5. **Swahili message quality.** Native-speaker review before launch.
6. **Interaction with promotions.** Route referral notifications via existing `UserNotification` with dedicated payload type.
7. **Fraud clawback on consumed credit.** Policy: write `admin_grant` negative balance; track loss in admin dashboard.
8. **Public landing SEO / OpenGraph.** `/r/{code}` needs server-rendered OG tags. Solution: nginx serves a small Django template at that URL (not Expo SPA).

## Critical Files for Implementation

- `backend/apps/referrals/models.py` *(new)*
- `backend/apps/referrals/tasks.py` *(new)*
- `backend/apps/payments/saga.py` *(modify — wire qualification hook)*
- `backend/apps/accounts/views.py` *(modify — attribute referral at signup)*
- `mobile/app/settings/referrals.tsx` *(new — main dashboard)*
- `mobile/app/_layout.tsx` *(modify — deep-link + public `/r/*` exemption)*
