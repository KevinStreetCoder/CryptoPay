import { useQuery } from "@tanstack/react-query";
import { walletsApi, Wallet } from "../api/wallets";

export function useWallets() {
  return useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: async () => {
      const { data } = await walletsApi.list();
      return data;
    },
    refetchInterval: 30000,
  });
}

export function useKESBalance(wallets: Wallet[] | undefined) {
  const kes = wallets?.find((w) => w.currency === "KES");
  return kes ? parseFloat(kes.balance) : 0;
}
