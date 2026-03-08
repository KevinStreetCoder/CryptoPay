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

const COLORS = {
  bg: "#060E1F",
  card: "#0C1A2E",
  elevated: "#162742",
  border: "#1E3350",
  glassBorder: "rgba(255, 255, 255, 0.08)",
  primary: "#10B981",
  primaryLight: "#34D399",
  accent: "#F59E0B",
  info: "#3B82F6",
  error: "#EF4444",
  warning: "#F59E0B",
  textPrimary: "#F0F4F8",
  textSecondary: "#8899AA",
  textMuted: "#556B82",
};

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
  label: string;
  description: string;
  icon: string;
  iconColor: string;
  iconBg: string;
}

interface NotificationSection {
  title: string;
  options: NotificationOption[];
}

const SECTIONS: NotificationSection[] = [
  {
    title: "TRANSACTIONS",
    options: [
      {
        key: "transaction_alerts",
        label: "Transaction Alerts",
        description: "Get notified when payments are sent or received",
        icon: "swap-horizontal-outline",
        iconColor: COLORS.primary,
        iconBg: COLORS.primary + "20",
      },
      {
        key: "deposit_confirmations",
        label: "Deposit Confirmations",
        description: "Alerts when blockchain deposits are credited to your wallet",
        icon: "arrow-down-circle-outline",
        iconColor: COLORS.info,
        iconBg: COLORS.info + "20",
      },
    ],
  },
  {
    title: "SECURITY",
    options: [
      {
        key: "security_alerts",
        label: "Security Alerts",
        description: "New device logins, PIN changes, and suspicious activity",
        icon: "shield-outline",
        iconColor: COLORS.error,
        iconBg: COLORS.error + "20",
      },
    ],
  },
  {
    title: "MARKET & UPDATES",
    options: [
      {
        key: "price_alerts",
        label: "Price Alerts",
        description: "Significant cryptocurrency price changes and market movements",
        icon: "trending-up-outline",
        iconColor: COLORS.accent,
        iconBg: COLORS.accent + "20",
      },
      {
        key: "promotional",
        label: "Promotional",
        description: "New features, announcements, and special offers",
        icon: "megaphone-outline",
        iconColor: COLORS.textSecondary,
        iconBg: COLORS.elevated,
      },
    ],
  },
];

export default function NotificationsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;

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
    return <View style={{ flex: 1, backgroundColor: COLORS.bg }} />;
  }

  const content = (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingBottom: 40,
        paddingHorizontal: isDesktop ? 0 : 16,
        maxWidth: isDesktop ? 560 : undefined,
        alignSelf: isDesktop ? "center" : undefined,
        width: isDesktop ? "100%" : undefined,
      }}
    >
      {/* Screen title (mobile only, desktop has it in the card) */}
      {!isDesktop && (
        <View style={{ marginBottom: 8, marginTop: 4 }}>
          <Text
            style={{
              color: COLORS.textPrimary,
              fontSize: 24,
              fontFamily: "Inter_700Bold",
              letterSpacing: -0.3,
            }}
          >
            Notifications
          </Text>
          <Text
            style={{
              color: COLORS.textMuted,
              fontSize: 14,
              fontFamily: "Inter_400Regular",
              marginTop: 4,
              lineHeight: 20,
            }}
          >
            Choose which notifications you want to receive
          </Text>
        </View>
      )}

      {SECTIONS.map((section) => (
        <View key={section.title} style={{ marginTop: 20 }}>
          {/* Section header */}
          <Text
            style={{
              color: COLORS.textMuted,
              fontSize: 11,
              fontFamily: "Inter_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1,
              paddingLeft: 4,
              marginBottom: 8,
            }}
          >
            {section.title}
          </Text>

          {/* Section card */}
          <View
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 20,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: COLORS.glassBorder,
            }}
          >
            {section.options.map((option, index) => (
              <View key={option.key}>
                {index > 0 && (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: "rgba(255,255,255,0.04)",
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
                        fontFamily: "Inter_500Medium",
                        color: COLORS.textPrimary,
                        marginBottom: 2,
                      }}
                    >
                      {option.label}
                    </Text>
                    <Text
                      style={{
                        color: COLORS.textMuted,
                        fontSize: 12,
                        fontFamily: "Inter_400Regular",
                        lineHeight: 17,
                      }}
                    >
                      {option.description}
                    </Text>
                  </View>

                  {/* Switch */}
                  <Switch
                    value={prefs[option.key]}
                    onValueChange={(value) => handleToggle(option.key, value)}
                    trackColor={{
                      false: COLORS.elevated,
                      true: COLORS.primary + "60",
                    }}
                    thumbColor={
                      prefs[option.key] ? COLORS.primaryLight : COLORS.textMuted
                    }
                    accessibilityLabel={`${option.label}. ${option.description}`}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: prefs[option.key] }}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}

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
          color={COLORS.textMuted}
          style={{ marginTop: 1 }}
        />
        <Text
          style={{
            color: COLORS.textMuted,
            fontSize: 12,
            fontFamily: "Inter_400Regular",
            lineHeight: 18,
            flex: 1,
          }}
        >
          Security alerts are recommended to stay enabled for account safety. You
          can also manage push notification permissions in your device settings.
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
          backgroundColor: COLORS.bg,
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
            onPress={() => router.back()}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: pressed ? COLORS.elevated : "transparent",
              alignSelf: "flex-start",
              opacity: pressed ? 0.9 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
            <Text
              style={{
                color: COLORS.textSecondary,
                fontSize: 15,
                fontFamily: "Inter_500Medium",
              }}
            >
              Back
            </Text>
          </Pressable>
        </View>

        {/* Title */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 8,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: COLORS.textPrimary,
              fontSize: 28,
              fontFamily: "Inter_700Bold",
              letterSpacing: -0.5,
            }}
          >
            Notifications
          </Text>
          <Text
            style={{
              color: COLORS.textMuted,
              fontSize: 15,
              fontFamily: "Inter_400Regular",
              marginTop: 6,
            }}
          >
            Choose which notifications you want to receive
          </Text>
        </View>

        {content}
      </View>
    );
  }

  // Mobile layout
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
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
          onPress={() => router.back()}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 8,
            borderRadius: 10,
            backgroundColor: pressed ? COLORS.elevated : "transparent",
            opacity: pressed ? 0.9 : 1,
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
          <Text
            style={{
              color: COLORS.textSecondary,
              fontSize: 15,
              fontFamily: "Inter_500Medium",
            }}
          >
            Back
          </Text>
        </Pressable>
      </View>

      {content}
    </SafeAreaView>
  );
}
