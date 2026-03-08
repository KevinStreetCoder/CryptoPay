import { I18n } from "i18n-js";
import { getLocales } from "expo-localization";
import en from "./en";
import sw from "./sw";

const i18n = new I18n({ en, sw });

// Auto-detect device locale
const deviceLocales = getLocales();
const deviceLang = deviceLocales?.[0]?.languageCode ?? "en";

// Use Swahili if device is set to Swahili, otherwise English
i18n.locale = deviceLang === "sw" ? "sw" : "en";
i18n.enableFallback = true;
i18n.defaultLocale = "en";

/**
 * Translate a key. Supports dot-notation: t("home.totalBalance")
 */
export function t(scope: string, options?: Record<string, unknown>): string {
  return i18n.t(scope, options);
}

export { i18n };
export default i18n;
