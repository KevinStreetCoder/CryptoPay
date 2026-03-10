import axios from "axios";
import { storage } from "../utils/storage";
import { config } from "../constants/config";

const BASE_URL = config.apiUrl;

// Production safety: crash early if API URL is localhost in a production build
if (config.isProd && BASE_URL.includes("localhost")) {
  throw new Error(
    "FATAL: Production build is using localhost API URL. " +
    "Set API_URL in eas.json extra or environment variables."
  );
}

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use(async (cfg) => {
  const token = await storage.getItemAsync("access_token");
  if (token) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
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
