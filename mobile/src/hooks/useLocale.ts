import { useState, useEffect, useCallback } from "react";
import { storage } from "../utils/storage";
import { i18n, t } from "../i18n";

const LOCALE_STORAGE_KEY = "cryptopay_locale";

/**
 * Hook for locale management with persistence.
 * Returns current locale, setter, and translation function.
 */
export function useLocale() {
  const [locale, setLocaleState] = useState<string>(i18n.locale);

  // Load persisted locale on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await storage.getItemAsync(LOCALE_STORAGE_KEY);
        if (saved && (saved === "en" || saved === "sw")) {
          i18n.locale = saved;
          setLocaleState(saved);
        }
      } catch {
        // Use default locale
      }
    })();
  }, []);

  const setLocale = useCallback(async (newLocale: string) => {
    i18n.locale = newLocale;
    setLocaleState(newLocale);
    try {
      await storage.setItemAsync(LOCALE_STORAGE_KEY, newLocale);
    } catch {
      // Storage write failed silently
    }
  }, []);

  return { locale, setLocale, t };
}
