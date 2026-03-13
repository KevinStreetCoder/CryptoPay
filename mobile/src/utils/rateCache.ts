/**
 * Offline rate & quote cache.
 * Caches exchange rates and recent quotes so users see
 * "Last updated X min ago" data even on flaky 2G networks.
 *
 * Uses existing storage (SecureStore on native, localStorage on web).
 */
import { storage } from "./storage";

const RATE_CACHE_KEY = "cryptopay_rate_cache";
const QUOTE_CACHE_KEY = "cryptopay_quote_cache";
const RATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export interface CachedRate {
  currency: string;
  kes_rate: string;
  usd_rate: string;
  timestamp: number; // epoch ms
}

export interface CachedQuote {
  quote_id: string;
  currency: string;
  exchange_rate: string;
  crypto_amount: string;
  kes_amount: string;
  fee_kes: string;
  excise_duty_kes: string;
  timestamp: number;
}

// ── Rates ────────────────────────────────────────────────────────────────────

/** Save rates to local cache */
export async function cacheRates(rates: Omit<CachedRate, "timestamp">[]): Promise<void> {
  const data = rates.map((r) => ({ ...r, timestamp: Date.now() }));
  await storage.setItemAsync(RATE_CACHE_KEY, JSON.stringify(data));
}

/** Get cached rates (returns null if stale or missing) */
export async function getCachedRates(): Promise<CachedRate[] | null> {
  const raw = await storage.getItemAsync(RATE_CACHE_KEY);
  if (!raw) return null;
  try {
    const data: CachedRate[] = JSON.parse(raw);
    // Return even if stale — caller decides what to show
    return data;
  } catch {
    return null;
  }
}

/** Check if cached rates are fresh (within max age) */
export function isRateFresh(rate: CachedRate): boolean {
  return Date.now() - rate.timestamp < RATE_MAX_AGE_MS;
}

/** Human-readable age string */
export function rateAge(rate: CachedRate): string {
  const diffMs = Date.now() - rate.timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHrs = Math.floor(diffMin / 60);
  return `${diffHrs}h ago`;
}

// ── Quotes ───────────────────────────────────────────────────────────────────

/** Cache the most recent quote per currency */
export async function cacheQuote(quote: Omit<CachedQuote, "timestamp">): Promise<void> {
  const existing = await getCachedQuotes();
  const updated = existing.filter((q) => q.currency !== quote.currency);
  updated.push({ ...quote, timestamp: Date.now() });
  // Keep max 10 quotes
  const trimmed = updated.slice(-10);
  await storage.setItemAsync(QUOTE_CACHE_KEY, JSON.stringify(trimmed));
}

/** Get all cached quotes */
export async function getCachedQuotes(): Promise<CachedQuote[]> {
  const raw = await storage.getItemAsync(QUOTE_CACHE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Clear all cached data */
export async function clearRateCache(): Promise<void> {
  await storage.deleteItemAsync(RATE_CACHE_KEY);
  await storage.deleteItemAsync(QUOTE_CACHE_KEY);
}
