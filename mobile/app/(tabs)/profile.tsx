import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  Linking,
  Switch,
  useWindowDimensions,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect } from "react";
import * as ImagePicker from "expo-image-picker";
import { useAuth, isBiometricEnabled, setBiometricEnabled } from "../../src/stores/auth";
import { useBiometricAuth } from "../../src/hooks/useBiometricAuth";
import { useToast } from "../../src/components/Toast";
import { usePhonePrivacy, maskPhone } from "../../src/utils/privacy";
import { useLocale } from "../../src/hooks/useLocale";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { authApi } from "../../src/api/auth";
import { config } from "../../src/constants/config";

const isWeb = Platform.OS === "web";

/** Resolve avatar URL — handles relative paths from Django */
function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  // Relative path from Django (e.g., /media/avatars/xxx.jpg)
  const base = config.apiUrl.replace(/\/api\/v1\/?$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

function getKycTiers(tc: ReturnType<typeof getThemeColors>) {
  return [
    { tier: 0, labelKey: "kyc.phoneOnly", limit: "KSh 5,000/day", color: tc.dark.muted },
    { tier: 1, labelKey: "kyc.idVerified", limit: "KSh 50,000/day", color: colors.warning },
    { tier: 2, labelKey: "kyc.kraPin", limit: "KSh 250,000/day", color: colors.info },
    { tier: 3, labelKey: "kyc.enhancedDd", limit: "KSh 1,000,000/day", color: colors.success },
  ];
}

interface MenuItemProps {
  icon: string;
  label: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
  iconBg?: string;
  iconColor?: string;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  trailing?: React.ReactNode;
}

function MenuItem({ icon, label, subtitle, onPress, danger, iconBg, iconColor, tc, ts, trailing }: MenuItemProps) {
  const itemIconBg = danger
    ? colors.error + "15"
    : iconBg || tc.dark.elevated + "80";
  const itemIconColor = danger ? colors.error : iconColor || tc.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 18,
        paddingVertical: 15,
        backgroundColor: pressed
          ? tc.dark.elevated + "60"
          : isWeb && hovered
            ? tc.dark.elevated + "30"
            : "transparent",
        minHeight: 62,
        transform: [{ scale: pressed ? 0.985 : 1 }],
        opacity: pressed ? 0.9 : 1,
        ...(isWeb ? { cursor: "pointer", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" } as any : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel={`${label}${subtitle ? `. ${subtitle}` : ""}`}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          backgroundColor: itemIconBg,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 14,
        }}
      >
        <Ionicons name={icon as any} size={20} color={itemIconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 15,
            fontFamily: "DMSans_500Medium",
            color: danger ? colors.error : tc.textPrimary,
            marginBottom: subtitle ? 3 : 0,
          }}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing || <Ionicons name="chevron-forward" size={16} color={tc.dark.muted} />}
    </Pressable>
  );
}

function getInitials(name: string | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function ThemeToggleSwitch({ isDark, onToggle, tc }: { isDark: boolean; onToggle: () => void; tc: ReturnType<typeof getThemeColors> }) {
  if (isWeb) {
    return (
      <Pressable
        onPress={onToggle}
        style={({ hovered }: any) => ({
          width: 52,
          height: 30,
          borderRadius: 15,
          backgroundColor: isDark ? colors.primary[500] + "60" : tc.dark.elevated,
          justifyContent: "center",
          paddingHorizontal: 3,
          ...(isWeb ? { cursor: "pointer", transition: "all 0.25s ease" } as any : {}),
          ...(isWeb && hovered ? { opacity: 0.85 } : {}),
        })}
        accessibilityRole="switch"
        accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: isDark ? colors.primary[400] : tc.textMuted,
            alignSelf: isDark ? "flex-end" : "flex-start",
            alignItems: "center",
            justifyContent: "center",
            ...(isWeb ? { transition: "all 0.25s ease" } as any : {}),
          }}
        >
          <Ionicons name={isDark ? "moon" : "sunny"} size={13} color="#fff" />
        </View>
      </Pressable>
    );
  }

  return (
    <Switch
      value={isDark}
      onValueChange={() => onToggle()}
      trackColor={{ false: tc.dark.elevated, true: colors.primary[500] + "60" }}
      thumbColor={isDark ? colors.primary[400] : tc.textMuted}
    />
  );
}

/** Info row used inside the profile header card */
function ProfileInfoChip({
  icon,
  label,
  value,
  tc,
  onPress,
  badge,
}: {
  icon: string;
  label: string;
  value: string;
  tc: ReturnType<typeof getThemeColors>;
  onPress?: () => void;
  badge?: { text: string; color: string; onPress?: () => void } | null;
}) {
  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: tc.dark.bg,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: tc.glass.border,
        gap: 10,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: colors.primary[500] + "12",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon as any} size={16} color={colors.primary[400]} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_500Medium",
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            {label}
          </Text>
          {badge ? (
            badge.onPress ? (
              <Pressable
                onPress={badge.onPress}
                style={({ hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 3,
                  backgroundColor: badge.color + "15",
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 6,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease", opacity: hovered ? 0.8 : 1 } as any : {}),
                })}
              >
                <Ionicons
                  name={badge.color === colors.success ? "checkmark-circle" : "alert-circle"}
                  size={10}
                  color={badge.color}
                />
                <Text style={{ color: badge.color, fontSize: 10, fontFamily: "DMSans_600SemiBold" }}>
                  {badge.text}
                </Text>
              </Pressable>
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 3,
                  backgroundColor: badge.color + "15",
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 6,
                }}
              >
                <Ionicons
                  name={badge.color === colors.success ? "checkmark-circle" : "alert-circle"}
                  size={10}
                  color={badge.color}
                />
                <Text style={{ color: badge.color, fontSize: 10, fontFamily: "DMSans_600SemiBold" }}>
                  {badge.text}
                </Text>
              </View>
            )
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            color: tc.textPrimary,
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
            ...(Platform.OS === "web" ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as any : {}),
          }}
        >
          {value}
        </Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={14} color={tc.dark.muted} /> : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ hovered }: any) => ({
          ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
          ...(isWeb && hovered ? { opacity: 0.85 } : {}),
        })}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { width } = useWindowDimensions();
  const { isDark, toggle: toggleTheme } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { formatPhone, phoneVisible, toggle: togglePhoneVisibility } = usePhonePrivacy();

  const isDesktop = isWeb && width >= 900;
  const isLargeDesktop = isWeb && width >= 1200;

  const KYC_TIERS = getKycTiers(tc);
  const currentTier = KYC_TIERS.find((tier) => tier.tier === (user?.kyc_tier ?? 0));
  const tierProgress = ((user?.kyc_tier ?? 0) + 1) / KYC_TIERS.length;

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);
  const toast = useToast();
  const biometric = useBiometricAuth();
  const { locale, setLocale, t } = useLocale();

  const [avatarUri, setAvatarUri] = useState<string | null>(resolveAvatarUrl(user?.avatar_url));
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleVerifyEmail = async () => {
    if (!user?.email) {
      router.push("/settings/edit-profile" as any);
      return;
    }
    try {
      await authApi.sendEmailVerification(user.email);
      toast.success("Code Sent", `Verification code sent to ${user.email}`);
      router.push("/settings/edit-profile?verify=1" as any);
    } catch {
      toast.error("Failed", "Could not send verification email. Try again.");
    }
  };

  const emailBadge = user?.email
    ? user.email_verified
      ? { text: "Verified", color: colors.success }
      : { text: "Verify", color: colors.warning, onPress: handleVerifyEmail }
    : null;

  const handlePickAvatar = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setUploadingAvatar(true);
        try {
          const formData = new FormData();
          if (Platform.OS === "web") {
            const response = await fetch(asset.uri);
            const blob = await response.blob();
            const file = new File([blob], "avatar.jpg", {
              type: asset.mimeType || "image/jpeg",
            });
            formData.append("avatar", file);
          } else {
            formData.append("avatar", {
              uri: asset.uri,
              type: asset.mimeType || "image/jpeg",
              name: "avatar.jpg",
            } as any);
          }
          const { data } = await authApi.updateProfile(formData);
          setAvatarUri(resolveAvatarUrl(data.avatar_url));
          toast.success("Updated", "Profile photo updated");
        } catch (err: any) {
          const msg = err?.response?.data?.detail || err?.response?.data?.avatar?.[0] || "Could not upload photo";
          toast.error("Upload Failed", msg);
        } finally {
          setUploadingAvatar(false);
        }
      }
    } catch {
      toast.error("Error", "Could not open image picker");
    }
  };

  useEffect(() => {
    isBiometricEnabled().then(setBiometricOn);
  }, []);

  const handleVerifyIdentity = () => {
    router.push("/settings/kyc" as any);
  };

  const handleBiometricToggle = async (value: boolean) => {
    if (isWeb) {
      toast.info(t("profile.notAvailable"), t("profile.biometricMobileOnly"));
      return;
    }

    if (!biometric.isAvailable) {
      toast.warning(
        t("profile.notAvailable"),
        t("profile.biometricNotAvailable")
      );
      return;
    }

    if (value) {
      const success = await biometric.authenticate("Verify to enable biometric login");
      if (!success) {
        toast.error(t("profile.failed"), t("profile.biometricFailed"));
        return;
      }
    }

    await setBiometricEnabled(value);
    setBiometricOn(value);
    toast.success(
      value ? t("profile.enabled") : t("profile.disabled"),
      value
        ? `${biometric.biometricType === "face" ? t("profile.faceId") : t("profile.fingerprint")} ${t("profile.biometricEnabled")}`
        : t("profile.biometricDisabled")
    );
  };

  const handleOpenUrl = (url: string) => {
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url);
    }
  };

  const handleHelpSupport = () => {
    handleOpenUrl("mailto:support@cpay.co.ke");
  };

  const handleTermsOfService = () => {
    router.push("/settings/terms" as any);
  };

  const handlePrivacyPolicy = () => {
    router.push("/settings/terms" as any);
  };

  const handleSelectLanguage = async (lang: string) => {
    await setLocale(lang);
    setShowLanguagePicker(false);
    toast.success(
      t("profile.languageChanged"),
      lang === "en" ? t("profile.langSetEnglish") : t("profile.langSetSwahili")
    );
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      setShowLogoutConfirm(true);
    } else {
      Alert.alert(t("profile.logout"), t("profile.logoutConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("profile.logout"),
          style: "destructive",
          onPress: async () => {
            await logout();
            router.replace("/auth/login");
          },
        },
      ]);
    }
  };

  const confirmLogout = async () => {
    setShowLogoutConfirm(false);
    await logout();
    router.replace("/auth/login");
  };

  const hPad = isLargeDesktop ? 48 : isDesktop ? 32 : 16;
  const dividerColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";

  // Shared card style
  const cardStyle = {
    backgroundColor: tc.dark.card,
    borderRadius: 20,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: tc.glass.border,
    ...ts.sm,
  };

  // ── Avatar component (shared between layouts) ──
  const renderAvatar = (size: number) => (
    <Pressable
      onPress={handlePickAvatar}
      style={({ hovered }: any) => ({
        position: "relative" as const,
        ...(isWeb ? { cursor: "pointer", transition: "transform 0.2s ease" } as any : {}),
        transform: [{ scale: isWeb && hovered ? 1.03 : 1 }],
      })}
      accessibilityRole="button"
      accessibilityLabel="Change profile photo"
    >
      {avatarUri ? (
        <Image
          source={{ uri: avatarUri }}
          style={{
            width: size,
            height: size,
            borderRadius: size * 0.32,
            borderWidth: 3,
            borderColor: colors.primary[500] + "40",
          }}
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size * 0.32,
            backgroundColor: colors.primary[500] + "18",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 3,
            borderColor: colors.primary[500] + "30",
            ...ts.glow(colors.primary[500], 0.15),
          }}
        >
          <Text
            style={{
              color: colors.primary[400],
              fontSize: size * 0.32,
              fontFamily: "DMSans_700Bold",
            }}
          >
            {getInitials(user?.full_name)}
          </Text>
        </View>
      )}
      {/* Camera badge */}
      <View
        style={{
          position: "absolute",
          bottom: -2,
          right: -2,
          width: size > 80 ? 34 : 28,
          height: size > 80 ? 34 : 28,
          borderRadius: size > 80 ? 17 : 14,
          backgroundColor: colors.primary[500],
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 3,
          borderColor: tc.dark.card,
          ...ts.sm,
        }}
      >
        <Ionicons
          name={uploadingAvatar ? "sync" : "camera"}
          size={size > 80 ? 16 : 14}
          color="#fff"
        />
      </View>
    </Pressable>
  );

  // ── KYC Status card (shared between layouts) ──
  const renderKycStatus = () => (
    <View
      style={{
        backgroundColor: tc.dark.bg,
        borderRadius: 16,
        padding: isDesktop ? 20 : 16,
        borderWidth: 1,
        borderColor: tc.glass.border,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <View>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_500Medium",
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 6,
            }}
          >
            {t("profile.verificationLevel")}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: currentTier?.color,
                ...ts.glow(currentTier?.color || tc.dark.muted, 0.4),
              }}
            />
            <Text
              style={{
                fontSize: 15,
                fontFamily: "DMSans_600SemiBold",
                color: currentTier?.color,
              }}
            >
              {t("kyc.tier")} {currentTier?.tier}: {currentTier ? t(currentTier.labelKey) : ""}
            </Text>
          </View>
        </View>
        <View
          style={{
            backgroundColor: tc.dark.elevated,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
        >
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 12,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            {currentTier?.limit}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View
        style={{
          height: 6,
          backgroundColor: tc.dark.elevated,
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${tierProgress * 100}%`,
            backgroundColor: currentTier?.color || tc.dark.muted,
            borderRadius: 3,
            ...(isWeb ? { transition: "width 0.6s ease" } as any : {}),
          }}
        />
      </View>

      {/* Tier dots */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 10,
        }}
      >
        {KYC_TIERS.map((t) => (
          <View key={t.tier} style={{ alignItems: "center" }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor:
                  (user?.kyc_tier ?? 0) >= t.tier
                    ? t.color
                    : tc.dark.elevated,
                ...(isWeb ? { transition: "background-color 0.3s ease" } as any : {}),
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );

  const isMaxTier = (user?.kyc_tier ?? 0) >= 3;

  // ── Edit Profile / Verify Identity action buttons ──
  const renderActionButtons = () => (
    <View style={{ flexDirection: isDesktop ? "column" : "row", gap: 10, marginTop: isDesktop ? 0 : 20 }}>
      {isMaxTier ? (
        /* ── Verified status badge for max-tier users ── */
        <View
          style={{
            flex: isDesktop ? undefined : 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 14,
            backgroundColor: colors.success + "18",
            borderWidth: 1,
            borderColor: colors.success + "40",
            ...(isWeb ? { transition: "all 0.3s ease" } as any : {}),
          }}
          accessibilityLabel="Identity Verified"
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: colors.success + "30",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="shield-checkmark" size={16} color={colors.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.success,
                fontSize: 13,
                fontFamily: "DMSans_700Bold",
                letterSpacing: 0.2,
              }}
              numberOfLines={1}
            >
              {t("profile.identityVerified")}
            </Text>
            <Text
              style={{
                color: colors.success + "B0",
                fontSize: 11,
                fontFamily: "DMSans_400Regular",
                marginTop: 1,
              }}
              numberOfLines={1}
            >
              {t("kyc.enhancedDd")} — {currentTier?.limit}
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        </View>
      ) : (
        <Pressable
          onPress={handleVerifyIdentity}
          style={({ pressed, hovered }: any) => ({
            flex: isDesktop ? undefined : 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 14,
            backgroundColor: pressed
              ? colors.primary[600]
              : isWeb && hovered
                ? colors.primary[500]
                : colors.primary[500] + "E6",
            ...ts.glow(colors.primary[500], pressed ? 0.1 : isWeb && hovered ? 0.4 : 0.25),
            ...(isWeb ? { cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as any : {}),
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
          accessibilityRole="button"
          accessibilityLabel="Verify Identity"
        >
          <Ionicons name="shield-checkmark" size={16} color="#fff" />
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 13,
              fontFamily: "DMSans_600SemiBold",
            }}
            numberOfLines={1}
          >
            {t("profile.verifyIdentity")}
          </Text>
        </Pressable>
      )}
      <Pressable
        onPress={() => router.push("/settings/edit-profile" as any)}
        style={({ pressed, hovered }: any) => ({
          flex: isDesktop ? undefined : 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 14,
          backgroundColor: pressed
            ? tc.dark.elevated + "80"
            : isWeb && hovered
              ? tc.dark.elevated + "60"
              : tc.dark.elevated + "40",
          borderWidth: 1,
          borderColor: tc.glass.borderStrong,
          ...(isWeb ? { cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as any : {}),
          transform: [{ scale: pressed ? 0.97 : 1 }],
        })}
        accessibilityRole="button"
        accessibilityLabel="Edit Profile"
      >
        <Ionicons name="create-outline" size={16} color={tc.textPrimary} />
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 13,
            fontFamily: "DMSans_600SemiBold",
          }}
          numberOfLines={1}
        >
          {t("profile.editProfile")}
        </Text>
      </Pressable>
    </View>
  );

  // ── Security settings section ──
  const renderSecuritySection = () => (
    <>
      <SectionHeader title={t("profile.security")} icon="shield-checkmark-outline" iconColor={colors.primary[400]} />
      <View style={{ ...cardStyle, marginBottom: 24 }}>
        {isMaxTier ? (
          /* Verified status display for max-tier users */
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              paddingVertical: 14,
              paddingHorizontal: 18,
            }}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                backgroundColor: colors.success + "18",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="shield-checkmark" size={22} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.success,
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                {t("profile.identityVerified")}
              </Text>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                  marginTop: 2,
                }}
              >
                {t("kyc.enhancedDd")} — {currentTier?.limit}
              </Text>
            </View>
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 8,
                backgroundColor: colors.success + "18",
                borderWidth: 1,
                borderColor: colors.success + "30",
              }}
            >
              <Text
                style={{
                  color: colors.success,
                  fontSize: 11,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                {t("common.verified")}
              </Text>
            </View>
          </View>
        ) : (
          <MenuItem
            icon="shield-checkmark-outline"
            label={t("profile.verifyIdentity")}
            subtitle={currentTier ? `${t(currentTier.labelKey)} - ${currentTier.limit}` : undefined}
            onPress={handleVerifyIdentity}
            iconBg={colors.primary[500] + "20"}
            iconColor={colors.primary[400]}
            tc={tc}
            ts={ts}
          />
        )}
        <View style={{ height: 1, backgroundColor: dividerColor, marginLeft: 76 }} />
        <MenuItem
          icon="lock-closed-outline"
          label={t("profile.changePin")}
          subtitle={t("profile.updatePin")}
          onPress={() => router.push("/settings/change-pin")}
          iconBg={colors.info + "20"}
          iconColor={colors.info}
          tc={tc}
          ts={ts}
        />
        <View style={{ height: 1, backgroundColor: dividerColor, marginLeft: 76 }} />
        <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 18 }}>
          <View style={{ flex: 1 }}>
            <MenuItem
              icon="finger-print-outline"
              label={t("profile.biometricLogin")}
              subtitle={
                biometric.isAvailable
                  ? `${biometric.biometricType === "face" ? t("profile.faceId") : t("profile.fingerprint")} ${biometricOn ? t("profile.enabled") : t("profile.disabled")}`
                  : t("profile.biometricNotAvailable")
              }
              onPress={() => handleBiometricToggle(!biometricOn)}
              iconBg={colors.accent + "20"}
              iconColor={colors.accent}
              tc={tc}
              ts={ts}
              trailing={<View />}
            />
          </View>
          {isWeb ? (
            <Pressable
              onPress={() => handleBiometricToggle(!biometricOn)}
              style={({ hovered }: any) => ({
                width: 52,
                height: 30,
                borderRadius: 15,
                backgroundColor: biometricOn ? colors.primary[500] + "60" : tc.dark.elevated,
                justifyContent: "center",
                paddingHorizontal: 3,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.25s ease" } as any : {}),
                ...(isWeb && hovered ? { opacity: 0.85 } : {}),
              })}
              accessibilityRole="switch"
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: biometricOn ? colors.primary[400] : tc.textMuted,
                  alignSelf: biometricOn ? "flex-end" : "flex-start",
                  ...(isWeb ? { transition: "all 0.25s ease" } as any : {}),
                }}
              />
            </Pressable>
          ) : (
            <Switch
              value={biometricOn}
              onValueChange={handleBiometricToggle}
              trackColor={{ false: tc.dark.elevated, true: colors.primary[500] + "60" }}
              thumbColor={biometricOn ? colors.primary[400] : tc.textMuted}
              disabled={!biometric.isAvailable}
            />
          )}
        </View>
      </View>
    </>
  );

  // ── Preferences section ──
  const renderPreferencesSection = () => (
    <>
      <SectionHeader title={t("settings.preferences")} icon="options-outline" iconColor={colors.info} />
      <View style={{ ...cardStyle, marginBottom: 24 }}>
        {/* Dark Mode Toggle */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 18 }}>
          <View style={{ flex: 1 }}>
            <MenuItem
              icon={isDark ? "moon-outline" : "sunny-outline"}
              label={isDark ? t("profile.darkMode") : t("profile.lightMode")}
              subtitle={isDark ? t("profile.darkThemeActive") : t("profile.lightThemeActive")}
              onPress={toggleTheme}
              iconBg={isDark ? "rgba(99,102,241,0.15)" : "rgba(251,191,36,0.15)"}
              iconColor={isDark ? "#818CF8" : "#F59E0B"}
              tc={tc}
              ts={ts}
              trailing={<View />}
            />
          </View>
          <ThemeToggleSwitch isDark={isDark} onToggle={toggleTheme} tc={tc} />
        </View>
        <View style={{ height: 1, backgroundColor: dividerColor, marginLeft: 76 }} />
        <MenuItem
          icon="notifications-outline"
          label={t("settings.notifications")}
          subtitle={t("profile.manageNotifications")}
          onPress={() => router.push("/settings/notifications" as any)}
          iconBg={colors.primary[500] + "20"}
          iconColor={colors.primary[400]}
          tc={tc}
          ts={ts}
        />
        <View style={{ height: 1, backgroundColor: dividerColor, marginLeft: 76 }} />
        <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 18 }}>
          <View style={{ flex: 1 }}>
            <MenuItem
              icon={phoneVisible ? "eye-outline" : "eye-off-outline"}
              label={t("profile.showPhoneNumber")}
              subtitle={phoneVisible ? t("profile.phoneVisible") : t("profile.phoneHidden")}
              onPress={togglePhoneVisibility}
              iconBg={colors.info + "20"}
              iconColor={colors.info}
              tc={tc}
              ts={ts}
              trailing={<View />}
            />
          </View>
          {isWeb ? (
            <Pressable
              onPress={togglePhoneVisibility}
              style={({ hovered }: any) => ({
                width: 52,
                height: 30,
                borderRadius: 15,
                backgroundColor: phoneVisible ? colors.primary[500] + "60" : tc.dark.elevated,
                justifyContent: "center",
                paddingHorizontal: 3,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.25s ease" } as any : {}),
                ...(isWeb && hovered ? { opacity: 0.85 } : {}),
              })}
              accessibilityRole="switch"
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: phoneVisible ? colors.primary[400] : tc.textMuted,
                  alignSelf: phoneVisible ? "flex-end" : "flex-start",
                  ...(isWeb ? { transition: "all 0.25s ease" } as any : {}),
                }}
              />
            </Pressable>
          ) : (
            <Switch
              value={phoneVisible}
              onValueChange={togglePhoneVisibility}
              trackColor={{ false: tc.dark.elevated, true: colors.primary[500] + "60" }}
              thumbColor={phoneVisible ? colors.primary[500] : tc.dark.muted}
            />
          )}
        </View>
        <View style={{ height: 1, backgroundColor: dividerColor, marginLeft: 76 }} />
        <MenuItem
          icon="language-outline"
          label={t("profile.language")}
          subtitle={locale === "en" ? t("profile.english") : t("profile.swahili")}
          onPress={() => setShowLanguagePicker(true)}
          iconBg={colors.warning + "20"}
          iconColor={colors.warning}
          tc={tc}
          ts={ts}
        />
      </View>
    </>
  );

  // ── Admin section (staff only) ──
  const renderAdminSection = () => {
    if (!user?.is_staff) return null;
    return (
      <>
        <SectionHeader title="Admin" icon="shield-outline" iconColor="#F59E0B" />
        <View style={{ ...cardStyle, marginBottom: 24 }}>
          <MenuItem
            icon="analytics-outline"
            label="Float Management"
            subtitle="Rebalance dashboard & float status"
            onPress={() => router.push("/settings/admin-rebalance" as any)}
            iconBg="rgba(245, 158, 11, 0.15)"
            iconColor="#F59E0B"
            tc={tc}
            ts={ts}
          />
          <View style={{ height: 1, backgroundColor: dividerColor, marginLeft: 76 }} />
          <MenuItem
            icon="people-outline"
            label="User Management"
            subtitle="Manage accounts, verify KYC & suspend"
            onPress={() => router.push("/settings/admin-users" as any)}
            iconBg="rgba(99, 102, 241, 0.15)"
            iconColor="#6366F1"
            tc={tc}
            ts={ts}
          />
          <View style={{ height: 1, backgroundColor: dividerColor, marginLeft: 76 }} />
          <MenuItem
            icon="stats-chart-outline"
            label="Platform Stats"
            subtitle="KPIs, system health & milestones"
            onPress={() => {
              const statsUrl = `${config.apiUrl}`.replace(/\/api\/v1\/?$/, "") + "/admin/stats/";
              if (Platform.OS === "web") {
                window.open(statsUrl, "_blank");
              } else {
                Linking.openURL(statsUrl);
              }
            }}
            iconBg="rgba(16, 185, 129, 0.15)"
            iconColor="#10B981"
            tc={tc}
            ts={ts}
          />
          <MenuItem
            icon="megaphone-outline"
            label="Broadcast Notifications"
            subtitle="Send announcements to all users"
            onPress={() => router.push("/settings/admin-broadcast" as any)}
            iconBg="rgba(139, 92, 246, 0.15)"
            iconColor="#8B5CF6"
            tc={tc}
            ts={ts}
          />
        </View>
      </>
    );
  };

  // ── Support section ──
  const renderSupportSection = () => (
    <>
      <SectionHeader title={t("profile.support")} icon="help-buoy-outline" iconColor={colors.warning} />
      <View style={{ ...cardStyle, marginBottom: 24 }}>
        <MenuItem
          icon="help-circle-outline"
          label={t("profile.helpSupport")}
          subtitle={t("profile.getHelpEmail")}
          onPress={handleHelpSupport}
          iconBg={colors.warning + "20"}
          iconColor={colors.warning}
          tc={tc}
          ts={ts}
        />
        <View style={{ height: 1, backgroundColor: dividerColor, marginLeft: 76 }} />
        <MenuItem
          icon="document-text-outline"
          label={t("profile.termsOfService")}
          subtitle={t("profile.readTerms")}
          onPress={handleTermsOfService}
          tc={tc}
          ts={ts}
        />
        <View style={{ height: 1, backgroundColor: dividerColor, marginLeft: 76 }} />
        <MenuItem
          icon="shield-outline"
          label={t("profile.privacyPolicy")}
          subtitle={t("profile.protectData")}
          onPress={handlePrivacyPolicy}
          tc={tc}
          ts={ts}
        />
      </View>
    </>
  );

  // ── Logout button ──
  const renderLogoutButton = () => (
    <Pressable
      onPress={handleLogout}
      style={({ pressed, hovered }: any) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        paddingVertical: 16,
        borderRadius: 16,
        backgroundColor: pressed
          ? colors.error + "25"
          : isWeb && hovered
            ? colors.error + "18"
            : colors.error + "10",
        borderWidth: 1,
        borderColor: pressed
          ? colors.error + "50"
          : isWeb && hovered
            ? colors.error + "40"
            : colors.error + "20",
        marginBottom: 16,
        maxWidth: isDesktop ? 360 : undefined,
        ...(isWeb ? { cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as any : {}),
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
      accessibilityRole="button"
      accessibilityLabel={t("profile.logout")}
    >
      <Ionicons name="log-out-outline" size={20} color={colors.error} />
      <Text
        style={{
          color: colors.error,
          fontSize: 15,
          fontFamily: "DMSans_600SemiBold",
        }}
      >
        {t("profile.logout")}
      </Text>
    </Pressable>
  );

  // ── Version footer ──
  const renderVersion = () => (
    <Text
      style={{
        color: tc.textMuted,
        fontSize: 12,
        fontFamily: "DMSans_400Regular",
        textAlign: "center",
        marginTop: 4,
        marginBottom: 28,
        opacity: 0.5,
      }}
      maxFontSizeMultiplier={1.3}
      accessibilityLabel={t("profile.version")}
    >
      {t("profile.version")}
    </Text>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 40,
          ...(isDesktop
            ? { paddingHorizontal: 48 }
            : {}),
        }}
      >
        {/* ── Suspension Banner ── */}
        {user?.is_suspended && (
          <View
            style={{
              marginHorizontal: hPad,
              marginTop: isDesktop ? 12 : 8,
              marginBottom: 12,
              backgroundColor: colors.error + "12",
              borderRadius: 16,
              padding: 18,
              borderWidth: 1,
              borderColor: colors.error + "30",
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 14,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: colors.error + "20",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="ban-outline" size={20} color={colors.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.error,
                  fontSize: 15,
                  fontFamily: "DMSans_700Bold",
                  marginBottom: 4,
                }}
              >
                Account Suspended
              </Text>
              {user.suspension_reason ? (
                <Text
                  style={{
                    color: colors.error + "CC",
                    fontSize: 13,
                    fontFamily: "DMSans_400Regular",
                    lineHeight: 19,
                  }}
                >
                  {user.suspension_reason}
                </Text>
              ) : null}
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                  marginTop: 6,
                }}
              >
                Transactions and profile updates are disabled. Contact support for assistance.
              </Text>
            </View>
          </View>
        )}

        {/* Page title with settings button */}
        <View
          style={{
            paddingHorizontal: hPad + 4,
            paddingTop: isDesktop ? 12 : 8,
            paddingBottom: 6,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {!isDesktop && (
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 28,
                fontFamily: "DMSans_700Bold",
                letterSpacing: -0.5,
              }}
            >
              {t("profile.profile")}
            </Text>
          )}
          {isDesktop && <View />}
          <Pressable
            onPress={() => router.push("/settings" as any)}
            style={({ pressed, hovered }: any) => ({
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: hovered
                ? tc.glass.highlight
                : tc.dark.card,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: hovered ? tc.glass.borderStrong : tc.glass.border,
              opacity: pressed ? 0.8 : 1,
              ...ts.sm,
              ...(isWeb
                ? ({
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    transform: hovered ? "scale(1.05)" : "scale(1)",
                  } as any)
                : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={22} color={tc.textSecondary} />
          </Pressable>
        </View>

        {/* ── Profile Header Card ── */}
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 24,
            marginHorizontal: hPad,
            padding: isDesktop ? 32 : 24,
            marginTop: isDesktop ? 12 : 8,
            marginBottom: 24,
            borderWidth: 1,
            borderColor: tc.glass.border,
            ...ts.md,
          }}
        >
          {isDesktop ? (
            /* Desktop: horizontal layout — avatar+name | info chips & KYC | actions */
            <View style={{ flexDirection: "row", gap: 32 }}>
              {/* Left: Avatar + Name + Phone */}
              <View style={{ alignItems: "center", minWidth: 180 }}>
                {renderAvatar(96)}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, marginBottom: 8 }}>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 22,
                      fontFamily: "DMSans_700Bold",
                      letterSpacing: -0.3,
                      textAlign: "center",
                    }}
                  >
                    {user?.full_name || "User"}
                  </Text>
                  {(user?.kyc_tier ?? 0) >= 1 && (
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: colors.primary[500],
                        alignItems: "center",
                        justifyContent: "center",
                        ...ts.glow(colors.primary[500], 0.3),
                      }}
                    >
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                    </View>
                  )}
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: tc.dark.bg,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                  }}
                >
                  <Ionicons name="call-outline" size={13} color={tc.textSecondary} />
                  <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_400Regular" }}>
                    {formatPhone(user?.phone)}
                  </Text>
                  <Pressable
                    onPress={togglePhoneVisibility}
                    style={({ hovered }: any) => ({
                      marginLeft: 4, padding: 2, borderRadius: 4,
                      ...(isWeb ? { cursor: "pointer", transition: "opacity 0.15s ease" } as any : {}),
                      opacity: isWeb && hovered ? 0.7 : 1,
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={phoneVisible ? "Hide phone number" : "Show phone number"}
                  >
                    <Ionicons name={phoneVisible ? "eye-outline" : "eye-off-outline"} size={14} color={tc.textMuted} />
                  </Pressable>
                </View>
                {/* Action buttons under avatar on desktop */}
                <View style={{ flexDirection: "row", gap: 10, marginTop: 20, width: "100%" }}>
                  {renderActionButtons()}
                </View>
              </View>

              {/* Vertical divider */}
              <View style={{ width: 1, backgroundColor: tc.glass.border, marginVertical: 4 }} />

              {/* Right: Info chips + KYC status (fills remaining space) */}
              <View style={{ flex: 1, justifyContent: "center" }}>
                {/* Info chips row */}
                <View style={{ flexDirection: "row", gap: 12, marginBottom: 20 }}>
                  <View style={{ flex: 1 }}>
                    <ProfileInfoChip
                      icon="mail-outline"
                      label={t("help.email")}
                      value={user?.email || t("common.notSet")}
                      tc={tc}
                      badge={emailBadge}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    {isMaxTier ? (
                      /* Verified badge chip for max-tier */
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          backgroundColor: colors.success + "10",
                          borderRadius: 14,
                          padding: 14,
                          borderWidth: 1,
                          borderColor: colors.success + "25",
                        }}
                      >
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            backgroundColor: colors.success + "20",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="shield-checkmark" size={18} color={colors.success} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
                            {t("kyc.currentLevel")}
                          </Text>
                          <Text style={{ color: colors.success, fontSize: 14, fontFamily: "DMSans_700Bold", marginTop: 1 }}>
                            {t("profile.identityVerified")}
                          </Text>
                        </View>
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 6,
                            backgroundColor: colors.success + "18",
                          }}
                        >
                          <Text style={{ color: colors.success, fontSize: 10, fontFamily: "DMSans_700Bold" }}>
                            {t("kyc.tier").toUpperCase()} {currentTier?.tier}
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <ProfileInfoChip
                        icon="shield-checkmark-outline"
                        label={t("kyc.currentLevel")}
                        value={currentTier ? `${t("kyc.tier")} ${currentTier.tier}: ${t(currentTier.labelKey)}` : t("common.unverified")}
                        tc={tc}
                        onPress={handleVerifyIdentity}
                      />
                    )}
                  </View>
                </View>

                {/* KYC progress */}
                {renderKycStatus()}
              </View>
            </View>
          ) : (
            /* Mobile: vertical stacked layout */
            <>
              {/* Avatar row */}
              <View style={{ alignItems: "center", marginBottom: 24, gap: 16 }}>
                {renderAvatar(88)}
                <View style={{ alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 24,
                        fontFamily: "DMSans_700Bold",
                        letterSpacing: -0.3,
                        textAlign: "center",
                      }}
                    >
                      {user?.full_name || "User"}
                    </Text>
                    {(user?.kyc_tier ?? 0) >= 1 && (
                      <View
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          backgroundColor: colors.primary[500],
                          alignItems: "center",
                          justifyContent: "center",
                          ...ts.glow(colors.primary[500], 0.3),
                        }}
                      >
                        <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                      </View>
                    )}
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      backgroundColor: tc.dark.bg,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: tc.glass.border,
                    }}
                  >
                    <Ionicons name="call-outline" size={13} color={tc.textSecondary} />
                    <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_400Regular" }}>
                      {formatPhone(user?.phone)}
                    </Text>
                    <Pressable
                      onPress={togglePhoneVisibility}
                      style={({ hovered }: any) => ({
                        marginLeft: 4, padding: 2, borderRadius: 4,
                        ...(isWeb ? { cursor: "pointer", transition: "opacity 0.15s ease" } as any : {}),
                        opacity: isWeb && hovered ? 0.7 : 1,
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={phoneVisible ? "Hide phone number" : "Show phone number"}
                    >
                      <Ionicons name={phoneVisible ? "eye-outline" : "eye-off-outline"} size={14} color={tc.textMuted} />
                    </Pressable>
                  </View>
                </View>
              </View>

              {/* Info chips */}
              <View style={{ gap: 10, marginBottom: 4 }}>
                <ProfileInfoChip
                  icon="mail-outline"
                  label={t("help.email")}
                  value={user?.email || t("common.notSet")}
                  tc={tc}
                  badge={emailBadge}
                />
                {isMaxTier ? (
                  /* Verified badge chip for max-tier — mobile */
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      backgroundColor: colors.success + "10",
                      borderRadius: 14,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: colors.success + "25",
                    }}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        backgroundColor: colors.success + "20",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="shield-checkmark" size={20} color={colors.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
                        {t("kyc.currentLevel")}
                      </Text>
                      <Text style={{ color: colors.success, fontSize: 15, fontFamily: "DMSans_700Bold", marginTop: 2 }}>
                        {t("profile.identityVerified")}
                      </Text>
                      <Text style={{ color: tc.textSecondary, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 1 }}>
                        {t("kyc.enhancedDd")} — {currentTier?.limit}
                      </Text>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 6,
                        backgroundColor: colors.success + "18",
                      }}
                    >
                      <Text style={{ color: colors.success, fontSize: 10, fontFamily: "DMSans_700Bold" }}>
                        {t("kyc.tier").toUpperCase()} {currentTier?.tier}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <ProfileInfoChip
                    icon="shield-checkmark-outline"
                    label={t("kyc.currentLevel")}
                    value={currentTier ? `${t("kyc.tier")} ${currentTier.tier}: ${t(currentTier.labelKey)}` : t("common.unverified")}
                    tc={tc}
                    onPress={handleVerifyIdentity}
                  />
                )}
              </View>

              {/* KYC progress */}
              <View style={{ marginTop: 16 }}>
                {renderKycStatus()}
              </View>

              {/* Action buttons */}
              {renderActionButtons()}
            </>
          )}
        </View>

        {/* ── Settings sections ── */}
        {isDesktop ? (
          /* Desktop: 2-column grid for settings */
          <View
            style={{
              flexDirection: "row",
              paddingHorizontal: hPad,
              gap: 24,
              marginBottom: 8,
            }}
          >
            {/* Left column */}
            <View style={{ flex: 1 }}>
              {renderAdminSection()}
              {renderSecuritySection()}
              {renderSupportSection()}
            </View>
            {/* Right column */}
            <View style={{ flex: 1 }}>
              {renderPreferencesSection()}
              {renderLogoutButton()}
              {renderVersion()}
            </View>
          </View>
        ) : (
          /* Mobile: single column */
          <View style={{ paddingHorizontal: hPad }}>
            {renderAdminSection()}
            {renderSecuritySection()}
            {renderPreferencesSection()}
            {renderSupportSection()}
            {renderLogoutButton()}
            {renderVersion()}
          </View>
        )}
      </ScrollView>

      {/* ── Web logout confirmation overlay ── */}
      {showLogoutConfirm && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              padding: 32,
              maxWidth: 380,
              width: "90%",
              borderWidth: 1,
              borderColor: tc.glass.border,
              alignItems: "center",
              ...ts.lg,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 20,
                backgroundColor: colors.error + "15",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
                ...ts.glow(colors.error, 0.2),
              }}
            >
              <Ionicons name="log-out-outline" size={32} color={colors.error} />
            </View>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 20,
                fontFamily: "DMSans_700Bold",
                marginBottom: 8,
              }}
            >
              {t("profile.logout")}
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
                marginBottom: 28,
                lineHeight: 20,
              }}
            >
              {t("profile.logoutConfirm")}
            </Text>
            <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
              <Pressable
                onPress={() => setShowLogoutConfirm(false)}
                style={({ pressed, hovered }: any) => ({
                  flex: 1,
                  paddingVertical: 15,
                  borderRadius: 14,
                  backgroundColor: pressed
                    ? tc.dark.elevated + "80"
                    : isWeb && hovered
                      ? tc.dark.elevated + "60"
                      : tc.dark.elevated,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
                })}
              >
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 15,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  {t("common.cancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={confirmLogout}
                style={({ pressed, hovered }: any) => ({
                  flex: 1,
                  paddingVertical: 15,
                  borderRadius: 14,
                  backgroundColor: pressed
                    ? "#DC2626"
                    : isWeb && hovered
                      ? "#E53E3E"
                      : colors.error,
                  alignItems: "center",
                  ...ts.glow(colors.error, 0.25),
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
                })}
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 15,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  {t("profile.logout")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* ── Language Picker Modal ── */}
      {showLanguagePicker && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              padding: 28,
              maxWidth: 380,
              width: "90%",
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...ts.lg,
            }}
          >
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 20,
                fontFamily: "DMSans_700Bold",
                marginBottom: 6,
                textAlign: "center",
              }}
            >
              {t("profile.selectLanguage")}
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 13,
                fontFamily: "DMSans_400Regular",
                marginBottom: 20,
                textAlign: "center",
              }}
            >
              Choose your preferred language
            </Text>

            {/* English Option */}
            <Pressable
              onPress={() => handleSelectLanguage("en")}
              style={({ pressed, hovered }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 14,
                backgroundColor:
                  locale === "en"
                    ? colors.primary[500] + "20"
                    : pressed
                      ? tc.dark.elevated + "60"
                      : isWeb && hovered
                        ? tc.dark.elevated + "30"
                        : "transparent",
                borderWidth: 1,
                borderColor:
                  locale === "en" ? colors.primary[400] + "40" : tc.glass.border,
                marginBottom: 10,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
              })}
              accessibilityRole="button"
              accessibilityLabel="English"
            >
              <Image source={{ uri: "https://flagcdn.com/w80/gb.png" }} style={{ width: 28, height: 20, borderRadius: 3, marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 15,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  English
                </Text>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_400Regular",
                  }}
                >
                  English
                </Text>
              </View>
              {locale === "en" && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary[400]} />
              )}
            </Pressable>

            {/* Swahili Option */}
            <Pressable
              onPress={() => handleSelectLanguage("sw")}
              style={({ pressed, hovered }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 14,
                backgroundColor:
                  locale === "sw"
                    ? colors.primary[500] + "20"
                    : pressed
                      ? tc.dark.elevated + "60"
                      : isWeb && hovered
                        ? tc.dark.elevated + "30"
                        : "transparent",
                borderWidth: 1,
                borderColor:
                  locale === "sw" ? colors.primary[400] + "40" : tc.glass.border,
                marginBottom: 20,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
              })}
              accessibilityRole="button"
              accessibilityLabel="Kiswahili"
            >
              <Image source={{ uri: "https://flagcdn.com/w80/ke.png" }} style={{ width: 28, height: 20, borderRadius: 3, marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 15,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  Kiswahili
                </Text>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_400Regular",
                  }}
                >
                  Swahili
                </Text>
              </View>
              {locale === "sw" && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary[400]} />
              )}
            </Pressable>

            {/* Cancel Button */}
            <Pressable
              onPress={() => setShowLanguagePicker(false)}
              style={({ pressed, hovered }: any) => ({
                paddingVertical: 15,
                borderRadius: 14,
                backgroundColor: pressed
                  ? tc.dark.elevated + "80"
                  : isWeb && hovered
                    ? tc.dark.elevated + "60"
                    : tc.dark.elevated,
                alignItems: "center",
                borderWidth: 1,
                borderColor: tc.glass.border,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
              })}
            >
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                {t("common.cancel")}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
