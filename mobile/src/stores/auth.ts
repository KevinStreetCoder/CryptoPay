import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import { storage } from "../utils/storage";
import { authApi, User } from "../api/auth";
import { setOnSessionExpired, resetSessionExpired } from "../api/client";
import { resetBalanceVisibility } from "./balance";

let _user: User | null = null;
let _listeners: Set<() => void> = new Set();
let _biometricEnabled: boolean = false;

function notify() {
  _listeners.forEach((l) => l());
}

/** Force-logout from anywhere (e.g. API interceptor on refresh failure) */
export function forceLogout() {
  storage.deleteItemAsync("access_token");
  storage.deleteItemAsync("refresh_token");
  _user = null;
  resetBalanceVisibility();
  notify();
}

// Register session-expiry callback so the API client can trigger logout
// without a circular import
setOnSessionExpired(forceLogout);

/** Check if user has enabled biometric login */
export async function isBiometricEnabled(): Promise<boolean> {
  const val = await storage.getItemAsync("biometric_enabled");
  return val === "true";
}

/** Enable or disable biometric login */
export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await storage.setItemAsync("biometric_enabled", enabled ? "true" : "false");
  _biometricEnabled = enabled;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(_user);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const listener = () => setUser(_user);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const token = await storage.getItemAsync("access_token");
      if (token) {
        // Check biometric preference
        _biometricEnabled = await isBiometricEnabled();

        // If biometric is enabled on native, require auth before proceeding
        if (_biometricEnabled && Platform.OS !== "web") {
          const LocalAuth = require("expo-local-authentication");
          const compatible = await LocalAuth.hasHardwareAsync();
          const enrolled = await LocalAuth.isEnrolledAsync();

          if (compatible && enrolled) {
            const result = await LocalAuth.authenticateAsync({
              promptMessage: "Unlock CryptoPay",
              cancelLabel: "Use PIN",
              disableDeviceFallback: false,
              fallbackLabel: "Enter PIN",
            });

            if (!result.success) {
              // Biometric failed — don't auto-login, force PIN entry
              setLoading(false);
              return;
            }
          }
        }

        const { data } = await authApi.getProfile();
        _user = data;
        notify();
      }
    } catch {
      await storage.deleteItemAsync("access_token");
      await storage.deleteItemAsync("refresh_token");
      _user = null;
      notify();
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (phone: string, pin: string, otp?: string) => {
    const { data } = await authApi.login({ phone, pin, otp });
    await storage.setItemAsync("access_token", data.tokens.access);
    await storage.setItemAsync("refresh_token", data.tokens.refresh);
    resetSessionExpired(); // Allow API requests again after re-login
    _user = data.user;
    notify();
    return data;
  }, []);

  const register = useCallback(
    async (phone: string, pin: string, otp: string, fullName?: string) => {
      const { data } = await authApi.register({
        phone,
        pin,
        otp,
        full_name: fullName,
      });
      await storage.setItemAsync("access_token", data.tokens.access);
      await storage.setItemAsync("refresh_token", data.tokens.refresh);
      resetSessionExpired();
      _user = data.user;
      notify();
      return data;
    },
    []
  );

  const googleLogin = useCallback(async (idToken: string) => {
    const { data } = await authApi.googleLogin(idToken);
    if (data.phone_required) {
      // Store tokens separately — don't put in main token storage
      // This prevents the auth gate from thinking user is logged in
      // which would trigger dashboard queries that 401 and poison session
      await storage.setItemAsync("google_temp_access", data.tokens.access);
      await storage.setItemAsync("google_temp_refresh", data.tokens.refresh);
    } else {
      await storage.setItemAsync("access_token", data.tokens.access);
      await storage.setItemAsync("refresh_token", data.tokens.refresh);
      resetSessionExpired();
      _user = data.user;
      notify();
    }
    return data;
  }, []);

  const googleCompleteProfile = useCallback(async (data: { phone: string; otp: string; pin: string; full_name?: string }) => {
    // Move temp Google tokens to main storage so the API call includes them
    const { forceResetSessionExpired } = require("../api/client");
    forceResetSessionExpired();
    const tempAccess = await storage.getItemAsync("google_temp_access");
    const tempRefresh = await storage.getItemAsync("google_temp_refresh");
    if (tempAccess) {
      await storage.setItemAsync("access_token", tempAccess);
      await storage.deleteItemAsync("google_temp_access");
    }
    if (tempRefresh) {
      await storage.setItemAsync("refresh_token", tempRefresh);
      await storage.deleteItemAsync("google_temp_refresh");
    }
    const { data: responseData } = await authApi.googleCompleteProfile(data);
    await storage.setItemAsync("access_token", responseData.tokens.access);
    await storage.setItemAsync("refresh_token", responseData.tokens.refresh);
    resetSessionExpired();
    _user = responseData.user;
    notify();
    return responseData;
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const { data } = await authApi.getProfile();
      _user = data;
      notify();
    } catch {
      // Non-critical — profile will refresh on next bootstrap
    }
  }, []);

  const logout = useCallback(async () => {
    await storage.deleteItemAsync("access_token");
    await storage.deleteItemAsync("refresh_token");
    _user = null;
    resetBalanceVisibility();
    notify();
  }, []);

  return { user, loading, bootstrap, login, register, googleLogin, googleCompleteProfile, refreshProfile, logout };
}
