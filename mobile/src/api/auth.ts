import { api } from "./client";

export interface User {
  id: string;
  phone: string;
  full_name: string;
  kyc_tier: number;
  kyc_status: string;
  created_at: string;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface LoginResponse {
  tokens: AuthTokens;
  user: User;
}

export const authApi = {
  requestOTP: (phone: string) => api.post("/auth/otp/", { phone }),

  register: (data: { phone: string; pin: string; otp: string; full_name?: string }) =>
    api.post<LoginResponse>("/auth/register/", data),

  login: (data: { phone: string; pin: string }) =>
    api.post<LoginResponse>("/auth/login/", data),

  refreshToken: (refresh: string) =>
    api.post<{ access: string }>("/auth/token/refresh/", { refresh }),

  getProfile: () => api.get<User>("/auth/profile/"),
};
