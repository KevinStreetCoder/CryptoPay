import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, Platform, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";
import { getPublicReferral, PublicReferralLanding } from "../../src/api/referrals";
import { Spinner } from "../../src/components/brand/Spinner";
import { Wordmark } from "../../src/components/brand/Wordmark";
import { storage } from "../../src/utils/storage";

const isWeb = Platform.OS === "web";

/**
 * Public referral landing · GET /r/{code}
 *
 *  1. Fetches first-name + reward preview from backend
 *  2. Stores the code to be auto-filled on the next Register screen
 *  3. "Claim offer" → /auth/register (picks up stored code)
 *  4. "Already have an account" → /auth/login
 */
export default function ReferralLandingScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();

  const [data, setData] = useState<PublicReferralLanding | null>(null);
  const [loading, setLoading] = useState(true);

  const codeUpper = (code || "").toString().trim().toUpperCase();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await getPublicReferral(codeUpper);
      if (!cancelled) {
        setData(res);
        setLoading(false);
        // Persist the code so Register can prefill it.
        if (res.is_valid) {
          try {
            await storage.setItemAsync("pending_referral_code", codeUpper);
          } catch {}
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [codeUpper]);

  const handleClaim = () => {
    router.replace("/auth/register");
  };

  const handleLogin = () => {
    router.replace("/auth/login");
  };

  const rewardAmount = data?.reward_preview_kes
    ? parseFloat(data.reward_preview_kes).toFixed(0)
    : "50";

  const firstName = data?.first_name || "A friend";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 48 }}>
        <View
          style={{
            flex: 1,
            alignSelf: "center",
            width: "100%",
            maxWidth: isDesktop ? 520 : "100%",
            paddingTop: isDesktop ? 48 : 24,
          }}
        >
          {/* Brand mark */}
          <View style={{ alignItems: "center", marginBottom: 24 }}>
            <Wordmark size={34} dark={isDark} />
          </View>

          {loading ? (
            <View style={{ alignItems: "center", padding: 48 }}>
              <Spinner size={40} />
            </View>
          ) : !data?.is_valid ? (
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                padding: isDesktop ? 32 : 24,
                alignItems: "center",
                borderWidth: 1,
                borderColor: tc.glass.border,
              }}
            >
              <Ionicons name="alert-circle-outline" size={44} color={tc.textSecondary} />
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 18,
                  fontFamily: "DMSans_700Bold",
                  marginTop: 16,
                  textAlign: "center",
                }}
              >
                {t("referrals.invalidCode")}
              </Text>
              <Pressable
                onPress={handleClaim}
                style={({ pressed }: any) => ({
                  marginTop: 20,
                  backgroundColor: "#10B981",
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  borderRadius: 12,
                  opacity: pressed ? 0.85 : 1,
                })}
                accessibilityRole="button"
              >
                <Text style={{ color: "#fff", fontFamily: "DMSans_700Bold" }}>
                  {t("auth.createAccount")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Hero card */}
              <View
                style={{
                  backgroundColor: tc.dark.card,
                  borderRadius: 24,
                  padding: isDesktop ? 32 : 24,
                  borderWidth: 1,
                  borderColor: "rgba(16,185,129,0.3)",
                  ...ts.lg,
                }}
              >
                <View
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 20,
                    backgroundColor: "rgba(16,185,129,0.16)",
                    alignItems: "center",
                    justifyContent: "center",
                    alignSelf: "center",
                    marginBottom: 20,
                  }}
                >
                  <Ionicons name="gift" size={36} color="#10B981" />
                </View>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: isDesktop ? 28 : 24,
                    fontFamily: "DMSans_700Bold",
                    textAlign: "center",
                    lineHeight: isDesktop ? 34 : 30,
                  }}
                >
                  {firstName} invited you to Cpay
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 15,
                    fontFamily: "DMSans_400Regular",
                    textAlign: "center",
                    marginTop: 12,
                    lineHeight: 22,
                  }}
                >
                  Pay any M-Pesa Paybill or Till directly from your crypto.
                </Text>

                {/* Reward badge */}
                <View
                  style={{
                    marginTop: 20,
                    backgroundColor: "rgba(16,185,129,0.1)",
                    borderRadius: 14,
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    borderWidth: 1,
                    borderColor: "rgba(16,185,129,0.25)",
                  }}
                >
                  <Ionicons name="cash-outline" size={22} color="#10B981" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#10B981", fontSize: 14, fontFamily: "DMSans_700Bold" }}>
                      KES {rewardAmount} off your first payment
                    </Text>
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                        marginTop: 2,
                      }}
                    >
                      Automatically applied when you pay a bill
                    </Text>
                  </View>
                </View>

                {/* Code display */}
                <View
                  style={{
                    marginTop: 16,
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    backgroundColor: tc.glass.highlight,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 11,
                      fontFamily: "DMSans_500Medium",
                      letterSpacing: 1,
                      textTransform: "uppercase",
                    }}
                  >
                    Invite code
                  </Text>
                  <Text
                    style={{
                      color: "#10B981",
                      fontSize: 24,
                      fontFamily: "DMSans_700Bold",
                      marginTop: 4,
                      letterSpacing: 2,
                    }}
                  >
                    {codeUpper}
                  </Text>
                </View>

                {/* CTA */}
                <Pressable
                  onPress={handleClaim}
                  style={({ pressed }: any) => ({
                    marginTop: 20,
                    backgroundColor: "#10B981",
                    borderRadius: 14,
                    paddingVertical: 16,
                    alignItems: "center",
                    opacity: pressed ? 0.9 : 1,
                  })}
                  accessibilityRole="button"
                >
                  <Text style={{ color: "#fff", fontFamily: "DMSans_700Bold", fontSize: 16 }}>
                    Claim my KES {rewardAmount}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleLogin}
                  style={{ alignItems: "center", paddingVertical: 14, marginTop: 4 }}
                  accessibilityRole="button"
                >
                  <Text style={{ color: tc.textSecondary, fontFamily: "DMSans_500Medium", fontSize: 14 }}>
                    {t("auth.alreadyHaveAccount")}{" "}
                    <Text style={{ color: "#10B981", fontFamily: "DMSans_700Bold" }}>
                      {t("auth.signIn")}
                    </Text>
                  </Text>
                </Pressable>
              </View>

              {/* Features list */}
              <View
                style={{
                  marginTop: 20,
                  backgroundColor: tc.dark.card,
                  borderRadius: 16,
                  padding: 18,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  gap: 14,
                }}
              >
                {[
                  {
                    icon: "flash-outline" as const,
                    title: "Instant M-Pesa payments",
                    desc: "Pay bills with crypto in under 30 seconds",
                  },
                  {
                    icon: "shield-checkmark-outline" as const,
                    title: "Bank-grade security",
                    desc: "PIN, biometrics, and device trust",
                  },
                  {
                    icon: "trending-up-outline" as const,
                    title: "Transparent rates",
                    desc: "See the exact KES amount before you pay",
                  },
                ].map((f) => (
                  <View key={f.title} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: "rgba(16,185,129,0.12)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name={f.icon} size={18} color="#10B981" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                        {f.title}
                      </Text>
                      <Text
                        style={{
                          color: tc.textSecondary,
                          fontSize: 12,
                          fontFamily: "DMSans_400Regular",
                          marginTop: 2,
                        }}
                      >
                        {f.desc}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
