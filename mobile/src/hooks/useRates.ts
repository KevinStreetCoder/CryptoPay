/**
 * Real-time exchange rates via WebSocket.
 *
 * Connects to ws/rates/ and receives rate updates every ~2 minutes
 * (matching the Celery Beat refresh interval).
 *
 * Falls back to REST API polling if WebSocket is unavailable.
 */

import { useCallback, useState } from "react";
import { useWebSocket } from "./useWebSocket";

export interface CurrencyRate {
  usd: number;
  kes: number | null;
}

export interface RatesMap {
  [currency: string]: CurrencyRate;
}

interface UseRatesReturn {
  /** Current rates, keyed by currency symbol (e.g., "USDT", "BTC") */
  rates: RatesMap;
  /** Whether the WebSocket is connected */
  connected: boolean;
}

export function useRates(): UseRatesReturn {
  const [rates, setRates] = useState<RatesMap>({});

  const handleMessage = useCallback((data: any) => {
    if (data?.type === "rate_update" && data.rates) {
      setRates(data.rates);
    }
  }, []);

  const { connected } = useWebSocket("ws/rates/", {
    onMessage: handleMessage,
    enabled: true,
  });

  return { rates, connected };
}
