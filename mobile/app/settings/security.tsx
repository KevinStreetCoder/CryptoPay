import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/stores/auth";
import { authApi } from "../../src/api/auth";
import { useToast } from "../../src/components/Toast";
import { getThemeColors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { normalizeError } from "../../src/utils/apiErrors";
import { useLocale } from "../../src/hooks/useLocale";

const isWeb = Platform.OS === "web";

interface SecurityData {
  email: string | null;
  email_verified: boolean;
  recovery_email: string | null;
  recovery_email_verified: boolean;
  recovery_phone: string;
  totp_enabled: boolean;
  totp_backup_codes_remaining: number;
  devices_count: number;
}

export default function SecuritySettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { t } = useLocale();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;

  const [security, setSecurity] = useState<SecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailInput, setEmailInput] = useState("");
  const [recoveryEmailInput, setRecoveryEmailInput] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showEmailVerify, setShowEmailVerify] = useState(false);
  const [showRecoveryForm, setShowRecoveryForm] = useState(false);
  const [actionLoading, setActionLoading] = useState("");

  const loadSecurity = useCallback(async () => {
    try {
      const { data } = await authApi.getSecuritySettings();
      setSecurity(data);
    } catch {
      toast.error(t("common.error"), t("securityPage.errorLoadingSecurity"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSecurity();
  }, [loadSecurity]);

  const handleSendEmailVerification = async () => {
    setActionLoading("email_verify");
    try {
      const { data } = await authApi.sendEmailVerification(emailInput || undefined);
      setShowEmailVerify(true);
      toast.success(t("securityPage.sent"), t("securityPage.verificationEmailSent"));
      if (data.verification_code) {
        setVerificationCode(data.verification_code);
      }
    } catch (err) {
      const e = normalizeError(err);
      toast.error(e.title, e.message);
    } finally {
      setActionLoading("");
    }
  };

  const handleConfirmEmail = async () => {
    if (!verificationCode) return;
    setActionLoading("confirm_email");
    try {
      await authApi.confirmEmailVerification(verificationCode);
      toast.success(t("securityPage.verified"), t("securityPage.emailVerified"));
      setShowEmailVerify(false);
      loadSecurity();
    } catch (err) {
      const e = normalizeError(err);
      toast.error(e.title, e.message);
    } finally {
      setActionLoading("");
    }
  };

  const handleSetupTOTP = () => {
    router.push("/settings/totp-setup" as any);
  };

  const handleUpdateRecovery = async () => {
    if (!recoveryEmailInput) return;
    setActionLoading("recovery");
    try {
      await authApi.updateRecoverySettings({ recovery_email: recoveryEmailInput });
      toast.success(t("securityPage.updated"), t("securityPage.recoveryEmailSet"));
      setShowRecoveryForm(false);
      loadSecurity();
    } catch (err) {
      const e = normalizeError(err);
      toast.error(e.title, e.message);
    } finally {
      setActionLoading("");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={tc.primary[500]} />
      </SafeAreaView>
    );
  }

  const btnMaxWidth = isDesktop ? 360 : undefined;

  const SecuritySection = ({
    icon,
    iconColor,
    iconBg,
    title,
    description,
    status,
    statusColor,
    children,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    iconBg: string;
    title: string;
    description: string;
    status?: string;
    statusColor?: string;
    children?: React.ReactNode;
  }) => (
    <View
      style={{
        backgroundColor: tc.dark.card,
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: tc.glass.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            backgroundColor: iconBg,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 14,
          }}
        >
          <Ionicons name={icon} size={22} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: tc.textPrimary, fontSize: 16, fontFamily: "DMSans_600SemiBold" }}>
            {title}
          </Text>
          <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
            {description}
          </Text>
        </View>
        {status && (
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: statusColor ? `${statusColor}15` : "rgba(100,100,100,0.1)",
            }}
          >
            <Text style={{ color: statusColor || tc.textMuted, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
              {status}
            </Text>
          </View>
        )}
      </View>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: isDesktop ? 32 : 20,
          paddingHorizontal: isDesktop ? 48 : 20,
        }}
      >
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 28 }}>
          <Pressable
            onPress={() => router.canGoBack() ? router.back() : router.replace("/settings")}
            style={{ marginRight: 16 }}
          >
            <Ionicons name="arrow-back" size={24} color={tc.textPrimary} />
          </Pressable>
          <Text style={{ color: tc.textPrimary, fontSize: 24, fontFamily: "DMSans_700Bold", flex: 1 }}>
            {t("securityPage.security")}
          </Text>
          <Ionicons name="shield-checkmark" size={24} color={tc.primary[500]} />
        </View>

        {/* 2-column grid on desktop, single column on mobile */}
        <View style={isDesktop ? { flexDirection: "row", flexWrap: "wrap", gap: 16 } : {}}>
          {/* Email Verification */}
          <View style={isDesktop ? { width: "48%", minWidth: 340, flexGrow: 1 } : {}}>
            <SecuritySection
              icon="mail"
              iconColor="#3B82F6"
              iconBg="rgba(59, 130, 246, 0.12)"
              title={t("securityPage.emailVerification")}
              description={security?.email ? `${security.email}` : t("securityPage.addEmailDesc")}
              status={security?.email_verified ? t("common.verified") : security?.email ? t("common.unverified") : t("common.notSet")}
              statusColor={security?.email_verified ? "#10B981" : "#F59E0B"}
            >
              {!security?.email_verified && (
                <View style={{ marginTop: 12, maxWidth: btnMaxWidth }}>
                  {!showEmailVerify ? (
                    <View>
                      <TextInput
                        value={emailInput}
                        onChangeText={setEmailInput}
                        placeholder="your@email.com"
                        placeholderTextColor={tc.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        style={{
                          backgroundColor: tc.dark.elevated,
                          borderRadius: 12,
                          padding: 14,
                          color: tc.textPrimary,
                          fontSize: 15,
                          marginBottom: 12,
                          borderWidth: 1,
                          borderColor: tc.dark.border,
                          ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                        }}
                      />
                      <Pressable
                        onPress={handleSendEmailVerification}
                        disabled={actionLoading === "email_verify"}
                        style={{
                          backgroundColor: tc.primary[500],
                          borderRadius: 12,
                          padding: 14,
                          alignItems: "center",
                        }}
                      >
                        {actionLoading === "email_verify" ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={{ color: "#fff", fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>
                            {t("securityPage.sendVerification")}
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <View>
                      <TextInput
                        value={verificationCode}
                        onChangeText={setVerificationCode}
                        placeholder="Enter 6-character code"
                        placeholderTextColor={tc.textMuted}
                        autoCapitalize="characters"
                        maxLength={6}
                        style={{
                          backgroundColor: tc.dark.elevated,
                          borderRadius: 12,
                          padding: 14,
                          color: tc.textPrimary,
                          fontSize: 18,
                          letterSpacing: 4,
                          textAlign: "center",
                          fontFamily: "DMSans_600SemiBold",
                          marginBottom: 12,
                          borderWidth: 1,
                          borderColor: tc.dark.border,
                          ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                        }}
                      />
                      <Pressable
                        onPress={handleConfirmEmail}
                        disabled={actionLoading === "confirm_email" || verificationCode.length < 6}
                        style={{
                          backgroundColor: tc.primary[500],
                          borderRadius: 12,
                          padding: 14,
                          alignItems: "center",
                          opacity: verificationCode.length < 6 ? 0.6 : 1,
                        }}
                      >
                        {actionLoading === "confirm_email" ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={{ color: "#fff", fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>
                            {t("securityPage.verifyCode")}
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
            </SecuritySection>
          </View>

          {/* TOTP Authenticator */}
          <View style={isDesktop ? { width: "48%", minWidth: 340, flexGrow: 1 } : {}}>
            <SecuritySection
              icon="key"
              iconColor="#8B5CF6"
              iconBg="rgba(139, 92, 246, 0.12)"
              title={t("securityPage.authenticatorApp")}
              description={security?.totp_enabled
                ? t("securityPage.backupCodesRemaining", { count: security.totp_backup_codes_remaining })
                : t("securityPage.authenticatorDesc")}
              status={security?.totp_enabled ? t("common.active") : t("common.off")}
              statusColor={security?.totp_enabled ? "#10B981" : "#64748B"}
            >
              <Pressable
                onPress={handleSetupTOTP}
                style={{
                  backgroundColor: security?.totp_enabled ? tc.dark.elevated : "rgba(139, 92, 246, 0.12)",
                  borderRadius: 12,
                  padding: 14,
                  alignItems: "center",
                  marginTop: 12,
                  maxWidth: btnMaxWidth,
                  borderWidth: 1,
                  borderColor: security?.totp_enabled ? tc.dark.border : "rgba(139, 92, 246, 0.2)",
                }}
              >
                <Text
                  style={{
                    color: security?.totp_enabled ? tc.textPrimary : "#8B5CF6",
                    fontSize: 15,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  {security?.totp_enabled ? t("securityPage.manageAuthenticator") : t("securityPage.setupAuthenticator")}
                </Text>
              </Pressable>
            </SecuritySection>
          </View>

          {/* Recovery Email */}
          <View style={isDesktop ? { width: "48%", minWidth: 340, flexGrow: 1 } : {}}>
            <SecuritySection
              icon="refresh"
              iconColor="#F59E0B"
              iconBg="rgba(245, 158, 11, 0.12)"
              title={t("securityPage.recoveryEmail")}
              description={security?.recovery_email
                ? `${security.recovery_email}`
                : t("securityPage.addRecoveryDesc")}
              status={
                security?.recovery_email
                  ? security.recovery_email_verified
                    ? t("common.verified")
                    : t("common.pending")
                  : t("common.notSet")
              }
              statusColor={
                security?.recovery_email_verified ? "#10B981" : security?.recovery_email ? "#F59E0B" : "#64748B"
              }
            >
              {!showRecoveryForm ? (
                <Pressable
                  onPress={() => setShowRecoveryForm(true)}
                  style={{
                    backgroundColor: "rgba(245, 158, 11, 0.12)",
                    borderRadius: 12,
                    padding: 14,
                    alignItems: "center",
                    marginTop: 12,
                    maxWidth: btnMaxWidth,
                    borderWidth: 1,
                    borderColor: "rgba(245, 158, 11, 0.2)",
                  }}
                >
                  <Text style={{ color: "#F59E0B", fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>
                    {security?.recovery_email ? t("securityPage.updateRecoveryEmail") : t("securityPage.addRecoveryEmail")}
                  </Text>
                </Pressable>
              ) : (
                <View style={{ marginTop: 12, maxWidth: btnMaxWidth }}>
                  <TextInput
                    value={recoveryEmailInput}
                    onChangeText={setRecoveryEmailInput}
                    placeholder="recovery@email.com"
                    placeholderTextColor={tc.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    style={{
                      backgroundColor: tc.dark.elevated,
                      borderRadius: 12,
                      padding: 14,
                      color: tc.textPrimary,
                      fontSize: 15,
                      marginBottom: 12,
                      borderWidth: 1,
                      borderColor: tc.dark.border,
                      ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                    }}
                  />
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <Pressable
                      onPress={() => setShowRecoveryForm(false)}
                      style={{
                        flex: 1,
                        backgroundColor: tc.dark.elevated,
                        borderRadius: 12,
                        padding: 14,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: tc.textMuted, fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>{t("common.cancel")}</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleUpdateRecovery}
                      disabled={actionLoading === "recovery" || !recoveryEmailInput}
                      style={{
                        flex: 1,
                        backgroundColor: tc.primary[500],
                        borderRadius: 12,
                        padding: 14,
                        alignItems: "center",
                        opacity: !recoveryEmailInput ? 0.6 : 1,
                      }}
                    >
                      {actionLoading === "recovery" ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={{ color: "#fff", fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>{t("common.save")}</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              )}
            </SecuritySection>
          </View>

          {/* Device Management */}
          <View style={isDesktop ? { width: "48%", minWidth: 340, flexGrow: 1 } : {}}>
            <SecuritySection
              icon="phone-portrait"
              iconColor="#06B6D4"
              iconBg="rgba(6, 182, 212, 0.12)"
              title={t("securityPage.trustedDevices")}
              description={t("securityPage.devicesRegistered", { count: security?.devices_count || 0 })}
            >
              <Pressable
                onPress={() => router.push("/settings/devices" as any)}
                style={{
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 12,
                  padding: 14,
                  alignItems: "center",
                  marginTop: 12,
                  maxWidth: btnMaxWidth,
                  borderWidth: 1,
                  borderColor: tc.dark.border,
                }}
              >
                <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>
                  {t("securityPage.manageDevices")}
                </Text>
              </Pressable>
            </SecuritySection>
          </View>

          {/* Change PIN */}
          <View style={isDesktop ? { width: "48%", minWidth: 340, flexGrow: 1 } : {}}>
            <SecuritySection
              icon="lock-closed"
              iconColor="#10B981"
              iconBg="rgba(16, 185, 129, 0.12)"
              title={t("securityPage.changePin")}
              description={t("securityPage.changePinDesc")}
            >
              <Pressable
                onPress={() => router.push("/settings/change-pin")}
                style={{
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 12,
                  padding: 14,
                  alignItems: "center",
                  marginTop: 12,
                  maxWidth: btnMaxWidth,
                  borderWidth: 1,
                  borderColor: tc.dark.border,
                }}
              >
                <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>
                  {t("securityPage.changePin")}
                </Text>
              </Pressable>
            </SecuritySection>
          </View>
        </View>

        {/* Login Security Info */}
        <View
          style={{
            backgroundColor: "rgba(16, 185, 129, 0.06)",
            borderRadius: 14,
            padding: 16,
            marginTop: 8,
            borderWidth: 1,
            borderColor: "rgba(16, 185, 129, 0.1)",
            flexDirection: "row",
            gap: 12,
          }}
        >
          <Ionicons name="information-circle" size={20} color={tc.primary[400]} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold", marginBottom: 4 }}>
              {t("securityPage.loginProtection")}
            </Text>
            <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 20 }}>
              {t("securityPage.loginProtectionDesc")}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
