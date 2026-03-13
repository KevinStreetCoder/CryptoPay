import { useEffect, useState } from "react";
import { Transaction } from "../api/payments";
import * as NotifStore from "../stores/notifications";

/**
 * Returns the live unread notification count.
 * Subscribes to the shared notification store so the count updates
 * instantly when a notification is marked read from any screen.
 */
export function useUnreadCount(transactions: Transaction[]) {
  const [, forceUpdate] = useState(0);

  // Load store on first mount
  useEffect(() => {
    NotifStore.loadReadIds();
  }, []);

  // Subscribe to store changes so we re-render when read state changes
  useEffect(() => {
    return NotifStore.subscribe(() => forceUpdate((n) => n + 1));
  }, []);

  const txIds = transactions.map((tx) => tx.id);
  const unreadCount = NotifStore.getUnreadCount(txIds);

  return { unreadCount };
}
