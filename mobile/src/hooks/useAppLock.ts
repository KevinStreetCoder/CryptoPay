import { useEffect, useRef, useCallback, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import { storage } from "../utils/storage";

const LOCK_TIMEOUT_KEY = "app_lock_timeout";
const LAST_ACTIVE_KEY = "app_last_active";

export type LockTimeout = 0 | 60 | 300 | 900 | 1800; // seconds: immediate, 1m, 5m, 15m, 30m

export const LOCK_TIMEOUT_OPTIONS: { label: string; value: LockTimeout }[] = [
  { label: "Immediately", value: 0 },
  { label: "After 1 minute", value: 60 },
  { label: "After 5 minutes", value: 300 },
  { label: "After 15 minutes", value: 900 },
  { label: "After 30 minutes", value: 1800 },
];

export async function getLockTimeout(): Promise<LockTimeout> {
  const val = await storage.getItemAsync(LOCK_TIMEOUT_KEY);
  if (val === null) return 0; // default: immediate
  const num = parseInt(val, 10);
  if ([0, 60, 300, 900, 1800].includes(num)) return num as LockTimeout;
  return 0;
}

export async function setLockTimeout(timeout: LockTimeout): Promise<void> {
  await storage.setItemAsync(LOCK_TIMEOUT_KEY, String(timeout));
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
 * Locks on cold start AND on background→foreground transitions.
 * Only active on native platforms (iOS/Android).
 */
export function useAppLock(biometricEnabled: boolean, isAuthenticated: boolean) {
  const [locked, setLocked] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const lockTimeoutRef = useRef<LockTimeout>(0);

  // Load lock timeout on mount
  useEffect(() => {
    getLockTimeout().then((t) => {
      lockTimeoutRef.current = t;
    });
  }, []);

  // Lock on cold start when biometric is enabled and user is authenticated
  useEffect(() => {
    if (initialCheckDone || !biometricEnabled || !isAuthenticated || Platform.OS === "web") return;

    (async () => {
      lockTimeoutRef.current = await getLockTimeout();
      const timeout = lockTimeoutRef.current;
      const lastActive = await getLastActive();
      const elapsed = (Date.now() - lastActive) / 1000;

      // Lock if: no last active (fresh open), or elapsed > timeout
      if (lastActive === 0 || elapsed >= timeout) {
        setLocked(true);
      }
      setInitialCheckDone(true);
    })();
  }, [biometricEnabled, isAuthenticated, initialCheckDone]);

  const checkAndLock = useCallback(async () => {
    if (!biometricEnabled || !isAuthenticated || Platform.OS === "web") return;

    const timeout = lockTimeoutRef.current;
    const lastActive = await getLastActive();
    const elapsed = (Date.now() - lastActive) / 1000;

    if (lastActive === 0 || elapsed >= timeout) {
      setLocked(true);
    }
  }, [biometricEnabled, isAuthenticated]);

  const unlock = useCallback(() => {
    setLocked(false);
    setLastActive();
  }, []);

  // Monitor background→foreground transitions
  useEffect(() => {
    if (Platform.OS === "web" || !biometricEnabled || !isAuthenticated) return;

    const subscription = AppState.addEventListener("change", async (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        // Refresh timeout setting in case it changed
        lockTimeoutRef.current = await getLockTimeout();
        await checkAndLock();
      }
      if (nextState.match(/inactive|background/)) {
        await setLastActive();
      }
      appState.current = nextState;
    });

    return () => subscription.remove();
  }, [biometricEnabled, isAuthenticated, checkAndLock]);

  return { locked, unlock };
}
