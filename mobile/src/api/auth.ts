import { Platform } from "react-native";
import { api } from "./client";
import * as Device from "expo-device";

/** Generate a stable device ID and collect device metadata for session tracking */
async function getDeviceInfo() {
  const deviceName = Device.deviceName || `${Device.brand ?? "Unknown"} ${Device.modelName ?? "Device"}`;
  const platform = Platform.OS === "web"
    ? `Web (${navigator.userAgent.includes("Windows") ? "Windows" : navigator.userAgent.includes("Mac") ? "macOS" : "Linux"})`
    : `${Platform.OS === "ios" ? "iOS" : "Android"} ${Device.osVersion ?? ""}`.trim();

  // Use a stable device ID: on web use a stored UUID, on native use Device constants
  let deviceId = "";
  if (Platform.OS === "web") {
    try {
      let stored = localStorage.getItem("cryptopay_device_id");
      if (!stored) {
        stored = crypto.randomUUID();
        localStorage.setItem("cryptopay_device_id", stored);
      }
      deviceId = stored;
    } catch {
      deviceId = `web-${Date.now()}`;
    }
  } else {
    deviceId = `${Device.brand}-${Device.modelId || Device.modelName}-${Device.osVersion}`;
  }

  return { device_id: deviceId, device_name: deviceName, platform };
}

export interface User {
  id: string;
  phone: string;
  email?: string;
  full_name: string;
  avatar_url: string | null;
  kyc_tier: number;
  kyc_status: string;
  email_verified?: boolean;
  totp_enabled?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  is_suspended?: boolean;
  suspension_reason?: string;
  created_at: string;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface LoginResponse {
  tokens: AuthTokens;
  user: User;
  pin_required?: boolean;
  phone_required?: boolean;
}

export interface KYCDocument {
  id: string;
  document_type: string;
  file_url: string;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string;
  created_at: string;
  verified_at?: string;
  verified_by_name?: string;
}

export const authApi = {
  requestOTP: (phone: string) => api.post("/auth/otp/", { phone }),

  register: async (data: { phone: string; pin: string; otp: string; full_name?: string }) => {
    const device = await getDeviceInfo();
    return api.post<LoginResponse>("/auth/register/", { ...data, ...device });
  },

  login: async (data: { phone: string; pin: string; otp?: string; totp_code?: string }) => {
    const device = await getDeviceInfo();
    return api.post<LoginResponse>("/auth/login/", { ...data, ...device });
  },

  googleLogin: async (idToken: string) => {
    const device = await getDeviceInfo();
    return api.post<LoginResponse>("/auth/google/", { id_token: idToken, ...device });
  },

  setInitialPin: (pin: string) =>
    api.post<{ message: string }>("/auth/set-initial-pin/", { pin }),

  googleCompleteProfile: async (data: { phone: string; otp: string; pin: string; full_name?: string; email?: string }) => {
    const device = await getDeviceInfo();
    return api.post<LoginResponse>("/auth/google/complete-profile/", { ...data, ...device });
  },

  refreshToken: (refresh: string) =>
    api.post<{ access: string }>("/auth/token/refresh/", { refresh }),

  getProfile: () => api.get<User>("/auth/profile/"),

  updateProfile: (data: FormData) =>
    api.patch<User>("/auth/profile/", data, {
      // Let axios set Content-Type with proper boundary automatically
      headers: { "Content-Type": undefined as any },
    }),

  changePin: (data: { current_pin: string; new_pin: string }) =>
    api.post("/auth/change-pin/", data),

  // KYC
  getKYCDocuments: () => api.get<KYCDocument[]>("/auth/kyc/documents/"),

  uploadKYCDocument: (data: FormData) =>
    api.post<KYCDocument>("/auth/kyc/documents/", data, {
      headers: { "Content-Type": undefined as any },
    }),

  // Push notifications
  registerPushToken: (token: string, platform: "ios" | "android") =>
    api.post("/auth/push-token/", { token, platform }),

  // Email verification
  sendEmailVerification: (email?: string) =>
    api.post("/auth/email/verify/", email ? { email } : {}),

  confirmEmailVerification: (token: string) =>
    api.post("/auth/email/confirm/", { token }),

  // TOTP authenticator
  setupTOTP: () =>
    api.get<{ secret: string; provisioning_uri: string; already_enabled: boolean }>("/auth/totp/setup/"),

  enableTOTP: (code: string) =>
    api.post<{ message: string; backup_codes: string[] }>("/auth/totp/setup/", { code }),

  disableTOTP: (pin: string) =>
    api.delete("/auth/totp/setup/", { data: { pin } }),

  // Recovery settings
  getRecoverySettings: () =>
    api.get<{
      recovery_email: string | null;
      recovery_email_verified: boolean;
      recovery_phone: string;
      email_verified: boolean;
      totp_enabled: boolean;
    }>("/auth/recovery/"),

  updateRecoverySettings: (data: { recovery_email?: string; recovery_phone?: string }) =>
    api.post("/auth/recovery/", data),

  // Security overview
  getSecuritySettings: () =>
    api.get<{
      email: string | null;
      email_verified: boolean;
      recovery_email: string | null;
      recovery_email_verified: boolean;
      recovery_phone: string;
      totp_enabled: boolean;
      totp_backup_codes_remaining: number;
      devices_count: number;
    }>("/auth/security/"),

  // Devices / sessions
  getDevices: () => api.get("/auth/devices/"),

  removeDevice: (deviceId: string) => api.delete(`/auth/devices/${deviceId}/`),

  // Forgot PIN recovery (3-step flow)
  forgotPin: (phone: string) =>
    api.post<{ message: string; dev_otp?: string }>("/auth/forgot-pin/", { phone }),

  verifyPinResetOTP: (phone: string, otp: string) =>
    api.post<{ token: string }>("/auth/forgot-pin/verify/", { phone, otp }),

  resetPin: (token: string, new_pin: string) =>
    api.post("/auth/reset-pin/", { token, new_pin }),

  // Transaction receipt
  downloadReceipt: (transactionId: string) =>
    api.get(`/payments/${transactionId}/receipt/`, { responseType: "blob" }),
};
