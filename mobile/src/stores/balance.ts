import { useEffect, useState } from "react";
import { storage } from "../utils/storage";

const STORAGE_KEY = "cpay_balance_hidden";

// Module-level state · synced with persistent storage
let _balanceHidden: boolean = true; // default hidden until loaded from storage
let _loaded = false;
let _listeners: Set<() => void> = new Set();

function notify() {
  _listeners.forEach((l) => l());
}

/** Load persisted preference from storage (called once at app init) */
export async function initBalanceVisibility() {
  if (_loaded) return;
  try {
    const stored = await storage.getItemAsync(STORAGE_KEY);
    if (stored !== null) {
      _balanceHidden = stored === "true";
    }
    // If no stored value, default to hidden (true)
    _loaded = true;
    notify();
  } catch {
    _loaded = true;
  }
}

export function useBalanceVisibility() {
  const [balanceHidden, setBalanceHidden] = useState(_balanceHidden);

  useEffect(() => {
    // Load from storage on first use if not loaded
    if (!_loaded) {
      initBalanceVisibility();
    }
    const listener = () => setBalanceHidden(_balanceHidden);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  const toggleBalance = () => {
    _balanceHidden = !_balanceHidden;
    // Persist to storage
    storage.setItemAsync(STORAGE_KEY, _balanceHidden ? "true" : "false").catch(() => {});
    notify();
  };

  const formatAmount = (
    value: number,
    opts?: {
      minimumFractionDigits?: number;
      maximumFractionDigits?: number;
    }
  ): string => {
    if (balanceHidden) return "****";
    return value.toLocaleString("en-KE", opts);
  };

  const formatCrypto = (value: number, decimals: number): string => {
    if (balanceHidden) return "****";
    return value.toFixed(decimals);
  };

  return { balanceHidden, toggleBalance, formatAmount, formatCrypto };
}

/** Called on logout to reset visibility to hidden */
export function resetBalanceVisibility() {
  _balanceHidden = true;
  storage.setItemAsync(STORAGE_KEY, "true").catch(() => {});
  notify();
}
