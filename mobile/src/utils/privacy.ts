// CryptoPay Privacy Utilities
import { useState, useEffect, useCallback } from "react";
import { storage } from "./storage";

const PRIVACY_KEY = "cryptopay_phone_visible";

let _phoneVisible = false;
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach((l) => l());
}

/** Initialize privacy setting from storage */
export async function initPrivacy() {
  try {
    const val = await storage.getItemAsync(PRIVACY_KEY);
    _phoneVisible = val === "true";
    notify();
  } catch {}
}

/** Mask a phone number: +254701961618 → +254 7** *** *18 */
export function maskPhone(phone: string | undefined): string {
  if (!phone) return "•••";
  // Strip spaces
  const clean = phone.replace(/\s/g, "");
  if (clean.length < 8) return "•••";

  // Show first 5 chars (+2547) and last 2 digits
  const prefix = clean.slice(0, 5);
  const suffix = clean.slice(-2);
  const middleLen = clean.length - 5 - 2;
  const masked = "•".repeat(middleLen);

  // Format nicely: +254 7•• ••• •18
  const full = prefix + masked + suffix;
  // Group into: +254 XXX XXX XXX
  if (full.startsWith("+254") && full.length >= 13) {
    return `+254 ${full[4]}•• ••• •${full.slice(-2)}`;
  }
  return full;
}

/** React hook for phone visibility toggle */
export function usePhonePrivacy() {
  const [visible, setVisible] = useState(_phoneVisible);

  useEffect(() => {
    setVisible(_phoneVisible);
    const listener = () => setVisible(_phoneVisible);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  const toggle = useCallback(async () => {
    _phoneVisible = !_phoneVisible;
    notify();
    await storage.setItemAsync(PRIVACY_KEY, _phoneVisible ? "true" : "false").catch(() => {});
  }, []);

  const setPhoneVisible = useCallback(async (val: boolean) => {
    if (_phoneVisible === val) return;
    _phoneVisible = val;
    notify();
    await storage.setItemAsync(PRIVACY_KEY, val ? "true" : "false").catch(() => {});
  }, []);

  /** Returns masked or full phone based on setting */
  const formatPhone = useCallback((phone: string | undefined): string => {
    if (_phoneVisible) return phone || "";
    return maskPhone(phone);
  }, [visible]);

  return { phoneVisible: visible, toggle, setPhoneVisible, formatPhone, maskPhone };
}
