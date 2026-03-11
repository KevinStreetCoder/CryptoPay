import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { storage } from "../../src/utils/storage";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";

const STORAGE_KEY = "notification_prefs";

interface NotificationPrefs {
  transaction_alerts: boolean;
  deposit_confirmations: boolean;
  security_alerts: boolean;
  price_alerts: boolean;
  promotional: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  transaction_alerts: true,
  deposit_confirmations: true,
  security_alerts: true,
  price_alerts: false,
  promotional: false,
};

interface NotificationOption {
  key: keyof NotificationPrefs;
  labelKey: string;
  descKey: string;
  icon: string;
  iconColor: string;
  iconBg: string;
}

interface NotificationSection {
  titleKey: string;
  options: NotificationOption[];
}

function buildSections(tc: ReturnType<typeof getThemeColors>): NotificationSection[] {
  return [
    {
      titleKey: "notifications.transactions",
      options: [
        {
          key: "transaction_alerts",
          labelKey: "notifications.transactionAlerts",
          descKey: "notifications.transactionAlertsDesc",
          icon: "swap-horizontal-outline",
          iconColor: colors.primary[500],
          iconBg: colors.primary[500] + "20",
        },
        {
          key: "deposit_confirmations",
          labelKey: "notifications.depositConfirmations",
          descKey: "notifications.depositConfirmationsDesc",
          icon: "arrow-down-circle-outline",
          iconColor: colors.info,
          iconBg: colors.info + "20",
        },
      ],
    },
    {
      titleKey: "notifications.security",
      options: [
        {
          key: "security_alerts",
          labelKey: "notifications.securityAlerts",
          descKey: "notifications.securityAlertsDesc",
          icon: "shield-outline",
          iconColor: colors.error,
          iconBg: colors.error + "20",
        },
      ],
    },
    {
      titleKey: "notifications.marketUpdates",
      options: [
        {
          key: "price_alerts",
          labelKey: "notifications.priceAlerts",
          descKey: "notifications.priceAlertsDesc",
          icon: "trending-up-outline",
          iconColor: colors.accent,
          iconBg: colors.accent + "20",
        },
        {
          key: "promotional",
          labelKey: "notifications.promotional",
          descKey: "notifications.promotionalDesc",
          icon: "megaphone-outline",
          iconColor: tc.textSecondary,
          iconBg: tc.dark.elevated,
        },
      ],
    },
  ];
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const { width } = useWindowDimensions();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;

  const sections = buildSections(tc);

  useEffect(() => {
    (async () => {
      try {
        const raw = await storage.getItemAsync(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
          setPrefs({ ...DEFAULT_PREFS, ...parsed });
        }
      } catch {
        // use defaults
      }
      setLoaded(true);
    })();
  }, []);

  const handleToggle = useCallback(
    async (key: keyof NotificationPrefs, value: boolean) => {
      const updated = { ...prefs, [key]: value };
      setPrefs(updated);
      try {
        await storage.setItemAsync(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // storage write failed, revert
        setPrefs(prefs);
      }
    },
    [prefs],
  );

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: tc.dark.bg }} />;
  }

  const content = (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingBottom: 40,
        paddingHorizontal: isDesktop ? 48 : 16,
      }}
    >
      {/* Screen title (mobile only, desktop has it in the card) */}
      {!isDesktop && (
        <View style={{ marginBottom: 8, marginTop: 4 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 24,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.3,
            }}
          >
            {t("notifications.notifications")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 14,
              fontFamily: "DMSans_400Regular",
              marginTop: 4,
              lineHeight: 20,
            }}
          >
            {t("notifications.chooseNotifications")}
          </Text>
        </View>
      )}

      <View style={isDesktop ? { flexDirection: "row", flexWrap: "wrap", gap: 16 } : {}}>
      {sections.map((section) => (
        <View key={section.titleKey} style={{ marginTop: 20, ...(isDesktop ? { width: "48%", minWidth: 300, flexGrow: 1 } : {}) }}>
          {/* Section header */}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1,
              paddingLeft: 4,
              marginBottom: 8,
            }}
          >
            {t(section.titleKey)}
          </Text>

          {/* Section card */}
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 20,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: tc.glass.border,
            }}
          >
            {section.options.map((option, index) => (
              <View key={option.key}>
                {index > 0 && (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: tc.glass.highlight,
                      marginLeft: 72,
                    }}
                  />
                )}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    minHeight: 68,
                  }}
                >
                  {/* Icon */}
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 14,
                      backgroundColor: option.iconBg,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 14,
                    }}
                  >
                    <Ionicons
                      name={option.icon as any}
                      size={20}
                      color={option.iconColor}
                    />
                  </View>

                  {/* Label & description */}
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        fontFamily: "DMSans_500Medium",
                        color: tc.textPrimary,
                        marginBottom: 2,
                      }}
                    >
                      {t(option.labelKey)}
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                        lineHeight: 17,
                      }}
                    >
                      {t(option.descKey)}
                    </Text>
                  </View>

                  {/* Switch */}
                  <Switch
                    value={prefs[option.key]}
                    onValueChange={(value) => handleToggle(option.key, value)}
                    trackColor={{
                      false: tc.dark.elevated,
                      true: colors.primary[500] + "60",
                    }}
                    thumbColor={
                      prefs[option.key] ? colors.primary[400] : tc.textMuted
                    }
                    accessibilityLabel={`${t(option.labelKey)}. ${t(option.descKey)}`}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: prefs[option.key] }}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
      </View>

      {/* Info footer */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          marginTop: 24,
          paddingHorizontal: 4,
          gap: 8,
        }}
      >
        <Ionicons
          name="information-circle-outline"
          size={16}
          color={tc.textMuted}
          style={{ marginTop: 1 }}
        />
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            lineHeight: 18,
            flex: 1,
          }}
        >
          {t("notifications.securityRecommendation")}
        </Text>
      </View>
    </ScrollView>
  );

  // Desktop layout
  if (isDesktop) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tc.dark.bg,
        }}
      >
        {/* Back button header */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 24,
          }}
        >
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/settings" as any);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: pressed ? tc.dark.elevated : "transparent",
              alignSelf: "flex-start",
              opacity: pressed ? 0.9 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 15,
                fontFamily: "DMSans_500Medium",
              }}
            >
              {t("common.back")}
            </Text>
          </Pressable>
        </View>

        {/* Title */}
        <View
          style={{
            paddingHorizontal: 48,
            paddingTop: 16,
            paddingBottom: 8,
          }}
        >
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 28,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.5,
            }}
          >
            {t("notifications.notifications")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 15,
              fontFamily: "DMSans_400Regular",
              marginTop: 6,
            }}
          >
            {t("notifications.chooseNotifications")}
          </Text>
        </View>

        {content}
      </View>
    );
  }

  // Mobile layout
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Back button header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 8,
            borderRadius: 10,
            backgroundColor: pressed ? tc.dark.elevated : "transparent",
            opacity: pressed ? 0.9 : 1,
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 15,
              fontFamily: "DMSans_500Medium",
            }}
          >
            {t("common.back")}
          </Text>
        </Pressable>
      </View>

      {content}
    </SafeAreaView>
  );
}
