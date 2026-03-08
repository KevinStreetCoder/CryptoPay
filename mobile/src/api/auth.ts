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

export interface KYCDocument {
  id: string;
  document_type: string;
  file_url: string;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string;
  created_at: string;
}

export const authApi = {
  requestOTP: (phone: string) => api.post("/auth/otp/", { phone }),

  register: (data: { phone: string; pin: string; otp: string; full_name?: string }) =>
    api.post<LoginResponse>("/auth/register/", data),

  login: (data: { phone: string; pin: string }) =>
    api.post<LoginResponse>("/auth/login/", data),

  googleLogin: (idToken: string) =>
    api.post<LoginResponse>("/auth/google/", { id_token: idToken }),

  refreshToken: (refresh: string) =>
    api.post<{ access: string }>("/auth/token/refresh/", { refresh }),

  getProfile: () => api.get<User>("/auth/profile/"),

  changePin: (data: { current_pin: string; new_pin: string }) =>
    api.post("/auth/change-pin/", data),

  // KYC
  getKYCDocuments: () => api.get<KYCDocument[]>("/auth/kyc/documents/"),

  uploadKYCDocument: (data: { document_type: string; file_url: string }) =>
    api.post<KYCDocument>("/auth/kyc/documents/", data),

  // Push notifications
  registerPushToken: (token: string, platform: "ios" | "android") =>
    api.post("/auth/push-token/", { token, platform }),
};
