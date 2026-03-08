import { api } from "./client";

export interface Wallet {
  id: string;
  currency: string;
  balance: string;
  locked_balance: string;
  deposit_address: string | null;
  created_at: string;
}

export const walletsApi = {
  list: () => api.get<Wallet[]>("/wallets/"),
  get: (id: string) => api.get<Wallet>(`/wallets/${id}/`),
};
