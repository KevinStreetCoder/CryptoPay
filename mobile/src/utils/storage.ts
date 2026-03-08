import { Platform } from "react-native";

/**
 * Cross-platform secure storage.
 * Uses expo-secure-store on native, localStorage on web.
 */

async function getItemAsync(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  const SecureStore = require("expo-secure-store");
  return SecureStore.getItemAsync(key);
}

async function setItemAsync(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage full or unavailable
    }
    return;
  }
  const SecureStore = require("expo-secure-store");
  return SecureStore.setItemAsync(key, value);
}

async function deleteItemAsync(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  const SecureStore = require("expo-secure-store");
  return SecureStore.deleteItemAsync(key);
}

export const storage = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
};
