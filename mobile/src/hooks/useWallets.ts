import { useQuery } from "@tanstack/react-query";
import { walletsApi, Wallet } from "../api/wallets";

interface PaginatedResponse {
  results: Wallet[];
  count: number;
}

// Priority order: stablecoins first, then by market cap
const CURRENCY_ORDER: Record<string, number> = {
  USDC: 0,
  USDT: 1,
  BTC: 2,
  SOL: 3,
  ETH: 4,
  KES: 5,
};

function sortWallets(wallets: Wallet[]): Wallet[] {
  return [...wallets].sort(
    (a, b) => (CURRENCY_ORDER[a.currency] ?? 99) - (CURRENCY_ORDER[b.currency] ?? 99)
  );
}

export function useWallets() {
  return useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: async () => {
      const { data } = await walletsApi.list();
      let wallets: Wallet[];
      if (Array.isArray(data)) {
        wallets = data;
      } else if (data && typeof data === "object" && "results" in (data as any)) {
        wallets = (data as unknown as PaginatedResponse).results;
      } else {
        wallets = [];
      }
      return sortWallets(wallets);
    },
    // 2026-05-09 · the Send / Pay screens display the user's
    // crypto balance on the form. After a successful BUY (callback
    // arrives, ledger credits the wallet) the user often navigates
    // straight to Send · staleTime: 0 + refetchOnMount: "always"
    // guarantees the form sees the post-credit balance instead of
    // a 10-second-stale cache that would render a misleading
    // "Insufficient USDT balance" warning. Combined with a 10 s
    // background interval so the cached view never drifts.
    refetchInterval: 10000,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
}

export function useKESBalance(wallets: Wallet[] | undefined) {
  const kes = wallets?.find((w) => w.currency === "KES");
  return kes ? parseFloat(kes.balance) : 0;
}
