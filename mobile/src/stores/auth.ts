import { useCallback, useEffect, useState } from "react";
import { storage } from "../utils/storage";
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
      const token = await storage.getItemAsync("access_token");
      if (token) {
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

  const login = useCallback(async (phone: string, pin: string) => {
    const { data } = await authApi.login({ phone, pin });
    await storage.setItemAsync("access_token", data.tokens.access);
    await storage.setItemAsync("refresh_token", data.tokens.refresh);
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
      _user = data.user;
      notify();
      return data;
    },
    []
  );

  const logout = useCallback(async () => {
    await storage.deleteItemAsync("access_token");
    await storage.deleteItemAsync("refresh_token");
    _user = null;
    notify();
  }, []);

  return { user, loading, bootstrap, login, register, logout };
}
