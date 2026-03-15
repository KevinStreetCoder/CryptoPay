/**
 * Real-time wallet balance updates via WebSocket.
 *
 * Connects to ws/wallets/ with JWT auth and receives balance updates
 * when transactions complete, deposits are credited, etc.
 *
 * Integrates with react-query: when a WS update arrives, it invalidates
 * the "wallets" query so the UI re-renders with fresh data.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { storage } from "../utils/storage";
import { useWebSocket } from "./useWebSocket";

export interface WalletBalance {
  id: string;
  currency: string;
  balance: string;
  locked_balance: string;
  available_balance: string;
}

interface UseWalletBalanceOptions {
  /** Whether the user is authenticated. Default true. */
  enabled?: boolean;
}

interface UseWalletBalanceReturn {
  /** Latest wallet balances from WebSocket */
  wallets: WalletBalance[];
  /** Whether the WebSocket is connected */
  connected: boolean;
  /** Request a balance refresh from the server */
  refresh: () => void;
}

export function useWalletBalance(
  options: UseWalletBalanceOptions = {}
): UseWalletBalanceReturn {
  const { enabled = true } = options;
  const queryClient = useQueryClient();

  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [token, setToken] = useState<string | null>(null);

  // Fetch token on mount / when enabled changes
  useEffect(() => {
    if (!enabled) {
      setToken(null);
      return;
    }

    let cancelled = false;
    storage.getItemAsync("access_token").then((t) => {
      if (!cancelled) setToken(t);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const params = useMemo(
    () => (token ? { token } : undefined),
    [token]
  );

  const handleMessage = useCallback(
    (data: any) => {
      if (data?.type === "balance_update" && data.wallets) {
        setWallets(data.wallets);
        // Invalidate the react-query wallets cache so useWallets() picks up
        // the new data on next render
        queryClient.invalidateQueries({ queryKey: ["wallets"] });
      }
    },
    [queryClient]
  );

  const { send, connected } = useWebSocket("ws/wallets/", {
    params: params ?? undefined,
    onMessage: handleMessage,
    enabled: enabled && !!token,
  });

  const refresh = useCallback(() => {
    send({ type: "refresh" });
  }, [send]);

  return { wallets, connected, refresh };
}
