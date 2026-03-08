import { View, Text, Pressable, ScrollView, Platform, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, shadows } from "../../src/constants/theme";

const PAYMENT_OPTIONS = [
  {
    id: "paybill",
    title: "Pay Bill",
    subtitle: "KPLC, DSTV, Water, Internet & more",
    icon: "receipt-outline" as const,
    accent: "#10B981",
    accentBg: "rgba(16, 185, 129, 0.12)",
    route: "/payment/paybill" as const,
  },
  {
    id: "till",
    title: "Buy Goods",
    subtitle: "Pay merchants via Till number",
    icon: "cart-outline" as const,
    accent: "#3B82F6",
    accentBg: "rgba(59, 130, 246, 0.12)",
    route: "/payment/till" as const,
  },
  {
    id: "send",
    title: "Send to M-Pesa",
    subtitle: "Send money to any M-Pesa number",
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

export default function PayScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;
  const hPad = isDesktop ? 28 : 16;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: hPad + 4, paddingTop: isDesktop ? 16 : 8, paddingBottom: 6 }}>
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: isDesktop ? 32 : 28,
              fontFamily: "Inter_700Bold",
              letterSpacing: -0.5,
            }}
          >
            Pay
          </Text>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: isDesktop ? 15 : 14,
              fontFamily: "Inter_400Regular",
              marginTop: 4,
            }}
          >
            Pay any Kenyan bill or merchant with crypto
          </Text>
        </View>

        {isDesktop ? (
          /* Desktop: two-column layout */
          <View
            style={{
              flexDirection: "row",
              paddingHorizontal: hPad,
              gap: 20,
              marginTop: 12,
            }}
          >
            {/* Left: Payment options */}
            <View style={{ flex: 1, gap: 12 }}>
              {PAYMENT_OPTIONS.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => router.push(option.route)}
                  style={({ pressed }) => ({
                    backgroundColor: colors.dark.card,
                    borderRadius: 24,
                    padding: 22,
                    flexDirection: "row",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: pressed
                      ? colors.primary[500] + "4D"
                      : colors.glass.border,
                    opacity: pressed ? 0.85 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  })}
                >
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 18,
                      backgroundColor: option.accentBg,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 18,
                    }}
                  >
                    <Ionicons name={option.icon} size={26} color={option.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 17,
                        fontFamily: "Inter_600SemiBold",
                        marginBottom: 4,
                      }}
                    >
                      {option.title}
                    </Text>
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 14,
                        fontFamily: "Inter_400Regular",
                        lineHeight: 20,
                      }}
                    >
                      {option.subtitle}
                    </Text>
                  </View>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      backgroundColor: colors.dark.elevated,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: colors.glass.border,
                    }}
                  >
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </View>
                </Pressable>
              ))}

              {/* Supported Providers */}
              <View style={{ marginTop: 12 }}>
                <Text
                  style={{
                    color: colors.textMuted,
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
                        backgroundColor: colors.dark.card,
                        borderRadius: 20,
                        paddingHorizontal: 14,
                        paddingVertical: 9,
                        gap: 7,
                        borderWidth: 1,
                        borderColor: colors.glass.border,
                      }}
                    >
                      <Ionicons name={p.icon as any} size={14} color={colors.textSecondary} />
                      <Text
                        style={{
                          color: colors.textSecondary,
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
            </View>

            {/* Right: How it works */}
            <View style={{ flex: 1 }}>
              <View
                style={{
                  backgroundColor: colors.dark.card,
                  borderRadius: 24,
                  padding: 24,
                  borderWidth: 1,
                  borderColor: colors.glass.border,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
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

                {HOW_IT_WORKS.map((item, index) => (
                  <View
                    key={item.step}
                    style={{ flexDirection: "row", alignItems: "flex-start" }}
                  >
                    <View style={{ alignItems: "center", marginRight: 16, width: 40 }}>
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: item.color + "1F",
                          borderWidth: 1.5,
                          borderColor: item.color + "40",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name={item.icon} size={18} color={item.color} />
                      </View>
                      {index < HOW_IT_WORKS.length - 1 && (
                        <View
                          style={{
                            width: 2,
                            height: 28,
                            backgroundColor: colors.primary[500] + "26",
                            borderRadius: 1,
                          }}
                        />
                      )}
                    </View>
                    <View
                      style={{
                        flex: 1,
                        paddingBottom: index < HOW_IT_WORKS.length - 1 ? 20 : 0,
                      }}
                    >
                      <Text
                        style={{
                          color: "#FFFFFF",
                          fontSize: 15,
                          fontFamily: "Inter_600SemiBold",
                          marginBottom: 4,
                        }}
                      >
                        {item.title}
                      </Text>
                      <Text
                        style={{
                          color: colors.textMuted,
                          fontSize: 14,
                          fontFamily: "Inter_400Regular",
                          lineHeight: 20,
                        }}
                      >
                        {item.desc}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : (
          /* Mobile layout */
          <>
            {/* Payment Option Cards */}
            <View style={{ paddingHorizontal: hPad, marginTop: 12, gap: 12 }}>
              {PAYMENT_OPTIONS.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => router.push(option.route)}
                  style={({ pressed }) => ({
                    backgroundColor: colors.dark.card,
                    borderRadius: 24,
                    padding: 20,
                    flexDirection: "row",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: pressed
                      ? colors.primary[500] + "4D"
                      : colors.glass.border,
                    opacity: pressed ? 0.85 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  })}
                >
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      backgroundColor: option.accentBg,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 16,
                    }}
                  >
                    <Ionicons name={option.icon} size={24} color={option.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 16,
                        fontFamily: "Inter_600SemiBold",
                        marginBottom: 3,
                      }}
                    >
                      {option.title}
                    </Text>
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 13,
                        fontFamily: "Inter_400Regular",
                        lineHeight: 18,
                      }}
                    >
                      {option.subtitle}
                    </Text>
                  </View>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 12,
                      backgroundColor: colors.dark.elevated,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: colors.glass.border,
                    }}
                  >
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </View>
                </Pressable>
              ))}
            </View>

            {/* How it works */}
            <View
              style={{
                marginHorizontal: hPad,
                marginTop: 28,
                backgroundColor: colors.dark.card,
                borderRadius: 24,
                padding: 22,
                borderWidth: 1,
                borderColor: colors.glass.border,
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
                        color: "#FFFFFF",
                        fontSize: 14,
                        fontFamily: "Inter_600SemiBold",
                        marginBottom: 3,
                      }}
                    >
                      {item.title}
                    </Text>
                    <Text
                      style={{
                        color: colors.textMuted,
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

            {/* Supported Providers */}
            <View style={{ marginHorizontal: hPad, marginTop: 24, marginBottom: 32 }}>
              <Text
                style={{
                  color: colors.textMuted,
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
                      backgroundColor: colors.dark.card,
                      borderRadius: 20,
                      paddingHorizontal: 14,
                      paddingVertical: 9,
                      gap: 7,
                      borderWidth: 1,
                      borderColor: colors.glass.border,
                    }}
                  >
                    <Ionicons name={p.icon as any} size={14} color={colors.textSecondary} />
                    <Text
                      style={{
                        color: colors.textSecondary,
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
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
