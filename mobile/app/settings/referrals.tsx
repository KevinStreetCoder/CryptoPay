import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  Share,
  ActivityIndicator,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";
import { useToast } from "../../src/components/Toast";
import {
  getMyReferral,
  getReferralHistory,
  logShareEvent,
  MyReferralResponse,
  ReferralHistoryItem,
} from "../../src/api/referrals";
import { Spinner } from "../../src/components/brand/Spinner";

const isWeb = Platform.OS === "web";

export default function ReferralsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t, locale } = useLocale();
  const toast = useToast();

  const [data, setData] = useState<MyReferralResponse | null>(null);
  const [history, setHistory] = useState<ReferralHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [me, hist] = await Promise.all([
        getMyReferral(),
        getReferralHistory(1).catch(() => ({ count: 0, next: null, previous: null, results: [] })),
      ]);
      setData(me);
      setHistory(hist.results);
    } catch (e: any) {
      setError(e?.message || t("referrals.errorLoading"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const copyCode = useCallback(async () => {
    if (!data?.code) return;
    try {
      await Clipboard.setStringAsync(data.code);
      toast.success(t("referrals.copied"), "");
    } catch {}
  }, [data, toast, t]);

  const copyLink = useCallback(async () => {
    if (!data?.share_url) return;
    try {
      await Clipboard.setStringAsync(data.share_url);
      toast.success(t("referrals.copied"), "");
      logShareEvent("copy_link").catch(() => {});
    } catch {}
  }, [data, toast, t]);

  const shareNow = useCallback(async () => {
    if (!data) return;
    const message = locale === "sw" ? data.share_message_sw : data.share_message_en;
    if (isWeb) {
      try {
        await Clipboard.setStringAsync(message);
        toast.success(t("referrals.copied"), "");
      } catch {}
      logShareEvent("web_copy").catch(() => {});
    } else {
      try {
        await Share.share({ message, url: data.share_url });
        logShareEvent("share_sheet").catch(() => {});
      } catch {}
    }
  }, [data, locale, toast, t]);

  const shareWhatsapp = useCallback(async () => {
    if (!data) return;
    const message = locale === "sw" ? data.share_message_sw : data.share_message_en;
    const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
    const fallback = `https://wa.me/?text=${encodeURIComponent(message)}`;
    try {
      const ok = await Linking.canOpenURL(url);
      await Linking.openURL(ok ? url : fallback);
      logShareEvent("whatsapp").catch(() => {});
    } catch {
      try {
        await Linking.openURL(fallback);
        logShareEvent("whatsapp").catch(() => {});
      } catch {}
    }
  }, [data, locale]);

  const shareSms = useCallback(async () => {
    if (!data) return;
    const message = locale === "sw" ? data.share_message_sw : data.share_message_en;
    const url = Platform.OS === "ios" ? `sms:&body=${encodeURIComponent(message)}` : `sms:?body=${encodeURIComponent(message)}`;
    try {
      await Linking.openURL(url);
      logShareEvent("sms").catch(() => {});
    } catch {}
  }, [data, locale]);

  const maxW = isDesktop ? 720 : "100%";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: tc.glass.border,
        }}
      >
        <Pressable onPress={() => router.back()} style={{ padding: 8, marginRight: 6 }} accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={tc.textPrimary} />
        </Pressable>
        <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold" }}>
          {t("referrals.title")}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <View style={{ alignSelf: "center", width: "100%", maxWidth: maxW as any }}>
          {loading && (
            <View style={{ alignItems: "center", padding: 48 }}>
              <Spinner size={40} />
            </View>
          )}

          {!loading && error && (
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
              <Ionicons name="alert-circle-outline" size={32} color={colors.error} />
              <Text style={{ color: tc.textPrimary, marginTop: 12, textAlign: "center", fontFamily: "DMSans_500Medium" }}>
                {error}
              </Text>
              <Pressable
                onPress={load}
                style={{
                  marginTop: 16,
                  backgroundColor: "#10B981",
                  paddingHorizontal: 20,
                  paddingVertical: 10,
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: "#fff", fontFamily: "DMSans_600SemiBold" }}>
                  {t("common.retry")}
                </Text>
              </Pressable>
            </View>
          )}

          {!loading && !error && data && (
            <>
              {/* Hero card */}
              <View
                style={{
                  backgroundColor: tc.dark.card,
                  borderRadius: 20,
                  padding: isDesktop ? 28 : 22,
                  borderWidth: 1,
                  borderColor: "rgba(16,185,129,0.25)",
                  ...ts.md,
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 16,
                    backgroundColor: "rgba(16,185,129,0.16)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <Ionicons name="gift-outline" size={28} color="#10B981" />
                </View>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: isDesktop ? 24 : 20,
                    fontFamily: "DMSans_700Bold",
                    marginBottom: 8,
                  }}
                >
                  {t("referrals.heroHeadline")}
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "DMSans_400Regular",
                    lineHeight: 21,
                  }}
                >
                  {t("referrals.heroSub").replace("{amount}", String(parseFloat(data.referee_bonus_kes).toFixed(0)))}
                </Text>
              </View>

              {/* Code card */}
              <View
                style={{
                  marginTop: 16,
                  backgroundColor: tc.dark.card,
                  borderRadius: 20,
                  padding: 22,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                }}
              >
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 12,
                    fontFamily: "DMSans_500Medium",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    marginBottom: 10,
                  }}
                >
                  {t("referrals.yourCode")}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <Text
                    selectable
                    style={{
                      color: "#10B981",
                      fontSize: isDesktop ? 36 : 32,
                      fontFamily: "DMSans_700Bold",
                      letterSpacing: 2,
                    }}
                  >
                    {data.code}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={copyCode}
                      style={({ pressed }: any) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        backgroundColor: "rgba(16,185,129,0.1)",
                        borderRadius: 12,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        opacity: pressed ? 0.7 : 1,
                      })}
                      accessibilityRole="button"
                    >
                      <Ionicons name="copy-outline" size={16} color="#10B981" />
                      <Text style={{ color: "#10B981", fontFamily: "DMSans_600SemiBold", fontSize: 13 }}>
                        {t("referrals.copyCode")}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* Share URL row */}
                <Pressable
                  onPress={copyLink}
                  style={({ pressed }: any) => ({
                    marginTop: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: tc.glass.highlight,
                    borderRadius: 10,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Ionicons name="link-outline" size={16} color={tc.textSecondary} />
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      color: tc.textSecondary,
                      fontFamily: "DMSans_500Medium",
                      fontSize: 13,
                    }}
                  >
                    {data.share_url}
                  </Text>
                  <Ionicons name="copy-outline" size={16} color={tc.textSecondary} />
                </Pressable>

                {/* Primary share button */}
                <Pressable
                  onPress={shareNow}
                  style={({ pressed }: any) => ({
                    marginTop: 16,
                    backgroundColor: "#10B981",
                    borderRadius: 14,
                    paddingVertical: 14,
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                    opacity: pressed ? 0.85 : 1,
                  })}
                  accessibilityRole="button"
                >
                  <Ionicons name="share-social-outline" size={18} color="#fff" />
                  <Text style={{ color: "#fff", fontFamily: "DMSans_700Bold", fontSize: 15 }}>
                    {t("referrals.share")}
                  </Text>
                </Pressable>

                {/* Secondary share options */}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Pressable
                    onPress={shareWhatsapp}
                    style={({ pressed }: any) => ({
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      backgroundColor: tc.glass.highlight,
                      borderRadius: 12,
                      paddingVertical: 11,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                    <Text style={{ color: tc.textPrimary, fontFamily: "DMSans_600SemiBold", fontSize: 13 }}>
                      WhatsApp
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={shareSms}
                    style={({ pressed }: any) => ({
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      backgroundColor: tc.glass.highlight,
                      borderRadius: 12,
                      paddingVertical: 11,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Ionicons name="chatbubble-outline" size={16} color={tc.textPrimary} />
                    <Text style={{ color: tc.textPrimary, fontFamily: "DMSans_600SemiBold", fontSize: 13 }}>
                      SMS
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Stats grid */}
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                  marginTop: 24,
                  marginBottom: 12,
                }}
              >
                {t("referrals.stats")}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                {[
                  {
                    label: t("referrals.sent"),
                    value: String(data.totals.invited_sent),
                    icon: "paper-plane-outline" as const,
                  },
                  {
                    label: t("referrals.signedUp"),
                    value: String(data.totals.signed_up),
                    icon: "person-add-outline" as const,
                  },
                  {
                    label: t("referrals.qualified"),
                    value: String(data.totals.qualified),
                    icon: "checkmark-circle-outline" as const,
                  },
                  {
                    label: t("referrals.earned"),
                    value: `KES ${parseFloat(data.totals.total_earned_kes).toFixed(0)}`,
                    icon: "cash-outline" as const,
                  },
                  {
                    label: t("referrals.available"),
                    value: `KES ${parseFloat(data.totals.available_credit_kes).toFixed(0)}`,
                    icon: "wallet-outline" as const,
                  },
                  {
                    label: t("referrals.pending"),
                    value: `KES ${parseFloat(data.totals.pending_credit_kes).toFixed(0)}`,
                    icon: "time-outline" as const,
                  },
                ].map((stat) => (
                  <View
                    key={stat.label}
                    style={{
                      flex: 1,
                      minWidth: isDesktop ? 200 : 150,
                      backgroundColor: tc.dark.card,
                      borderRadius: 14,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: tc.glass.border,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name={stat.icon} size={14} color={tc.textSecondary} />
                      <Text
                        style={{
                          color: tc.textSecondary,
                          fontSize: 11,
                          fontFamily: "DMSans_500Medium",
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                        }}
                      >
                        {stat.label}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 18,
                        fontFamily: "DMSans_700Bold",
                        marginTop: 6,
                      }}
                    >
                      {stat.value}
                    </Text>
                  </View>
                ))}
              </View>

              {/* How it works */}
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                  marginTop: 24,
                  marginBottom: 12,
                }}
              >
                {t("referrals.howItWorks")}
              </Text>
              <View
                style={{
                  backgroundColor: tc.dark.card,
                  borderRadius: 16,
                  padding: 18,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  gap: 14,
                }}
              >
                {[t("referrals.step1"), t("referrals.step2"), t("referrals.step3")].map((step, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        backgroundColor: "rgba(16,185,129,0.15)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: "#10B981", fontFamily: "DMSans_700Bold", fontSize: 12 }}>
                        {i + 1}
                      </Text>
                    </View>
                    <Text
                      style={{
                        flex: 1,
                        color: tc.textPrimary,
                        fontSize: 13,
                        fontFamily: "DMSans_400Regular",
                        lineHeight: 20,
                      }}
                    >
                      {step.replace("{amount}", String(parseFloat(data.referee_bonus_kes).toFixed(0)))}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Invite history */}
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                  marginTop: 24,
                  marginBottom: 12,
                }}
              >
                {t("referrals.history")}
              </Text>
              {history.length === 0 ? (
                <View
                  style={{
                    backgroundColor: tc.dark.card,
                    borderRadius: 16,
                    padding: 24,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                    borderStyle: "dashed" as any,
                  }}
                >
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontFamily: "DMSans_500Medium",
                      textAlign: "center",
                    }}
                  >
                    {t("referrals.emptyHistory")}
                  </Text>
                </View>
              ) : (
                <View
                  style={{
                    backgroundColor: tc.dark.card,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                    overflow: "hidden",
                  }}
                >
                  {history.map((item, i) => (
                    <View
                      key={item.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        gap: 10,
                        borderBottomWidth: i === history.length - 1 ? 0 : 1,
                        borderBottomColor: tc.glass.border,
                      }}
                    >
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 12,
                          backgroundColor: "rgba(16,185,129,0.1)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="person-outline" size={16} color="#10B981" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: tc.textPrimary, fontFamily: "DMSans_600SemiBold", fontSize: 14 }}>
                          {item.referee_masked_name || item.referee_masked_phone || "—"}
                        </Text>
                        <Text style={{ color: tc.textSecondary, fontFamily: "DMSans_400Regular", fontSize: 12, marginTop: 2 }}>
                          {item.status_display}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: item.status === "rewarded" ? "#10B981" : tc.textSecondary,
                          fontFamily: "DMSans_700Bold",
                          fontSize: 13,
                        }}
                      >
                        {item.status === "rewarded" ? `+KES ${parseFloat(item.reward_amount_kes).toFixed(0)}` : "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 11,
                  fontFamily: "DMSans_400Regular",
                  textAlign: "center",
                  marginTop: 24,
                  lineHeight: 17,
                }}
              >
                {t("referrals.disclaimer")}
              </Text>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
