import { useCallback, useEffect, useRef, useState } from "react";
import { notificationsApi, ServerNotification } from "../api/notifications";

/**
 * Hook to fetch server-side unread notification count.
 * Polls every 30 seconds to keep the bell badge updated.
 */
export function useServerUnreadCount() {
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    try {
      const { data } = await notificationsApi.unreadCount();
      setUnreadCount(data.unread_count);
    } catch {
      // silently fail · don't disrupt UI
    }
  }, []);

  useEffect(() => {
    fetch();
    intervalRef.current = setInterval(fetch, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetch]);

  return { unreadCount, refresh: fetch };
}
