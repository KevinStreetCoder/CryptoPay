import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CryptoLogo } from "../../src/components/CryptoLogo";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { paymentsApi, C2BInstructions } from "../../src/api/payments";
import { normalizeError } from "../../src/utils/apiErrors";
import { useAuth } from "../../src/stores/auth";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { GlassCard } from "../../src/components/GlassCard";
import { useLocale } from "../../src/hooks/useLocale";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

type CryptoOption = "USDT" | "USDC" | "BTC" | "ETH" | "SOL";

const CRYPTO_OPTIONS: { id: CryptoOption; name: string; color: string }[] = [
  { id: "USDT", name: "Tether", color: colors.crypto.USDT },
  { id: "USDC", name: "USD Coin", color: colors.crypto.USDC },
  { id: "BTC", name: "Bitcoin", color: colors.crypto.BTC },
  { id: "ETH", name: "Ethereum", color: colors.crypto.ETH },
  { id: "SOL", name: "Solana", color: colors.crypto.SOL },
];

type DepositMethod = "stk" | "c2b" | "crypto";

export default function DepositScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { user } = useAuth();
  const toast = useToast();
  const { t } = useLocale();

  const [method, setMethod] = useState<DepositMethod>("stk");
  const [currency, setCurrency] = useState<CryptoOption>("USDT");
  const [amount, setAmount] = useState("");
  const [c2bInstructions, setC2bInstructions] = useState<C2BInstructions | null>(null);
  const [loadingC2B, setLoadingC2B] = useState(false);

  // Fetch C2B instructions when switching to that method
  useEffect(() => {
    if (method === "c2b" && !c2bInstructions) {
      setLoadingC2B(true);
      paymentsApi
        .c2bInstructions()
        .then((res) => setC2bInstructions(res.data))
        .catch((err) => { const e = normalizeError(err); toast.error(e.title, e.message); })
        .finally(() => setLoadingC2B(false));
    }
  }, [method]);

  const handleSTKDeposit = useCallback(() => {
    const kesAmount = parseFloat(amount);
    if (!kesAmount || kesAmount < 100) {
      toast.error(t("payment.invalidAmount"), t("payment.minimumAmount"));
      return;
    }
    // Navigate to buy-crypto page which handles STK Push
    // The buy-crypto page already handles the full STK Push flow
    router.push({
      pathname: "/payment/buy-crypto" as any,
      params: { preset_amount: amount, preset_currency: currency },
    });
  }, [amount, currency, router, toast, t]);

  const handleCryptoDeposit = useCallback(() => {
    // Navigate to wallet tab where users can see deposit addresses
    router.push("/(tabs)/wallet" as any);
  }, [router]);

  const contentMaxWidth = isDesktop ? 720 : undefined;

  const content = (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: isDesktop ? 48 : 16,
        paddingBottom: 40,
      }}
    >
      <View
        style={{
          maxWidth: contentMaxWidth,
          alignSelf: contentMaxWidth ? "center" : undefined,
          width: "100%",
        }}
      >
        {/* Page Title — mobile only */}
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
              {t("wallet.deposit")}
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
              {t("home.depositDesc")}
            </Text>
          </View>
        )}

        {/* Deposit Method Tabs */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: tc.dark.card,
            borderRadius: 16,
            padding: 4,
            marginTop: 16,
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
        >
          {(
            [
              { id: "stk" as DepositMethod, label: "M-Pesa", icon: "phone-portrait-outline" as const },
              { id: "c2b" as DepositMethod, label: "Paybill", icon: "receipt-outline" as const },
              { id: "crypto" as DepositMethod, label: "Crypto", icon: "wallet-outline" as const },
            ] as const
          ).map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => setMethod(tab.id)}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor:
                  method === tab.id ? colors.primary[500] + "20" : "transparent",
                borderWidth: method === tab.id ? 1 : 0,
                borderColor: colors.primary[500] + "40",
              }}
            >
              <Ionicons
                name={tab.icon}
                size={16}
                color={
                  method === tab.id ? colors.primary[400] : tc.textMuted
                }
              />
              <Text
                style={{
                  color:
                    method === tab.id ? colors.primary[400] : tc.textMuted,
                  fontSize: 13,
                  fontFamily:
                    method === tab.id
                      ? "DMSans_700Bold"
                      : "DMSans_500Medium",
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* STK Push Deposit */}
        {method === "stk" && (
          <View style={{ marginTop: 20, gap: 16 }}>
            {/* Currency Selector */}
            <View>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  fontFamily: "DMSans_600SemiBold",
                  marginBottom: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Receive as
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {CRYPTO_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.id}
                    onPress={() => setCurrency(opt.id)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 14,
                      backgroundColor:
                        currency === opt.id
                          ? opt.color + "18"
                          : tc.dark.card,
                      borderWidth: 1.5,
                      borderColor:
                        currency === opt.id
                          ? opt.color + "40"
                          : tc.glass.border,
                      ...(isWeb
                        ? ({
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                          } as any)
                        : {}),
                    }}
                  >
                    <CryptoLogo currency={opt.id} size={24} />
                    <Text
                      style={{
                        color:
                          currency === opt.id
                            ? tc.textPrimary
                            : tc.textSecondary,
                        fontSize: 14,
                        fontFamily:
                          currency === opt.id
                            ? "DMSans_700Bold"
                            : "DMSans_500Medium",
                      }}
                    >
                      {opt.id}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            {/* Amount Input */}
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 18,
                padding: 20,
                borderWidth: 1,
                borderColor: tc.glass.border,
                ...ts.sm,
              }}
            >
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_600SemiBold",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {t("payment.amountKes")}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 28,
                    fontFamily: "DMSans_700Bold",
                  }}
                >
                  KSh
                </Text>
                <TextInput
                  value={amount}
                  onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                  placeholderTextColor={tc.textMuted + "60"}
                  keyboardType="numeric"
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 32,
                    fontFamily: "DMSans_700Bold",
                    padding: 0,
                    ...(isWeb
                      ? ({ outlineStyle: "none" } as any)
                      : {}),
                  }}
                />
              </View>

              {/* Quick amounts */}
              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  marginTop: 16,
                  flexWrap: "wrap",
                }}
              >
                {[500, 1000, 2500, 5000, 10000].map((preset) => (
                  <Pressable
                    key={preset}
                    onPress={() => setAmount(String(preset))}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 10,
                      backgroundColor:
                        amount === String(preset)
                          ? colors.primary[500] + "20"
                          : tc.dark.elevated,
                      borderWidth: 1,
                      borderColor:
                        amount === String(preset)
                          ? colors.primary[500] + "40"
                          : tc.glass.border,
                      ...(isWeb
                        ? ({
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          } as any)
                        : {}),
                    }}
                  >
                    <Text
                      style={{
                        color:
                          amount === String(preset)
                            ? colors.primary[400]
                            : tc.textSecondary,
                        fontSize: 13,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      {preset.toLocaleString()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* How It Works */}
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: tc.glass.border,
                gap: 12,
              }}
            >
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  fontFamily: "DMSans_700Bold",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {t("payment.howItWorks")}
              </Text>
              {[
                {
                  icon: "phone-portrait" as const,
                  title: "M-Pesa prompt",
                  desc: "You'll receive an STK Push on your phone",
                },
                {
                  icon: "lock-closed" as const,
                  title: "Enter M-Pesa PIN",
                  desc: "Confirm payment with your M-Pesa PIN",
                },
                {
                  icon: "wallet" as const,
                  title: "Crypto credited",
                  desc: `${currency} deposited to your CryptoPay wallet instantly`,
                },
              ].map((step, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      backgroundColor: colors.primary[500] + "12",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={step.icon}
                      size={16}
                      color={colors.primary[400]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      {step.title}
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                      }}
                    >
                      {step.desc}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <Button
              title={`Deposit via M-Pesa`}
              onPress={handleSTKDeposit}
              icon="arrow-forward"
              style={{ maxWidth: isDesktop ? 420 : undefined }}
            />
          </View>
        )}

        {/* C2B Paybill Instructions */}
        {method === "c2b" && (
          <View style={{ marginTop: 20, gap: 16 }}>
            {loadingC2B ? (
              <View
                style={{ alignItems: "center", justifyContent: "center", paddingVertical: 40 }}
              >
                <ActivityIndicator size="large" color={colors.primary[400]} />
              </View>
            ) : c2bInstructions ? (
              <>
                {/* Paybill Number Card */}
                <View
                  style={{
                    backgroundColor: colors.primary[500] + "08",
                    borderRadius: 18,
                    padding: 20,
                    borderWidth: 1,
                    borderColor: colors.primary[500] + "20",
                    alignItems: "center",
                    gap: 8,
                    ...ts.sm,
                  }}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_600SemiBold",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Business Number (Paybill)
                  </Text>
                  <Text
                    style={{
                      color: colors.primary[400],
                      fontSize: 36,
                      fontFamily: "DMSans_700Bold",
                      letterSpacing: 2,
                    }}
                  >
                    {c2bInstructions.paybill}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_400Regular",
                    }}
                  >
                    Min: KES {c2bInstructions.min_amount.toLocaleString()} | Max: KES{" "}
                    {c2bInstructions.max_amount.toLocaleString()} | Fee: {c2bInstructions.fee_percent}%
                  </Text>
                </View>

                {/* Account Formats */}
                <View>
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 13,
                      fontFamily: "DMSans_700Bold",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      marginBottom: 10,
                    }}
                  >
                    Account Number Format
                  </Text>
                  <View style={{ gap: 8 }}>
                    {c2bInstructions.account_formats.map((fmt) => (
                      <View
                        key={fmt.currency}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: tc.dark.card,
                          borderRadius: 14,
                          padding: 14,
                          borderWidth: 1,
                          borderColor: tc.glass.border,
                          gap: 12,
                        }}
                      >
                        <CryptoLogo currency={fmt.currency} size={28} />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              color: tc.textPrimary,
                              fontSize: 15,
                              fontFamily: "DMSans_700Bold",
                              letterSpacing: 0.5,
                            }}
                          >
                            {fmt.account_number}
                          </Text>
                          <Text
                            style={{
                              color: tc.textMuted,
                              fontSize: 12,
                              fontFamily: "DMSans_400Regular",
                            }}
                          >
                            {fmt.description}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Step-by-step Instructions */}
                <View
                  style={{
                    backgroundColor: tc.dark.card,
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                    gap: 12,
                  }}
                >
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 13,
                      fontFamily: "DMSans_700Bold",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {t("payment.howItWorks")}
                  </Text>
                  {c2bInstructions.instructions.map((step, i) => (
                    <View
                      key={i}
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: colors.primary[500] + "15",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text
                          style={{
                            color: colors.primary[400],
                            fontSize: 12,
                            fontFamily: "DMSans_700Bold",
                          }}
                        >
                          {i + 1}
                        </Text>
                      </View>
                      <Text
                        style={{
                          flex: 1,
                          color: tc.textSecondary,
                          fontSize: 14,
                          fontFamily: "DMSans_400Regular",
                          lineHeight: 20,
                        }}
                      >
                        {step}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Info Note */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 10,
                    paddingHorizontal: 4,
                  }}
                >
                  <Ionicons
                    name="information-circle"
                    size={18}
                    color={colors.info}
                  />
                  <Text
                    style={{
                      flex: 1,
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_400Regular",
                      lineHeight: 18,
                    }}
                  >
                    Crypto will be credited at the live market rate when your M-Pesa
                    payment is confirmed. The phone number you pay from must match your
                    CryptoPay account.
                  </Text>
                </View>
              </>
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 40 }}>
                <Text style={{ color: tc.textMuted, fontFamily: "DMSans_500Medium" }}>
                  Failed to load instructions
                </Text>
                <Pressable
                  onPress={() => {
                    setC2bInstructions(null);
                    setMethod("c2b");
                  }}
                  style={{ marginTop: 12 }}
                >
                  <Text style={{ color: colors.primary[400], fontFamily: "DMSans_600SemiBold" }}>
                    {t("common.retry")}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* Crypto Deposit */}
        {method === "crypto" && (
          <View style={{ marginTop: 20, gap: 16 }}>
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 18,
                padding: 24,
                borderWidth: 1,
                borderColor: tc.glass.border,
                alignItems: "center",
                gap: 16,
                ...ts.sm,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  backgroundColor: colors.primary[500] + "15",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="download-outline"
                  size={28}
                  color={colors.primary[400]}
                />
              </View>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 18,
                  fontFamily: "DMSans_700Bold",
                  textAlign: "center",
                }}
              >
                Deposit Crypto Directly
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "DMSans_400Regular",
                  textAlign: "center",
                  lineHeight: 20,
                  maxWidth: 360,
                }}
              >
                Send crypto from any external wallet or exchange to your CryptoPay
                deposit address. Supports USDT, BTC, ETH, SOL, and USDC.
              </Text>
            </View>

            {/* Supported networks */}
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: tc.glass.border,
                gap: 10,
              }}
            >
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  fontFamily: "DMSans_700Bold",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Supported Networks
              </Text>
              {[
                { currency: "USDT", network: "Tron (TRC-20)", time: "~2 min" },
                { currency: "BTC", network: "Bitcoin", time: "~30 min" },
                { currency: "ETH", network: "Ethereum (ERC-20)", time: "~3 min" },
                { currency: "SOL", network: "Solana", time: "~15 sec" },
                { currency: "USDC", network: "Ethereum (ERC-20)", time: "~3 min" },
              ].map((net) => (
                <View
                  key={net.currency}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 6,
                  }}
                >
                  <CryptoLogo currency={net.currency} size={24} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      {net.currency}
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                      }}
                    >
                      {net.network}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    {net.time}
                  </Text>
                </View>
              ))}
            </View>

            <Button
              title="Go to Wallet"
              onPress={handleCryptoDeposit}
              icon="wallet-outline"
              style={{ maxWidth: isDesktop ? 420 : undefined }}
            />
          </View>
        )}
      </View>
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
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
              opacity: pressed ? 0.9 : 1,
              ...(isWeb
                ? ({
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  } as any)
                : {}),
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
            {t("wallet.deposit")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 15,
              fontFamily: "DMSans_400Regular",
              marginTop: 6,
            }}
          >
            {t("home.depositDesc")}
          </Text>
        </View>
        {content}
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
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
            else router.replace("/(tabs)" as any);
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
