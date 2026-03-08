import { useQuery } from "@tanstack/react-query";
import { walletsApi, Wallet } from "../api/wallets";

interface PaginatedResponse {
  results: Wallet[];
  count: number;
}

export function useWallets() {
  return useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: async () => {
      const { data } = await walletsApi.list();
      // Handle both paginated and direct array responses
      if (Array.isArray(data)) return data;
      if (data && typeof data === "object" && "results" in (data as any)) {
        return (data as unknown as PaginatedResponse).results;
      }
      return [];
    },
    refetchInterval: 30000,
  });
}

export function useKESBalance(wallets: Wallet[] | undefined) {
  const kes = wallets?.find((w) => w.currency === "KES");
  return kes ? parseFloat(kes.balance) : 0;
}
