import { View, Text, Pressable, ScrollView, Platform, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, shadows, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

const PAYMENT_OPTIONS = [
  {
    id: "paybill",
    title: "Pay Bill",
    icon: "receipt-outline" as const,
    accent: "#10B981",
    accentBg: "rgba(16, 185, 129, 0.12)",
    route: "/payment/paybill" as const,
  },
  {
    id: "till",
    title: "Buy Goods",
    icon: "cart-outline" as const,
    accent: "#3B82F6",
    accentBg: "rgba(59, 130, 246, 0.12)",
    route: "/payment/till" as const,
  },
  {
    id: "send",
    title: "Send to M-Pesa",
    icon: "phone-portrait-outline" as const,
    accent: "#F59E0B",
    accentBg: "rgba(245, 158, 11, 0.12)",
    route: "/payment/send" as const,
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Enter details",
    desc: "Paybill/Till number and amount in KES",
    icon: "create-outline" as const,
    color: "#10B981",
  },
  {
    step: 2,
    title: "Auto convert",
    desc: "We convert your crypto at the best rate",
    icon: "swap-horizontal-outline" as const,
    color: "#3B82F6",
  },
  {
    step: 3,
    title: "Instant payment",
    desc: "Payment sent via M-Pesa in seconds",
    icon: "flash-outline" as const,
    color: "#F59E0B",
  },
];

const PROVIDERS = [
  { name: "Safaricom", icon: "phone-portrait-outline" },
  { name: "KPLC", icon: "flash-outline" },
  { name: "DSTV", icon: "tv-outline" },
  { name: "Water", icon: "water-outline" },
  { name: "KRA", icon: "document-outline" },
  { name: "1000+", icon: "apps-outline" },
];

const TRUST_STATS = [
  {
    title: "256-bit Encryption",
    desc: "Bank-grade security on every transaction",
    icon: "shield-checkmark-outline" as const,
    color: "#10B981",
  },
  {
    title: "Instant Settlement",
    desc: "Payments confirmed in under 30 seconds",
    icon: "flash-outline" as const,
    color: "#3B82F6",
  },
  {
    title: "24/7 Support",
    desc: "Real human help whenever you need it",
    icon: "headset-outline" as const,
    color: "#A78BFA",
  },
];

export default function PayScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;
  const isLargeDesktop = isWeb && width >= 1200;
  const hPad = isLargeDesktop ? 48 : isDesktop ? 32 : 16;

  const textColor = isDark ? "#FFFFFF" : tc.textPrimary;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: hPad + 4, paddingTop: isDesktop ? 16 : 8, paddingBottom: 6 }}>
          <Text
            style={{
              color: textColor,
              fontSize: isDesktop ? 32 : 28,
              fontFamily: "Inter_700Bold",
              letterSpacing: -0.5,
            }}
          >
            Pay
          </Text>
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: isDesktop ? 15 : 14,
              fontFamily: "Inter_400Regular",
              marginTop: 4,
            }}
          >
            Pay any Kenyan bill or merchant with crypto
          </Text>
        </View>

        {/* Payment Option Cards */}
        <View
          style={{
            paddingHorizontal: hPad,
            marginTop: 12,
            ...(isDesktop
              ? {
                  flexDirection: "row" as const,
                  gap: isLargeDesktop ? 20 : 16,
                  flexWrap: "wrap" as const,
                }
              : { gap: 12 }),
          }}
        >
          {PAYMENT_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => router.push(option.route)}
              style={({ pressed, hovered }: any) => ({
                flex: isDesktop ? 1 : undefined,
                minWidth: isDesktop ? 0 : undefined,
                backgroundColor: hovered ? tc.dark.elevated : tc.dark.card,
                borderRadius: 20,
                padding: isDesktop ? 28 : 20,
                alignItems: isDesktop ? ("center" as const) : ("flex-start" as const),
                flexDirection: isDesktop ? ("column" as const) : ("row" as const),
                borderWidth: 1,
                borderColor: pressed
                  ? option.accent + "4D"
                  : hovered
                    ? option.accent + "40"
                    : tc.glass.border,
                opacity: pressed ? 0.9 : 1,
                transform: [
                  { scale: pressed ? 0.98 : hovered ? 1.02 : 1 },
                ],
                ...(isWeb
                  ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any)
                  : {}),
                ...(hovered ? ts.md : ts.sm),
              })}
            >
              <View
                style={{
                  width: isDesktop ? 60 : 52,
                  height: isDesktop ? 60 : 52,
                  borderRadius: isDesktop ? 20 : 16,
                  backgroundColor: option.accentBg,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: isDesktop ? 14 : 0,
                  marginRight: isDesktop ? 0 : 16,
                }}
              >
                <Ionicons name={option.icon} size={isDesktop ? 28 : 24} color={option.accent} />
              </View>
              {isDesktop ? (
                <Text
                  style={{
                    color: textColor,
                    fontSize: 16,
                    fontFamily: "Inter_600SemiBold",
                    textAlign: "center",
                  }}
                >
                  {option.title}
                </Text>
              ) : (
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
                  <Text
                    style={{
                      color: textColor,
                      fontSize: 16,
                      fontFamily: "Inter_600SemiBold",
                      flex: 1,
                    }}
                  >
                    {option.title}
                  </Text>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 12,
                      backgroundColor: tc.dark.elevated,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: tc.glass.border,
                    }}
                  >
                    <Ionicons name="chevron-forward" size={18} color={tc.textSecondary} />
                  </View>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* Supported Providers */}
        <View style={{ paddingHorizontal: hPad, marginTop: 20 }}>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "Inter_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1.2,
              marginBottom: 14,
              paddingLeft: 4,
            }}
          >
            Supported Providers
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {PROVIDERS.map((p) => (
              <View
                key={p.name}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: tc.dark.card,
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  gap: 7,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                }}
              >
                <Ionicons name={p.icon as any} size={14} color={tc.textSecondary} />
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 13,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  {p.name}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* How It Works */}
        {isDesktop ? (
          <View style={{ paddingHorizontal: hPad, marginTop: 32 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}>
              <Ionicons name="sparkles" size={18} color={colors.primary[400]} />
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 15,
                  fontFamily: "Inter_600SemiBold",
                  marginLeft: 8,
                }}
              >
                How it works
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              {HOW_IT_WORKS.map((item, index) => (
                <View
                  key={item.step}
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "flex-start",
                  }}
                >
                  {/* Step content */}
                  <View style={{ flex: 1, alignItems: "center" }}>
                    {/* Step number badge */}
                    <View
                      style={{
                        position: "absolute",
                        top: -6,
                        right: "50%",
                        marginRight: -30,
                        zIndex: 1,
                        backgroundColor: item.color,
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#FFFFFF",
                          fontSize: 11,
                          fontFamily: "Inter_700Bold",
                        }}
                      >
                        {item.step}
                      </Text>
                    </View>
                    {/* Icon circle */}
                    <View
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 26,
                        backgroundColor: item.color + "1F",
                        borderWidth: 1.5,
                        borderColor: item.color + "40",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 12,
                      }}
                    >
                      <Ionicons name={item.icon} size={22} color={item.color} />
                    </View>
                    <Text
                      style={{
                        color: textColor,
                        fontSize: 15,
                        fontFamily: "Inter_600SemiBold",
                        textAlign: "center",
                      }}
                    >
                      {item.title}
                    </Text>
                  </View>
                  {/* Connecting line */}
                  {index < HOW_IT_WORKS.length - 1 && (
                    <View
                      style={{
                        height: 2,
                        flex: 0.5,
                        backgroundColor: colors.primary[500] + "30",
                        borderRadius: 1,
                        marginTop: 26,
                      }}
                    />
                  )}
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View
            style={{
              marginHorizontal: hPad,
              marginTop: 28,
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              padding: 22,
              borderWidth: 1,
              borderColor: tc.glass.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 22 }}>
              <Ionicons name="sparkles" size={18} color={colors.primary[400]} />
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 14,
                  fontFamily: "Inter_600SemiBold",
                  marginLeft: 8,
                }}
              >
                How it works
              </Text>
            </View>

            {HOW_IT_WORKS.map((item, index) => (
              <View
                key={item.step}
                style={{ flexDirection: "row", alignItems: "flex-start" }}
              >
                <View style={{ alignItems: "center", marginRight: 16, width: 36 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: item.color + "1F",
                      borderWidth: 1.5,
                      borderColor: item.color + "40",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={item.icon} size={17} color={item.color} />
                  </View>
                  {index < HOW_IT_WORKS.length - 1 && (
                    <View
                      style={{
                        width: 2,
                        height: 26,
                        backgroundColor: colors.primary[500] + "26",
                        borderRadius: 1,
                      }}
                    />
                  )}
                </View>
                <View
                  style={{
                    flex: 1,
                    paddingBottom: index < HOW_IT_WORKS.length - 1 ? 18 : 0,
                  }}
                >
                  <Text
                    style={{
                      color: textColor,
                      fontSize: 14,
                      fontFamily: "Inter_600SemiBold",
                      marginBottom: 3,
                    }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "Inter_400Regular",
                      lineHeight: 18,
                    }}
                  >
                    {item.desc}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Trust Stats */}
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: hPad,
            gap: isLargeDesktop ? 16 : 12,
            marginTop: 24,
            ...(isDesktop ? {} : { flexWrap: "wrap" as const }),
          }}
        >
          {TRUST_STATS.map((stat) => (
            <View
              key={stat.title}
              style={{
                flex: isDesktop ? 1 : undefined,
                width: isDesktop ? undefined : "100%",
                backgroundColor: tc.dark.card,
                borderRadius: 18,
                padding: 20,
                borderWidth: 1,
                borderColor: tc.glass.border,
                alignItems: "center",
                ...ts.sm,
              }}
            >
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  backgroundColor: stat.color + "18",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <Ionicons name={stat.icon} size={20} color={stat.color} />
              </View>
              <Text
                style={{
                  color: textColor,
                  fontSize: 14,
                  fontFamily: "Inter_600SemiBold",
                  marginBottom: 4,
                  textAlign: "center",
                }}
              >
                {stat.title}
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                  textAlign: "center",
                  lineHeight: 17,
                }}
              >
                {stat.desc}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
