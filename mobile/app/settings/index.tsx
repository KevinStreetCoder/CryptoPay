import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/stores/auth";
import { useBalanceVisibility } from "../../src/stores/balance";
import { colors, shadows } from "../../src/constants/theme";
import { storage } from "../../src/utils/storage";

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
  items: MenuItem[];
}

function SettingsItem({
  item,
  isDesktop,
  onPress,
}: {
  item: MenuItem;
  isDesktop: boolean;
  onPress: () => void;
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
          ? "rgba(255,255,255,0.04)"
          : "transparent",
        opacity: pressed ? 0.8 : 1,
        gap: 14,
        ...(isWeb
          ? ({ cursor: "pointer", transition: "background-color 0.15s ease" } as any)
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
              color: colors.textPrimary,
              fontSize: 15,
              fontWeight: "600",
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
                  fontWeight: "700",
                }}
              >
                {item.badge}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 13,
            marginTop: 2,
          }}
        >
          {item.description}
        </Text>
      </View>
      {item.rightElement || (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textMuted}
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
}: {
  item: MenuItem;
  isDesktop: boolean;
  value: boolean;
  onToggle: () => void;
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
            color: colors.textPrimary,
            fontSize: 15,
            fontWeight: "600",
          }}
        >
          {item.label}
        </Text>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 13,
            marginTop: 2,
          }}
        >
          {item.description}
        </Text>
      </View>
      <Pressable
        onPress={onToggle}
        style={{
          width: 52,
          height: 30,
          borderRadius: 15,
          backgroundColor: value ? colors.primary[500] : colors.dark.elevated,
          justifyContent: "center",
          paddingHorizontal: 3,
          ...(isWeb
            ? ({ cursor: "pointer", transition: "background-color 0.2s ease" } as any)
            : {}),
        }}
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
            ...shadows.sm,
          }}
        />
      </Pressable>
    </View>
  );
}

// ── Main Settings Screen ────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { user } = useAuth();
  const { balanceHidden, toggleBalance } = useBalanceVisibility();
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Load biometric pref
  useState(() => {
    storage.getItemAsync("biometric_enabled").then((val) => {
      setBiometricEnabled(val === "true");
    });
  });

  const toggleBiometric = useCallback(async () => {
    const newVal = !biometricEnabled;
    setBiometricEnabled(newVal);
    await storage.setItemAsync("biometric_enabled", newVal ? "true" : "false");
  }, [biometricEnabled]);

  const sections: (MenuSection & { type?: "toggle" })[] = [
    {
      title: "Account",
      items: [
        {
          key: "profile",
          icon: "person-outline",
          iconColor: colors.primary[400],
          iconBg: colors.primary[500] + "18",
          label: "Profile",
          description: "Name, phone number, account info",
          route: "/(tabs)/profile",
        },
        {
          key: "kyc",
          icon: "shield-checkmark-outline",
          iconColor: colors.info,
          iconBg: colors.info + "18",
          label: "Identity Verification",
          description: "KYC documents and verification status",
          route: "/settings/kyc",
          badge: "KYC",
        },
        {
          key: "change-pin",
          icon: "key-outline",
          iconColor: colors.accent,
          iconBg: colors.accent + "18",
          label: "Change PIN",
          description: "Update your transaction PIN",
          route: "/settings/change-pin",
        },
      ],
    },
    {
      title: "Preferences",
      items: [
        {
          key: "notifications",
          icon: "notifications-outline",
          iconColor: "#A78BFA",
          iconBg: "rgba(167,139,250,0.15)",
          label: "Notifications",
          description: "Transaction alerts, deposits, promotions",
          route: "/settings/notifications",
        },
        {
          key: "language",
          icon: "language-outline",
          iconColor: "#60A5FA",
          iconBg: "rgba(96,165,250,0.15)",
          label: "Language",
          description: "English, Swahili",
          route: "/settings/language",
          badge: "EN",
        },
        {
          key: "currency",
          icon: "cash-outline",
          iconColor: colors.success,
          iconBg: colors.success + "18",
          label: "Default Currency",
          description: "Display amounts in KES",
          action: () => {},
          rightElement: (
            <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: "600" }}>
              KES
            </Text>
          ),
        },
      ],
    },
    {
      title: "Security",
      items: [
        {
          key: "hide-balance",
          icon: "eye-off-outline",
          iconColor: colors.warning,
          iconBg: colors.warning + "18",
          label: "Hide Balance",
          description: "Mask amounts on screen for privacy",
        },
        {
          key: "biometric",
          icon: "finger-print",
          iconColor: "#EC4899",
          iconBg: "rgba(236,72,153,0.15)",
          label: "Biometric Lock",
          description: "Use fingerprint or Face ID to unlock",
        },
        {
          key: "sessions",
          icon: "phone-portrait-outline",
          iconColor: "#06B6D4",
          iconBg: "rgba(6,182,212,0.15)",
          label: "Active Sessions",
          description: "Manage logged-in devices",
          action: () => {},
        },
      ],
    },
    {
      title: "About",
      items: [
        {
          key: "help",
          icon: "help-circle-outline",
          iconColor: colors.textSecondary,
          iconBg: "rgba(136,153,170,0.12)",
          label: "Help & Support",
          description: "FAQs, contact support",
          route: "/settings/help",
        },
        {
          key: "terms",
          icon: "document-text-outline",
          iconColor: colors.textSecondary,
          iconBg: "rgba(136,153,170,0.12)",
          label: "Terms & Privacy",
          description: "Legal documents and data policy",
          action: () => {},
        },
        {
          key: "version",
          icon: "information-circle-outline",
          iconColor: colors.textSecondary,
          iconBg: "rgba(136,153,170,0.12)",
          label: "App Version",
          description: "CryptoPay v1.0.0",
          action: () => {},
          rightElement: (
            <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: "500" }}>
              1.0.0
            </Text>
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

  const isLargeDesktop = isWeb && width >= 1100;
  const contentMaxW = isLargeDesktop ? 1200 : isDesktop ? 860 : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: isDesktop ? 32 : 16,
          paddingTop: isDesktop ? 8 : 8,
          paddingBottom: 40,
          ...(contentMaxW
            ? { maxWidth: contentMaxW, alignSelf: "center" as const, width: "100%" as const }
            : {}),
        }}
      >
        {/* Back button (mobile only) */}
        {!isDesktop && (
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 8,
              opacity: pressed ? 0.6 : 1,
              alignSelf: "flex-start",
              marginBottom: 8,
            })}
          >
            <Ionicons name="arrow-back" size={22} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: 16, fontWeight: "500" }}>
              Back
            </Text>
          </Pressable>
        )}

        {/* User header card */}
        <View
          style={{
            backgroundColor: colors.dark.card,
            borderRadius: 20,
            padding: isDesktop ? 24 : 20,
            borderWidth: 1,
            borderColor: colors.glass.border,
            marginBottom: 24,
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
            ...shadows.sm,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              backgroundColor: colors.primary[500] + "25",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1.5,
              borderColor: colors.primary[500] + "40",
            }}
          >
            <Text
              style={{
                color: colors.primary[400],
                fontSize: 20,
                fontWeight: "700",
              }}
            >
              {user?.full_name?.[0]?.toUpperCase() || "U"}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 18,
                fontWeight: "700",
              }}
            >
              {user?.full_name || "User"}
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 14,
                marginTop: 2,
              }}
            >
              {user?.phone || ""}
            </Text>
          </View>
          <View
            style={{
              backgroundColor: colors.success + "18",
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}
          >
            <Text style={{ color: colors.success, fontSize: 12, fontWeight: "600" }}>
              Active
            </Text>
          </View>
        </View>

        {/* Settings sections */}
        {isLargeDesktop ? (
          <View style={{ flexDirection: "row", gap: 20 }}>
            {/* Left column: Account + Preferences */}
            <View style={{ flex: 1 }}>
              {sections.filter((s) => s.title === "Account" || s.title === "Preferences").map((section) => (
                <View key={section.title} style={{ marginBottom: 20 }}>
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: 12,
                      fontWeight: "600",
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      paddingHorizontal: 18,
                      marginBottom: 8,
                    }}
                  >
                    {section.title}
                  </Text>
                  <View
                    style={{
                      backgroundColor: colors.dark.card,
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: colors.glass.border,
                      overflow: "hidden",
                      ...shadows.sm,
                    }}
                  >
                    {section.items.map((item, idx) => {
                      const isToggle = item.key === "hide-balance" || item.key === "biometric";
                      const showDivider = idx < section.items.length - 1;
                      return (
                        <View key={item.key}>
                          {isToggle ? (
                            <ToggleItem item={item} isDesktop={isDesktop} value={item.key === "hide-balance" ? balanceHidden : biometricEnabled} onToggle={item.key === "hide-balance" ? toggleBalance : toggleBiometric} />
                          ) : (
                            <SettingsItem item={item} isDesktop={isDesktop} onPress={() => handleItemPress(item)} />
                          )}
                          {showDivider && <View style={{ height: 1, backgroundColor: colors.glass.border, marginLeft: 74 }} />}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
            {/* Right column: Security + About */}
            <View style={{ flex: 1 }}>
              {sections.filter((s) => s.title === "Security" || s.title === "About").map((section) => (
                <View key={section.title} style={{ marginBottom: 20 }}>
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: 12,
                      fontWeight: "600",
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      paddingHorizontal: 18,
                      marginBottom: 8,
                    }}
                  >
                    {section.title}
                  </Text>
                  <View
                    style={{
                      backgroundColor: colors.dark.card,
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: colors.glass.border,
                      overflow: "hidden",
                      ...shadows.sm,
                    }}
                  >
                    {section.items.map((item, idx) => {
                      const isToggle = item.key === "hide-balance" || item.key === "biometric";
                      const showDivider = idx < section.items.length - 1;
                      return (
                        <View key={item.key}>
                          {isToggle ? (
                            <ToggleItem item={item} isDesktop={isDesktop} value={item.key === "hide-balance" ? balanceHidden : biometricEnabled} onToggle={item.key === "hide-balance" ? toggleBalance : toggleBiometric} />
                          ) : (
                            <SettingsItem item={item} isDesktop={isDesktop} onPress={() => handleItemPress(item)} />
                          )}
                          {showDivider && <View style={{ height: 1, backgroundColor: colors.glass.border, marginLeft: 74 }} />}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : (
          sections.map((section) => (
            <View key={section.title} style={{ marginBottom: 20 }}>
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 12,
                  fontWeight: "600",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  paddingHorizontal: isDesktop ? 18 : 16,
                  marginBottom: 8,
                }}
              >
                {section.title}
              </Text>
              <View
                style={{
                  backgroundColor: colors.dark.card,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: colors.glass.border,
                  overflow: "hidden",
                  ...shadows.sm,
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
                          value={
                            item.key === "hide-balance"
                              ? balanceHidden
                              : biometricEnabled
                          }
                          onToggle={
                            item.key === "hide-balance"
                              ? toggleBalance
                              : toggleBiometric
                          }
                        />
                      ) : (
                        <SettingsItem
                          item={item}
                          isDesktop={isDesktop}
                          onPress={() => handleItemPress(item)}
                        />
                      )}
                      {showDivider && (
                        <View
                          style={{
                            height: 1,
                            backgroundColor: colors.glass.border,
                            marginLeft: isDesktop ? 74 : 72,
                          }}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
