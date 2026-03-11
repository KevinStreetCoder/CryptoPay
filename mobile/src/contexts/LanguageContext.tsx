import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { storage } from "../utils/storage";
import { i18n, t as translateFn } from "../i18n";

const LOCALE_STORAGE_KEY = "cryptopay_locale";

interface LanguageContextValue {
  locale: string;
  setLocale: (newLocale: string) => Promise<void>;
  t: (scope: string, options?: Record<string, unknown>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
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

  // Wrap t so it re-evaluates when locale changes
  const t = useCallback(
    (scope: string, options?: Record<string, unknown>) => {
      // locale dependency ensures re-render triggers new translations
      return translateFn(scope, options);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}

export { LanguageContext };
