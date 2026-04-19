import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  Animated,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/stores/auth";
import { useBalanceVisibility } from "../../src/stores/balance";
import { config } from "../../src/constants/config";
import { UserAvatar } from "../../src/components/UserAvatar";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { storage } from "../../src/utils/storage";
import { usePhonePrivacy } from "../../src/utils/privacy";
import { useLocale } from "../../src/hooks/useLocale";
import { useToast } from "../../src/components/Toast";

const isWeb = Platform.OS === "web";

// ── Settings Menu Item ──────────────────────────────────────────────────────
interface MenuItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  description: string;
  route?: string;
  action?: () => void;
  badge?: string;
  rightElement?: React.ReactNode;
}

interface MenuSection {
  title: string;
  icon: string;
  iconColor: string;
  items: MenuItem[];
}

function SettingsItem({
  item,
  isDesktop,
  onPress,
  tc,
  ts,
}: {
  item: MenuItem;
  isDesktop: boolean;
  onPress: () => void;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: isDesktop ? 14 : 16,
        paddingHorizontal: isDesktop ? 18 : 16,
        borderRadius: 14,
        backgroundColor: hovered
          ? tc.glass.highlight
          : "transparent",
        opacity: pressed ? 0.8 : 1,
        gap: 14,
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.2s ease",
              transform: hovered ? "translateX(4px)" : "translateX(0px)",
            } as any)
          : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel={item.label}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          backgroundColor: item.iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={item.icon} size={20} color={item.iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 15,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            {item.label}
          </Text>
          {item.badge && (
            <View
              style={{
                backgroundColor: colors.primary[500] + "20",
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 10,
                  fontFamily: "DMSans_700Bold",
                }}
              >
                {item.badge}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 13,
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {item.description}
        </Text>
      </View>
      {item.rightElement || (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={tc.textMuted}
        />
      )}
    </Pressable>
  );
}

// ── Toggle Item (inline switch) ─────────────────────────────────────────────
function ToggleItem({
  item,
  isDesktop,
  value,
  onToggle,
  tc,
  ts,
}: {
  item: MenuItem;
  isDesktop: boolean;
  value: boolean;
  onToggle: () => void;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: isDesktop ? 14 : 16,
        paddingHorizontal: isDesktop ? 18 : 16,
        gap: 14,
      }}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          backgroundColor: item.iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={item.icon} size={20} color={item.iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 15,
            fontFamily: "DMSans_600SemiBold",
          }}
        >
          {item.label}
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 13,
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {item.description}
        </Text>
      </View>
      <Pressable
        onPress={onToggle}
        style={({ hovered }: any) => ({
          width: 52,
          height: 30,
          borderRadius: 15,
          backgroundColor: value ? colors.primary[500] : tc.dark.elevated,
          justifyContent: "center",
          paddingHorizontal: 3,
          ...(isWeb
            ? ({
                cursor: "pointer",
                transition: "background-color 0.2s ease",
                transform: hovered ? "scale(1.05)" : "scale(1)",
              } as any)
            : {}),
        })}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: "#FFFFFF",
            alignSelf: value ? "flex-end" : "flex-start",
            ...(isWeb
              ? ({ transition: "all 0.2s ease" } as any)
              : {}),
            ...ts.sm,
          }}
        />
      </Pressable>
    </View>
  );
}

// ── Section Card ────────────────────────────────────────────────────────────
function SectionCard({
  section,
  isDesktop,
  tc,
  ts,
  balanceHidden,
  biometricEnabled,
  toggleBalance,
  toggleBiometric,
  handleItemPress,
}: {
  section: MenuSection;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  balanceHidden: boolean;
  biometricEnabled: boolean;
  toggleBalance: () => void;
  toggleBiometric: () => void;
  handleItemPress: (item: MenuItem) => void;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <SectionHeader
        title={section.title}
        icon={section.icon}
        iconColor={section.iconColor}
      />
      <View
        style={{
          backgroundColor: tc.dark.card,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: tc.glass.border,
          overflow: "hidden",
          ...ts.sm,
        }}
      >
        {section.items.map((item, idx) => {
          const isToggle = item.key === "hide-balance" || item.key === "biometric";
          const showDivider = idx < section.items.length - 1;
          return (
            <View key={item.key}>
              {isToggle ? (
                <ToggleItem
                  item={item}
                  isDesktop={isDesktop}
                  value={item.key === "hide-balance" ? balanceHidden : biometricEnabled}
                  onToggle={item.key === "hide-balance" ? toggleBalance : toggleBiometric}
                  tc={tc}
                  ts={ts}
                />
              ) : (
                <SettingsItem
                  item={item}
                  isDesktop={isDesktop}
                  onPress={() => handleItemPress(item)}
                  tc={tc}
                  ts={ts}
                />
              )}
              {showDivider && (
                <View
                  style={{
                    height: 1,
                    backgroundColor: tc.glass.border,
                    marginLeft: isDesktop ? 74 : 72,
                  }}
                />
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Profile Card ────────────────────────────────────────────────────────────
function ProfileCard({
  user,
  formatPhone,
  isDesktop,
  tc,
  ts,
  router,
}: {
  user: any;
  formatPhone: (phone?: string) => string;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  router: any;
}) {
  const { t } = useLocale();
  const AVATAR_COLORS = ["#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6", "#F59E0B", "#EF4444"];
  const ADMIN_GOLD = "#D4AF37";
  const avatarIdentifier = user?.id?.toString() || user?.phone || "user";
  let avatarHash = 0;
  for (let i = 0; i < avatarIdentifier.length; i++) avatarHash = avatarIdentifier.charCodeAt(i) + ((avatarHash << 5) - avatarHash);
  const isAdmin = user?.is_staff || user?.is_superuser;
  const avatarBgColor = isAdmin ? ADMIN_GOLD : AVATAR_COLORS[Math.abs(avatarHash) % AVATAR_COLORS.length];
  const tierBorderColor = isAdmin ? ADMIN_GOLD : (user?.kyc_tier ?? 0) >= 1 ? "#10B981" : avatarBgColor;
  const avatarBgHex = avatarBgColor.replace("#", "");
  const avatarName = encodeURIComponent(user?.full_name || user?.phone?.slice(-4) || "U");
  const generatedAvatarUrl = `https://ui-avatars.com/api/?name=${avatarName}&size=128&background=${avatarBgHex}&color=fff&bold=true&font-size=0.38&rounded=true&format=png`;

  return (
    <Pressable
      onPress={() => router.push("/(tabs)/profile" as any)}
      style={({ pressed, hovered }: any) => ({
        backgroundColor: tc.dark.card,
        borderRadius: 22,
        padding: isDesktop ? 28 : 22,
        borderWidth: 1,
        borderColor: hovered ? tc.glass.borderStrong : tc.glass.border,
        marginBottom: 28,
        flexDirection: "row",
        alignItems: "center",
        gap: 18,
        maxWidth: undefined,
        alignSelf: undefined,
        width: "100%" as const,
        opacity: pressed ? 0.95 : 1,
        ...ts.md,
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.25s ease",
              transform: hovered ? "translateY(-2px)" : "translateY(0px)",
            } as any)
          : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel="View profile"
    >
      {/* Avatar */}
      <UserAvatar
        avatarUrl={user?.avatar_url}
        fullName={user?.full_name}
        phone={user?.phone}
        userId={user?.id}
        isStaff={user?.is_staff}
        isSuperuser={user?.is_superuser}
        kycTier={user?.kyc_tier}
        size={isDesktop ? 64 : 56}
        borderRadius={isDesktop ? 20 : 18}
      />

      {/* Info */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isDesktop ? 20 : 18,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.3,
            }}
          >
            {user?.full_name || "User"}
          </Text>
          {(user?.kyc_tier ?? 0) >= 1 && (
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: colors.primary[500],
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="checkmark" size={13} color="#FFFFFF" />
            </View>
          )}
        </View>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 14,
            marginTop: 3,
          }}
        >
          {formatPhone(user?.phone)}
        </Text>
      </View>

      {/* Status + Chevron */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            backgroundColor: colors.success + "18",
            borderRadius: 10,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <Text style={{ color: colors.success, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
            {t("common.active")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={tc.textMuted} />
      </View>
    </Pressable>
  );
}

// ── Main Settings Screen ────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const isTablet = isWeb && width >= 600 && width < 900;
  const useGrid = isDesktop || isTablet;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { user } = useAuth();
  const { formatPhone } = usePhonePrivacy();
  const { balanceHidden, toggleBalance } = useBalanceVisibility();
  const { t } = useLocale();
  const toast = useToast();
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Load biometric pref
  useEffect(() => {
    storage.getItemAsync("biometric_enabled").then((val) => {
      setBiometricEnabled(val === "true");
    });
  }, []);

  const toggleBiometric = useCallback(async () => {
    const newVal = !biometricEnabled;
    setBiometricEnabled(newVal);
    await storage.setItemAsync("biometric_enabled", newVal ? "true" : "false");
  }, [biometricEnabled]);

  const sections: MenuSection[] = [
    {
      title: t("settings.account"),
      icon: "person-circle-outline",
      iconColor: colors.primary[400],
      items: [
        {
          key: "profile",
          icon: "person-outline",
          iconColor: colors.primary[400],
          iconBg: colors.primary[500] + "18",
          label: t("settings.profile"),
          description: t("settings.profileDesc"),
          route: "/(tabs)/profile",
        },
        {
          key: "edit-profile",
          icon: "create-outline",
          iconColor: "#F59E0B",
          iconBg: "rgba(245, 158, 11, 0.12)",
          label: t("settings.editProfile"),
          description: t("settings.editProfileDesc"),
          route: "/settings/edit-profile",
        },
        {
          key: "kyc",
          icon: "shield-checkmark-outline",
          iconColor: colors.info,
          iconBg: colors.info + "18",
          label: t("settings.identityVerification"),
          description: t("settings.identityVerificationDesc"),
          route: "/settings/kyc",
          badge: "KYC",
        },
        {
          key: "change-pin",
          icon: "key-outline",
          iconColor: colors.accent,
          iconBg: colors.accent + "18",
          label: t("settings.changePin"),
          description: t("settings.changePinDesc"),
          route: "/settings/change-pin",
        },
        {
          key: "security",
          icon: "shield-half-outline",
          iconColor: "#8B5CF6",
          iconBg: "rgba(139, 92, 246, 0.15)",
          label: t("settings.securitySettings"),
          description: t("settings.securitySettingsDesc"),
          route: "/settings/security",
          badge: "NEW",
        },
        // Float Management moved to admin stats page
      ],
    },
    {
      title: t("settings.preferences"),
      icon: "options-outline",
      iconColor: "#60A5FA",
      items: [
        {
          key: "notifications",
          icon: "notifications-outline",
          iconColor: "#A78BFA",
          iconBg: "rgba(167,139,250,0.15)",
          label: t("settings.notifications"),
          description: t("settings.notificationsDesc"),
          route: "/settings/notifications",
        },
        {
          key: "price-alerts",
          icon: "trending-up-outline",
          iconColor: colors.accent,
          iconBg: colors.accent + "18",
          label: t("settings.priceAlerts"),
          description: t("settings.priceAlertsDesc"),
          route: "/settings/price-alerts",
          badge: "NEW",
        },
        {
          key: "referrals",
          icon: "people-outline",
          iconColor: "#10B981",
          iconBg: "rgba(16,185,129,0.15)",
          label: t("referrals.title"),
          description: t("referrals.heroHeadline"),
          route: "/settings/referrals",
          badge: "KES 50",
        },
        {
          key: "language",
          icon: "language-outline",
          iconColor: "#60A5FA",
          iconBg: "rgba(96,165,250,0.15)",
          label: t("settings.language"),
          description: t("settings.languageDesc"),
          route: "/settings/language",
          badge: "EN",
        },
        {
          key: "currency",
          icon: "cash-outline",
          iconColor: colors.success,
          iconBg: colors.success + "18",
          label: t("settings.defaultCurrency"),
          description: t("settings.defaultCurrencyDesc"),
          route: "/settings/currency",
          rightElement: (
            <View
              style={{
                backgroundColor: colors.success + "15",
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: colors.success, fontSize: 13, fontFamily: "DMSans_700Bold" }}>
                KES
              </Text>
            </View>
          ),
        },
      ],
    },
    {
      title: t("settings.security"),
      icon: "lock-closed-outline",
      iconColor: colors.warning,
      items: [
        {
          key: "hide-balance",
          icon: "eye-off-outline",
          iconColor: colors.warning,
          iconBg: colors.warning + "18",
          label: t("settings.hideBalance"),
          description: t("settings.hideBalanceDesc"),
        },
        {
          key: "biometric",
          icon: "finger-print",
          iconColor: "#EC4899",
          iconBg: "rgba(236,72,153,0.15)",
          label: t("settings.biometricLock"),
          description: t("settings.biometricLockDesc"),
        },
        {
          key: "sessions",
          icon: "phone-portrait-outline",
          iconColor: "#06B6D4",
          iconBg: "rgba(6,182,212,0.15)",
          label: t("settings.activeSessions"),
          description: t("settings.activeSessionsDesc"),
          route: "/settings/devices",
        },
      ],
    },
    {
      title: t("settings.about"),
      icon: "information-circle-outline",
      iconColor: tc.textSecondary,
      items: [
        {
          key: "help",
          icon: "help-circle-outline",
          iconColor: tc.textSecondary,
          iconBg: "rgba(136,153,170,0.12)",
          label: t("settings.helpSupport"),
          description: t("settings.helpSupportDesc"),
          route: "/settings/help",
        },
        {
          key: "terms",
          icon: "document-text-outline",
          iconColor: tc.textSecondary,
          iconBg: "rgba(136,153,170,0.12)",
          label: t("settings.termsPrivacy"),
          description: t("settings.termsPrivacyDesc"),
          route: "/settings/terms",
        },
        {
          key: "version",
          icon: "information-circle-outline",
          iconColor: tc.textSecondary,
          iconBg: "rgba(136,153,170,0.12)",
          label: t("settings.appVersion"),
          description: t("settings.appVersionDesc"),
          action: () => {},
          rightElement: (
            <View
              style={{
                backgroundColor: tc.glass.highlight,
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: tc.glass.border,
              }}
            >
              <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>
                1.0.0
              </Text>
            </View>
          ),
        },
      ],
    },
  ];

  const handleItemPress = (item: MenuItem) => {
    if (item.route) {
      router.push(item.route as any);
    } else if (item.action) {
      item.action();
    }
  };

  const horizontalPadding = isDesktop ? 48 : isTablet ? 32 : 20;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          paddingTop: isDesktop ? 12 : 8,
          paddingBottom: 40,
        }}
      >
        {/* Back button */}
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)" as any);
          }}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: hovered
              ? tc.glass.highlight
              : pressed
                ? tc.dark.elevated
                : "transparent",
            alignSelf: "flex-start",
            marginBottom: 8,
            opacity: pressed ? 0.9 : 1,
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  transform: hovered ? "translateX(-2px)" : "translateX(0px)",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
            {t("common.back")}
          </Text>
        </Pressable>

        {/* Page Title */}
        <View
          style={{
            marginBottom: isDesktop ? 28 : 20,
            paddingHorizontal: 4,
          }}
        >
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isDesktop ? 32 : 26,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.5,
            }}
          >
            {t("settings.settings")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: isDesktop ? 16 : 14,
              marginTop: 4,
              lineHeight: 22,
            }}
          >
            {t("settings.manageAccount")}
          </Text>
        </View>

        {/* Profile Card */}
        <ProfileCard
          user={user}
          formatPhone={formatPhone}
          isDesktop={isDesktop}
          tc={tc}
          ts={ts}
          router={router}
        />

        {/* Settings sections - 2x2 grid on desktop/tablet, single column on mobile */}
        {useGrid ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}>
            {sections.map((section) => (
              <View key={section.title} style={{ width: "48%", minWidth: 280, flexGrow: 1 }}>
                <SectionCard
                  section={section}
                  isDesktop={isDesktop}
                  tc={tc}
                  ts={ts}
                  balanceHidden={balanceHidden}
                  biometricEnabled={biometricEnabled}
                  toggleBalance={toggleBalance}
                  toggleBiometric={toggleBiometric}
                  handleItemPress={handleItemPress}
                />
              </View>
            ))}
          </View>
        ) : (
          sections.map((section) => (
            <SectionCard
              key={section.title}
              section={section}
              isDesktop={isDesktop}
              tc={tc}
              ts={ts}
              balanceHidden={balanceHidden}
              biometricEnabled={biometricEnabled}
              toggleBalance={toggleBalance}
              toggleBiometric={toggleBiometric}
              handleItemPress={handleItemPress}
            />
          ))
        )}

        {/* Footer */}
        <View style={{ alignItems: "center", marginTop: 12, paddingBottom: 8 }}>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
            }}
          >
            CryptoPay v1.0.0
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
