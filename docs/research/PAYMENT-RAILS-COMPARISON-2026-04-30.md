# Payment-rail comparison · post-Daraja-block (2026-04-30)

**Status:** decision-ready
**Owner:** payments + regulatory
**Updated:** 2026-04-30
**Companion:** `DARAJA-CBK-BLOCKER-2026-04-30.md`

## TL;DR · ship via SasaPay this week

The CBK Letter of No-Objection blocking direct Daraja is real and
unavoidable — months of regulatory work · but it does NOT block
production. **Two-track:**

1. **Production rail TODAY = SasaPay** (we already have the client
   code · `apps/mpesa/sasapay_client.py`). Pre-clear with their
   compliance team in a single email, sandbox → prod in 1-3 weeks.
2. **Parallel = open the CBK LNO file** with KE counsel
   (AMG Advocates / CM Advocates). Budget KES 1.5-3M legal + KES
   100K filing + 6-12 months. Reply to Safaricom Falcon ONLY when
   the LNO lands · your reply IS the LNO. Replying without it just
   resets the clock.

Bottom line: do not let a Safaricom Falcon reviewer become your
roadmap. SasaPay rides the same M-Pesa rails as a licensed
aggregator. Branding on the SMS receipt becomes "SASAPAY" instead
of "CPAY" — that's the cost of speed, reclaimable once the LNO
clears.

---

## 1. CBK Letter of No-Objection · the real process

### Who issues it
CBK's Banking and Payment Services Department · NPS Division. Under
the **VASP Act 2025** (effective 4 Nov 2025) the LNO is co-issued
through CBK + CMA consultation for crypto-adjacent activity. The
LNO is the same instrument CBK gave Safaricom for M-Pesa in 2007 ·
"we don't oppose this activity while we figure out the regime."

### Documents required
Mirrors CBK PSP authorisation checklist · NPS Regulations 2014:

- Cert of Incorporation, CR12, share register, beneficial-ownership
- Fitness & Propriety forms for every director and 10%+ shareholder (CBK Form 2)
- 5-year business plan + financial projections
- AML/CFT/CPF policy aligned to POCAMLA + FATF Travel Rule
- ICT systems audit (penetration test, BCP/DR plan)
- Source-of-funds proof + bank reference
- Audited financials (parent company if startup)
- Cover letter setting out the activity, why an LNO is sought, and
  the regulator stack

### VASP Act 2025 interaction · regulator split
- **CBK** → custodial wallet providers, virtual asset payment
  processors, stablecoin issuers · **Cpay sits HERE**
- **CMA** → exchanges, brokers, advisers, tokenisation platforms

VASP Act explicitly does not displace the National Payment System
Act, so the LNO route remains the bridge while detailed VASP regs
are finalised by Treasury (not yet gazetted as of Nov 2025).
**No VASP has been licensed yet** — CBK + CMA publicly stated
licensing only begins once the regulations land.

### Timelines
NPS guidelines prescribe up to 90 days from a complete file. In
crypto-adjacent practice CBK has been measured in **months not
weeks**. The Bitpesa-Lipisha-Safaricom 2015 case is the cautionary
tale · courts upheld Safaricom's right to suspend any operator
running crypto remittance without explicit CBK authorisation.

### Cost
- Application fee: **KES 100,000** once CBK issues the Letter of
  Intent. Authorisation certificate within 7 days of payment.
- Capital floor for Cpay's bracket: **KES 20-50M paid-up**
  (e-money issuer / designated payment-instrument issuer per
  NPS Regulations 2014).
- Legal counsel: **KES 1.5-3M** budget for the full filing
  through specialist firms (AMG Advocates, CM Advocates LLP).

### What competitors actually did
- **BitPesa (now AZA Finance)** · sued Safaricom 2015, lost,
  pivoted to B2B FX flows, exited consumer M-Pesa.
- **Yellow Card** · licensed in South Africa (FSCA), no Kenyan
  PSP/VASP licence, uses third-party rails for M-Pesa
  deposit/withdraw.
- **Kotani Pay** · "Regulated by CBK" per company copy but no
  public PSP grant. Primary licence is South African FSCA CASP.
  Operates through aggregator partners.
- **Mara Wallet** · folded.

**Read-through · nobody has gone direct-Daraja-as-a-crypto-co.
Everybody uses aggregators or partner banks.** This is the
strategic reality, not a corner case.

### Sources
- [CBK NPS Authorisation Procedures 2014](https://www.centralbank.go.ke/images/docs/NPS/Regulations%20and%20Guidelines/Authorisationprocedurespaymentserviceprovider2014.pdf)
- [Capita Registrars LNO checklist](https://capitaregistrars.co.ke/cbk-letter-of-no-objection-requirements/)
- [Cliffe Dekker · VASP Act 2025 analysis](https://www.cliffedekkerhofmeyr.com/en/news/publications/2026/Kenya/Corporate-Commercial/corporate-and-commercial-alert-15-january-Kenya-VASP-Act-2025-A-new-era-for-virtual-asset-regulation)
- [Capital FM · CBK/CMA licensing pending regs](https://www.capitalfm.co.ke/news/2025/11/cbk-crypto-service-providers-licensing-to-begin-after-regulations/)
- [Lipisha v Safaricom · Chambers analysis](https://chambers.com/articles/the-other-side-of-the-coin-bitcoins-short-stint-in-kenya)
- [Kotani Pay FSCA licence · MariBlock](https://www.mariblock.com/stories/kotani-pay-secures-2m-to-expand-offline-cross-border-crypto-payments-in-africa)

---

## 2. Kopo Kopo · Daraja-approved aggregator

### Onboarding
KYB-only · Cert of Incorp, CR12, KRA PIN, directors' ID, bank
reference. **No public list of prohibited businesses for crypto**
but their settlement bank (formerly NCBA, now Equity per their
public copy) applies its own correspondent-bank AML screen. They
reserve discretionary right to refuse any merchant per TOS.
**Realistic: they accept fintech but require CBK comfort once your
activity becomes obviously crypto.** Blunt up-front conversation
with their compliance team is the only way to confirm.

### API capability map (K2-Connect)
| Capability | Status | Notes |
|---|---|---|
| C2B / STK Push | ✅ | Public docs at `developers.kopokopo.com/guides/receive-money/mpesa-stk.html` |
| B2C (pay user) | ✅ | "Pay" / Settlement Transfer · pays out to mobile money or bank |
| B2B paybill payment | ⚠ partial | Bank payout is first-class; paybill-as-recipient via M-Pesa not in public docs |
| Reversal | ✅ | "Reverse Incoming Transactions" endpoint |
| Webhooks + tx status polling | ✅ | |
| SDKs | ✅ | Ruby, PHP, Python, Node, Dart |

### Fees
- **0.55% inbound** Lipa-na-M-Pesa, capped at KES 200, free under KES 200
- **KES 50 flat outbound** per transaction regardless of amount
  (KES 10K or KES 1M, both cost KES 50)
- No setup fees, no monthly minimums
- **Materially cheaper than Daraja B2C for high-value payouts**

### Documentation
**Strong.** Public Postman collection, OpenAPI-style reference at
`api-docs.kopokopo.com`, sandbox keys typically issued same week.
Better DX than raw Daraja.

### Trade-offs vs direct Daraja
- **Branding** · M-Pesa SMS receipt shows "KOPO KOPO" or the Kopo
  Kopo paybill name (NOT Cpay). Some merchants negotiate a custom
  till short-name; verify with Kopo Kopo. **Biggest UX hit.**
- **Settlement** · T+0 to M-Pesa, T+1 to bank.
- **Disputes** · Kopo Kopo is the merchant of record at Safaricom ·
  disputes route through them.
- **Crypto stance** · not anti, not pro. **Risk: aggregator-side
  de-platforming if a customer complaint references "crypto".**
- **No public crypto fintechs confirmed using it** · Cpay would be
  opening a new merchant category from their POV.

### Sources
- [Kopo Kopo developer hub](https://developers.kopokopo.com/)
- [K2 Connect features](https://kopokopoinc.zendesk.com/hc/en-us/articles/21157966743826-What-can-I-do-with-K2-Connect)
- [Pricing review](https://paymentgateways.org/gateway/kopokopo)
- [TOS discretion clause](https://kopokopo.co.ke/terms-conditions/)

---

## 3. SasaPay · CBK-licensed PSP

### Crypto stance
**Silent.** Operated by ViewTech Ltd, CBK-licensed PSP since
15 Sep 2021. **Publishes no explicit crypto policy** and no public
partnership announcements with crypto fintechs. They are an
e-money issuer and aggregator, not a VASP. Have not signalled
hostility OR comfort. **Treat as conditional · pre-clear with their
compliance team before integrating.**

### Coverage / rails
SasaPay rides **Safaricom M-Pesa as one of multiple endpoints**,
alongside Airtel Money, T-Kash, and Pesalink-connected banks. When
a customer pays a SasaPay paybill from M-Pesa, the funds land in
the user's M-Pesa wallet first, **then SasaPay sweeps** to its
CBK-licensed e-money float.

It is **NOT** the same Daraja-backed account a direct Safaricom
merchant would have · it's a different switch with M-Pesa as a
gateway. Branding on the customer's M-Pesa SMS reads "SASAPAY" /
the SasaPay paybill (e.g. 711111).

### API parity vs Daraja
| Capability | Status |
|---|---|
| C2B (STK + paybill) | ✅ |
| B2C | ✅ |
| B2B | ✅ |
| Transaction status | ✅ |
| Account validation | ✅ |
| Balance | ✅ |
| Statements | ✅ |
| WAAS (sub-wallets) | ✅ |
| **Reversal API** | ❌ **GAP** · not first-class published; statements expose reversal status only |
| Per-tx limit | KES 250K (CBK e-money limit, same as M-Pesa) |

The reversal gap is real. Cpay's saga already handles this
gracefully via the `REVERSAL_NOT_SUPPORTED` ReconciliationCase
type (shipped in `1311989`).

### Onboarding for crypto fintech
Self-service sandbox · production goes through KYB. **No public
crypto-specific gate** but expect a custom compliance call.
**Timeline 1-3 weeks for sandbox-to-prod** for a normal PSP flow.

### Fees
- Public schedule sparse · advertise themselves as cheaper than
  M-Pesa
- B2B/B2C tiered, below Safaricom's per public reviews
- SasaPay-to-bank withdrawal via Pesalink (KES 100-300 typical)

### Operational risk
Smaller switch · failure surface is real. No published uptime SLA.
ViewTech/SasaPay has no major public outages on record but also
no public status page. **Regulator: CBK.** They are not a VASP.

### Sources
- [SasaPay developer docs](https://docs.sasapay.app/docs/introduction/)
- [B2B endpoint](https://docs.sasapay.app/docs/b2b/)
- [Transaction status](https://docs.sasapay.app/docs/transactionstatus/)
- [CBK PSP directory · Nov 2025](https://www.centralbank.go.ke/wp-content/uploads/2025/11/Directory-of-Authorized-Payment-Service-Providers-6-November-2025.pdf)
- [BusinessToday · ViewTech licensing](https://businesstoday.co.ke/sasapay-gets-cbk-nod-operate-kenya-psp/)
- [BusinessRadar · SasaPay guide](https://www.businessradar.co.ke/blog/2024/09/25/complete-guide-to-sasapay-in-kenya/)

---

## 4. Comparison matrix

| | Direct Daraja | Kopo Kopo | SasaPay | Pesapal | Cellulant |
|---|---|---|---|---|---|
| **Time to live** | 6-18 months | 1-3 weeks | 1-3 weeks | 2-6 weeks | 6-12 weeks |
| **Capital / fees** | KES 20-50M + LNO process | 0.55% in, KES 50 out | tiered, < Safaricom | ~3.5% per tx | enterprise quote-only |
| **CBK letter req?** | YES (blocked) | NO (theirs) | NO (theirs) | NO (theirs) | NO (theirs) |
| **Crypto-friendly** | unclear (case-by-case) | tolerant (no policy) | silent (no policy) | hostile (refuses) | enterprise (depends) |
| **Reversal API** | YES | YES | partial | YES | YES |
| **Branding on SMS** | "CPAY" | "KOPO KOPO" | "SASAPAY" | "PESAPAL" | "TINGG" |
| **B2C cap / tx** | KES 250K | KES 250K | KES 250K | KES 150K | KES 250K |
| **Public docs** | strong | strong | strong | medium | weak |
| **Already integrated in Cpay?** | yes (`mpesa/client.py`) | NO | yes (`mpesa/sasapay_client.py`) | NO | NO |

---

## 5. Cpay action plan · this week

### Day 1-2 · SasaPay compliance pre-clear
- Email `support@sasapay.app` with cc to `developers@sasapay.app`
- Disclose Cpay's crypto-onramp model upfront · do NOT hide it
- Attach the Cpay Technologies Business Profile (already at
  `docs/Cpay-Technologies-Business-Profile.docx`) and the BN-
  B8S6JP89 cert
- Ask: (a) is our use case approved? (b) what's the production
  KYB timeline? (c) any per-tx caps for VASP-adjacent merchants?

### Day 3-5 · Switch primary rail to SasaPay
**If pre-clear approved:**
1. Generate prod credentials in the SasaPay dashboard
2. Set `PAYMENT_PROVIDER=sasapay` in `.env.production` (already
   plumbed through `apps/mpesa/provider.py`)
3. Deploy + monitor Reconciliation queue for any
   `REVERSAL_NOT_SUPPORTED` cases (saga handles automatically)
4. Update mobile receipt copy: *"Paid via SasaPay payment partner ·
   ref XXX"* (so users know why the SMS shows SASAPAY)
5. Live test: 100 KES → 10K → 100K → ramp

**If pre-clear declined:** open the Kopo Kopo conversation (Day 6)

### Day 6-7 · Kopo Kopo fallback (only if SasaPay declines)
- Apply at `kopokopo.com/products/api`
- Stub `apps/mpesa/kopokopo_client.py` mirroring `MpesaClient`
  interface
- Wire into `apps/mpesa/provider.py` as a third option
- Re-test live

### Parallel · CBK LNO file (months)
- Engage AMG Advocates or CM Advocates LLP this week
- Compile the document checklist (Cert, CR12, P&L projections,
  AML/CFT policy, ICT audit, source of funds, audited financials)
- Plan KES 1.5-3M legal + KES 100K filing budget
- Plan KES 20-50M capital adequacy proof

### What we DON'T do
- ❌ **Don't reply to Safaricom Falcon yet.** Reply only when LNO
  is in hand. Replying without it just resets the clock and
  burns goodwill. Falcon ticket can sit at 66% indefinitely · it
  does not block aggregator-route production.
- ❌ **Don't pivot the cpay.co.ke landing copy** to hide crypto.
  Honesty wins regulatory rounds. Tone the language ("digital
  asset payments" instead of "buy crypto with M-Pesa") if you
  want, but keep transparency.

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-30 | **Primary rail: SasaPay** | Code already exists, 1-3 wk to prod, CBK-licensed PSP so no separate LNO needed. Reversal gap absorbed by ReconciliationCase queue (already shipped). |
| 2026-04-30 | **Fallback rail: Kopo Kopo** | Only if SasaPay refuses. Better B2C economics (KES 50 flat) but adds engineering effort (new client). |
| 2026-04-30 | **Long-track: CBK LNO via legal counsel** | Direct Daraja is the eventual goal. 6-12 month process. Run in parallel, do not block production on it. |
| 2026-04-30 | **Pesapal: rejected** | Hostile to crypto per public reports. |
| 2026-04-30 | **Cellulant: deferred** | Enterprise-only, slow onboarding, weak public docs. Not appropriate for our scale yet. |
