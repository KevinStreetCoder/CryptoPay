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

  // Load persisted locale on mount · local storage is read first for
  // offline / pre-auth rendering. Once the user bootstraps, we also pull
  // `user.language` from /auth/profile/ and reconcile.
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
      // After any stored-locale load, try to pull the server-side preference.
      try {
        const { api } = await import("../api/client");
        const { data } = await api.get<{ language?: string }>("/auth/profile/");
        const serverLang = data?.language;
        if (serverLang && (serverLang === "en" || serverLang === "sw") && serverLang !== i18n.locale) {
          i18n.locale = serverLang;
          setLocaleState(serverLang);
          try {
            await storage.setItemAsync(LOCALE_STORAGE_KEY, serverLang);
          } catch {}
        }
      } catch {
        // Not authenticated yet, offline, or network hiccup · ignore.
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
    // Mirror the preference server-side so backend-originated messages
    // (welcome SMS, OTP SMS, transaction notifications) speak the same
    // language. Best-effort · we don't block the UI on this round-trip.
    try {
      const { api } = await import("../api/client");
      await api.patch("/auth/profile/", { language: newLocale });
    } catch {
      // Not authenticated yet or offline · the setting will sync next time
      // the user updates their profile. Local state is already correct.
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
