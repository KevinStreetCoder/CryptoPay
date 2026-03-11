import { useLanguage } from "../contexts/LanguageContext";

/**
 * Hook for locale management with persistence.
 * Returns current locale, setter, and translation function.
 * Now backed by LanguageContext so all consumers re-render on locale change.
 */
export function useLocale() {
  return useLanguage();
}
