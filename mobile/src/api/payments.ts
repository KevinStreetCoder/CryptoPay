import { api } from "./client";

export interface Transaction {
  id: string;
  type: string;
  status: string;
  source_currency: string;
  source_amount: string;
  dest_currency: string;
  dest_amount: string;
  exchange_rate: string;
  fee_amount: string;
  fee_currency: string;
  mpesa_paybill: string;
  mpesa_till: string;
  mpesa_account: string;
  mpesa_phone: string;
  mpesa_receipt: string;
  excise_duty_amount: string;
  chain: string;
  tx_hash: string;
  confirmations: number;
  created_at: string;
  completed_at: string | null;
}

/** Helper: get the KES amount from a transaction (dest for payments, source for deposits) */
export function getTxKesAmount(tx: Transaction): number {
  if (tx.dest_currency === "KES") return parseFloat(tx.dest_amount || "0");
  if (tx.source_currency === "KES") return parseFloat(tx.source_amount || "0");
  return parseFloat(tx.dest_amount || tx.source_amount || "0");
}

/** Helper: get the crypto currency from a transaction */
export function getTxCrypto(tx: Transaction): { currency: string; amount: string } {
  if (tx.source_currency && tx.source_currency !== "KES") {
    return { currency: tx.source_currency, amount: tx.source_amount };
  }
  if (tx.dest_currency && tx.dest_currency !== "KES") {
    return { currency: tx.dest_currency, amount: tx.dest_amount };
  }
  return { currency: tx.source_currency, amount: tx.source_amount };
}

/** Helper: get display recipient from a transaction */
export function getTxRecipient(tx: Transaction): string {
  return tx.mpesa_phone || tx.mpesa_paybill || tx.mpesa_till || "";
}

export interface PayBillData {
  paybill: string;
  account: string;
  pin: string;
  idempotency_key: string;
  quote_id: string;
}

export interface PayTillData {
  till: string;
  pin: string;
  idempotency_key: string;
  quote_id: string;
}

export interface SendMpesaData {
  phone: string;
  amount_kes: string;
  crypto_currency: string;
  pin: string;
  idempotency_key: string;
  quote_id: string;
}

export interface BuyCryptoData {
  phone: string;
  quote_id: string;
  pin: string;
  idempotency_key: string;
}

export interface DepositQuoteData {
  kes_amount: string;
  dest_currency: string;
}

export interface C2BInstructions {
  paybill: string;
  account_formats: { currency: string; account_number: string; description: string }[];
  min_amount: number;
  max_amount: number;
  fee_percent: number;
  instructions: string[];
}

export const paymentsApi = {
  payBill: (data: PayBillData) => api.post<Transaction>("/payments/pay-bill/", data),
  payTill: (data: PayTillData) => api.post<Transaction>("/payments/pay-till/", data),
  sendMpesa: (data: SendMpesaData) => api.post<Transaction>("/payments/send-mpesa/", data),
  buyCrypto: (data: BuyCryptoData) => api.post<Transaction>("/payments/buy-crypto/", data),
  history: (page = 1) => api.get<{ results: Transaction[]; count: number }>("/payments/history/", { params: { page } }),
  // KES Deposit endpoints
  depositQuote: (data: DepositQuoteData) => api.post("/payments/deposit/quote/", data),
  depositStatus: (transactionId: string) => api.get<Transaction>(`/payments/deposit/${transactionId}/status/`),
  c2bInstructions: () => api.get<C2BInstructions>("/payments/deposit/c2b-instructions/"),
};
