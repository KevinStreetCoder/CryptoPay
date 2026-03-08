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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect } from "react";
import { useAuth, isBiometricEnabled, setBiometricEnabled } from "../../src/stores/auth";
import { useBiometricAuth } from "../../src/hooks/useBiometricAuth";
import { useToast } from "../../src/components/Toast";
import { useLocale } from "../../src/hooks/useLocale";
import { colors, shadows } from "../../src/constants/theme";

const KYC_TIERS = [
  { tier: 0, label: "Phone Only", limit: "KSh 5,000/day", color: colors.dark.muted },
  { tier: 1, label: "ID Verified", limit: "KSh 50,000/day", color: colors.warning },
  { tier: 2, label: "KRA PIN", limit: "KSh 250,000/day", color: colors.info },
  { tier: 3, label: "Enhanced DD", limit: "KSh 1,000,000/day", color: colors.success },
];

interface MenuItemProps {
  icon: string;
  label: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
  iconBg?: string;
  iconColor?: string;
}

function MenuItem({ icon, label, subtitle, onPress, danger, iconBg, iconColor }: MenuItemProps) {
  const itemIconBg = danger
    ? colors.error + "15"
    : iconBg || colors.dark.elevated + "80";
  const itemIconColor = danger ? colors.error : iconColor || colors.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: pressed ? colors.dark.elevated + "40" : "transparent",
        minHeight: 60,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        opacity: pressed ? 0.9 : 1,
      })}
      accessibilityRole="button"
      accessibilityLabel={`${label}${subtitle ? `. ${subtitle}` : ""}`}
    >
      <View
        style={{
          width: 42,
          height: 42,
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
            fontFamily: "Inter_500Medium",
            color: danger ? colors.error : colors.textPrimary,
            marginBottom: subtitle ? 2 : 0,
          }}
        >
          {label}
        </Text>
        {subtitle && (
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              fontFamily: "Inter_400Regular",
            }}
          >
            {subtitle}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.dark.muted} />
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

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { width } = useWindowDimensions();

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;

  const currentTier = KYC_TIERS.find((t) => t.tier === (user?.kyc_tier ?? 0));
  const tierProgress = ((user?.kyc_tier ?? 0) + 1) / KYC_TIERS.length;

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);
  const toast = useToast();
  const biometric = useBiometricAuth();
  const { locale, setLocale, t } = useLocale();

  // Load biometric preference
  useEffect(() => {
    isBiometricEnabled().then(setBiometricOn);
  }, []);

  const handleVerifyIdentity = () => {
    router.push("/settings/kyc" as any);
  };

  const handleBiometricToggle = async (value: boolean) => {
    if (isWeb) {
      toast.info("Not Available", "Biometric login is only available on mobile devices");
      return;
    }

    if (!biometric.isAvailable) {
      toast.warning(
        "Not Available",
        biometric.isEnrolled
          ? "Biometric hardware not found on this device"
          : "No biometric data enrolled. Set up fingerprint or Face ID in device settings."
      );
      return;
    }

    if (value) {
      // Verify biometric before enabling
      const success = await biometric.authenticate("Verify to enable biometric login");
      if (!success) {
        toast.error("Failed", "Biometric verification failed");
        return;
      }
    }

    await setBiometricEnabled(value);
    setBiometricOn(value);
    toast.success(
      value ? "Enabled" : "Disabled",
      value
        ? `${biometric.biometricType === "face" ? "Face ID" : "Fingerprint"} login enabled`
        : "Biometric login disabled"
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
    handleOpenUrl("mailto:support@cryptopay.co.ke");
  };

  const handleTermsOfService = () => {
    handleOpenUrl("https://cryptopay.co.ke/terms");
  };

  const handlePrivacyPolicy = () => {
    handleOpenUrl("https://cryptopay.co.ke/privacy");
  };

  const handleSelectLanguage = async (lang: string) => {
    await setLocale(lang);
    setShowLanguagePicker(false);
    toast.success(
      lang === "en" ? "Language Changed" : "Lugha Imebadilishwa",
      lang === "en" ? "App language set to English" : "Lugha ya programu imewekwa Kiswahili"
    );
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      setShowLogoutConfirm(true);
    } else {
      Alert.alert("Logout", "Are you sure you want to log out?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Logout",
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

  // Responsive padding
  const hPad = isDesktop ? 28 : 16;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 32,
        }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: hPad + 4, paddingTop: isDesktop ? 16 : 8, paddingBottom: 6 }}>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: isDesktop ? 32 : 28,
              fontFamily: "Inter_700Bold",
              letterSpacing: -0.5,
            }}
          >
            Profile
          </Text>
        </View>

        {/* Desktop: two-column layout for user card + security */}
        {isDesktop ? (
          <View
            style={{
              flexDirection: "row",
              paddingHorizontal: hPad,
              gap: 20,
              marginTop: 12,
              marginBottom: 20,
            }}
          >
            {/* Left column: User Card */}
            <View style={{ flex: 1 }}>
              <View
                style={{
                  backgroundColor: colors.dark.card,
                  borderRadius: 24,
                  padding: 28,
                  borderWidth: 1,
                  borderColor: colors.glass.border,
                  marginBottom: 20,
                }}
              >
                {/* Avatar + Info */}
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
                  <View
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 20,
                      backgroundColor: colors.primary[500] + "33",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 20,
                      borderWidth: 2,
                      borderColor: colors.primary[400] + "59",
                    }}
                  >
                    <Text
                      style={{
                        color: colors.primary[400],
                        fontSize: 28,
                        fontFamily: "Inter_700Bold",
                      }}
                    >
                      {getInitials(user?.full_name)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.textPrimary,
                        fontSize: 24,
                        fontFamily: "Inter_700Bold",
                        marginBottom: 6,
                      }}
                    >
                      {user?.full_name || "User"}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="call-outline" size={14} color={colors.textMuted} />
                      <Text
                        style={{
                          color: colors.textMuted,
                          fontSize: 15,
                          fontFamily: "Inter_400Regular",
                        }}
                      >
                        {user?.phone || "+254 ***"}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* KYC Status */}
                <View
                  style={{
                    backgroundColor: colors.dark.bg,
                    borderRadius: 18,
                    padding: 18,
                    borderWidth: 1,
                    borderColor: colors.glass.border,
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
                          color: colors.textMuted,
                          fontSize: 11,
                          fontFamily: "Inter_500Medium",
                          textTransform: "uppercase",
                          letterSpacing: 0.8,
                          marginBottom: 6,
                        }}
                      >
                        VERIFICATION LEVEL
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: currentTier?.color,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 15,
                            fontFamily: "Inter_600SemiBold",
                            color: currentTier?.color,
                          }}
                        >
                          Tier {currentTier?.tier}: {currentTier?.label}
                        </Text>
                      </View>
                    </View>
                    <View
                      style={{
                        backgroundColor: colors.dark.elevated,
                        borderRadius: 12,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.textSecondary,
                          fontSize: 12,
                          fontFamily: "Inter_600SemiBold",
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
                      backgroundColor: colors.dark.elevated,
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        height: "100%",
                        width: `${tierProgress * 100}%`,
                        backgroundColor: currentTier?.color || colors.dark.muted,
                        borderRadius: 3,
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
                                : colors.dark.elevated,
                          }}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              {/* Logout on desktop - bottom of left column */}
              <View
                style={{
                  backgroundColor: colors.dark.card,
                  borderRadius: 20,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: colors.error + "15",
                }}
              >
                <MenuItem
                  icon="log-out-outline"
                  label="Logout"
                  onPress={handleLogout}
                  danger
                />
              </View>
            </View>

            {/* Right column: Security + Support */}
            <View style={{ flex: 1 }}>
              {/* Security Section */}
              <View style={{ marginBottom: 4 }}>
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 11,
                    fontFamily: "Inter_600SemiBold",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    paddingLeft: 4,
                    marginBottom: 8,
                  }}
                >
                  SECURITY
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: colors.dark.card,
                  borderRadius: 20,
                  marginBottom: 20,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: colors.glass.border,
                }}
              >
                <MenuItem
                  icon="shield-checkmark-outline"
                  label="Verify Identity"
                  subtitle="Upgrade your transaction limits"
                  onPress={handleVerifyIdentity}
                  iconBg={colors.primary[500] + "20"}
                  iconColor={colors.primary[400]}
                />
                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
                <MenuItem
                  icon="lock-closed-outline"
                  label="Change PIN"
                  subtitle="Update your security PIN"
                  onPress={() => router.push("/settings/change-pin")}
                  iconBg={colors.info + "20"}
                  iconColor={colors.info}
                />
                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
                <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 16 }}>
                  <View style={{ flex: 1 }}>
                    <MenuItem
                      icon="finger-print-outline"
                      label="Biometric Login"
                      subtitle={
                        biometric.isAvailable
                          ? `${biometric.biometricType === "face" ? "Face ID" : "Fingerprint"} ${biometricOn ? "enabled" : "disabled"}`
                          : "Not available on this device"
                      }
                      onPress={() => handleBiometricToggle(!biometricOn)}
                      iconBg={colors.accent + "20"}
                      iconColor={colors.accent}
                    />
                  </View>
                  {!isWeb && (
                    <Switch
                      value={biometricOn}
                      onValueChange={handleBiometricToggle}
                      trackColor={{ false: colors.dark.elevated, true: colors.primary[500] + "60" }}
                      thumbColor={biometricOn ? colors.primary[400] : colors.textMuted}
                      disabled={!biometric.isAvailable}
                    />
                  )}
                </View>
              </View>

              {/* Preferences Section */}
              <View style={{ marginBottom: 4 }}>
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 11,
                    fontFamily: "Inter_600SemiBold",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    paddingLeft: 4,
                    marginBottom: 8,
                  }}
                >
                  PREFERENCES
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: colors.dark.card,
                  borderRadius: 20,
                  marginBottom: 20,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: colors.glass.border,
                }}
              >
                <MenuItem
                  icon="notifications-outline"
                  label="Notifications"
                  subtitle="Manage your notification preferences"
                  onPress={() => router.push("/settings/notifications" as any)}
                  iconBg={colors.primary[500] + "20"}
                  iconColor={colors.primary[400]}
                />
                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
                <MenuItem
                  icon="language-outline"
                  label={t("profile.language")}
                  subtitle={locale === "en" ? t("profile.english") : t("profile.swahili")}
                  onPress={() => setShowLanguagePicker(true)}
                  iconBg={colors.warning + "20"}
                  iconColor={colors.warning}
                />
              </View>

              {/* Support Section */}
              <View style={{ marginBottom: 4 }}>
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 11,
                    fontFamily: "Inter_600SemiBold",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    paddingLeft: 4,
                    marginBottom: 8,
                  }}
                >
                  SUPPORT
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: colors.dark.card,
                  borderRadius: 20,
                  marginBottom: 20,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: colors.glass.border,
                }}
              >
                <MenuItem
                  icon="help-circle-outline"
                  label="Help & Support"
                  onPress={handleHelpSupport}
                />
                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
                <MenuItem
                  icon="document-text-outline"
                  label="Terms of Service"
                  onPress={handleTermsOfService}
                />
                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
                <MenuItem
                  icon="shield-outline"
                  label="Privacy Policy"
                  onPress={handlePrivacyPolicy}
                />
              </View>

              {/* Version */}
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                  textAlign: "center",
                  marginTop: 4,
                  opacity: 0.6,
                }}
                maxFontSizeMultiplier={1.3}
                accessibilityLabel="CryptoPay version 1.0.0"
              >
                CryptoPay v1.0.0
              </Text>
            </View>
          </View>
        ) : (
          /* Mobile layout (unchanged) */
          <>
            {/* User Card */}
            <View
              style={{
                backgroundColor: colors.dark.card,
                borderRadius: 24,
                marginHorizontal: hPad,
                padding: 24,
                marginTop: 8,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: colors.glass.border,
              }}
            >
              {/* Avatar + Info */}
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}>
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 18,
                    backgroundColor: colors.primary[500] + "33",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 16,
                    borderWidth: 2,
                    borderColor: colors.primary[400] + "59",
                  }}
                >
                  <Text
                    style={{
                      color: colors.primary[400],
                      fontSize: 24,
                      fontFamily: "Inter_700Bold",
                    }}
                  >
                    {getInitials(user?.full_name)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontSize: 21,
                      fontFamily: "Inter_700Bold",
                      marginBottom: 6,
                    }}
                  >
                    {user?.full_name || "User"}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="call-outline" size={13} color={colors.textMuted} />
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 14,
                        fontFamily: "Inter_400Regular",
                      }}
                    >
                      {user?.phone || "+254 ***"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* KYC Status */}
              <View
                style={{
                  backgroundColor: colors.dark.bg,
                  borderRadius: 18,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: colors.glass.border,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <View>
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 11,
                        fontFamily: "Inter_500Medium",
                        textTransform: "uppercase",
                        letterSpacing: 0.8,
                        marginBottom: 6,
                      }}
                    >
                      VERIFICATION LEVEL
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: currentTier?.color,
                        }}
                      />
                      <Text
                        style={{
                          fontSize: 15,
                          fontFamily: "Inter_600SemiBold",
                          color: currentTier?.color,
                        }}
                      >
                        Tier {currentTier?.tier}: {currentTier?.label}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={{
                      backgroundColor: colors.dark.elevated,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontSize: 12,
                        fontFamily: "Inter_600SemiBold",
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
                    backgroundColor: colors.dark.elevated,
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: "100%",
                      width: `${tierProgress * 100}%`,
                      backgroundColor: currentTier?.color || colors.dark.muted,
                      borderRadius: 3,
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
                              : colors.dark.elevated,
                        }}
                      />
                    </View>
                  ))}
                </View>
              </View>
            </View>

            {/* Security Section */}
            <View style={{ paddingHorizontal: hPad, marginBottom: 4 }}>
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  paddingLeft: 4,
                  marginBottom: 8,
                }}
              >
                SECURITY
              </Text>
            </View>
            <View
              style={{
                backgroundColor: colors.dark.card,
                borderRadius: 20,
                marginHorizontal: hPad,
                marginBottom: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: colors.glass.border,
              }}
            >
              <MenuItem
                icon="shield-checkmark-outline"
                label="Verify Identity"
                subtitle="Upgrade your transaction limits"
                onPress={handleVerifyIdentity}
                iconBg={colors.primary[500] + "20"}
                iconColor={colors.primary[400]}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
              <MenuItem
                icon="lock-closed-outline"
                label="Change PIN"
                subtitle="Update your security PIN"
                onPress={() => router.push("/settings/change-pin")}
                iconBg={colors.info + "20"}
                iconColor={colors.info}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
              <MenuItem
                icon="finger-print-outline"
                label="Biometric Login"
                subtitle="Use fingerprint or Face ID"
                onPress={() => handleBiometricToggle(!biometricOn)}
                iconBg={colors.accent + "20"}
                iconColor={colors.accent}
              />
            </View>

            {/* Preferences Section */}
            <View style={{ paddingHorizontal: hPad, marginBottom: 4 }}>
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  paddingLeft: 4,
                  marginBottom: 8,
                }}
              >
                PREFERENCES
              </Text>
            </View>
            <View
              style={{
                backgroundColor: colors.dark.card,
                borderRadius: 20,
                marginHorizontal: hPad,
                marginBottom: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: colors.glass.border,
              }}
            >
              <MenuItem
                icon="notifications-outline"
                label="Notifications"
                subtitle="Manage your notification preferences"
                onPress={() => router.push("/settings/notifications" as any)}
                iconBg={colors.primary[500] + "20"}
                iconColor={colors.primary[400]}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
              <MenuItem
                icon="language-outline"
                label={t("profile.language")}
                subtitle={locale === "en" ? t("profile.english") : t("profile.swahili")}
                onPress={() => setShowLanguagePicker(true)}
                iconBg={colors.warning + "20"}
                iconColor={colors.warning}
              />
            </View>

            {/* Support Section */}
            <View style={{ paddingHorizontal: hPad, marginBottom: 4 }}>
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  paddingLeft: 4,
                  marginBottom: 8,
                }}
              >
                SUPPORT
              </Text>
            </View>
            <View
              style={{
                backgroundColor: colors.dark.card,
                borderRadius: 20,
                marginHorizontal: hPad,
                marginBottom: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: colors.glass.border,
              }}
            >
              <MenuItem
                icon="help-circle-outline"
                label="Help & Support"
                onPress={handleHelpSupport}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
              <MenuItem
                icon="document-text-outline"
                label="Terms of Service"
                onPress={handleTermsOfService}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginLeft: 72 }} />
              <MenuItem
                icon="shield-outline"
                label="Privacy Policy"
                onPress={handlePrivacyPolicy}
              />
            </View>

            {/* Logout */}
            <View
              style={{
                backgroundColor: colors.dark.card,
                borderRadius: 20,
                marginHorizontal: hPad,
                marginBottom: 16,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: colors.error + "15",
              }}
            >
              <MenuItem
                icon="log-out-outline"
                label="Logout"
                onPress={handleLogout}
                danger
              />
            </View>

            {/* Version */}
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 12,
                fontFamily: "Inter_400Regular",
                textAlign: "center",
                marginTop: 4,
                marginBottom: 28,
                opacity: 0.6,
              }}
              maxFontSizeMultiplier={1.3}
              accessibilityLabel="CryptoPay version 1.0.0"
            >
              CryptoPay v1.0.0
            </Text>
          </>
        )}
      </ScrollView>

      {/* Web logout confirmation overlay */}
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
              backgroundColor: colors.dark.card,
              borderRadius: 24,
              padding: 28,
              maxWidth: 340,
              width: "90%",
              borderWidth: 1,
              borderColor: colors.glass.border,
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                backgroundColor: colors.error + "15",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="log-out-outline" size={28} color={colors.error} />
            </View>
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 18,
                fontFamily: "Inter_700Bold",
                marginBottom: 8,
              }}
            >
              Logout
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 14,
                fontFamily: "Inter_400Regular",
                textAlign: "center",
                marginBottom: 24,
                lineHeight: 20,
              }}
            >
              Are you sure you want to log out?
            </Text>
            <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
              <Pressable
                onPress={() => setShowLogoutConfirm(false)}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: colors.dark.elevated,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: colors.glass.border,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 15,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={confirmLogout}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: colors.error,
                  alignItems: "center",
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 15,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  Logout
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Language Picker Modal */}
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
              backgroundColor: colors.dark.card,
              borderRadius: 24,
              padding: 28,
              maxWidth: 340,
              width: "90%",
              borderWidth: 1,
              borderColor: colors.glass.border,
            }}
          >
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 18,
                fontFamily: "Inter_700Bold",
                marginBottom: 20,
                textAlign: "center",
              }}
            >
              {t("profile.selectLanguage")}
            </Text>

            {/* English Option */}
            <Pressable
              onPress={() => handleSelectLanguage("en")}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 14,
                backgroundColor:
                  locale === "en"
                    ? colors.primary[500] + "20"
                    : pressed
                      ? colors.dark.elevated + "40"
                      : "transparent",
                borderWidth: 1,
                borderColor:
                  locale === "en" ? colors.primary[400] + "40" : colors.glass.border,
                marginBottom: 10,
              })}
              accessibilityRole="button"
              accessibilityLabel="English"
            >
              <Text style={{ fontSize: 22, marginRight: 12 }}>🇬🇧</Text>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 15,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  English
                </Text>
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 12,
                    fontFamily: "Inter_400Regular",
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
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 14,
                backgroundColor:
                  locale === "sw"
                    ? colors.primary[500] + "20"
                    : pressed
                      ? colors.dark.elevated + "40"
                      : "transparent",
                borderWidth: 1,
                borderColor:
                  locale === "sw" ? colors.primary[400] + "40" : colors.glass.border,
                marginBottom: 20,
              })}
              accessibilityRole="button"
              accessibilityLabel="Kiswahili"
            >
              <Text style={{ fontSize: 22, marginRight: 12 }}>🇰🇪</Text>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 15,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  Kiswahili
                </Text>
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 12,
                    fontFamily: "Inter_400Regular",
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
              style={({ pressed }) => ({
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: colors.dark.elevated,
                alignItems: "center",
                borderWidth: 1,
                borderColor: colors.glass.border,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text
                style={{
                  color: colors.textPrimary,
                  fontSize: 15,
                  fontFamily: "Inter_600SemiBold",
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
