# Daraja API onboarding · CBK Letter of No-Objection blocker

**Status**: blocker · Safaricom approval halted at Validation 66 %
**Owner**: regulatory + payments
**Effort**: weeks/months for CBK letter; days to switch to alt rail
**Updated**: 2026-04-30

## What happened

Safaricom's Falcon onboarding portal (`falcon.safaricom.co.ke`) walked
us through:

```
Identify ✅  Qualify ✅  Propose ✅  Negotiate ✅
Contract ✅  Credit Check ✅  Validation 66 % → BLOCKED
```

The reviewer's exact comment:

> Greetings, as per details on website: https://cpay.co.ke/, please
> share letter of no Objection from CBK.

Translation: the reviewer Googled `cpay.co.ke`, saw "crypto-to-M-Pesa"
copy on the landing page, and bumped the application back asking for
a Letter of No Objection from the Central Bank of Kenya before
they'll grant direct Daraja merchant access.

This is an industry-known pattern — Safaricom's compliance team
treats crypto-adjacent fintechs as out-of-scope unless CBK has
already cleared them. Until that letter exists, no direct Daraja
shortcode + no production STK Push / B2B / B2C from a Cpay-owned
business account.

## Why this matters

- **Direct Daraja gives the cleanest UX**: the M-Pesa receipt SMS
  reads "Cpay" as the receiver, settlements land in our shortcode
  same-day, reversal API works, fees are Safaricom's published
  bands (no aggregator markup).
- **Without it** we either (a) wait for the CBK letter and the VASP
  licence (months), or (b) route through an aggregator who already
  has Daraja approval.

## Decision space (filled in once research lands)

The companion research doc
`docs/research/PAYMENT-RAILS-COMPARISON-2026-04-30.md` (generated
2026-04-30) compares: **direct Daraja**, **Kopo Kopo**, **SasaPay**,
**Pesapal**, **Cellulant**.

Headline tradeoffs we're evaluating:

| | Direct Daraja | Kopo Kopo | SasaPay |
|---|---|---|---|
| CBK letter required | YES (blocker right now) | NO (KK has it already) | NO (SasaPay is CBK-licensed PSP) |
| Time to live | months | days | days (we have client code) |
| Fees | base bands | KK markup | SasaPay markup |
| Reversal API | YES | partial | NO (saga creates ReconciliationCase) |
| Branding (M-Pesa receipt) | "Cpay" | "Kopo Kopo / Cpay" | "SasaPay" or "Cpay-via-SasaPay" |
| Crypto-friendly KYB | unknown | unknown | already engaged |

## What Cpay does NEXT

### Path A · stay the course on Daraja (months)

1. Engage CBK directly · write to the National Payments department
   asking what they need from us to issue a Letter of No Objection
   for a payment-aggregation activity. Public reports from other
   Kenyan crypto fintechs (BitPesa→AZA, Kotani Pay, Yellow Card)
   suggest a 3–12 month process.
2. Parallel-track the **VASP licence** application (Kenya VASP Act
   2025, KES 50 M paid-up capital floor, CMA as the licensing
   authority). The VASP licence supersedes the CBK letter for
   crypto-fiat conversion under the new Act — but the Act's
   regulations are still being drafted and CMA hasn't started
   issuing VASP licences as of 2026-04.
3. Reply to the Safaricom Falcon ticket with a status update so the
   case stays open (don't let it auto-close).

### Path B · switch primary rail to SasaPay TODAY (days)

We already have `apps/mpesa/sasapay_client.py` covering login, B2C,
C2B, and balance. The provider abstraction in `apps/mpesa/provider.py`
already supports per-environment switching via
`PAYMENT_PROVIDER=sasapay`. Steps:

1. Confirm SasaPay's KYB stance on crypto-onramp · email their
   integrations team with the cpay.co.ke business model and ask
   if our use case is approved (some PSPs reject crypto outright).
2. If approved, generate prod credentials and flip
   `PAYMENT_PROVIDER=sasapay` in `.env.production`.
3. Update mobile copy: instead of "M-Pesa Daraja" branding the
   buy-crypto / send-money flows, surface "powered by SasaPay" on
   the receipt screens. Same M-Pesa rails underneath; SasaPay is
   the licensed bridge.
4. Keep the saga's reversal path mapped to a
   `REVERSAL_NOT_SUPPORTED` ReconciliationCase (already
   implemented · `compensate_mpesa` → `_open_reversal_recon_case`)
   since SasaPay doesn't have an automated reversal API.
5. Re-engage Daraja in parallel for the long-term direct integration.

### Path C · Kopo Kopo aggregator (days)

Kopo Kopo is a Daraja-approved aggregator. They publish an OAuth-
based REST API covering STK Push, B2C, and reversal. Onboarding
involves a KYB, contract, and a small (~KES 50–100k) integration
fee.

1. Apply via `kopokopo.com/products/api` · get sandbox keys.
2. Re-implement `apps/mpesa/kopokopo_client.py` mirroring the
   `MpesaClient` interface so the provider abstraction can route
   to it transparently.
3. Pay attention to the M-Pesa receipt branding: KK's default has
   them named first, which can confuse users.
4. Live testing then `PAYMENT_PROVIDER=kopokopo` in prod.

### Recommendation

**Path B (SasaPay) immediately, Path A (Daraja LNO) in parallel.**

Confirmed by the 2026-04-30 deep-dive in
`PAYMENT-RAILS-COMPARISON-2026-04-30.md`:

- **No Kenyan crypto fintech has gone direct-Daraja.** BitPesa lost
  to Safaricom in court (2015); Yellow Card uses partner rails;
  Kotani Pay is FSCA-licensed (South Africa), not CBK. The "do it
  through an aggregator" pattern is the strategic norm here, not a
  workaround.
- **SasaPay is CBK-licensed** (since 15 Sep 2021 per the Nov 2025
  PSP directory). Has the Daraja access we need WITHOUT us
  needing an LNO. We already have the client (`apps/mpesa/
  sasapay_client.py`), the provider abstraction
  (`apps/mpesa/provider.py`), and the missing-reversal handling
  (`REVERSAL_NOT_SUPPORTED` ReconciliationCase shipped in 1311989).
- **Kopo Kopo is the fallback** if SasaPay's compliance call
  rejects us. Same M-Pesa rails, KES 50 flat outbound (cheaper
  for B2C than direct Daraja), but no Cpay code yet · adds 1-2
  days of integration work.
- **Pesapal: ruled out** (hostile to crypto per public reports).
- **Cellulant: deferred** (enterprise-only, slow onboarding).

**Critically: do NOT reply to the Safaricom Falcon ticket yet.**
Replying without an LNO in hand resets the clock. The ticket can
sit at 66% indefinitely while we ship via SasaPay. The Falcon
reply, when it comes, IS the LNO attachment.

## Compliance reading list

- Kenya VASP Act 2025 · `docs/project_vasp_regulations.md` (memory
  reference) · capital, custody, AML/CFT obligations.
- CBK National Payments Act 2011 · the legal basis for the no-
  objection letter requirement.
- CBK Prudential Guidelines PG-AML/CFT-1 · KYC/CDD framework that
  any rail provider will require us to mirror.
- CMA Capital Markets Act · once VASP regulations are gazetted,
  CMA becomes the issuing authority for crypto licences (replacing
  CBK's de-facto gate).

## Operator todos

- [ ] Reply to Safaricom Falcon ticket · acknowledge, request a
      30-day hold, ask whether VASP licence (when issued) is
      sufficient in lieu of the CBK letter
- [ ] Email CBK National Payments department · request the letter
      application form and the documents-needed checklist
- [ ] Email SasaPay integrations · pre-clear our crypto-onramp /
      utility-pay / send-money use case
- [ ] Tone down the cpay.co.ke landing-page crypto language while
      negotiations are open · "digital asset payments" reads less
      regulatorily-charged than "buy crypto with M-Pesa" (advisory
      from the Falcon comment)

---

*This doc tracks regulatory state. The provider-comparison
research lives in `PAYMENT-RAILS-COMPARISON-2026-04-30.md`.*
