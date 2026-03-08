import { useCallback, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { authApi, User } from "../api/auth";

let _user: User | null = null;
let _listeners: Set<() => void> = new Set();

function notify() {
  _listeners.forEach((l) => l());
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
      const token = await SecureStore.getItemAsync("access_token");
      if (token) {
        const { data } = await authApi.getProfile();
        _user = data;
        notify();
      }
    } catch {
      await SecureStore.deleteItemAsync("access_token");
      await SecureStore.deleteItemAsync("refresh_token");
      _user = null;
      notify();
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (phone: string, pin: string) => {
    const { data } = await authApi.login({ phone, pin });
    await SecureStore.setItemAsync("access_token", data.tokens.access);
    await SecureStore.setItemAsync("refresh_token", data.tokens.refresh);
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
      await SecureStore.setItemAsync("access_token", data.tokens.access);
      await SecureStore.setItemAsync("refresh_token", data.tokens.refresh);
      _user = data.user;
      notify();
      return data;
    },
    []
  );

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync("access_token");
    await SecureStore.deleteItemAsync("refresh_token");
    _user = null;
    notify();
  }, []);

  return { user, loading, bootstrap, login, register, logout };
}
