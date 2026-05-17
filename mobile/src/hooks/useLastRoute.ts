/**
 * useLastRoute · saves the user's current route on every navigation
 * and restores it on app start (within a TTL window).
 *
 * 2026-05-09 · added because the user reported losing their place
 * when the APK reloaded after a network blip. Now: if the user was
 * on /payment/paybill and the bundle reloads, they land back on
 * /payment/paybill (not the home tab).
 *
 * Excluded routes (sensitive / shouldn't auto-resume):
 *   - /auth/*           · login, register, OTP screens
 *   - /payment/confirm  · the PIN-entry step (force review again)
 *   - /payment/success  · already-completed flows
 *   - /onboarding/*     · only meaningful as a one-shot
 *
 * The TTL is 30 minutes · longer than that, the user has likely
 * moved on / forgotten the context and we land them on the home tab.
 */
import { useEffect, useRef } from "react";
import { useRouter, useSegments, useGlobalSearchParams } from "expo-router";
import { storage } from "../utils/storage";

const STORAGE_KEY = "last_route_v1";
const TTL_MS = 30 * 60 * 1000; // 30 min

const EXCLUDED_PREFIXES = [
  "auth",
  "onboarding",
];
// 2026-05-17 · `/payment/detail` REMOVED from this list. The user
// wants the lock screen → unlock to drop them back on the tx detail
// screen so they can see the live status. Excluded paths are those
// that are transient by design (confirm = quote-locked, success =
// one-shot) · the detail page is durable + benefits from auto-
// refresh via react-query on remount.
const EXCLUDED_PATHS = [
  "/payment/confirm",
  "/payment/success",
];

interface LastRouteEnvelope {
  pathname: string;
  params: Record<string, string>;
  ts: number;
}

function shouldPersist(pathname: string, segments: string[]): boolean {
  if (!pathname) return false;
  if (segments?.[0] && EXCLUDED_PREFIXES.includes(segments[0])) return false;
  for (const p of EXCLUDED_PATHS) {
    if (pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`)) {
      return false;
    }
  }
  return true;
}

/**
 * Hook that saves the current route on every change. Call it ONCE
 * in `app/_layout.tsx` after the auth gate.
 */
export function useTrackLastRoute(enabled: boolean = true): void {
  const segments = useSegments();
  const params = useGlobalSearchParams();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const segArr = segments as unknown as string[];
    if (!segArr || segArr.length === 0) return;

    const pathname = "/" + segArr.join("/");
    if (!shouldPersist(pathname, segArr)) return;

    // Debounce so rapid back/forward navs don't churn storage.
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const safeParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(params || {})) {
        if (typeof v === "string") {
          safeParams[k] = v;
        } else if (Array.isArray(v) && typeof v[0] === "string") {
          safeParams[k] = v[0];
        }
      }
      const env: LastRouteEnvelope = {
        pathname,
        params: safeParams,
        ts: Date.now(),
      };
      storage.setItemAsync(STORAGE_KEY, JSON.stringify(env)).catch(() => {});
    }, 400);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [segments, params, enabled]);
}

/**
 * Restore the last saved route · call ONCE on app start AFTER auth
 * is verified. Returns the pathname/params if a recent route was
 * found, else null.
 *
 * Caller is responsible for navigating · we don't call router.replace
 * here because that races with the initial Expo Router mount.
 */
export async function getLastRouteIfFresh(): Promise<{
  pathname: string;
  params: Record<string, string>;
} | null> {
  try {
    const raw = await storage.getItemAsync(STORAGE_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as LastRouteEnvelope;
    if (!env?.pathname || typeof env.ts !== "number") return null;
    if (Date.now() - env.ts > TTL_MS) {
      // Stale · clear it.
      storage.deleteItemAsync(STORAGE_KEY).catch(() => {});
      return null;
    }
    return { pathname: env.pathname, params: env.params || {} };
  } catch {
    return null;
  }
}

export async function clearLastRoute(): Promise<void> {
  try {
    await storage.deleteItemAsync(STORAGE_KEY);
  } catch {}
}
