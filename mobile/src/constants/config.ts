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
  appName: Constants.expoConfig?.name ?? "M-Crypto",
  appVersion: Constants.expoConfig?.version ?? "1.0.0",
};
