import { useEffect, useState, useCallback, useRef } from "react";
import { Transaction } from "../api/payments";
import { notificationsApi } from "../api/notifications";
import * as NotifStore from "../stores/notifications";

/**
 * Returns the live unread notification count.
 * Combines local transaction-based unread state with server-side
 * admin broadcast notification unread count.
 * Polls server every 30 seconds to keep the bell badge updated.
 */
export function useUnreadCount(transactions: Transaction[]) {
  const [, forceUpdate] = useState(0);
  const [serverUnread, setServerUnread] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load local store on first mount
  useEffect(() => {
    NotifStore.loadReadIds();
  }, []);

  // Subscribe to local store changes so we re-render when read state changes
  useEffect(() => {
    return NotifStore.subscribe(() => forceUpdate((n) => n + 1));
  }, []);

  // Fetch server-side unread count
  const fetchServerCount = useCallback(async () => {
    try {
      const { data } = await notificationsApi.unreadCount();
      setServerUnread(data.unread_count);
    } catch {
      // silently ignore — don't break the UI
    }
  }, []);

  useEffect(() => {
    fetchServerCount();
    intervalRef.current = setInterval(fetchServerCount, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchServerCount]);

  // Local (transaction-based) unread count
  const txIds = transactions.map((tx) => tx.id);
  const localUnread = NotifStore.getUnreadCount(txIds);

  // Combined count
  const unreadCount = localUnread + serverUnread;

  return { unreadCount, refresh: fetchServerCount };
}
