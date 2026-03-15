import Constants from "expo-constants";
import { Platform } from "react-native";

type Environment = "development" | "preview" | "production";

interface AppConfig {
  apiUrl: string;
  environment: Environment;
  isDev: boolean;
  isProd: boolean;
  appName: string;
  appVersion: string;
}

function getEnvironment(): Environment {
  const env = Constants.expoConfig?.extra?.APP_ENV
    ?? process.env.APP_ENV
    ?? "development";
  if (env === "production" || env === "preview") return env;
  return "development";
}

function getApiUrl(): string {
  const envUrl = Constants.expoConfig?.extra?.API_URL ?? process.env.API_URL;
  if (envUrl) return envUrl;

  // Web production: if running on cpay.co.ke, use same-origin API
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location?.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `${window.location.origin}/api/v1`;
    }
  }

  // Fallback for local development
  return Platform.select({
    android: "http://10.0.2.2:8000/api/v1",
    ios: "http://localhost:8000/api/v1",
    default: "http://localhost:8000/api/v1",
  }) as string;
}

const environment = getEnvironment();

export const config: AppConfig = {
  apiUrl: getApiUrl(),
  environment,
  isDev: environment === "development",
  isProd: environment === "production",
  appName: Constants.expoConfig?.name ?? "CryptoPay",
  appVersion: Constants.expoConfig?.version ?? "1.0.0",
};

// ── WalletConnect / Reown AppKit ────────────────────────────────────────────
// Project ID from https://cloud.reown.com — required for WalletConnect v2.
// Set via EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID env var or in app.json extra.
export const WALLETCONNECT_PROJECT_ID =
  process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || "34724557aafaf3b437889ff0a053cba9";

// Supported EVM chains for WalletConnect deposits
export const WALLETCONNECT_CHAINS = {
  ethereum: { chainId: 1, name: "Ethereum", symbol: "ETH" },
  polygon: { chainId: 137, name: "Polygon", symbol: "MATIC" },
  bsc: { chainId: 56, name: "BNB Smart Chain", symbol: "BNB" },
} as const;

// Non-EVM chains — WalletConnect v2 does NOT support these natively.
// Users must use manual deposit addresses for Tron, Bitcoin, Solana.
export const MANUAL_DEPOSIT_CHAINS = {
  tron: { name: "Tron (TRC-20)", tokens: ["USDT"] },
  bitcoin: { name: "Bitcoin", tokens: ["BTC"] },
  solana: { name: "Solana", tokens: ["SOL"] },
} as const;
