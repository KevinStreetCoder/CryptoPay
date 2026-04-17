// CryptoPay Premium Design System v3.0
// Dark/Light theme with glassmorphism effects

/** Dark theme (default) – kept as `colors` for backward compat */
export const colors = {
  primary: {
    50: "#ECFDF5",
    100: "#D1FAE5",
    200: "#A7F3D0",
    300: "#6EE7B7",
    400: "#34D399",
    500: "#10B981",
    600: "#059669",
    700: "#047857",
    800: "#065F46",
    900: "#064E3B",
  },
  dark: {
    bg: "#060E1F",
    card: "#0C1A2E",
    elevated: "#162742",
    border: "#1E3350",
    muted: "#556B82",
  },
  accent: "#F59E0B",
  accentLight: "#FCD34D",
  accentDark: "#D97706",
  success: "#10B981",
  error: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",
  white: "#FFFFFF",
  textPrimary: "#F0F4F8",
  // Bumped from #8899AA (~3.5:1 on dark bg) to meet WCAG AA 4.5:1 on #060E1F.
  textSecondary: "#A8BBCC",
  textMuted: "#6B8299",

  // Glass morphism
  glass: {
    bg: "rgba(12, 26, 46, 0.8)",
    bgLight: "rgba(22, 39, 66, 0.6)",
    border: "rgba(255, 255, 255, 0.08)",
    borderStrong: "rgba(255, 255, 255, 0.14)",
    highlight: "rgba(255, 255, 255, 0.03)",
  },

  // Crypto brand colors
  crypto: {
    USDC: "#2775CA",
    USDT: "#26A17B",
    BTC: "#F7931A",
    SOL: "#9945FF",
    ETH: "#627EEA",
    KES: "#10B981",
  } as Record<string, string>,
} as const;

import { Platform } from "react-native";

const isWeb = Platform.OS === "web";

/** Cross-platform shadow that uses boxShadow on web, shadow* props on native */
function makeShadow(color: string, offsetY: number, blur: number, opacity: number, elevation: number) {
  if (isWeb) {
    const r = parseInt(color.slice(1, 3), 16) || 0;
    const g = parseInt(color.slice(3, 5), 16) || 0;
    const b = parseInt(color.slice(5, 7), 16) || 0;
    return { boxShadow: `0 ${offsetY}px ${blur}px rgba(${r},${g},${b},${opacity})` } as any;
  }
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: blur,
    elevation,
  };
}

export const shadows = {
  sm: makeShadow("#000000", 2, 8, 0.15, 3),
  md: makeShadow("#000000", 4, 16, 0.2, 6),
  lg: makeShadow("#000000", 8, 24, 0.25, 12),
  glow: (color: string, opacity = 0.3) => makeShadow(color, 4, 16, opacity, 8),
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 28,
  full: 9999,
} as const;

export const CURRENCIES = {
  USDC: { name: "USD Coin", symbol: "USDC", decimals: 2 },
  USDT: { name: "Tether", symbol: "USDT", decimals: 2 },
  BTC: { name: "Bitcoin", symbol: "BTC", decimals: 8 },
  SOL: { name: "Solana", symbol: "SOL", decimals: 4 },
  ETH: { name: "Ethereum", symbol: "ETH", decimals: 6 },
  KES: { name: "Kenyan Shilling", symbol: "KES", decimals: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

// ── Light Theme ──────────────────────────────────────────────────────────────

/** Light theme variant – same structure as `colors` */
export const lightColors = {
  ...colors,
  dark: {
    bg: "#F5F7FA",
    card: "#FFFFFF",
    elevated: "#F0F2F5",
    border: "#E2E8F0",
    muted: "#94A3B8",
  },
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#94A3B8",
  white: "#FFFFFF",
  glass: {
    bg: "rgba(255, 255, 255, 0.85)",
    bgLight: "rgba(255, 255, 255, 0.6)",
    border: "rgba(0, 0, 0, 0.08)",
    borderStrong: "rgba(0, 0, 0, 0.12)",
    highlight: "rgba(0, 0, 0, 0.02)",
  },
} as const;

export const lightShadows = {
  sm: makeShadow("#94A3B8", 1, 6, 0.08, 2),
  md: makeShadow("#94A3B8", 3, 12, 0.1, 4),
  lg: makeShadow("#94A3B8", 6, 20, 0.12, 8),
  glow: (color: string, opacity = 0.15) => makeShadow(color, 3, 12, opacity, 6),
};

/** Returns the correct color set based on dark/light mode */
export function getThemeColors(isDark: boolean) {
  return isDark ? colors : lightColors;
}

export function getThemeShadows(isDark: boolean) {
  return isDark ? shadows : lightShadows;
}
