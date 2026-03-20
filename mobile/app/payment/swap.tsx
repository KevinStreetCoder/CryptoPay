/**
 * Crypto Swap Screen
 *
 * Allows users to convert between crypto currencies in their wallet.
 * Uses the rate engine to derive cross-rates via KES intermediary.
 * 0.5% swap fee deducted from source amount.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CryptoLogo } from "../../src/components/CryptoLogo";
import { Button } from "../../src/components/Button";
import { PinInput } from "../../src/components/PinInput";
import { GlassCard } from "../../src/components/GlassCard";
import { SectionHeader } from "../../src/components/SectionHeader";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { useToast } from "../../src/components/Toast";
import { useWallets } from "../../src/hooks/useWallets";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { paymentsApi } from "../../src/api/payments";
import { ratesApi, RateApiResponse } from "../../src/api/rates";
import { normalizeError } from "../../src/utils/apiErrors";
import {
  colors,
  getThemeColors,
  getThemeShadows,
  CURRENCIES,
  CurrencyCode,
} from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";
import { useQueryClient } from "@tanstack/react-query";

const isWeb = Platform.OS === "web";

type SwapCurrency = "USDT" | "USDC" | "BTC" | "ETH" | "SOL";

const CRYPTO_OPTIONS: SwapCurrency[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];
// Default fee — updated from backend rate API response
let SWAP_FEE_PERCENT = 0.5;

type RateInfo = RateApiResponse;

export default function SwapScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 768;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();
  const { t } = useLocale();

  const { data: wallets } = useWallets();

  const [fromCurrency, setFromCurrency] = useState<SwapCurrency>("USDT");
  const [toCurrency, setToCurrency] = useState<SwapCurrency>("BTC");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"form" | "review" | "pin">("form");
  const [submitting, setSubmitting] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Rate state
  const [fromRate, setFromRate] = useState<RateInfo | null>(null);
  const [toRate, setToRate] = useState<RateInfo | null>(null);
  const [ratesLoading, setRatesLoading] = useState(false);
  const rateRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useScreenSecurity(step === "pin");

  const fromWallet = wallets?.find((w) => w.currency === fromCurrency);
  const toWallet = wallets?.find((w) => w.currency === toCurrency);
  const fromBalance = fromWallet ? parseFloat(fromWallet.balance) : 0;
  const fromLockedBalance = fromWallet
    ? parseFloat((fromWallet as any).locked_balance || "0")
    : 0;
  const availableBalance = fromBalance - fromLockedBalance;
  const toBalance = toWallet ? parseFloat(toWallet.balance) : 0;

  const numAmount = parseFloat(amount) || 0;
  const feeAmount = numAmount * (SWAP_FEE_PERCENT / 100);
  const netAmount = numAmount - feeAmount;

  // Cross-rate calculation
  const fromKesRate = fromRate ? parseFloat(fromRate.final_rate) : 0;
  const toKesRate = toRate ? parseFloat(toRate.final_rate) : 0;
  const crossRate = toKesRate > 0 ? fromKesRate / toKesRate : 0;
  const destAmount = netAmount * crossRate;

  const fromDecimals = CURRENCIES[fromCurrency as CurrencyCode]?.decimals || 8;
  const toDecimals = CURRENCIES[toCurrency as CurrencyCode]?.decimals || 8;

  // Fetch rates when currencies change
  const fetchRates = useCallback(async () => {
    setRatesLoading(true);
    try {
      const [fromRes, toRes] = await Promise.all([
        ratesApi.getRate(fromCurrency),
        ratesApi.getRate(toCurrency),
      ]);
      setFromRate(fromRes.data);
      setToRate(toRes.data);
      // Sync swap fee from backend
      if ((fromRes.data as any).swap_fee_percent != null) {
        SWAP_FEE_PERCENT = parseFloat((fromRes.data as any).swap_fee_percent);
      }
    } catch {
      // Rates may fail silently; user sees "0" preview
    } finally {
      setRatesLoading(false);
    }
  }, [fromCurrency, toCurrency]);

  useEffect(() => {
    fetchRates();
    // Refresh rates every 30 seconds
    rateRefreshRef.current = setInterval(fetchRates, 30000);
    return () => {
      if (rateRefreshRef.current) clearInterval(rateRefreshRef.current);
    };
  }, [fetchRates]);

  const handleFlipCurrencies = useCallback(() => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
    setAmount("");
  }, [fromCurrency, toCurrency]);

  const handleMaxAmount = useCallback(() => {
    if (availableBalance > 0) {
      setAmount(availableBalance.toFixed(fromDecimals));
    }
  }, [availableBalance, fromDecimals]);

  const handleReview = () => {
    if (numAmount <= 0) {
      toast.warning("Invalid Amount", "Enter a valid swap amount");
      return;
    }
    // Allow small floating point rounding (0.01 tolerance for stablecoins, 0.00001 for crypto)
    const tolerance = ["USDT", "USDC"].includes(fromCurrency) ? 0.01 : 0.00001;
    if (numAmount > availableBalance + tolerance) {
      toast.warning(
        "Insufficient Balance",
        `You have ${availableBalance.toFixed(fromDecimals)} ${fromCurrency} available`
      );
      return;
    }
    if (destAmount <= 0) {
      toast.warning("Amount Too Small", "The swap amount is too small after fees");
      return;
    }
    if (!fromRate || !toRate) {
      toast.warning("Rates Unavailable", "Please wait for rates to load");
      return;
    }
    setStep("review");
  };

  const handleConfirmReview = () => {
    setStep("pin");
  };

  const handlePinComplete = async (pin: string) => {
    setSubmitting(true);
    setPinError(false);

    try {
      const { data: txData } = await paymentsApi.swap({
        from_currency: fromCurrency,
        to_currency: toCurrency,
        amount: amount,
        pin,
      });

      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      router.replace({
        pathname: "/payment/success",
        params: {
          amount_kes: "0",
          crypto_amount: destAmount.toFixed(toDecimals),
          crypto_currency: toCurrency,
          recipient: `${fromCurrency} → ${toCurrency}`,
          transaction_id: txData?.id || "",
          tx_status: "completed",
        },
      });
    } catch (err: unknown) {
      setPinError(true);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputBorderColor = (field: string) =>
    focusedField === field ? colors.primary[400] + "60" : tc.dark.border;

  const inputFocusGlow = (field: string) =>
    focusedField === field && isWeb
      ? ({ boxShadow: `0 0 0 3px ${colors.primary[500]}15` } as any)
      : {};

  // Currency selector pill
  const CurrencyPill = ({
    currency,
    selected,
    onPress,
    showBalance,
  }: {
    currency: SwapCurrency;
    selected: boolean;
    onPress: () => void;
    showBalance?: boolean;
  }) => {
    const w = wallets?.find((wl) => wl.currency === currency);
    const bal = w ? parseFloat(w.balance) : 0;
    return (
      <Pressable
        onPress={onPress}
        style={({ hovered }: any) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 14,
          backgroundColor: selected
            ? colors.crypto[currency] + "18"
            : hovered
              ? tc.dark.elevated
              : tc.dark.card,
          borderWidth: 1.5,
          borderColor: selected
            ? colors.crypto[currency] + "40"
            : tc.glass.border,
          ...(isWeb
            ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any)
            : {}),
        })}
      >
        <CryptoLogo currency={currency} size={24} />
        <View>
          <Text
            style={{
              color: selected ? tc.textPrimary : tc.textSecondary,
              fontSize: 14,
              fontFamily: selected ? "DMSans_700Bold" : "DMSans_500Medium",
            }}
          >
            {currency}
          </Text>
          {showBalance && (
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_400Regular",
              }}
            >
              {bal.toFixed(
                CURRENCIES[currency as CurrencyCode]?.decimals || 2
              )}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  // ── PIN Entry Step ──
  if (step === "pin") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <ScrollView
          contentContainerStyle={
            isDesktop
              ? { alignItems: "center", paddingVertical: 32 }
              : { flex: 1 }
          }
        >
          <View
            style={
              isDesktop
                ? {
                    width: "100%",
                    maxWidth: 480,
                    backgroundColor: tc.dark.card,
                    borderRadius: 20,
                    padding: 36,
                    borderWidth: 1,
                    borderColor: tc.dark.border,
                    ...ts.md,
                  }
                : { flex: 1, paddingHorizontal: 20 }
            }
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 24,
              }}
            >
              <Pressable
                onPress={() => setStep("review")}
                hitSlop={12}
                style={({ pressed }) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  backgroundColor: tc.dark.card,
                  borderColor: tc.glass.border,
                  borderWidth: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.85 : 1,
                  ...(isWeb
                    ? ({
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      } as any)
                    : {}),
                })}
              >
                <Ionicons
                  name="arrow-back"
                  size={20}
                  color={tc.textPrimary}
                />
              </Pressable>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 20,
                  fontFamily: "DMSans_700Bold",
                  marginLeft: 14,
                  flex: 1,
                }}
              >
                {t("payment.enterYourPin")}
              </Text>
              <PaymentStepper currentStep={2} />
            </View>

            <View
              style={{ alignItems: "center", paddingVertical: 20, gap: 16 }}
            >
              <GlassCard style={{ width: "100%", padding: 16 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    Swap
                  </Text>
                  <Text
                    style={{
                      color: colors.primary[400],
                      fontSize: 15,
                      fontFamily: "DMSans_700Bold",
                    }}
                  >
                    {amount} {fromCurrency}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    Receive
                  </Text>
                  <Text
                    style={{
                      color: colors.success,
                      fontSize: 15,
                      fontFamily: "DMSans_700Bold",
                    }}
                  >
                    {destAmount.toFixed(toDecimals)} {toCurrency}
                  </Text>
                </View>
              </GlassCard>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons
                  name="lock-closed"
                  size={14}
                  color={tc.textMuted}
                />
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_400Regular",
                  }}
                >
                  {t("payment.securedBy")}
                </Text>
              </View>

              <PinInput
                length={6}
                onComplete={handlePinComplete}
                error={pinError}
                loading={submitting}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Review Step ──
  if (step === "review") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <ScrollView
          contentContainerStyle={
            isDesktop
              ? { alignItems: "center", paddingVertical: 32 }
              : undefined
          }
        >
          <View
            style={
              isDesktop
                ? {
                    width: "100%",
                    maxWidth: 600,
                    backgroundColor: tc.dark.card,
                    borderRadius: 20,
                    padding: 36,
                    borderWidth: 1,
                    borderColor: tc.dark.border,
                    ...ts.md,
                  }
                : { flex: 1, paddingHorizontal: 20 }
            }
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 12,
                marginBottom: 16,
              }}
            >
              <Pressable
                onPress={() => setStep("form")}
                hitSlop={12}
                style={({ pressed }) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  backgroundColor: tc.dark.card,
                  borderColor: tc.glass.border,
                  borderWidth: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.85 : 1,
                  ...(isWeb
                    ? ({
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      } as any)
                    : {}),
                })}
              >
                <Ionicons
                  name="arrow-back"
                  size={20}
                  color={tc.textPrimary}
                />
              </Pressable>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isDesktop ? 24 : 20,
                  fontFamily: "DMSans_700Bold",
                  marginLeft: 14,
                  flex: 1,
                }}
              >
                Confirm Swap
              </Text>
              <PaymentStepper currentStep={1} />
            </View>

            {/* Review Card */}
            <GlassCard glowOpacity={0.15} style={{ marginBottom: 20 }}>
              <View style={{ padding: 20, gap: 14 }}>
                {/* From / To visual */}
                <View style={{ alignItems: "center", paddingVertical: 12 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 16,
                    }}
                  >
                    <View style={{ alignItems: "center" }}>
                      <CryptoLogo currency={fromCurrency} size={40} />
                      <Text
                        style={{
                          color: tc.textPrimary,
                          fontSize: 14,
                          fontFamily: "DMSans_700Bold",
                          marginTop: 6,
                        }}
                      >
                        {fromCurrency}
                      </Text>
                    </View>
                    <View style={{ alignItems: "center" }}>
                      <Ionicons
                        name="arrow-forward"
                        size={24}
                        color={colors.primary[400]}
                      />
                    </View>
                    <View style={{ alignItems: "center" }}>
                      <CryptoLogo currency={toCurrency} size={40} />
                      <Text
                        style={{
                          color: tc.textPrimary,
                          fontSize: 14,
                          fontFamily: "DMSans_700Bold",
                          marginTop: 6,
                        }}
                      >
                        {toCurrency}
                      </Text>
                    </View>
                  </View>

                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 28,
                      fontFamily: "DMSans_700Bold",
                      marginTop: 16,
                    }}
                  >
                    {amount} {fromCurrency}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                      marginTop: 4,
                    }}
                  >
                    Swap to {toCurrency}
                  </Text>
                </View>

                <View
                  style={{ height: 1, backgroundColor: tc.dark.border }}
                />

                {/* You receive */}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    You receive
                  </Text>
                  <Text
                    style={{
                      color: colors.success,
                      fontSize: 16,
                      fontFamily: "DMSans_700Bold",
                    }}
                  >
                    {destAmount.toFixed(toDecimals)} {toCurrency}
                  </Text>
                </View>

                {/* Exchange rate */}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    Exchange rate
                  </Text>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    1 {fromCurrency} = {crossRate.toFixed(toDecimals)}{" "}
                    {toCurrency}
                  </Text>
                </View>

                {/* Fee */}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    Swap fee ({SWAP_FEE_PERCENT}%)
                  </Text>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    {feeAmount.toFixed(fromDecimals)} {fromCurrency}
                  </Text>
                </View>

                <View
                  style={{ height: 1, backgroundColor: tc.dark.border }}
                />

                {/* Total deducted */}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 14,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {t("payment.total")}
                  </Text>
                  <Text
                    style={{
                      color: colors.primary[400],
                      fontSize: 16,
                      fontFamily: "DMSans_700Bold",
                    }}
                  >
                    {numAmount.toFixed(fromDecimals)} {fromCurrency}
                  </Text>
                </View>
              </View>
            </GlassCard>

            {/* Rate staleness warning */}
            {(fromRate?.rate_stale || toRate?.rate_stale) && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 10,
                  marginBottom: 16,
                  paddingHorizontal: 4,
                }}
              >
                <Ionicons
                  name="warning-outline"
                  size={18}
                  color={colors.warning}
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
                  Exchange rates may be slightly outdated. The final rate will
                  be confirmed at execution.
                </Text>
              </View>
            )}

            <Button
              title="Confirm Swap"
              onPress={handleConfirmReview}
              size="lg"
              icon={
                <Ionicons
                  name="shield-checkmark-outline"
                  size={20}
                  color="#FFFFFF"
                />
              }
              style={{ maxWidth: isDesktop ? 420 : undefined }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Form Step (main) ──
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={
            isDesktop
              ? { alignItems: "center", paddingVertical: 32 }
              : undefined
          }
        >
          {/* Desktop back button */}
          {isDesktop && (
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
                marginBottom: 12,
                opacity: pressed ? 0.85 : 1,
                cursor: "pointer",
                transition: "all 0.15s ease",
              } as any)}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons
                name="arrow-back"
                size={20}
                color={tc.textSecondary}
              />
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
          )}

          {/* Desktop wrapper card */}
          <View
            style={
              isDesktop
                ? {
                    width: "100%",
                    maxWidth: 600,
                    backgroundColor: tc.dark.card,
                    borderRadius: 20,
                    padding: 36,
                    borderWidth: 1,
                    borderColor: tc.dark.border,
                    ...ts.md,
                  }
                : { flex: 1 }
            }
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: isDesktop ? 0 : 16,
                paddingVertical: 12,
                marginBottom: isDesktop ? 16 : 4,
              }}
            >
              <Pressable
                onPress={() => {
                  if (router.canGoBack()) router.back();
                  else router.replace("/(tabs)" as any);
                }}
                hitSlop={12}
                style={({ pressed, hovered }: any) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  backgroundColor:
                    isWeb && hovered ? tc.dark.elevated : tc.dark.card,
                  borderColor:
                    isWeb && hovered
                      ? tc.glass.borderStrong
                      : tc.glass.border,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  opacity: pressed ? 0.85 : 1,
                  ...(isWeb
                    ? ({
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      } as any)
                    : {}),
                })}
              >
                <Ionicons
                  name="arrow-back"
                  size={20}
                  color={tc.textPrimary}
                />
              </Pressable>

              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isDesktop ? 24 : 20,
                  fontFamily: "DMSans_700Bold",
                  marginLeft: 14,
                  flex: 1,
                  letterSpacing: -0.3,
                }}
              >
                Swap Crypto
              </Text>

              <PaymentStepper currentStep={0} />
            </View>

            <View
              style={{
                paddingHorizontal: isDesktop ? 0 : 20,
                marginTop: isDesktop ? 0 : 8,
              }}
            >
              {/* ── FROM Currency ── */}
              <SectionHeader
                title="From"
                icon="arrow-up-circle-outline"
                iconColor={colors.primary[400]}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, marginBottom: 16 }}
              >
                {CRYPTO_OPTIONS.filter((c) => c !== toCurrency).map((opt) => (
                  <CurrencyPill
                    key={`from-${opt}`}
                    currency={opt}
                    selected={fromCurrency === opt}
                    onPress={() => {
                      setFromCurrency(opt);
                      setAmount("");
                    }}
                    showBalance
                  />
                ))}
              </ScrollView>

              {/* Balance display */}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                  paddingHorizontal: 4,
                }}
              >
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 13,
                    fontFamily: "DMSans_500Medium",
                  }}
                >
                  Available: {availableBalance.toFixed(fromDecimals)}{" "}
                  {fromCurrency}
                </Text>
                <Pressable
                  onPress={handleMaxAmount}
                  style={({ pressed }) => ({
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 8,
                    backgroundColor: colors.primary[500] + "15",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text
                    style={{
                      color: colors.primary[400],
                      fontSize: 12,
                      fontFamily: "DMSans_700Bold",
                    }}
                  >
                    MAX
                  </Text>
                </Pressable>
              </View>

              {/* Amount Input */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: inputBorderColor("amount"),
                  paddingHorizontal: 16,
                  marginBottom: 20,
                  ...inputFocusGlow("amount"),
                }}
              >
                <CryptoLogo currency={fromCurrency} size={24} />
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor={tc.textMuted}
                  keyboardType="decimal-pad"
                  onFocus={() => setFocusedField("amount")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 20,
                    fontFamily: "DMSans_700Bold",
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    ...(isWeb
                      ? ({ outlineStyle: "none" } as any)
                      : {}),
                  }}
                />
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 16,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  {fromCurrency}
                </Text>
              </View>

              {/* ── Flip Button ── */}
              <View
                style={{
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <Pressable
                  onPress={handleFlipCurrencies}
                  style={({ pressed, hovered }: any) => ({
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: hovered
                      ? colors.primary[500] + "30"
                      : colors.primary[500] + "18",
                    borderWidth: 2,
                    borderColor: colors.primary[400] + "40",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.8 : 1,
                    ...(isWeb
                      ? ({
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                        } as any)
                      : {}),
                  })}
                >
                  <Ionicons
                    name="swap-vertical"
                    size={24}
                    color={colors.primary[400]}
                  />
                </Pressable>
              </View>

              {/* ── TO Currency ── */}
              <SectionHeader
                title="To"
                icon="arrow-down-circle-outline"
                iconColor={colors.success}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, marginBottom: 16 }}
              >
                {CRYPTO_OPTIONS.filter((c) => c !== fromCurrency).map(
                  (opt) => (
                    <CurrencyPill
                      key={`to-${opt}`}
                      currency={opt}
                      selected={toCurrency === opt}
                      onPress={() => setToCurrency(opt)}
                    />
                  )
                )}
              </ScrollView>

              {/* ── Conversion Preview ── */}
              <GlassCard
                style={{ marginBottom: 24 }}
                glowOpacity={0.08}
              >
                <View style={{ padding: 16, gap: 12 }}>
                  {/* You will receive */}
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 13,
                        fontFamily: "DMSans_500Medium",
                      }}
                    >
                      You will receive
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <CryptoLogo currency={toCurrency} size={20} />
                      <Text
                        style={{
                          color: destAmount > 0 ? colors.success : tc.textMuted,
                          fontSize: 18,
                          fontFamily: "DMSans_700Bold",
                        }}
                      >
                        {destAmount > 0
                          ? destAmount.toFixed(toDecimals)
                          : "0.00"}{" "}
                        {toCurrency}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={{
                      height: 1,
                      backgroundColor: tc.dark.border,
                    }}
                  />

                  {/* Exchange rate */}
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                      }}
                    >
                      Rate
                    </Text>
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontSize: 12,
                        fontFamily: "DMSans_500Medium",
                      }}
                    >
                      {ratesLoading
                        ? "Loading..."
                        : crossRate > 0
                          ? `1 ${fromCurrency} = ${crossRate.toFixed(toDecimals)} ${toCurrency}`
                          : "--"}
                    </Text>
                  </View>

                  {/* Fee */}
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                      }}
                    >
                      Fee ({SWAP_FEE_PERCENT}%)
                    </Text>
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontSize: 12,
                        fontFamily: "DMSans_500Medium",
                      }}
                    >
                      {feeAmount > 0
                        ? `${feeAmount.toFixed(fromDecimals)} ${fromCurrency}`
                        : "--"}
                    </Text>
                  </View>

                  {/* Current balance in dest */}
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                      }}
                    >
                      Current {toCurrency} balance
                    </Text>
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontSize: 12,
                        fontFamily: "DMSans_500Medium",
                      }}
                    >
                      {toBalance.toFixed(toDecimals)}
                    </Text>
                  </View>
                </View>
              </GlassCard>

              {/* Swap Button */}
              <Button
                title="Review Swap"
                onPress={handleReview}
                size="lg"
                disabled={numAmount <= 0 || ratesLoading || !fromRate || !toRate}
                icon={
                  <Ionicons
                    name="swap-horizontal-outline"
                    size={20}
                    color="#FFFFFF"
                  />
                }
                style={{
                  maxWidth: isDesktop ? 420 : undefined,
                  marginBottom: 32,
                }}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
