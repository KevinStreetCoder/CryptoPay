import { useEffect, useState } from "react";

// Module-level state — resets every app launch (no async storage)
let _balanceHidden: boolean = true; // default hidden every session
let _listeners: Set<() => void> = new Set();

function notify() {
  _listeners.forEach((l) => l());
}

export function useBalanceVisibility() {
  const [balanceHidden, setBalanceHidden] = useState(_balanceHidden);

  useEffect(() => {
    const listener = () => setBalanceHidden(_balanceHidden);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  const toggleBalance = () => {
    _balanceHidden = !_balanceHidden;
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
  notify();
}
