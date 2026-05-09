/**
 * usePersistedState · drop-in replacement for `useState` that auto-saves
 * to AsyncStorage / localStorage so the value survives:
 *   - JS bundle reloads (network change → expo-router refresh, RN
 *     bridge restart, OOM kill)
 *   - App-killed-then-reopened
 *   - APK upgrade in place (vc N → vc N+1)
 *
 * 2026-05-09 · added because the user reported losing the paybill /
 * amount / phone they had typed when network changed and the APK
 * silently reloaded. Form fields on the high-friction payment screens
 * (Send to M-Pesa, Pay Bill, Buy Goods, Send to Bank, Buy Crypto)
 * cost 10-30 seconds of typing — wiping them is brutal UX.
 *
 * Usage · just swap useState for usePersistedState and pass a stable
 * key. Multiple components on the same screen can share the same key
 * by passing a different field name suffix.
 *
 *   const [phone, setPhone] = usePersistedState("send_phone", "");
 *   const [amount, setAmount] = usePersistedState("send_amount", "");
 *
 * The hook persists strings only · pass JSON.stringify() values for
 * objects. TTL defaults to 24 h (we don't want a paybill from last
 * week pre-filling today). Pass `ttlMs: 0` to disable.
 *
 * Restoration is async (storage is async), so the first render
 * returns the `initial` value and the persisted value swaps in once
 * the async fetch completes. Components that care about the
 * "restored vs fresh" distinction can check the second tuple value.
 */
import { useEffect, useRef, useState } from "react";
import { storage } from "../utils/storage";

const KEY_PREFIX = "fp_";  // form-persistence
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;  // 24 h

interface PersistedEnvelope {
  v: string;
  ts: number;
}

export function usePersistedState(
  key: string,
  initial: string,
  options: { ttlMs?: number; debounceMs?: number } = {},
): [string, (next: string) => void, { restored: boolean }] {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const debounceMs = options.debounceMs ?? 250;
  const fullKey = `${KEY_PREFIX}${key}`;

  const [value, setValue] = useState<string>(initial);
  const [restored, setRestored] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Restore on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await storage.getItemAsync(fullKey);
        if (cancelled) return;
        if (!raw) {
          setRestored(true);
          return;
        }
        let env: PersistedEnvelope | null = null;
        try {
          env = JSON.parse(raw) as PersistedEnvelope;
        } catch {
          // Legacy plain-string fallback so we don't break older saves.
          env = { v: raw, ts: Date.now() };
        }
        if (!env || typeof env.v !== "string") {
          setRestored(true);
          return;
        }
        if (ttlMs > 0 && env.ts && Date.now() - env.ts > ttlMs) {
          // Stale · clear it and use the initial.
          try { await storage.deleteItemAsync(fullKey); } catch {}
          setRestored(true);
          return;
        }
        if (env.v && env.v !== initial) {
          setValue(env.v);
        }
        setRestored(true);
      } catch {
        setRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fullKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  // Persist on every change · debounced so a fast typist doesn't
  // hammer storage with a write per keystroke.
  useEffect(() => {
    if (!restored) return; // don't persist before first restore
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      const env: PersistedEnvelope = { v: value, ts: Date.now() };
      // Empty string · delete the key so the next mount uses `initial`.
      if (value === "") {
        storage.deleteItemAsync(fullKey).catch(() => {});
      } else {
        storage.setItemAsync(fullKey, JSON.stringify(env)).catch(() => {});
      }
    }, debounceMs);
  }, [value, restored, fullKey, debounceMs]);

  return [value, setValue, { restored }];
}

/**
 * Clear all persisted form state · used after a successful payment
 * so the next visit doesn't pre-fill the previous recipient's
 * details. Call with a list of keys you want to wipe.
 */
export async function clearPersistedFields(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((k) => storage.deleteItemAsync(`${KEY_PREFIX}${k}`).catch(() => {})),
  );
}
