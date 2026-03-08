import { useQuery } from "@tanstack/react-query";
import { paymentsApi } from "../api/payments";

export function useTransactions(page = 1) {
  return useQuery({
    queryKey: ["transactions", page],
    queryFn: async () => {
      const { data } = await paymentsApi.history(page);
      return data;
    },
  });
}
