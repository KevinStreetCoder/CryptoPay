/**
 * useScrollPersist · save + restore scroll position for a key.
 *
 * 2026-05-09 · used on the home + history tabs and any long list
 * screen where the user might have scrolled deep before the APK
 * reloaded.
 *
 * Usage:
 *   const scrollProps = useScrollPersist("home_feed");
 *   <ScrollView {...scrollProps} ...>
 *
 * The hook returns props you spread onto a ScrollView (or any
 * component that exposes `onScroll` + a `ref` you can call
 * `.scrollTo()` on). `keepScrollResponder` is added so the responder
 * survives the post-restore scroll.
 *
 * Persistence is debounced 300ms while scrolling and TTL'd at 1 h
 * so a long-stale scroll position doesn't snap the user to a place
 * they don't remember.
 */
import { useCallback, useEffect, useRef } from "react";
import { ScrollView, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { storage } from "../utils/storage";

const KEY_PREFIX = "scroll_v1_";
const TTL_MS = 60 * 60 * 1000; // 1 h
const DEBOUNCE_MS = 300;

interface ScrollEnvelope {
  y: number;
  ts: number;
}

export function useScrollPersist(key: string): {
  ref: React.RefObject<ScrollView | null>;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
} {
  const ref = useRef<ScrollView | null>(null);
  const lastY = useRef<number>(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullKey = `${KEY_PREFIX}${key}`;
  const restoredRef = useRef(false);

  // Restore on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await storage.getItemAsync(fullKey);
        if (cancelled || !raw) return;
        const env = JSON.parse(raw) as ScrollEnvelope;
        if (!env || typeof env.y !== "number") return;
        if (Date.now() - env.ts > TTL_MS) {
          storage.deleteItemAsync(fullKey).catch(() => {});
          return;
        }
        // Defer the scrollTo until the next tick so the ScrollView
        // has finished its initial layout · scrolling before layout
        // is a no-op on Android.
        setTimeout(() => {
          if (!cancelled && ref.current && env.y > 0) {
            ref.current.scrollTo({ y: env.y, animated: false });
          }
          restoredRef.current = true;
        }, 50);
      } catch {
        restoredRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [fullKey]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      lastY.current = y;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        const env: ScrollEnvelope = { y: lastY.current, ts: Date.now() };
        storage.setItemAsync(fullKey, JSON.stringify(env)).catch(() => {});
      }, DEBOUNCE_MS);
    },
    [fullKey],
  );

  return {
    ref,
    onScroll,
    scrollEventThrottle: 200,
  };
}
