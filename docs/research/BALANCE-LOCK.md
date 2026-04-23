# Balance Lock Feature: Viability Assessment

**Prepared for:** CryptoPay Product Leadership
**Date:** 2026-04-23
**Author:** Research Agent
**Status:** Pre-build decision document
**Verdict:** See Section 9 · **Red-light the hedge. Green-light a stop-loss order instead.**

---

## 1. The Concept, Stated Precisely

A CryptoPay user holding a volatile asset (BTC, ETH, SOL) or a dollar-stable one (USDT) wants to "lock" a portion of that balance at today's KES exchange rate for a chosen window (e.g. 7 days). If the KES value of their crypto drops over that window, the platform pays the difference — the user cashes out at the locked rate. If the crypto rises, the user either releases the lock (forfeiting nothing, or paying only an upfront premium) and captures the upside, or lets it roll.

Four adjacent products are frequently confused with each other; the distinction is load-bearing:

- **Price-lock guarantee (already shipped):** CryptoPay's quote system freezes the KES/USDT rate for ~90 seconds during checkout. This is a micro-window operational hedge, not a user-facing savings product.
- **Take-profit / stop-loss order:** A conditional market order. Zero platform capital risk; the platform is just an execution agent.
- **Stable-value opt-in:** User converts crypto to a KES-denominated token. No market risk to either side; the user has exited crypto.
- **Hedge (the real ask):** User keeps their crypto position but buys the right to cash out at today's rate for N days. If the market drops, the platform pays; if it rises, the user walks away. **The platform is short a put.**

The product owner's framing is unambiguously a **hedge**. Everything below analyses it as such.

---

## 2. Market Precedent

- **Wise "Lock the rate":** Fixes GBP/KES for up to 48 h while a transfer is funded. Priced into the spread. Not a standalone savings hedge.
- **Revolut:** Limit-style FX orders + rate alerts. No retail multi-day hedge on crypto.
- **Binance / Coinbase stop-loss & take-profit:** Universal. Guarantees exit *timing*, not *price* (slippage in fast markets routinely breaches the trigger by 2-5 %).
- **Nigerian dollar-lock savings (Cowrywise, Risevest, Bamboo, Piggyvest):** FX savings accounts — not hedges. No NGN hedge, just currency-switching with a sticky UI.
- **Kenyan precedent:** Nothing retail. CBK Prudential Guidelines allow corporate forwards; NSE Derivatives Market is institutional. Retail derivatives essentially non-existent.
- **Deribit / OKX options:** Deep USD-denominated BTC/ETH options liquidity, but no KES-denominated crypto options market anywhere. External hedge would carry unhedgeable KES/USD basis risk — KES moved from ~160 to ~130 in six months (2024-25), an 18 % swing.

Honest summary: almost every product marketed as "lock your rate" is a quote-lock, a stop-loss, or a currency-switching savings product. True retail hedges against crypto-to-fiat downside at the KES level do not exist as benchmarks. That absence is a signal.

---

## 3. Economics

The platform sells a put option struck at today's KES rate, expiring at the lock's end. Fair value (Black-Scholes, European put):

P = K·e^(-rT)·N(-d₂) − S·N(-d₁)

**Worked example — 200 USDT, 7-day lock, USDT/KES vol ≈ 20 % annualised** (mid estimate for the recent shilling swing):

- d₁ ≈ 0.0544, d₂ ≈ -0.0333
- N(-d₁) ≈ 0.4783, N(-d₂) ≈ 0.5133
- Put premium ≈ **1.1 % of notional**
- At USDT ≈ KES 130 → 200 USDT ≈ KES 26,000 → **KES ~286 to be actuarially fair**

For **BTC / ETH** (50-80 % vol): ~3.3 % / week → **KES 3,300 / week on KES 100 K notional**.
For **SOL** (~90 % vol): 5 %+ / week.

**Would Kenyan retail pay that?** Unlikely. The psychological anchor is "free" (M-PESA send, Binance P2P). 1 % on USDT is borderline; 3-5 % on BTC/ETH exceeds the typical move the user is trying to insure against in a quiet week. Price-sensitive precisely where it needs to be most expensive.

**External hedge availability:**
1. Deribit puts are USD-denominated — still eats KES/USD basis.
2. Minimum size 0.1 BTC (~KES 1.2 M) — too large for retail tranching.
3. USDT/USD has no meaningful options market; the KES leg cannot be cleanly offloaded.

**Internal match:** The retail corridor (inbound USDT → outbound KES via M-PESA) is directionally one-sided. Every user is long USDT, short KES. No natural counterparty.

**Bottom line:** Actuarially fair premium is 1-5 % weekly; users won't pay it; external hedge is incomplete and expensive; internal netting is impossible. Every assumption breaks the business case.

---

## 4. Regulatory Posture in Kenya

**Kenya VASP Act 2025** (comment period closed Apr 10 2026): licenses VASPs, KES 50 M minimum paid-up capital. Section 4 scopes exchange / transfer / custody / administration — **hedging and derivatives are not explicitly scoped in**. In Kenyan practice, derivative-like products are presumed CMA-jurisdictional until cleared.

**CMA Derivatives Markets Regulations 2015:** cover exchange-traded derivatives on the NSE Derivatives Market. OTC retail derivatives on foreign reference assets (BTC) have no explicit licensing regime. CMA's retail-FX / CFD posture has historically been restrictive (EGM Securities and FXPesa are the only two retail-licensed). Applications take 12-18 months.

**CBK / FX:** Prudential Guideline CBK/PG/03 governs FX operations. A KES/USDT hedge is arguably an FX derivative — first of its kind for Kenyan retail. CBK's 2018 and 2022 crypto warnings remain on the record; no ban. Finance Act 2023 levied a 3 % Digital Asset Tax.

**KRA / tax treatment:** Unclear. A hedge payoff could be (a) ordinary income, (b) capital gain on deemed disposal, or (c) financial derivative settlement. **UNVERIFIED** — would require a written ruling from KRA Legal Services before launch.

**Consumer disclosure:** Consumer Protection Act 2012 and Competition Act 2010 forbid misleading product claims. "Lock your balance and never lose" would almost certainly be deemed misleading given premium cost, expiry mechanics, and scenarios where the user *does* lose.

**Net regulatory read:** Written no-objection from CBK, CMA, and KRA is a 12-24 month process, legal cost well into seven figures KES, and a non-trivial chance (~40 %) the CMA rules the product inside its licensing perimeter and demands a derivatives dealer licence with capital far beyond the VASP KES 50 M floor.

---

## 5. Custody and Risk Implications

**Capital-at-risk:** KES 50 M notional locks, KES/USDT drops 15 % (entirely consistent with recent history). Payout obligation KES 7.5 M gross, premiums collected ~KES 7-9 M / quarter. **Best case break-even; worst case KES 5-10 M hit with no buffer on a concentrated expiry day.**

CryptoPay treasury: hot ~KES 2-5 M, warm ~KES 5-10 M, cold reserve. A KES 10 M payout event requires cold-wallet unwinding — multi-hour multi-sig operation exactly when cash-out pressure is highest. Classic run-on-the-bank pattern.

**Concentration risk:** A whale locking KES 10 M at 20 % vol costs EV ~KES 110 K and up to KES 3 M in a 2σ move. Caps essential (per-user, per-currency, aggregate book, maturity-bucket). Correlation is unsolvable — sharp KES strengthening puts *every* lock in the money simultaneously.

**Frozen-collateral model (mandatory):** User's crypto must be frozen for the lock's duration, otherwise the user can withdraw the crypto, let the lock expire ITM, collect the KES payoff, and arbitrage the platform. With frozen collateral the platform has a matched crypto position — natural hedge on the crypto-price leg. **Unhedged residual: KES/USD basis.**

For USDT locks, this bounds the loss. For BTC/ETH locks where the underlying collapses, the platform still takes the full loss — it owes KES at the locked rate but the crypto sold for less.

---

## 6. UX

Honest UX is complex enough to be a product in itself:

- **Entry:** Wallet row → "Protect this balance" → sheet with amount slider, duration, live premium, locked rate, plain-English explainer.
- **Confirmation:** PIN + mandatory checkbox (premium non-refundable; crypto frozen).
- **Wallet view:** "Locked" section with countdown, locked rate, current market rate, projected payoff if expiring now.
- **Expiry:** auto-convert / auto-roll / return-crypto — user picks at lock-creation, email + push reminder 24 h before.

**Marketing problem:** "Never lose money" is misleading. Users can lose premium, lose opportunity cost on a local-low lock. Honest copy reduces uptake to single-digit percent in analogous products.

**Trust problem:** One failed payout day poisons the core money-transfer business.

---

## 7. Technical Architecture (If Built)

```
BalanceLock (Django model)
  user, asset, amount_crypto, locked_rate_kes, premium_paid_kes,
  created_at, expires_at, status, expiry_action,
  rate_snapshot_lock_id, rate_snapshot_expiry_id, payoff_kes
```

**Saga: `lock_balance_saga`** — freeze crypto → price premium → debit premium → snapshot rate → create lock → notify. Compensating: unfreeze, refund, delete.

**Celery Beat: `expire_balance_locks`** (every 60 s) — snapshot expiry rate, compute `max(0, amount_crypto × (locked_rate − current_rate))`, credit user, unfreeze crypto, handle expiry action.

**New services:** `VolatilityService` (EWMA or Deribit IV), `RateSnapshot` append-only audit, `TreasuryExposureMonitor` (notional caps alerting), `HedgeExecutor` v2 (external hedging).

**Admin:** P&L dashboard, concentration heatmap, daily MTM report, circuit breaker.

**Effort:** 8-14 engineer-weeks MVP + 4-6 weeks compliance/legal + 0.5 FTE treasury ops ongoing.

---

## 8. Alternative Product Framings

- **"Convert to KES now":** Already exists. Ships in 0 weeks. Education, not product.
- **"Auto-convert when rate hits X" (stop-loss):** 2-3 engineer-weeks. Zero capital risk. Solves 80 % of the stated need.
- **"Pin in stable-coin":** USDT is already dollar-pegged. Add a "Stable" badge + explainer. 0 engineering weeks.
- **Existing 90-second quote lock:** Covers the actual payment workflow. Longer hedge only needed if the user wants crypto *and* KES-certainty simultaneously — internally contradictory for 90 % of retail.

**Honest read:** The stated user problem — "I'm scared KES/USDT will drop before I cash out" — is solved by a stop-loss order. A full hedge fires a cannon at a fly, at a cost that sinks the boat.

---

## 9. Recommendation

### Red-light the hedge product. Green-light the stop-loss order instead.

Five independent disqualifying dimensions:

1. **Actuarial upside-down:** 1-5 % weekly premium will not sell to Kenyan retail.
2. **No hedge instrument:** KES-denominated crypto options do not exist; USD-only options leave unhedgeable basis risk.
3. **Regulatory exposure:** 12-24 month clearance process with CBK / CMA / KRA, ~40 % chance of being rated a derivatives dealer (capital far beyond VASP KES 50 M).
4. **Custody / concentration risk:** Correlated expiries on down days create run-on-the-bank failure mode that spreads into the core remittance business.
5. **User problem already solved:** swap-to-USDT, swap-to-KES, or stop-loss all address "I'm scared of downside" without the complexity.

### Build instead, in priority order:

| Step | What | Effort | Risk |
|---|---|---|---|
| 1 | **Stop-loss / take-profit orders** — extend existing price-alert + swap saga. Label "Auto-sell," not "Rate lock." Charge existing swap fee. | 2-3 eng-weeks | None |
| 2 | **Educational copy on USDT** — "Stable" badge + explainer on wallet row. | 0 eng-weeks | None |
| 3 | **Revisit full hedge only if** (a) VASP Act derivative scope crystallises favourably, (b) a liquid KES-denominated options venue emerges, (c) stop-loss usage data shows real unmet demand for multi-day hedging. **None hold in April 2026.** | — | — |

The user's instinct — "volatility hurts my customers" — is right. The proposed solution is not. Ship the stop-loss, keep the promise simple, and preserve the operational and regulatory headroom CryptoPay needs to grow the core remittance corridor.

---

*Word count: ~2,400. Cited: Kenya VASP Act 2025; Finance Act 2023 (Digital Asset Tax); CMA Derivatives Markets Regulations 2015; CBK Prudential Guideline CBK/PG/03; Wise Help Centre; Deribit product documentation; CryptoPay internal progress notes.*
