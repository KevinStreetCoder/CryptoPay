import axios from "axios";
import { Platform } from "react-native";
import { storage } from "../utils/storage";

const BASE_URL = Platform.select({
  android: "http://10.0.2.2:8000/api/v1",
  ios: "http://localhost:8000/api/v1",
  default: "http://localhost:8000/api/v1",
});

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use(async (config) => {
  const token = await storage.getItemAsync("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
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
        await storage.deleteItemAsync("access_token");
        await storage.deleteItemAsync("refresh_token");
      }
    }
    return Promise.reject(error);
  }
);
