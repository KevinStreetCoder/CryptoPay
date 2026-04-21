/**
 * Generic WebSocket hook with auto-reconnect and exponential backoff.
 *
 * Handles connection lifecycle, automatic reconnection on disconnect,
 * and JSON message parsing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import { config } from "../constants/config";

interface UseWebSocketOptions {
  /** Query params appended to the WS URL (e.g., { token: "xxx" }) */
  params?: Record<string, string>;
  /** Called when a JSON message is received */
  onMessage?: (data: any) => void;
  /** Whether the hook should connect. Default true. */
  enabled?: boolean;
  /** Max reconnect attempts before giving up. Default 10. */
  maxRetries?: number;
}

interface UseWebSocketReturn {
  /** Send a JSON message through the WebSocket */
  send: (data: any) => void;
  /** Current connection status */
  connected: boolean;
  /** Last received message data */
  lastMessage: any;
}

/**
 * Derive the WebSocket base URL from the API URL.
 * http://host:port/api/v1 -> ws://host:port
 * https://host/api/v1    -> wss://host
 */
function getWsBaseUrl(): string {
  const apiUrl = config.apiUrl; // e.g. "http://localhost:8000/api/v1"

  // Strip /api/v1 suffix
  const base = apiUrl.replace(/\/api\/v1\/?$/, "");

  // Replace http(s) with ws(s)
  return base.replace(/^http/, "ws");
}

export function useWebSocket(
  path: string,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const { params, onMessage, enabled = true, maxRetries = 10 } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Serialize params to a stable string so useCallback doesn't re-create on every render
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Close any existing connection
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
    }

    // Build URL
    const baseUrl = getWsBaseUrl();
    let url = `${baseUrl}/${path.replace(/^\//, "")}`;

    const currentParams = paramsRef.current;
    if (currentParams && Object.keys(currentParams).length > 0) {
      const qs = new URLSearchParams(currentParams).toString();
      url += `?${qs}`;
    }

    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (unmountedRef.current) {
        ws.close();
        return;
      }
      retryCountRef.current = 0;
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastMessage(data);
        onMessageRef.current?.(data);
      } catch {
        // Non-JSON message · ignore
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;

      if (unmountedRef.current) return;

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
      if (retryCountRef.current < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
        retryCountRef.current += 1;
        retryTimeoutRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnection
    };

    wsRef.current = ws;
  }, [path, maxRetries]);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // Connect/disconnect based on enabled flag
  useEffect(() => {
    unmountedRef.current = false;

    if (enabled) {
      connect();
    }

    return () => {
      unmountedRef.current = true;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [enabled, connect]);

  // Reconnect when app comes back to foreground (mobile)
  useEffect(() => {
    if (Platform.OS === "web") return;

    const handleAppState = (state: AppStateStatus) => {
      if (state === "active" && enabled && !wsRef.current) {
        retryCountRef.current = 0;
        connect();
      }
    };

    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [enabled, connect]);

  return { send, connected, lastMessage };
}
