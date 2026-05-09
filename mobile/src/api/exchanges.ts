/**
 * External-exchange linking API (Binance / Coinbase / Noones).
 *
 * Mirrors backend/apps/exchanges/urls.py · 11 endpoints under
 * /api/v1/exchanges/. All endpoints require auth (the api client
 * attaches the JWT on every request).
 *
 * Design doc: docs/research/EXCHANGE-OAUTH-INTEGRATION-2026-05-09.md
 */
import { api } from "./client";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ExchangeProvider = "binance" | "coinbase" | "noones";

/** Per-provider metadata for the discovery screen. */
export interface ProviderInfo {
  id: ExchangeProvider;
  name: string;
  /** "api_key" (Binance) or "oauth" (Coinbase / Noones). */
  method: "api_key" | "oauth";
  /** True when the operator has provisioned the OAuth app (or
   * for Binance · always true since per-user keys are end-user
   * provisioned). */
  configured: boolean;
  /** The currencies the user can link/withdraw on this provider. */
  supported_currencies: string[];
  /** Binance only · the IP the user must paste into Binance's API
   * key IP-restriction field. */
  egress_ip?: string;
}

/** Free + locked balance · Binance shape. */
export interface BinanceBalance {
  free: string;   // Decimal stringified, NOT a number (precision)
  locked: string;
}

/** Coinbase / Noones · single Decimal string per currency. */
export type SimpleBalance = string;

/** Mixed shape · Binance has free/locked, Coinbase / Noones don't. */
export type Balances = Record<string, BinanceBalance | SimpleBalance>;

/** Active link in the user's account. */
export interface ExchangeLink {
  id: string;
  provider: ExchangeProvider;
  verified_at: string;
  last_used_at: string | null;
  scopes: string[];
  balances: Balances;
}

/** Persisted withdraw record · maps to ExchangeWithdrawal model. */
export interface ExchangeWithdrawal {
  id: string;
  provider: ExchangeProvider;
  currency: string;
  network: string;
  amount: string;
  destination_address: string;
  exchange_tx_id: string;
  on_chain_tx: string;
  status: "pending" | "confirming" | "done" | "failed";
  error_code: string;
  error_message: string;
  created_at: string;
  completed_at: string | null;
}

// ─────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────

export const exchangesApi = {
  // Discovery / read
  providers: () =>
    api.get<{ providers: ProviderInfo[] }>("/exchanges/providers/"),

  list: () =>
    api.get<{ links: ExchangeLink[] }>("/exchanges/"),

  // Binance · paste-key flow
  linkBinance: (data: { api_key: string; api_secret: string }) =>
    api.post<{
      link: ExchangeLink;
      supported_coins: string[];
      address_whitelist: Record<string, string[]>;
    }>("/exchanges/binance/link/", data),

  // OAuth · two-step (start returns URL · client opens it · callback
  // hits the deep link · client posts code+state to /complete/)
  coinbaseOAuthStart: (scheme: "app" | "web" = "app") =>
    api.get<{ authorize_url: string; state: string }>(
      "/exchanges/coinbase/oauth/start/",
      { params: { scheme } },
    ),

  coinbaseOAuthComplete: (data: {
    code: string;
    state: string;
    scheme?: "app" | "web";
  }) =>
    api.post<{ link: ExchangeLink }>(
      "/exchanges/coinbase/oauth/complete/",
      data,
    ),

  noonesOAuthStart: (scheme: "app" | "web" = "app") =>
    api.get<{ authorize_url: string; state: string }>(
      "/exchanges/noones/oauth/start/",
      { params: { scheme } },
    ),

  noonesOAuthComplete: (data: {
    code: string;
    state: string;
    scheme?: "app" | "web";
  }) =>
    api.post<{ link: ExchangeLink }>(
      "/exchanges/noones/oauth/complete/",
      data,
    ),

  // Unlink (revoke + wipe creds)
  unlink: (provider: ExchangeProvider) =>
    api.delete<{ unlinked: true }>(`/exchanges/${provider}/`),

  // Withdraw initiate · 202 + pull record. The mobile client polls
  // /withdrawals/<id>/ until terminal.
  withdraw: (
    provider: ExchangeProvider,
    data: { currency: string; amount: string; network?: string },
  ) =>
    api.post<ExchangeWithdrawal>(
      `/exchanges/${provider}/withdraw/`,
      data,
    ),

  // Withdraw history
  withdrawals: () =>
    api.get<{ withdrawals: ExchangeWithdrawal[] }>(
      "/exchanges/withdrawals/",
    ),

  withdrawalStatus: (id: string) =>
    api.get<ExchangeWithdrawal>(`/exchanges/withdrawals/${id}/`),
};
