import axios from "axios";
import { storage } from "../utils/storage";
import { config } from "../constants/config";

// Callback for session expiry — set by auth store to avoid circular imports
let _onSessionExpired: (() => void) | null = null;
export function setOnSessionExpired(cb: () => void) {
  _onSessionExpired = cb;
}

// Flag to prevent 401 retry storm after logout
let _sessionExpired = false;
export function resetSessionExpired() {
  _sessionExpired = false;
}

const BASE_URL = config.apiUrl;

// Production safety: crash early if API URL is localhost in a production build
if (config.isProd && BASE_URL.includes("localhost")) {
  throw new Error(
    "FATAL: Production build is using localhost API URL. " +
    "Set API_URL in eas.json extra or environment variables."
  );
}

// Custom error class so react-query can detect session expiry and stop retrying
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "SessionExpiredError";
  }
}

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

// Auth endpoints that should work even after session expiry
const AUTH_ENDPOINTS = ["/auth/login/", "/auth/register/", "/auth/otp/", "/auth/google/", "/auth/token/refresh/"];

api.interceptors.request.use(async (cfg) => {
  const isAuthEndpoint = AUTH_ENDPOINTS.some((ep) => cfg.url?.includes(ep));

  // If session already expired, reject immediately — but allow auth endpoints through
  if (_sessionExpired && !isAuthEndpoint) {
    return Promise.reject(new SessionExpiredError());
  }
  const token = await storage.getItemAsync("access_token");
  if (token && !isAuthEndpoint) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isAuthEndpoint = AUTH_ENDPOINTS.some((ep) => originalRequest?.url?.includes(ep));

    // Auth endpoints (login, register, etc.) — always pass errors through as-is
    if (isAuthEndpoint) {
      return Promise.reject(error);
    }

    // Already handled — don't re-process (but only for non-auth endpoints)
    if (error instanceof SessionExpiredError || _sessionExpired) {
      return Promise.reject(new SessionExpiredError());
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      // If the 401 carries a business-logic error (e.g. "Invalid PIN"),
      // pass it through instead of treating it as token expiry.
      const body = error.response?.data;
      if (body?.error && typeof body.error === "string") {
        return Promise.reject(error);
      }

      originalRequest._retry = true;
      try {
        const refresh = await storage.getItemAsync("refresh_token");
        if (!refresh) throw new Error("No refresh token");
        const { data } = await axios.post(`${BASE_URL}/auth/token/refresh/`, {
          refresh,
        });
        await storage.setItemAsync("access_token", data.access);
        originalRequest.headers.Authorization = `Bearer ${data.access}`;
        return api(originalRequest);
      } catch {
        // Mark session as expired to stop all future requests immediately
        _sessionExpired = true;
        await storage.deleteItemAsync("access_token");
        await storage.deleteItemAsync("refresh_token");
        _onSessionExpired?.();
        return Promise.reject(new SessionExpiredError());
      }
    }
    return Promise.reject(error);
  }
);
