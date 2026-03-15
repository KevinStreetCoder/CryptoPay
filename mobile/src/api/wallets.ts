import { api } from "./client";

export interface Wallet {
  id: string;
  currency: string;
  balance: string;
  locked_balance: string;
  available_balance: string;
  deposit_address: string | null;
  created_at: string;
}

export interface BlockchainDeposit {
  id: number;
  chain: string;
  tx_hash: string;
  from_address: string;
  to_address: string;
  amount: string;
  currency: string;
  confirmations: number;
  required_confirmations: number;
  status: "detecting" | "confirming" | "confirmed" | "credited";
  credited_at: string | null;
  block_number: number | null;
  created_at: string;
}

export const walletsApi = {
  list: () => api.get<Wallet[]>("/wallets/"),
  get: (id: string) => api.get<Wallet>(`/wallets/${id}/`),
  generateAddress: (walletId: string) =>
    api.post<Wallet>(`/wallets/${walletId}/generate-address/`),
  deposits: (page = 1) =>
    api.get<{ results: BlockchainDeposit[]; count: number }>("/wallets/deposits/", {
      params: { page },
    }),
  getDepositStatus: (id: number) =>
    api.get<BlockchainDeposit>(`/wallets/deposits/${id}/`),
};
