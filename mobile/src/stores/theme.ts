// CryptoPay Theme Store – dark/light mode with persistence
import { useState, useEffect, useCallback } from "react";
import { storage } from "../utils/storage";

type ThemeMode = "dark" | "light";

let _mode: ThemeMode = "dark";
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach((l) => l());
}

/** Call once at app startup to load persisted theme */
export async function initTheme() {
  try {
    const saved = await storage.getItemAsync("cryptopay_theme");
    if (saved === "light" || saved === "dark") {
      _mode = saved;
      notify();
    }
  } catch {}
}

/** React hook – re-renders when theme changes */
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(_mode);

  useEffect(() => {
    // Sync in case init finished before mount
    setMode(_mode);
    const listener = () => setMode(_mode);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  const toggle = useCallback(async () => {
    _mode = _mode === "dark" ? "light" : "dark";
    notify();
    await storage.setItemAsync("cryptopay_theme", _mode).catch(() => {});
  }, []);

  const setTheme = useCallback(async (m: ThemeMode) => {
    if (_mode === m) return;
    _mode = m;
    notify();
    await storage.setItemAsync("cryptopay_theme", m).catch(() => {});
  }, []);

  return { mode, isDark: mode === "dark", toggle, setTheme };
}

/** Non-reactive getter for use outside components */
export function getThemeMode(): ThemeMode {
  return _mode;
}
