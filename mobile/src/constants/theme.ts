export const colors = {
  primary: {
    50: "#ECFDF5",
    100: "#D1FAE5",
    200: "#A7F3D0",
    300: "#6EE7B7",
    400: "#34D399",
    500: "#0D9F6E",
    600: "#059669",
    700: "#047857",
    800: "#065F46",
    900: "#064E3B",
  },
  dark: {
    bg: "#0F172A",
    card: "#1E293B",
    elevated: "#334155",
    border: "#475569",
    muted: "#64748B",
  },
  accent: "#F59E0B",
  accentLight: "#FCD34D",
  accentDark: "#D97706",
  success: "#10B981",
  error: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",
  white: "#FFFFFF",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
} as const;

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
  full: 9999,
} as const;

export const CURRENCIES = {
  USDT: { name: "Tether", symbol: "USDT", icon: "💵", decimals: 2 },
  BTC: { name: "Bitcoin", symbol: "BTC", icon: "₿", decimals: 8 },
  ETH: { name: "Ethereum", symbol: "ETH", icon: "Ξ", decimals: 6 },
  SOL: { name: "Solana", symbol: "SOL", icon: "◎", decimals: 4 },
  KES: { name: "Kenyan Shilling", symbol: "KES", icon: "KSh", decimals: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
