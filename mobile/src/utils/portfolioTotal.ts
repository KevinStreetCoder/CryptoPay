/**
 * Shared total-portfolio-in-KES calculation.
 *
 * 2026-05-15 · extracted from `app/(tabs)/wallet.tsx` and re-used by
 * `components/BalanceCard`. The Dashboard previously computed the
 * total as `sum(wallet.kes_value)` without a `kes_rate` fallback ·
 * when the backend skipped populating `kes_value` for one of the
 * cryptos (e.g. SOL during the beta cohort while the rate-write
 * task was still warming up) the Dashboard dropped that wallet
 * silently and showed a tiny total (KSh 19.96 for 0.0854 SOL +
 * 0.15 USDT instead of the ~KSh 981 the Wallet tab showed).
 *
 * Single source of truth now · both the Dashboard's BalanceCard
 * and the Wallet page's "TOTAL PORTFOLIO" call this helper, so
 * the two cards can NEVER show different numbers again.
 *
 * Inputs are deliberately tolerant of `undefined` because both
 * call-sites can render while the React-Query data is still
 * loading. Returns 0 if there are no wallets at all.
 */
import type { Wallet } from "../api/wallets";
import type { Rate } from "../api/rates";

/**
 * Sum every wallet's KES-equivalent value:
 *  - For the KES wallet → use its balance directly.
 *  - For each crypto wallet → prefer `wallet.kes_value` (backend-computed,
 *    includes our spread); fall back to `balance × rate.kes_rate` from
 *    the rates feed when `kes_value` is missing or zero.
 *
 * Same semantics in BalanceCard (dashboard) and wallet.tsx (wallet tab).
 */
export function computeTotalKes(
  wallets: Wallet[] | undefined,
  rates: Rate[] | undefined,
): number {
  if (!Array.isArray(wallets) || wallets.length === 0) return 0;

  const kesWallet = wallets.find((w) => w.currency === "KES");
  const kesDirect = kesWallet ? parseFloat(kesWallet.balance) || 0 : 0;

  const cryptoTotal = wallets
    .filter((w) => w.currency !== "KES")
    .reduce((sum, w) => {
      // Prefer backend-supplied kes_value (it already includes the spread
      // we apply on conversion). The `(w as any)` cast is here because
      // older Wallet typedefs don't list `kes_value`; the field is
      // present at runtime when the backend wrote it.
      const kesVal = (w as any).kes_value
        ? parseFloat((w as any).kes_value) || 0
        : 0;
      if (kesVal > 0) return sum + kesVal;

      // Fallback · the backend hadn't written kes_value yet for this
      // currency. Use the live rate to estimate so we don't undercount.
      const bal = parseFloat(w.balance) || 0;
      const rate = rates?.find((r) => r.currency === w.currency);
      const kesRate = rate ? parseFloat(rate.kes_rate) || 0 : 0;
      return sum + bal * kesRate;
    }, 0);

  return kesDirect + cryptoTotal;
}

/**
 * Pick the crypto currency whose balance has the HIGHEST KES-equivalent
 * value out of the supplied options. Falls back to the first option when:
 *   - wallets / rates haven't loaded yet
 *   - every wallet has zero balance
 *   - none of the options have a wallet at all
 *
 * 2026-05-16 · used by payment screens (send-to-cpay, paybill, till,
 * send, withdraw, swap, buy) so that the default "Pay With" pill is
 * the currency the user can ACTUALLY pay with, rather than always
 * defaulting to USDT (which is empty for most beta users). A user
 * with 0.08 SOL and 0 USDT would have to manually tap SOL every
 * single time pre-fix · now SOL is the auto-default until they
 * explicitly pick something else.
 *
 * Same prefer-kes_value-then-fallback-to-rates logic as computeTotalKes
 * so the two helpers agree on which wallet "has the most".
 */
export function pickHighestBalanceCurrency<T extends string>(
  options: readonly T[],
  wallets: Wallet[] | undefined,
  rates: Rate[] | undefined,
  fallback: T = options[0],
): T {
  if (!options.length) return fallback;
  if (!Array.isArray(wallets) || wallets.length === 0) return fallback;

  let bestKes = 0;
  let best: T | null = null;

  for (const opt of options) {
    const w = wallets.find((x) => x.currency === opt);
    if (!w) continue;
    const bal = parseFloat(w.balance) || 0;
    if (bal <= 0) continue;
    const kesVal = (w as any).kes_value
      ? parseFloat((w as any).kes_value) || 0
      : 0;
    let kes = kesVal;
    if (kes <= 0) {
      const r = rates?.find((x) => x.currency === opt);
      const rate = r ? parseFloat(r.kes_rate) || 0 : 0;
      kes = bal * rate;
    }
    if (kes > bestKes) {
      bestKes = kes;
      best = opt;
    }
  }
  return best ?? fallback;
}

