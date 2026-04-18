import { useEffect, useRef, useCallback, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import { storage } from "../utils/storage";

const LOCK_TIMEOUT_KEY = "app_lock_timeout";
const LAST_ACTIVE_KEY = "app_last_active";

// -1 = never lock (user opted out). Other values are seconds.
export type LockTimeout = -1 | 0 | 60 | 300 | 900 | 1800;

export const LOCK_TIMEOUT_OPTIONS: { label: string; value: LockTimeout }[] = [
  { label: "Immediately", value: 0 },
  { label: "After 1 minute", value: 60 },
  { label: "After 5 minutes", value: 300 },
  { label: "After 15 minutes", value: 900 },
  { label: "After 30 minutes", value: 1800 },
  { label: "Never", value: -1 },
];

const VALID_TIMEOUTS: LockTimeout[] = [-1, 0, 60, 300, 900, 1800];

// Pub/sub so the active session picks up timeout changes from the
// settings screen without waiting for the next bg→fg transition.
const _listeners = new Set<(t: LockTimeout) => void>();
function _notifyTimeoutChange(t: LockTimeout) {
  _listeners.forEach((cb) => cb(t));
}

export async function getLockTimeout(): Promise<LockTimeout> {
  const val = await storage.getItemAsync(LOCK_TIMEOUT_KEY);
  if (val === null) return 0; // default: immediate
  const num = parseInt(val, 10);
  if (VALID_TIMEOUTS.includes(num as LockTimeout)) return num as LockTimeout;
  return 0;
}

export async function setLockTimeout(timeout: LockTimeout): Promise<void> {
  await storage.setItemAsync(LOCK_TIMEOUT_KEY, String(timeout));
  _notifyTimeoutChange(timeout);
}

async function getLastActive(): Promise<number> {
  const val = await storage.getItemAsync(LAST_ACTIVE_KEY);
  return val ? parseInt(val, 10) : 0;
}

async function setLastActive(): Promise<void> {
  await storage.setItemAsync(LAST_ACTIVE_KEY, String(Date.now()));
}

/**
 * Hook that monitors app state and determines when the lock screen should show.
 *
 * Lock fires on cold start AND on background→foreground transitions, gated
 * by the user's chosen timeout. Lock is enabled whenever the user is
 * authenticated — `AppLockScreen` falls back to PIN when biometric isn't
 * available, so PIN-only users still get the gate.
 *
 * `biometricEnabled` is no longer required (but accepted for callsite
 * compat); the kept param documents that biometric is preferred when
 * present and is read by `AppLockScreen` directly.
 *
 * Native-only: web doesn't have AppState transitions that map cleanly to
 * the lock model.
 */
export function useAppLock(_biometricEnabled: boolean, isAuthenticated: boolean) {
  const [locked, setLocked] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const lockTimeoutRef = useRef<LockTimeout>(0);

  // Subscribe to timeout setting changes — the settings screen calls
  // setLockTimeout() which fires _notifyTimeoutChange, so the active
  // session picks up the new value immediately instead of waiting for
  // a bg→fg transition or app restart.
  useEffect(() => {
    getLockTimeout().then((t) => {
      lockTimeoutRef.current = t;
    });
    const cb = (t: LockTimeout) => {
      lockTimeoutRef.current = t;
    };
    _listeners.add(cb);
    return () => {
      _listeners.delete(cb);
    };
  }, []);

  // Lock on cold start when user is authenticated.
  useEffect(() => {
    if (initialCheckDone || !isAuthenticated || Platform.OS === "web") return;

    (async () => {
      lockTimeoutRef.current = await getLockTimeout();
      const timeout = lockTimeoutRef.current;
      // "Never" disables the lock entirely.
      if (timeout === -1) {
        setInitialCheckDone(true);
        return;
      }
      const lastActive = await getLastActive();
      const elapsed = (Date.now() - lastActive) / 1000;

      // Lock if: no last active (fresh open), or elapsed > timeout
      if (lastActive === 0 || elapsed >= timeout) {
        setLocked(true);
      }
      setInitialCheckDone(true);
    })();
  }, [isAuthenticated, initialCheckDone]);

  const checkAndLock = useCallback(async () => {
    if (!isAuthenticated || Platform.OS === "web") return;

    const timeout = lockTimeoutRef.current;
    if (timeout === -1) return; // Never lock.

    const lastActive = await getLastActive();
    const elapsed = (Date.now() - lastActive) / 1000;

    // Debounce only when user picked a non-zero timeout. For "Immediately"
    // (timeout=0) we honor the choice and lock on any bg→fg transition.
    // The 5s floor exists to avoid locking on transient inactive states
    // (image picker, share sheet, biometric prompt, control center) for
    // users who picked a real timeout.
    const effectiveTimeout = timeout === 0 ? 0 : Math.max(timeout, 5);

    if (lastActive === 0 || elapsed >= effectiveTimeout) {
      setLocked(true);
    }
  }, [isAuthenticated]);

  const unlock = useCallback(() => {
    setLocked(false);
    setLastActive();
  }, []);

  // Monitor background→foreground transitions
  useEffect(() => {
    if (Platform.OS === "web" || !isAuthenticated) return;

    const subscription = AppState.addEventListener("change", async (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        // Re-read in case the user changed the setting while backgrounded.
        lockTimeoutRef.current = await getLockTimeout();
        await checkAndLock();
      }
      if (nextState.match(/inactive|background/)) {
        await setLastActive();
      }
      appState.current = nextState;
    });

    return () => subscription.remove();
  }, [isAuthenticated, checkAndLock]);

  return { locked, unlock };
}
