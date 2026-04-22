/**
 * Display Currency Context
 *
 * Single source of truth for the user's display-currency preference (KES / USD)
 * across the whole app. All balance + amount formatting should go through
 * `useDisplayCurrency().formatKes(...)` instead of hardcoded "KSh" templates.
 *
 * Why the backend still returns KES everywhere:
 *   · M-Pesa settles in KES
 *   · Wallet.kes_value is the canonical portfolio valuation
 *   · The backend does not need to care how the user wants to see numbers
 *
 * The conversion to USD is a purely presentational transform using the
 * currently-cached USD/KES forex rate from `ratesApi.getRate("USDT")`. The
 * hook polls every 60s so the rate stays fresh while the app is open.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { storage } from "../utils/storage";
import { ratesApi } from "../api/rates";

export type DisplayCurrencyCode = "KES" | "USD";

interface DisplayCurrencyContextValue {
  code: DisplayCurrencyCode;
  symbol: string;
  usdKesRate: number;
  isLoaded: boolean;
  setCode: (c: DisplayCurrencyCode) => Promise<void>;
  /** Convert a KES-denominated value to the display currency and format. */
  formatKes: (
    kesAmount: number | string | null | undefined,
    opts?: {
      digits?: number;          // default 2
      compact?: boolean;        // 1M / 1K suffix when large
      fallback?: string;        // returned on invalid input (default "KSh 0")
    },
  ) => string;
  /** Same as formatKes but returns the numeric display value (no symbol). */
  convertKes: (kesAmount: number | string | null | undefined) => number;
  /** Format a USD-denominated amount. Used when the backend returns USD directly. */
  formatUsd: (
    usdAmount: number | string | null | undefined,
    opts?: { digits?: number; fallback?: string },
  ) => string;
}

const STORAGE_KEY = "cryptopay_display_currency";
const DEFAULT_USD_KES = 130; // last-resort fallback if rate fetch fails on first load

const Ctx = createContext<DisplayCurrencyContextValue | null>(null);

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return NaN;
  if (typeof v === "number") return v;
  const n = parseFloat(v);
  return isFinite(n) ? n : NaN;
}

export function DisplayCurrencyProvider({ children }: { children: React.ReactNode }) {
  const [code, setCodeState] = useState<DisplayCurrencyCode>("KES");
  const [usdKesRate, setUsdKesRate] = useState<number>(DEFAULT_USD_KES);
  const [isLoaded, setIsLoaded] = useState(false);
  const mountedRef = useRef(true);

  // Hydrate the stored preference (synchronous for web localStorage,
  // async for native SecureStore).
  useEffect(() => {
    let cancelled = false;
    storage.getItemAsync(STORAGE_KEY).then((v) => {
      if (cancelled) return;
      if (v === "USD" || v === "KES") {
        setCodeState(v);
      }
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll the USD/KES rate every 60s. Uses the existing /rates/ endpoint
  // which already returns `usd_kes` alongside each crypto quote.
  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      try {
        const { data } = await ratesApi.getRate("USDT");
        const r = parseFloat((data as any).usd_kes || "0");
        if (r > 0 && mountedRef.current) {
          setUsdKesRate(r);
        }
      } catch {
        // Keep the last-known rate on failure. Dashboard will still render
        // using whatever we had before (or DEFAULT_USD_KES on cold start).
      }
    }

    refresh();
    timer = setInterval(refresh, 60_000);
    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  const setCode = useCallback(async (c: DisplayCurrencyCode) => {
    setCodeState(c);
    try {
      await storage.setItemAsync(STORAGE_KEY, c);
    } catch {
      // Storage write failure is non-fatal · in-memory state still changes.
    }
  }, []);

  const symbol = code === "USD" ? "$" : "KSh";

  const convertKes = useCallback(
    (kesAmount: number | string | null | undefined): number => {
      const n = toNumber(kesAmount);
      if (!isFinite(n)) return 0;
      if (code === "USD") {
        if (usdKesRate <= 0) return 0;
        return n / usdKesRate;
      }
      return n;
    },
    [code, usdKesRate],
  );

  const formatKes = useCallback(
    (
      kesAmount: number | string | null | undefined,
      opts?: { digits?: number; compact?: boolean; fallback?: string },
    ): string => {
      const digits = opts?.digits ?? 2;
      const compact = !!opts?.compact;
      const fallback = opts?.fallback ?? `${symbol} 0`;
      const n = toNumber(kesAmount);
      if (!isFinite(n)) return fallback;
      const val = code === "USD" ? (usdKesRate > 0 ? n / usdKesRate : 0) : n;
      const locale = code === "USD" ? "en-US" : "en-KE";
      const abs = Math.abs(val);
      if (compact && abs >= 1_000_000) {
        return `${symbol} ${(val / 1_000_000).toLocaleString(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}M`;
      }
      if (compact && abs >= 10_000) {
        return `${symbol} ${(val / 1_000).toLocaleString(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}K`;
      }
      return `${symbol} ${val.toLocaleString(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}`;
    },
    [code, usdKesRate, symbol],
  );

  const formatUsd = useCallback(
    (
      usdAmount: number | string | null | undefined,
      opts?: { digits?: number; fallback?: string },
    ): string => {
      const digits = opts?.digits ?? 2;
      const fallback = opts?.fallback ?? `${symbol} 0`;
      const n = toNumber(usdAmount);
      if (!isFinite(n)) return fallback;
      // If user prefers KES and backend gave us USD, convert back.
      const val = code === "USD" ? n : n * (usdKesRate > 0 ? usdKesRate : DEFAULT_USD_KES);
      const locale = code === "USD" ? "en-US" : "en-KE";
      return `${symbol} ${val.toLocaleString(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}`;
    },
    [code, usdKesRate, symbol],
  );

  const value: DisplayCurrencyContextValue = {
    code,
    symbol,
    usdKesRate,
    isLoaded,
    setCode,
    formatKes,
    convertKes,
    formatUsd,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDisplayCurrency(): DisplayCurrencyContextValue {
  const v = useContext(Ctx);
  if (!v) {
    // Fail-soft: return a degraded KES-only formatter instead of crashing.
    // This keeps legacy callers rendering correctly if the provider hasn't
    // mounted yet (e.g. during a split-bundle race on web).
    return {
      code: "KES",
      symbol: "KSh",
      usdKesRate: DEFAULT_USD_KES,
      isLoaded: false,
      setCode: async () => {},
      formatKes: (kes, opts) => {
        const digits = opts?.digits ?? 2;
        const n = toNumber(kes);
        if (!isFinite(n)) return opts?.fallback ?? "KSh 0";
        return `KSh ${n.toLocaleString("en-KE", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })}`;
      },
      convertKes: (kes) => {
        const n = toNumber(kes);
        return isFinite(n) ? n : 0;
      },
      formatUsd: (usd, opts) => {
        const digits = opts?.digits ?? 2;
        const n = toNumber(usd);
        if (!isFinite(n)) return opts?.fallback ?? "KSh 0";
        return `KSh ${(n * DEFAULT_USD_KES).toLocaleString("en-KE", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })}`;
      },
    };
  }
  return v;
}
