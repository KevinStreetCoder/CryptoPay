# Beta-readiness audit · 2026-05-08

## TL;DR

Code is ready. Backend is at `dd43231` on `origin/main` with all CI
green (478/478 tests). The blockers between today and a small,
disclosed closed-beta are **all operator actions on external
services** · not engineering. Total operator time to cleared:
**~2 hours of clicking + waiting**, then a smoke test.

| Gate | State | Owner | Time |
|---|---|---|---|
| GCP KMS billing | 🔴 disabled | you · 5 min on Google Cloud Console | NOW · blocks every backend deploy |
| SasaPay prod env vars | 🟡 not set on VPS | you · paste `SASAPAY_CLIENT_ID/SECRET/WEBHOOK_SECRET` into `.env.production` | 5 min after dashboard pull |
| `PAYMENT_PROVIDER=sasapay` flip | 🟡 still `daraja` | you · one env line + container restart | 1 min after env vars |
| Backend redeploy | 🔴 blocked on KMS | me · `bash scripts/deploy-production.sh` | 5 min after KMS green |
| Smile Identity sandbox keys | 🔴 no account | you · sign up at usesmileid.com | 30 min |
| Sentry DSN | 🟡 env slot empty | you · sign up + paste DSN | 10 min |
| UptimeRobot on `/health/` | 🔴 not configured | you · free tier, 5 ping interval | 5 min |
| Privacy / Terms lawyer review | 🟡 draft live | you · email AMG / Bowmans / KDS | async, beta can ship without |
| Cold wallet seeding | 🔴 env slots empty | you · generate addresses offline, set env vars | 30 min (air-gap setup is the slow bit) |
| Google Play org account | ✅ verified 2026-05-08 | done · D-U-N-S 850394732 | done |
| BRS Cert of Registration | 🟡 in flight | you · check eCitizen daily | async |

## What's shipped this weekend (engineering side)

- **Reconciliation case queue** is operable · Django admin + DRF API at `/api/v1/payments/admin/reconciliation/{,stats/,<uuid>/,<uuid>/{assign,resolve,escalate,reopen}/}`
- **IntaSend** rail replaces Kopo Kopo · approved 2026-05-08 · sits as fallback if SasaPay errors
- **SasaPay C2B deposit flow** · paybill 756756 + accounts in form `1334777-<CRYPTO>-<phone>`. The IPN handler auto-converts KES → crypto at the live rate (1.5% spread + KES 10 flat + 10% excise) and credits the right wallet. KES fallback is safe when the suffix is missing.
- **Platform limits** · admin-settable per-tx + hour + day + count caps + kill switch. `/api/v1/payments/admin/limits/` GET/PATCH for the admin surface, audit trail on every change.
- **Cold-wallet env wiring** · `init_custody_tiers --check` reports which `COLD_WALLET_*` env vars are set, which addresses are seeded in DB, which tiers still need addresses.
- **KMS test boundary fixed** · the 13 GCP-billing-blocked tests are now mocked at the unit-test boundary in `conftest.py`. CI is independent of GCP billing state.
- **SasaPay sandbox smoke command** · `python manage.py sasapay_sandbox_smoke` drives visible OAuth traffic so the SasaPay review team sees activity.
- **Production-approval email to SasaPay** · `docs/letters/sasapay-production-approval-email.md` · plain-English ops update, three concrete asks. Send it.

## Hard-blocker chain to first live KES → USDT deposit

1. **You · re-enable GCP KMS billing**
   `https://console.cloud.google.com/billing/projects` → project `cpay-490223` → attach billing account.

2. **You · grab SasaPay production credentials from the dashboard**
   Click-through: Production Applications → Cpay Technologies → Reveal Client ID + Client Secret + Webhook Secret.

3. **You · ssh + paste env**
   ```bash
   ssh root@173.249.4.109
   nano /home/deploy/cpay/deploy/.env.production
   # Set:
   #   SASAPAY_CLIENT_ID=<from dashboard>
   #   SASAPAY_CLIENT_SECRET=<from dashboard>
   #   SASAPAY_MERCHANT_CODE=1334777
   #   SASAPAY_ENVIRONMENT=production
   #   SASAPAY_WEBHOOK_SECRET=<from dashboard>
   #   SASAPAY_C2B_PAYBILL=756756
   #   PAYMENT_PROVIDER=sasapay
   chmod 600 /home/deploy/cpay/deploy/.env.production
   ```

4. **You + me · backend redeploy**
   ```bash
   cd /home/deploy/cpay && git pull origin main
   bash scripts/deploy-production.sh
   ```
   Pre-deploy gate: I'll re-probe `manage.py kms_health` · refuses if billing still off.

5. **You · live KES 100 smoke test**
   M-Pesa → Lipa Na M-Pesa → Pay Bill → 756756 → account `1334777-USDT-<your-phone>` → KES 100.
   Within 30 seconds: USDT credited on the app, transaction shows in history with state COMPLETED.

## Beta-launch (closed, ~100 invites) checklist

| # | Action | Done? |
|---|---|---|
| 1 | Hard-blocker chain above | 🔴 |
| 2 | Sign up Smile Identity sandbox · paste sandbox keys into env · run `python manage.py kyc_smoke_test +254712...` | 🔴 |
| 3 | Sign up Sentry · paste DSN into `SENTRY_DSN` env, restart web | 🔴 |
| 4 | UptimeRobot · 5-min ping on `https://cpay.co.ke/health/` · alert email | 🔴 |
| 5 | Cold wallet addresses · generate on offline laptop / hardware wallet · set `COLD_WALLET_TRON/ETH/POLYGON/BTC/SOL` env · run `manage.py init_custody_tiers` then `--check` to verify | 🔴 |
| 6 | Send the SasaPay production-approval email (`docs/letters/sasapay-production-approval-email.md`) | 🔴 |
| 7 | Send the CBK Letter-of-No-Objection request (`docs/letters/cbk-letter-of-no-objection-request.md`) when ready · NOT a beta gate | 🟡 |
| 8 | Beta invite list · 50-100 names + phone numbers, opted in to a "pre-licensing" disclosure | 🔴 |
| 9 | Update Terms of Service to include the beta-program disclosure clause | 🔴 |
| 10 | APK uploaded to `/var/www/cpay-downloads/cryptopay.apk` (in flight via WSL build PID 17056) | 🟡 |

## Post-beta queue (first 30 days)

In rough priority order:

1. **Yellow Card API** for treasury auto-rebalance · `paymentsapi@yellowcard.io`, B2B onboarding. Currently float top-up is manual.
2. **Stop-loss orders** · BALANCE-LOCK research green-lit this 2-3 engineer weeks. Real product feature, zero capital risk.
3. **B2B Developer API** · revenue moat. Three endpoints (paybill, invoice, payout) with API keys + tier pricing.
4. **iOS TestFlight** · $99/year Apple Developer + EAS production iOS build.
5. **Push-2FA real-device test** · two real phones, end-to-end approval flow.
6. **Hot/warm/cold custody UI for ops** · the on-chain sweep is automated, but ops needs a live "what's in each tier today" dashboard.
7. **WalletConnect MetaMask / Trust / Phantom** · external-wallet pay-from-your-own-wallet flow.
8. **In-app admin surface for the recon queue** (mobile screen) · the DRF API is live; React Native screen would let ops work cases from the phone.

## Risks I'm tracking

- **GCP KMS billing flap** · third hit this session. New memory rule landed (`reference_gcp_kms_billing_risk.md`). Pre-deploy probe is now mandatory.
- **VASP Act capital floor** (KES 50M) · still unresolved · post-beta. Closed beta with disclosure is the legal path forward per the VASP Act draft sandbox provision.
- **SasaPay being the only rail at launch** · IntaSend is wired but not flipped. If SasaPay throttles or has an outage the saga fails open. Operator can flip `PAYMENT_PROVIDER=intasend` in env without code change once IntaSend webhook secret is set.
- **Cold wallet still empty** · hot float currently has no automated safety valve to sweep excess. P9 from PRODUCTION-CHECKLIST.

## Recommended weekend-after-this-one focus

If GCP billing + SasaPay env vars + the 4 sign-ups (Smile, Sentry, UptimeRobot, cold-wallet seeding) clear next week:

1. **Live KES 100 → KES 1K → KES 10K → KES 100K → KES 1M ramp**, one transaction at each level, watch logs for surprises.
2. **Beta invite first batch · 5 names you trust personally** (you, friends, one ops partner) before the public 100.
3. **Yellow Card paperwork submitted** · 6-8 week onboarding window means you want it started early.
