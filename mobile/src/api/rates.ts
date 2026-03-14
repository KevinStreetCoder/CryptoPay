import { api } from "./client";

export interface RateApiResponse {
  currency: string;
  crypto_usd: string;
  usd_kes: string;
  raw_rate: string;
  spread_percent: number;
  final_rate: string;
  flat_fee_kes: number;
  rate_freshness?: "live" | "stale";
  rate_stale?: boolean;
}

// Normalized rate used throughout the app
export interface Rate {
  currency: string;
  usd_rate: string;
  kes_rate: string;
  spread: string;
  updated_at: string;
}

export interface RateHistoryPoint {
  timestamp: string;
  rate: string;
}

export interface RateHistoryResponse {
  currency: string;
  period: string;
  data: RateHistoryPoint[];
}

export interface Quote {
  quote_id: string;
  currency: string;
  exchange_rate: string;
  final_rate: string;
  crypto_amount: string;
  kes_amount: string;
  fee_kes: string;
  excise_duty_kes: string;
  total_kes: string;
  crypto_usd: string;
  usd_kes: string;
  raw_rate: string;
  spread_percent: number;
  flat_fee_kes: number;
  excise_duty_percent: number;
}

export const ratesApi = {
  getRate: (currency: string) =>
    api.get<RateApiResponse>("/rates/", { params: { currency } }),
  getQuote: (amount: string, _from: string, to: string) =>
    api.post<Quote>("/rates/quote/", { kes_amount: amount, currency: to }),
  lockRate: (data: { currency: string; kes_amount: string }) =>
    api.post<Quote>("/rates/quote/", data),
  getRateHistory: (currency: string, period: string = "7d") =>
    api.get<RateHistoryResponse>("/rates/history/", { params: { currency, period } }),
};

// Normalize API response to the Rate shape used by the app
export function normalizeRate(raw: RateApiResponse): Rate {
  return {
    currency: raw.currency,
    usd_rate: raw.crypto_usd || "0",
    kes_rate: raw.final_rate || raw.raw_rate || "0",
    spread: String(raw.spread_percent ?? 0),
    updated_at: new Date().toISOString(),
  };
}
