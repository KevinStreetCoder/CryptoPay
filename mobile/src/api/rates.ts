import { api } from "./client";

export interface Rate {
  currency: string;
  usd_rate: string;
  kes_rate: string;
  spread: string;
  updated_at: string;
}

export interface Quote {
  quote_id: string;
  currency: string;
  rate: string;
  crypto_amount: string;
  kes_amount: string;
  fee: string;
  total_crypto: string;
  expires_at: string;
}

export const ratesApi = {
  getRate: (currency: string) => api.get<Rate>("/rates/", { params: { currency } }),
  lockRate: (data: { currency: string; kes_amount: string }) =>
    api.post<Quote>("/rates/quote/", data),
};
