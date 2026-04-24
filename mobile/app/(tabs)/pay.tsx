import { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Platform, useWindowDimensions, Image, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { SERVICE_LOGOS } from "../../src/constants/logos";
import { useLocale } from "../../src/hooks/useLocale";
import { paymentsApi, SavedPaybill } from "../../src/api/payments";
import { useToast } from "../../src/components/Toast";
import { Spinner } from "../../src/components/brand/Spinner";

const isWeb = Platform.OS === "web";

/** Renders a company logo from a require() asset with letter fallback. */
function ServiceLogo({
  logos,
  name,
  size = 28,
  color,
  bg,
}: {
  logos?: any;
  name: string;
  size?: number;
  color: string;
  bg?: string;
}) {
  const [failed, setFailed] = useState(false);

  // Render image if we have a valid asset (require() result · number on native, object/string on web)
  if (logos && !failed) {
    return (
      <Image
        source={logos}
        style={{ width: size, height: size, borderRadius: 6 }}
        onError={() => setFailed(true)}
        resizeMode="contain"
      />
    );
  }

  // Colored initial-letter fallback
  const initial = name.charAt(0).toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        backgroundColor: color + "30",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: color,
          fontSize: size * 0.52,
          fontFamily: "DMSans_700Bold",
          lineHeight: size * 0.65,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

// ── Real Kenyan Service Providers ──────────────────────────────────────────
interface ServiceProvider {
  name: string;
  paybill?: string;
  till?: string;
  icon: keyof typeof Ionicons.glyphMap;
  logos?: any;
  color: string;
  bg: string;
  category: "utility" | "telecom" | "entertainment" | "government" | "other";
  route: "/payment/paybill" | "/payment/till" | "/payment/send";
}

const POPULAR_SERVICES: ServiceProvider[] = [
  {
    name: "KPLC Prepaid",
    paybill: "888880",
    icon: "flash",
    logos: SERVICE_LOGOS["KPLC Prepaid"],
    color: "#F59E0B",
    bg: "rgba(245,158,11,0.12)",
    category: "utility",
    route: "/payment/paybill",
  },
  {
    name: "KPLC Postpaid",
    paybill: "888888",
    icon: "flash-outline",
    logos: SERVICE_LOGOS["KPLC Postpaid"],
    color: "#F59E0B",
    bg: "rgba(245,158,11,0.12)",
    category: "utility",
    route: "/payment/paybill",
  },
  {
    name: "Nairobi Water",
    paybill: "444400",
    icon: "water",
    logos: SERVICE_LOGOS["Nairobi Water"],
    color: "#3B82F6",
    bg: "rgba(59,130,246,0.12)",
    category: "utility",
    route: "/payment/paybill",
  },
  {
    name: "Safaricom",
    paybill: "174379",
    icon: "phone-portrait",
    logos: SERVICE_LOGOS["Safaricom"],
    color: "#10B981",
    bg: "rgba(16,185,129,0.12)",
    category: "telecom",
    route: "/payment/paybill",
  },
  {
    name: "GOtv",
    paybill: "444900",
    icon: "play-circle",
    logos: SERVICE_LOGOS["GOtv"],
    color: "#F97316",
    bg: "rgba(249,115,22,0.12)",
    category: "entertainment",
    route: "/payment/paybill",
  },
  {
    name: "StarTimes",
    paybill: "585858",
    icon: "star",
    logos: SERVICE_LOGOS["StarTimes"],
    color: "#FBBF24",
    bg: "rgba(251,191,36,0.12)",
    category: "entertainment",
    route: "/payment/paybill",
  },
  {
    name: "NHIF",
    paybill: "200222",
    icon: "medkit",
    logos: SERVICE_LOGOS["NHIF"],
    color: "#EC4899",
    bg: "rgba(236,72,153,0.12)",
    category: "government",
    route: "/payment/paybill",
  },
  {
    name: "Zuku",
    paybill: "320320",
    icon: "wifi",
    logos: SERVICE_LOGOS["Zuku"],
    color: "#14B8A6",
    bg: "rgba(20,184,166,0.12)",
    category: "telecom",
    route: "/payment/paybill",
  },
];

const PAYMENT_OPTIONS = [
  {
    id: "deposit",
    titleKey: "payment.depositKes",
    subtitleKey: "payment.depositKesSubtitle",
    icon: "arrow-down-circle-outline" as const,
    accent: "#A78BFA",
    accentBg: "rgba(167, 139, 250, 0.12)",
    route: "/payment/deposit" as const,
  },
  {
    id: "paybill",
    titleKey: "payment.payBill",
    subtitleKey: "payment.payBillSubtitle",
    icon: "receipt-outline" as const,
    accent: "#10B981",
    accentBg: "rgba(16, 185, 129, 0.12)",
    route: "/payment/paybill" as const,
  },
  {
    id: "till",
    titleKey: "payment.payTill",
    subtitleKey: "payment.buyGoodsSubtitle",
    icon: "cart-outline" as const,
    accent: "#3B82F6",
    accentBg: "rgba(59, 130, 246, 0.12)",
    route: "/payment/till" as const,
  },
  {
    id: "send",
    titleKey: "payment.sendToMpesa",
    subtitleKey: "payment.sendMpesaSubtitle",
    icon: "phone-portrait-outline" as const,
    accent: "#F59E0B",
    accentBg: "rgba(245, 158, 11, 0.12)",
    route: "/payment/send" as const,
  },
  {
    id: "swap",
    titleKey: "payment.swapCrypto" as any,
    subtitleKey: "payment.swapCryptoSubtitle" as any,
    icon: "swap-horizontal-outline" as const,
    accent: "#627EEA",
    accentBg: "rgba(98, 126, 234, 0.12)",
    route: "/payment/swap" as const,
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    titleKey: "payment.enterDetails",
    descKey: "payment.enterDetailsDesc",
    icon: "create-outline" as const,
    color: "#10B981",
  },
  {
    step: 2,
    titleKey: "payment.autoConvert",
    descKey: "payment.autoConvertDesc",
    icon: "swap-horizontal-outline" as const,
    color: "#3B82F6",
  },
  {
    step: 3,
    titleKey: "payment.instantPayment",
    descKey: "payment.instantPaymentDesc",
    icon: "flash-outline" as const,
    color: "#F59E0B",
  },
];

const TRUST_STATS = [
  {
    titleKey: "payment.encryption256",
    descKey: "payment.encryptionDesc",
    icon: "shield-checkmark-outline" as const,
    color: "#10B981",
  },
  {
    titleKey: "payment.instantSettlement",
    descKey: "payment.instantSettlementDesc",
    icon: "flash-outline" as const,
    color: "#3B82F6",
  },
  {
    titleKey: "payment.support247",
    descKey: "payment.support247Desc",
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
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const bottomTabBarHeight = useBottomTabBarHeight();

  const isDesktop = isWeb && width >= 900;
  const isLargeDesktop = isWeb && width >= 1200;
  const hPad = isLargeDesktop ? 48 : isDesktop ? 32 : 16;

  const textColor = isDark ? "#FFFFFF" : tc.textPrimary;

  // Fetch saved paybills
  const { data: savedPaybills, isLoading: savedLoading } = useQuery<SavedPaybill[]>({
    queryKey: ["savedPaybills"],
    queryFn: async () => {
      const { data } = await paymentsApi.savedPaybills();
      return data;
    },
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteSavedPaybill = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await paymentsApi.deleteSavedPaybill(id);
      queryClient.invalidateQueries({ queryKey: ["savedPaybills"] });
      toast.success("Removed", "Saved paybill deleted");
    } catch {
      toast.error("Error", "Could not delete saved paybill");
    } finally {
      setDeletingId(null);
    }
  }, [queryClient, toast]);

  const handleSavedPaybillPress = (bill: SavedPaybill) => {
    router.push(
      `/payment/paybill?prefill=${bill.paybill_number}&account=${encodeURIComponent(bill.account_number)}&name=${encodeURIComponent(bill.label || "Saved Bill")}` as any
    );
  };

  const handleSavedPaybillLongPress = (bill: SavedPaybill) => {
    if (isWeb) {
      // On web, confirm via window.confirm
      if (typeof window !== "undefined" && window.confirm(`Delete saved paybill "${bill.label || bill.paybill_number}"?`)) {
        handleDeleteSavedPaybill(bill.id);
      }
    } else {
      Alert.alert(
        "Delete Saved Paybill",
        `Remove "${bill.label || bill.paybill_number}"?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => handleDeleteSavedPaybill(bill.id) },
        ]
      );
    }
  };

  const handleServicePress = (service: ServiceProvider) => {
    if (service.paybill) {
      router.push(`/payment/paybill?prefill=${service.paybill}&name=${encodeURIComponent(service.name)}` as any);
    } else if (service.till) {
      router.push(`/payment/till?prefill=${service.till}&name=${encodeURIComponent(service.name)}` as any);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomTabBarHeight + 16 }}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <View
          style={{
            paddingHorizontal: hPad,
            paddingTop: isDesktop ? 20 : 12,
            paddingBottom: 8,
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
              marginBottom: 16,
              opacity: pressed ? 0.9 : 1,
              ...(isWeb
                ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any)
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

          {/* Page title and subtitle */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <View
              style={{
                width: isDesktop ? 48 : 42,
                height: isDesktop ? 48 : 42,
                borderRadius: isDesktop ? 16 : 14,
                backgroundColor: colors.primary[500] + "18",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="wallet-outline"
                size={isDesktop ? 24 : 22}
                color={colors.primary[400]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: textColor,
                  fontSize: isDesktop ? 32 : 28,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -0.5,
                }}
              >
                {t("payment.payments")}
              </Text>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: isDesktop ? 15 : 14,
                  fontFamily: "DMSans_400Regular",
                  marginTop: 2,
                }}
              >
                {t("payment.payAnyBill")}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Payment Methods ────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: hPad, marginTop: 20 }}>
          <SectionHeader
            title={t("payment.paymentMethods")}
            icon="card-outline"
            iconColor={colors.primary[400]}
          />
          <View
            style={{
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
                    ? ({
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                      } as any)
                    : {}),
                  ...(hovered
                    ? {
                        ...ts.md,
                        ...(isWeb
                          ? ({
                              boxShadow: `0 4px 20px ${option.accent}25, 0 4px 16px rgba(0,0,0,0.2)`,
                            } as any)
                          : {}),
                      }
                    : ts.sm),
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
                  <View style={{ alignItems: "center" }}>
                    <Text
                      style={{
                        color: textColor,
                        fontSize: 16,
                        fontFamily: "DMSans_600SemiBold",
                        textAlign: "center",
                      }}
                    >
                      {t(option.titleKey)}
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                        marginTop: 4,
                        textAlign: "center",
                      }}
                    >
                      {t(option.subtitleKey)}
                    </Text>
                  </View>
                ) : (
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: textColor,
                          fontSize: 16,
                          fontFamily: "DMSans_600SemiBold",
                        }}
                      >
                        {t(option.titleKey)}
                      </Text>
                      <Text
                        style={{
                          color: tc.textMuted,
                          fontSize: 12,
                          fontFamily: "DMSans_400Regular",
                          marginTop: 2,
                        }}
                      >
                        {t(option.subtitleKey)}
                      </Text>
                    </View>
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
        </View>

        {/* ── Saved Paybills ────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: hPad, marginTop: 32 }}>
          <SectionHeader
            title="Saved Paybills"
            icon="bookmark-outline"
            iconColor={colors.primary[400]}
            count={savedPaybills?.length || 0}
          />
          {savedLoading ? (
            <View style={{ paddingVertical: 20, alignItems: "center" }}>
              <Spinner size={16} color={colors.primary[400]} />
            </View>
          ) : !savedPaybills || savedPaybills.length === 0 ? (
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 16,
                padding: 24,
                alignItems: "center",
                borderWidth: 1,
                borderColor: tc.glass.border,
              }}
            >
              <Ionicons name="bookmark-outline" size={28} color={tc.textMuted} style={{ marginBottom: 10 }} />
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 13,
                  fontFamily: "DMSans_400Regular",
                  textAlign: "center",
                  lineHeight: 19,
                }}
              >
                No saved paybills yet. They'll appear here after your first payment.
              </Text>
            </View>
          ) : (
            <View
              style={{
                flexDirection: isDesktop ? "row" : "column",
                flexWrap: isDesktop ? "wrap" : undefined,
                gap: isDesktop ? 14 : 10,
              }}
            >
              {savedPaybills.map((bill) => (
                <Pressable
                  key={bill.id}
                  onPress={() => handleSavedPaybillPress(bill)}
                  onLongPress={() => handleSavedPaybillLongPress(bill)}
                  style={({ pressed, hovered }: any) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: hovered ? tc.dark.elevated : tc.dark.card,
                    borderRadius: 16,
                    paddingHorizontal: isDesktop ? 18 : 14,
                    paddingVertical: isDesktop ? 14 : 12,
                    gap: 12,
                    borderWidth: 1,
                    borderColor: hovered ? colors.primary[400] + "40" : tc.glass.border,
                    opacity: pressed ? 0.85 : deletingId === bill.id ? 0.5 : 1,
                    transform: [{ scale: pressed ? 0.97 : hovered ? 1.01 : 1 }],
                    ...(isDesktop
                      ? {
                          width: `calc(33.333% - ${(14 * 2) / 3}px)` as any,
                          minWidth: 200,
                        }
                      : {}),
                    ...(isWeb
                      ? ({
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                        } as any)
                      : {}),
                    ...(hovered
                      ? {
                          ...ts.sm,
                          ...(isWeb
                            ? ({
                                boxShadow: `0 2px 12px ${colors.primary[400]}20, 0 2px 8px rgba(0,0,0,0.15)`,
                              } as any)
                            : {}),
                        }
                      : {}),
                  })}
                  accessibilityRole="button"
                  accessibilityLabel={`Pay ${bill.label || bill.paybill_number}`}
                >
                  {/* Icon */}
                  <View
                    style={{
                      width: isDesktop ? 40 : 36,
                      height: isDesktop ? 40 : 36,
                      borderRadius: isDesktop ? 12 : 10,
                      backgroundColor: colors.primary[400] + "18",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Ionicons name="bookmark" size={isDesktop ? 20 : 18} color={colors.primary[400]} />
                  </View>

                  {/* Details */}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: isDesktop ? 14 : 13,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                      numberOfLines={1}
                    >
                      {bill.label || "Saved Bill"}
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: isDesktop ? 12 : 11,
                        fontFamily: "DMSans_400Regular",
                        marginTop: 1,
                      }}
                      numberOfLines={1}
                    >
                      {bill.paybill_number} / {bill.account_number}
                    </Text>
                    {bill.last_used_at && (
                      <Text
                        style={{
                          color: tc.dark.muted,
                          fontSize: 10,
                          fontFamily: "DMSans_400Regular",
                          marginTop: 2,
                        }}
                      >
                        Last used {new Date(bill.last_used_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
                      </Text>
                    )}
                  </View>

                  {/* Delete button (visible on desktop hover or always on mobile via long press) */}
                  {isDesktop && (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        handleSavedPaybillLongPress(bill);
                      }}
                      hitSlop={8}
                      style={({ hovered }: any) => ({
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        backgroundColor: hovered ? tc.dark.elevated : "transparent",
                        alignItems: "center",
                        justifyContent: "center",
                        ...(isWeb ? { cursor: "pointer" } as any : {}),
                      })}
                      accessibilityRole="button"
                      accessibilityLabel="Delete saved paybill"
                    >
                      <Ionicons name="trash-outline" size={14} color={tc.textMuted} />
                    </Pressable>
                  )}

                  {!isDesktop && (
                    <Ionicons name="chevron-forward" size={16} color={tc.textMuted} />
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* ── Popular Services ───────────────────────────────────────── */}
        <View style={{ paddingHorizontal: hPad, marginTop: 32 }}>
          <SectionHeader
            title={t("payment.popularServices")}
            icon="star-outline"
            iconColor="#F59E0B"
            count={POPULAR_SERVICES.length}
          />
          <View
            style={{
              flexDirection: isDesktop ? "row" : "column",
              flexWrap: isDesktop ? "wrap" : undefined,
              gap: isDesktop ? 14 : 10,
            }}
          >
            {POPULAR_SERVICES.map((service) => (
              <Pressable
                key={service.name}
                onPress={() => handleServicePress(service)}
                style={({ pressed, hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: hovered ? tc.dark.elevated : tc.dark.card,
                  borderRadius: 16,
                  paddingHorizontal: isDesktop ? 18 : 14,
                  paddingVertical: isDesktop ? 14 : 10,
                  gap: 10,
                  borderWidth: 1,
                  borderColor: hovered ? service.color + "40" : tc.glass.border,
                  opacity: pressed ? 0.85 : 1,
                  transform: [{ scale: pressed ? 0.97 : hovered ? 1.01 : 1 }],
                  ...(isDesktop
                    ? {
                        width: `calc(33.333% - ${14 * 2 / 3}px)` as any,
                        minWidth: 200,
                      }
                    : {}),
                  ...(isWeb
                    ? ({
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                      } as any)
                    : {}),
                  ...(hovered
                    ? {
                        ...ts.sm,
                        ...(isWeb
                          ? ({
                              boxShadow: `0 2px 12px ${service.color}20, 0 2px 8px rgba(0,0,0,0.15)`,
                            } as any)
                          : {}),
                      }
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel={`Pay ${service.name}`}
              >
                <View
                  style={{
                    width: isDesktop ? 40 : 36,
                    height: isDesktop ? 40 : 36,
                    borderRadius: isDesktop ? 12 : 10,
                    backgroundColor: service.bg,
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <ServiceLogo
                    logos={service.logos}
                    name={service.name}
                    size={isDesktop ? 34 : 30}
                    color={service.color}
                    bg={service.bg}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: isDesktop ? 14 : 13,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {service.name}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: isDesktop ? 12 : 11,
                      fontFamily: "DMSans_400Regular",
                      marginTop: 1,
                    }}
                  >
                    {service.paybill || service.till}
                  </Text>
                </View>
                {isDesktop && (
                  <Ionicons name="chevron-forward" size={16} color={tc.textMuted} />
                )}
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── How It Works ───────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: hPad, marginTop: 32 }}>
          <SectionHeader
            title={t("payment.howItWorks")}
            icon="sparkles"
            iconColor={colors.primary[400]}
            uppercase={false}
          />
        </View>
        {isDesktop ? (
          <View style={{ paddingHorizontal: hPad }}>
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
                  <View style={{ flex: 1, alignItems: "center" }}>
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
                          fontFamily: "DMSans_700Bold",
                        }}
                      >
                        {item.step}
                      </Text>
                    </View>
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
                        fontFamily: "DMSans_600SemiBold",
                        textAlign: "center",
                      }}
                    >
                      {t(item.titleKey)}
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                        textAlign: "center",
                        marginTop: 4,
                        lineHeight: 17,
                        maxWidth: 180,
                      }}
                    >
                      {t(item.descKey)}
                    </Text>
                  </View>
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
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              padding: 22,
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...ts.sm,
            }}
          >
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
                      fontFamily: "DMSans_600SemiBold",
                      marginBottom: 3,
                    }}
                  >
                    {t(item.titleKey)}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_400Regular",
                      lineHeight: 18,
                    }}
                  >
                    {t(item.descKey)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Trust & Security ───────────────────────────────────────── */}
        <View style={{ paddingHorizontal: hPad, marginTop: 32 }}>
          <SectionHeader
            title={t("payment.trustAndSecurity")}
            icon="shield-checkmark-outline"
            iconColor="#10B981"
          />
          <View
            style={{
              flexDirection: "row",
              gap: isLargeDesktop ? 16 : 12,
              ...(isDesktop ? {} : { flexWrap: "wrap" as const }),
            }}
          >
            {TRUST_STATS.map((stat) => (
              <View
                key={t(stat.titleKey)}
                style={{
                  flex: isDesktop ? 1 : undefined,
                  width: isDesktop ? undefined : "100%",
                  backgroundColor: tc.dark.card,
                  borderRadius: 18,
                  padding: isDesktop ? 24 : 20,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  alignItems: "center",
                  ...ts.sm,
                }}
              >
                <View
                  style={{
                    width: isDesktop ? 48 : 42,
                    height: isDesktop ? 48 : 42,
                    borderRadius: isDesktop ? 16 : 14,
                    backgroundColor: stat.color + "18",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <Ionicons
                    name={stat.icon}
                    size={isDesktop ? 24 : 20}
                    color={stat.color}
                  />
                </View>
                <Text
                  style={{
                    color: textColor,
                    fontSize: isDesktop ? 15 : 14,
                    fontFamily: "DMSans_600SemiBold",
                    marginBottom: 4,
                    textAlign: "center",
                  }}
                >
                  {t(stat.titleKey)}
                </Text>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_400Regular",
                    textAlign: "center",
                    lineHeight: 17,
                  }}
                >
                  {t(stat.descKey)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
