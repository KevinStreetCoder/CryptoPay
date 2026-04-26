import axios from "axios";
import { Platform } from "react-native";
import { storage } from "../utils/storage";
import { config } from "../constants/config";

// C1: on web, the backend sets HttpOnly cookies (cpay_access, cpay_refresh)
// when it sees `X-Cpay-Web: 1`. axios must send cookies on cross-origin
// requests, so `withCredentials = true` is required in addition to the
// server's `Access-Control-Allow-Credentials: true`. On native, SecureStore
// continues to hold the bearer token · no cookies.
const IS_WEB = Platform.OS === "web";

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
  headers: {
    "Content-Type": "application/json",
    // C1: mark web-origin requests so the backend emits HttpOnly auth cookies.
    ...(IS_WEB ? { "X-Cpay-Web": "1" } : {}),
  },
  // C1: send cross-origin cookies on web (api.cpay.co.ke ↔ cpay.co.ke).
  withCredentials: IS_WEB,
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

/**
 * Refresh-token mutex · with `ROTATE_REFRESH_TOKENS=True` and
 * `BLACKLIST_AFTER_ROTATION=True` on the backend (matches Binance/
 * Revolut threat model · stolen tokens auto-invalidate on the legit
 * client's next refresh) the OLD refresh token is blacklisted the
 * moment a new pair is minted. If the user happens to have two
 * requests fly out in parallel and both 401, both interceptors race
 * to call /auth/token/refresh/. The second one presents an already-
 * blacklisted token and gets 401 back · which the catch path then
 * interprets as "real auth failure" and force-logs-out the user.
 *
 * Result: a benign double-401 (e.g. wallets + transactions queries
 * firing together right after access-token expiry) silently kicked
 * the user back to the login screen every ~15 minutes. The user
 * reported this as "after a few hours I have to start again from
 * phone instead of just pin if I am still on this phone right".
 *
 * Fix: coalesce all parallel refresh attempts behind a single
 * in-flight Promise. The first 401 calls /auth/token/refresh/ for
 * real; every subsequent caller in that window awaits the same
 * Promise and inherits its result (success or failure). Cleared
 * once the network call resolves so the next genuine expiry can
 * trigger a fresh refresh.
 */
let _inflightRefresh: Promise<{ access: string; refresh?: string }> | null = null;

async function performRefresh(): Promise<{ access: string; refresh?: string }> {
  const refresh = await storage.getItemAsync("refresh_token");
  if (!refresh) throw new Error("No refresh token");
  const { data } = await axios.post(`${BASE_URL}/auth/token/refresh/`, { refresh });
  await storage.setItemAsync("access_token", data.access);
  if (data.refresh) {
    await storage.setItemAsync("refresh_token", data.refresh);
  }
  return data;
}

async function coalescedRefresh(): Promise<{ access: string; refresh?: string }> {
  if (_inflightRefresh) return _inflightRefresh;
  _inflightRefresh = performRefresh().finally(() => {
    // Clear the lock either way · failed refreshes shouldn't pin a
    // dead promise that prevents future retries from running.
    _inflightRefresh = null;
  });
  return _inflightRefresh;
}

api.interceptors.request.use(async (cfg) => {
  const isPublicAuth = AUTH_ENDPOINTS.some((ep) => cfg.url?.includes(ep));
  const isAuthWithToken = AUTH_WITH_TOKEN.some((ep) => cfg.url?.includes(ep));

  // If session already expired, reject immediately · but allow auth endpoints through
  if (_sessionExpired && !isPublicAuth && !isAuthWithToken) {
    return Promise.reject(new SessionExpiredError());
  }
  // C1: on web we rely on HttpOnly cookies. We still SEND a Bearer header
  // when we have an `access_token` stored for backwards compat (older
  // Expo web builds that haven't picked up the cookie cycle) but the
  // cookie is the primary authenticator. Native continues to use Bearer.
  const token = await storage.getItemAsync("access_token");
  if (token && !isPublicAuth) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  // C1: CSRF protection for cookie-authenticated mutations on web.
  // Django emits `csrftoken` cookie; we mirror it into X-CSRFToken.
  if (IS_WEB && typeof document !== "undefined") {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    if (csrf && cfg.headers) {
      cfg.headers["X-CSRFToken"] = csrf;
    }
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
        // Coalesced refresh · see `coalescedRefresh` doc for why.
        // Two parallel 401s share one network call instead of racing
        // and blacklisting each other's tokens.
        const data = await coalescedRefresh();
        originalRequest.headers.Authorization = `Bearer ${data.access}`;
        return api(originalRequest);
      } catch (refreshErr: any) {
        // Distinguish a real auth failure (refresh token actually
        // rejected by the server with 401/403) from a transient
        // network/upstream failure (5xx, timeout, no response). The
        // earlier code force-logged-out for ANY refresh error, which
        // meant a brief 4G hiccup at app-resume time silently kicked
        // the user back to the phone screen even though their refresh
        // token was perfectly valid · the user-reported "logged out
        // after a few minutes" symptom.
        const refreshStatus = refreshErr?.response?.status;
        const refreshIsAuthFailure =
          refreshStatus === 401 || refreshStatus === 403;
        const refreshIsMissingToken =
          refreshErr?.message === "No refresh token";

        if (refreshIsAuthFailure || refreshIsMissingToken) {
          // Token genuinely invalid (rotated chain blacklisted, expired,
          // or never stored) · clear and force re-login.
          _sessionExpired = true;
          await storage.deleteItemAsync("access_token");
          await storage.deleteItemAsync("refresh_token");
          _onSessionExpired?.();
          return Promise.reject(new SessionExpiredError());
        }

        // Network / 5xx / timeout · keep the session intact. Surface
        // the original error so the caller's UI can show a "couldn't
        // reach server, please retry" state without nuking the user's
        // login. _sessionExpired stays false, so subsequent requests
        // (or the next app-resume) will try again.
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(error);
  }
);
