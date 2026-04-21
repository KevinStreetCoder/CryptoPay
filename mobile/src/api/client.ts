import axios from "axios";
import { storage } from "../utils/storage";
import { config } from "../constants/config";

// Callback for session expiry · set by auth store to avoid circular imports
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
// Endpoints that bypass session-expired check AND don't send auth token
const AUTH_ENDPOINTS = ["/auth/login/", "/auth/register/", "/auth/otp/", "/auth/google/", "/auth/token/refresh/", "/auth/forgot-pin/", "/auth/reset-pin/", "/auth/verify-pin-reset-otp/"];

// Endpoints that bypass session-expired check but DO send auth token
const AUTH_WITH_TOKEN = ["/auth/google/complete-profile/", "/auth/set-initial-pin/", "/auth/profile/"];

// Force reset session expired flag · used after Google OAuth stores new tokens
export function forceResetSessionExpired() {
  _sessionExpired = false;
}

/** Manually refresh the access token using stored refresh token */
export async function refreshAccessToken(): Promise<void> {
  const refresh = await storage.getItemAsync("refresh_token");
  if (!refresh) throw new Error("No refresh token");
  const { data } = await axios.post(`${BASE_URL}/auth/token/refresh/`, { refresh });
  await storage.setItemAsync("access_token", data.access);
  if (data.refresh) {
    await storage.setItemAsync("refresh_token", data.refresh);
  }
}

api.interceptors.request.use(async (cfg) => {
  const isPublicAuth = AUTH_ENDPOINTS.some((ep) => cfg.url?.includes(ep));
  const isAuthWithToken = AUTH_WITH_TOKEN.some((ep) => cfg.url?.includes(ep));

  // If session already expired, reject immediately · but allow auth endpoints through
  if (_sessionExpired && !isPublicAuth && !isAuthWithToken) {
    return Promise.reject(new SessionExpiredError());
  }
  const token = await storage.getItemAsync("access_token");
  if (token && !isPublicAuth) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isAuthEndpoint = AUTH_ENDPOINTS.some((ep) => originalRequest?.url?.includes(ep)) ||
      AUTH_WITH_TOKEN.some((ep) => originalRequest?.url?.includes(ep));

    // Auth endpoints (login, register, etc.) · always pass errors through as-is
    if (isAuthEndpoint) {
      return Promise.reject(error);
    }

    // Already handled · don't re-process (but only for non-auth endpoints)
    if (error instanceof SessionExpiredError || _sessionExpired) {
      return Promise.reject(new SessionExpiredError());
    }

    // Transient upstream failures (502/503/504) · usually a brief deploy
    // window or a connection reset between nginx and daphne. Retry twice
    // with 700ms / 1600ms backoff before surfacing the error. Auth
    // endpoints skipped above, so logins still fail fast.
    const status = error.response?.status;
    const isTransient = status === 502 || status === 503 || status === 504
      || error.code === "ECONNABORTED" || error.code === "ERR_NETWORK";
    if (isTransient && originalRequest && !originalRequest._transientRetries) {
      originalRequest._transientRetries = 0;
    }
    if (isTransient && originalRequest && originalRequest._transientRetries < 2) {
      originalRequest._transientRetries += 1;
      const delay = originalRequest._transientRetries === 1 ? 700 : 1600;
      await new Promise((r) => setTimeout(r, delay));
      return api(originalRequest);
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
        // Save rotated refresh token · backend blacklists the old one
        if (data.refresh) {
          await storage.setItemAsync("refresh_token", data.refresh);
        }
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
