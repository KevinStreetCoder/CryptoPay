# Stable Lock · the rate-lock idea, second look

**Status**: research, recommendation green-light for Path A
**Owner**: product + backend
**Effort**: 3-5 days for Path A
**Updated**: 2026-04-25
**Related**: `docs/research/BALANCE-LOCK.md` (first-pass red-light verdict)

## What changed since the first pass

The earlier `BALANCE-LOCK.md` correctly concluded that a true hedge
(Cpay promises a fixed KES rate; takes the price risk if the market
falls) is not viable pre-VASP-license. That conclusion stands.

This second look reframes the user's underlying need (freeze my KES
value while I decide what to do) without putting Cpay's float at
risk. The reframe is just an honest UX wrapper around the swap
infrastructure that already exists.

## What the user is actually asking for

Three real demand signals from the field:

1. **Pay-day deposits**. A Kenyan working abroad receives crypto on
   the 1st, but rent is due on the 15th. They want to freeze the
   rate the day the money lands, not the day rent is due.
2. **Volatile weeks**. BTC moves 10% in 24h; SOL moves 15%. USDT
   barely moves against KES (it's USD-pegged, KES/USD swings 0.1% a
   day in calm weeks).
3. **Refund / unwind certainty**. A user wants to know exactly how
   many KES the recipient gets when they send to family.

Each of these is satisfied if the user simply holds USDT instead of
the volatile asset. They get USD-pegged stability without Cpay
making a price commitment.

## Two implementation paths, one recommended

### Path A · Stable Lock (recommended)

User taps **Lock value**. The app swaps the volatile-crypto balance
to USDT at the current live rate, the same rate the swap screen
shows today. Result: the user holds USDT instead of BTC/ETH/SOL.
KES exposure is now anchored to USD/KES movement only, which is
ten times smoother than crypto/KES.

**What it costs the user**: one swap fee (~0.5% spread on the live
rate) plus any chain transfer fee. Disclosed up front in the quote.

**What it costs Cpay**: nothing extra. The swap path is already
running in production for normal sends.

**What it costs Cpay's float**: zero. Cpay never holds the price
exposure. The user simply ends up in a different asset.

**Reverse path**: Tap **Unlock to BTC** (or SOL, etc.). App swaps
USDT back to the original crypto at the new live rate. User accepts
the spread + transfer fee in both directions.

**Honest framing for the user**:

> We can't promise you a fixed KES rate. Doing that would mean Cpay
> takes the loss when the market moves, and that's not safe for
> either of us. What we can do is convert your crypto to USDT, the
> dollar-pegged token. From USDT, the only swing you'll see is the
> small daily USD-vs-KES movement (typically 0.1% a day, sometimes
> nothing for a week).

### Path B · Synthetic locked rate (do not build)

Cpay quotes "1 BTC = KES 6,500,000 locked for 24h" and the user
accepts. Cpay agrees to honour that rate for the next 24h regardless
of market movement. To survive, Cpay must hedge. Three options:

1. Hold KES on the side equivalent to the locked value. Capital
   intensive, doesn't scale, regulatory exposure as a deposit-like
   activity.
2. Short BTC perpetual futures on a derivatives exchange. Counter-
   party risk, settlement risk, and exchange-account risk all stack
   on top of an already-tight margin business.
3. Buy a put option. Expensive, requires a liquid Kenyan derivatives
   market that doesn't exist yet.

**Verdict**: same as the first-pass research. This is a financial
product. It's exactly what bankrupted unlicensed operators in
similar markets (FTX, Genesis, BlockFi). Don't build it before VASP
licensing, treasury function, and a real risk team are in place.

## Why USDT (not USDC, not DAI)

Cpay already holds USDT at scale on TRC-20. It has the deepest
liquidity on every venue we touch. KES/USDT spread at the live rate
is the tightest of any crypto/KES pair we quote. USDC and DAI both
work on the same swap path; we just default the **Lock value**
button to USDT to give the user the best execution.

We can let users opt into "Lock to USDC" if there's measurable
demand, but USDT is the obvious starting line.

## Why not let users hold KES directly?

Two real reasons:

1. **Banking Act exposure.** Holding pooled customer KES would make
   Cpay a deposit-taking institution under the Banking Act, which
   is a different licence to VASP and significantly more regulated.
   USDT is an externally-issued token; Cpay holds the user's claim
   on their tokens, not their money.
2. **M-Shwari already exists.** The user's KES already lives in
   M-Pesa, where it earns interest (M-Shwari) and is M-Pesa-insured.
   Cpay isn't trying to compete with that. Stay in our lane.

## What we'd build

- **`LockValueView`** in `apps/payments/views.py` (~60 LOC), a thin
  wrapper around the existing `SwapView`. Defaults `to_currency=USDT`,
  exposes the all-in fee + spread in the quote response.
- **Wallet card UI**: a single "Lock value" button on each volatile
  crypto row, plus a "Locked" badge on the USDT row when the user has
  used Stable Lock recently. Tapping the badge shows the unlock flow.
- **Confirmation modal**: live rate, fee, the resulting USDT amount,
  the resulting KES value if they were to send to M-Pesa right now,
  and the standard 90-second quote freeze that the swap path already
  enforces.
- **Education sheet**: one screen that explains Stable Lock without
  promising what we can't deliver. Honest framing copy is in the
  section above; product can refine.

Engineering effort: 3-5 days. Most of the work is UX copy and the
micro-flow; the rail itself is unchanged.

## What we're NOT building

- **Limit orders ("buy if BTC drops to X")**. Distinct feature; can
  follow Stable Lock but is not part of this scope.
- **Recurring auto-lock** ("lock 50% of every deposit to USDT"). Worth
  considering after we measure adoption of the manual flow.
- **Fixed-period locks ("freeze for 7 days")**. Would re-introduce the
  Path B problem because the user's expectation drifts toward "you
  promised a rate". Stable Lock should be cancellable at any moment
  by tapping Unlock.

## Metrics to watch after launch

- `% of crypto balance moved into USDT via Lock` per cohort
- Lock-to-Unlock interval distribution (median, p90)
- Swap fee revenue from Stable Lock as a fraction of total swap
  revenue
- Support tickets mentioning "rate" or "lock" or "value" before vs
  after launch
