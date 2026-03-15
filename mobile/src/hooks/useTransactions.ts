import { useQuery } from "@tanstack/react-query";
import { paymentsApi, ActivityParams } from "../api/payments";

export function useTransactions(page = 1) {
  return useQuery({
    queryKey: ["transactions", page],
    queryFn: async () => {
      const { data } = await paymentsApi.history(page);
      return data;
    },
    refetchInterval: 15000,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** Fetches the unified activity feed (Transaction + BlockchainDeposit merged). */
export function useActivity(params: ActivityParams = {}) {
  return useQuery({
    queryKey: ["activity", params],
    queryFn: async () => {
      const { data } = await paymentsApi.activity(params);
      return data;
    },
    refetchInterval: 15000,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
