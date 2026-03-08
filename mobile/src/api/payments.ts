import { api } from "./client";

export interface Transaction {
  id: string;
  type: string;
  status: string;
  crypto_currency: string;
  crypto_amount: string;
  kes_amount: string;
  rate_used: string;
  fee_amount: string;
  recipient_name: string;
  paybill_number: string;
  account_number: string;
  till_number: string;
  mpesa_receipt: string;
  created_at: string;
}

export interface PayBillData {
  paybill_number: string;
  account_number: string;
  amount_kes: string;
  crypto_currency: string;
  pin: string;
  idempotency_key: string;
  quote_id: string;
}

export interface PayTillData {
  till_number: string;
  amount_kes: string;
  crypto_currency: string;
  pin: string;
  idempotency_key: string;
  quote_id: string;
}

export const paymentsApi = {
  payBill: (data: PayBillData) => api.post<Transaction>("/payments/paybill/", data),
  payTill: (data: PayTillData) => api.post<Transaction>("/payments/till/", data),
  history: (page = 1) => api.get<{ results: Transaction[]; count: number }>("/payments/history/", { params: { page } }),
};
