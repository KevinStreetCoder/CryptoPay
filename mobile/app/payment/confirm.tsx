import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, Pressable, Animated, Easing, Platform, useWindowDimensions, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Svg, { Circle } from "react-native-svg";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { GlassCard } from "../../src/components/GlassCard";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { useQueryClient } from "@tanstack/react-query";
import { paymentsApi } from "../../src/api/payments";
import { normalizeError } from "../../src/utils/apiErrors";
import { recordBankUse } from "../../src/utils/bankPrefs";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { useTransactionPoller } from "../../src/hooks/useTransactionPoller";
import { useBiometricAuth } from "../../src/hooks/useBiometricAuth";
import { isBiometricEnabled } from "../../src/stores/auth";
import { CURRENCIES, CurrencyCode, colors } from "../../src/constants/theme";
import { getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";

function PulsingDot() {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== "web",
        }),
      ])
    ).start();
  }, [pulse]);

  return (
    <Animated.View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.primary[400],
        opacity: pulse,
      }}
    />
  );
}

const QUOTE_TTL_SECONDS = 90;

function QuoteCountdown({ onExpired }: { onExpired: () => void }) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const [secondsLeft, setSecondsLeft] = useState(QUOTE_TTL_SECONDS);
  const hasExpired = useRef(false);
  const flashOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (!hasExpired.current) {
            hasExpired.current = true;
            onExpired();
          }
          return 0;
        }
        // Per-second haptic tick (light) in last 30 seconds
        if (prev <= 31 && Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        // Stronger haptic warning at 10 seconds left
        if (prev <= 11 && Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
        // Red flash at 10s
        if (prev === 11) {
          Animated.sequence([
            Animated.timing(flashOpacity, { toValue: 0.6, duration: 150, useNativeDriver: Platform.OS !== "web" }),
            Animated.timing(flashOpacity, { toValue: 0, duration: 300, useNativeDriver: Platform.OS !== "web" }),
          ]).start();
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [onExpired]);

  const isUrgent = secondsLeft <= 15;
  const isCritical = secondsLeft <= 10;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const display = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const progress = secondsLeft / QUOTE_TTL_SECONDS;

  const ringColor = isCritical ? colors.error : isUrgent ? colors.warning : colors.primary[400];
  const ringSize = 64;
  const strokeWidth = 4;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <View style={{ alignItems: "center", gap: 8 }}>
      {/* Red flash overlay */}
      <Animated.View
        style={{
          position: "absolute",
          top: -20,
          left: -20,
          right: -20,
          bottom: -20,
          backgroundColor: colors.error,
          opacity: flashOpacity,
          pointerEvents: "none",
          borderRadius: 24,
          zIndex: 10,
        }}
      />

      {/* Circular timer ring */}
      <View style={{ width: ringSize, height: ringSize, alignItems: "center", justifyContent: "center" }}>
        <View style={{ position: "absolute" }}>
          <Svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`}>
            {/* Background ring */}
            <Circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke={tc.dark.elevated}
              strokeWidth={strokeWidth}
            />
            {/* Progress ring */}
            <Circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke={ringColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${circumference}`}
              strokeDashoffset={strokeDashoffset}
              transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
            />
          </Svg>
        </View>
        <Text
          style={{
            color: ringColor,
            fontSize: 16,
            fontFamily: "DMSans_700Bold",
            letterSpacing: 0.5,
          }}
        >
          {display}
        </Text>
      </View>

      {/* Label */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 4,
          paddingHorizontal: 12,
          borderRadius: 10,
          backgroundColor: isCritical ? colors.error + "15" : isUrgent ? colors.warning + "12" : colors.primary[500] + "10",
        }}
      >
        <PulsingDot />
        <Text
          style={{
            color: isCritical ? colors.error : isUrgent ? colors.warning : colors.primary[400],
            fontSize: 12,
            fontFamily: "DMSans_500Medium",
          }}
        >
          {isCritical ? "Quote expiring!" : isUrgent ? "Rate expiring soon" : "Rate locked"}
        </Text>
      </View>
    </View>
  );
}

export default function ConfirmPaymentScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const { t } = useLocale();
  const [backHovered, setBackHovered] = useState(false);

  const params = useLocalSearchParams<{
    type: string;
    paybill_number?: string;
    account_number?: string;
    till_number?: string;
    phone?: string;
    amount_kes: string;
    crypto_currency: string;
    quote_id: string;
    crypto_amount: string;
    rate: string;
    fee: string;
    excise_duty?: string;
    // Pochi flag forwarded from /payment/send?context=pochi.
    context?: string;
    // Send-to-Bank fields · forwarded from /payment/send-to-bank.
    bank_slug?: string;
    bank_name?: string;
  }>();

  const [step, setStep] = useState<"review" | "pin">("review");
  const [loading, setLoading] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);
  const { pollTransaction, cancel: cancelPoll } = useTransactionPoller();
  const [pinError, setPinError] = useState(false);
  const [quoteExpired, setQuoteExpired] = useState(false);
  const biometric = useBiometricAuth();
  const [biometricOn, setBiometricOn] = useState(false);

  useScreenSecurity(step === "pin");

  // Check biometric setting
  useEffect(() => {
    isBiometricEnabled().then(setBiometricOn);
  }, []);

  const handleQuoteExpired = useCallback(() => {
    setQuoteExpired(true);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    toast.error("Quote Expired", "The rate lock has expired. Please get a new quote.");
  }, [toast]);

  const handleConfirm = async () => {
    if (quoteExpired) return;

    // If biometric is enabled, try biometric auth first
    if (biometricOn && biometric.isAvailable && Platform.OS !== "web") {
      const success = await biometric.authenticate("Authorize Payment");
      if (success) {
        // Biometric approved · use a special PIN bypass marker
        // The backend still requires PIN, so fall through to PIN entry
        setStep("pin");
        return;
      }
    }

    setStep("pin");
  };

  const handlePinComplete = async (pin: string) => {
    if (quoteExpired) return;
    setLoading(true);
    setPinError(false);

    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      let txResponse: any;
      if (params.type === "paybill") {
        txResponse = await paymentsApi.payBill({
          paybill: params.paybill_number!,
          account: params.account_number!,
          pin,
          idempotency_key: idempotencyKey,
          quote_id: params.quote_id,
        });
      } else if (params.type === "till") {
        txResponse = await paymentsApi.payTill({
          till: params.till_number!,
          pin,
          idempotency_key: idempotencyKey,
          quote_id: params.quote_id,
        });
      } else if (params.type === "send") {
        txResponse = await paymentsApi.sendMpesa({
          phone: params.phone!,
          amount_kes: params.amount_kes,
          crypto_currency: params.crypto_currency,
          pin,
          idempotency_key: idempotencyKey,
          quote_id: params.quote_id,
          ...(params.context === "pochi" ? { context: "pochi" as const } : {}),
        });
      } else if (params.type === "bank") {
        txResponse = await paymentsApi.sendToBank({
          bank_slug: params.bank_slug!,
          account_number: params.account_number!,
          pin,
          idempotency_key: idempotencyKey,
          quote_id: params.quote_id,
        });
      }

      const txData = txResponse?.data;
      const transactionId = txData?.id || "";

      // Poll for backend confirmation before showing success
      setPollingStatus("confirming");

      const { status: finalStatus } = await pollTransaction(
        transactionId,
        (s) => setPollingStatus(s)
      );

      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });

      if (finalStatus === "failed") {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        toast.error("Payment Failed", "The transaction was not completed. Please try again.");
        setPollingStatus(null);
        setStep("review");
        return;
      }

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // Track bank usage so the picker's "Frequent" section reflects
      // real behaviour. Fire-and-forget · the storage write never
      // blocks the success-screen transition.
      if (params.type === "bank" && params.bank_slug) {
        void recordBankUse(params.bank_slug);
      }
      router.replace({
        pathname: "/payment/success",
        params: {
          amount_kes: params.amount_kes,
          crypto_amount: params.crypto_amount,
          crypto_currency: params.crypto_currency,
          recipient: params.paybill_number || params.till_number || params.phone || "",
          transaction_id: transactionId,
          tx_status: finalStatus,
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
      setLoading(false);
    }
  };

  // C1 audit fix · add the `bank` branch alongside paybill / send / till.
  // Without this, Send-to-Bank users used to land on the till-styled
  // confirm screen with cart icon, "Pay Till" copy, and an undefined
  // `recipientValue` (because send-to-bank.tsx forwards `account_number`,
  // not `till_number`).
  const isPaybill = params.type === "paybill";
  const isSend = params.type === "send";
  const isBank = params.type === "bank";
  const amountKES = parseFloat(params.amount_kes);
  const recipientLabel = isPaybill
    ? t("payment.paybillNumber")
    : isSend
      ? t("payment.phoneNumber")
      : isBank
        ? `${t("payment.bankAccount")}${params.bank_name ? ` · ${params.bank_name}` : ""}`
        : t("payment.tillNumber");
  const recipientValue = isPaybill
    ? params.paybill_number
    : isSend
      ? params.phone
      : isBank
        ? params.account_number
        : params.till_number;
  const typeIcon = isPaybill
    ? "receipt-outline"
    : isSend
      ? "phone-portrait-outline"
      : isBank
        ? "business-outline"
        : "cart-outline";
  const typeColor = isPaybill
    ? tc.primary[500]
    : isSend
      ? "#F59E0B"
      : isBank
        ? "#0EA5E9"
        : tc.accent;
  const typeLabel = isPaybill
    ? t("payment.payBill")
    : isSend
      ? t("payment.sendToMpesa")
      : isBank
        ? t("payment.sendToBank")
        : t("payment.payTill");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: isDesktop ? 28 : 20,
          paddingVertical: 14,
          maxWidth: isDesktop ? 640 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
        }}
      >
        <Pressable
          onPress={() => { if (step === "pin") setStep("review"); else if (router.canGoBack()) router.back(); else router.replace("/(tabs)" as any); }}
          onHoverIn={() => setBackHovered(true)}
          onHoverOut={() => setBackHovered(false)}
          hitSlop={12}
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            backgroundColor: backHovered ? tc.dark.elevated : tc.dark.card,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="back-button"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
        </Pressable>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 18,
            fontFamily: "DMSans_600SemiBold",
            marginLeft: 14,
            flex: 1,
          }}
          maxFontSizeMultiplier={1.3}
        >
          {step === "review" ? t("payment.confirmPayment") : t("payment.enterYourPin")}
        </Text>

        {/* Step indicator */}
        <PaymentStepper currentStep={step === "review" ? 1 : 1} />
      </View>

      {step === "review" ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: isDesktop ? 28 : 20,
            maxWidth: isDesktop ? 560 : undefined,
            alignSelf: isDesktop ? "center" : undefined,
            width: isDesktop ? "100%" : undefined,
            flexGrow: 1,
            justifyContent: isDesktop ? "center" : undefined,
            paddingVertical: isDesktop ? 24 : 0,
          }}
        >
          {/* Quote countdown timer */}
          <QuoteCountdown onExpired={handleQuoteExpired} />
          <View style={{ height: 16 }} />

          {/* Premium Receipt Card */}
          <GlassCard
            glowColor={typeColor}
            glowOpacity={0.2}
            style={{
              marginTop: isDesktop ? 0 : 12,
            }}
          >
            {/* Top section: icon + amount */}
            <View
              style={{
                alignItems: "center",
                paddingTop: 28,
                paddingBottom: 24,
                paddingHorizontal: 24,
              }}
              accessibilityRole="summary"
              accessibilityLabel={`Payment of ${amountKES.toLocaleString()} KES to ${isPaybill ? `Paybill ${params.paybill_number}` : `Till ${params.till_number}`}`}
              testID="payment-summary"
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 20,
                  backgroundColor: typeColor + "18",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                  borderWidth: 1.5,
                  borderColor: typeColor + "30",
                }}
              >
                <Ionicons
                  name={typeIcon as any}
                  size={28}
                  color={typeColor}
                />
              </View>

              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_500Medium",
                  marginBottom: 10,
                  textTransform: "uppercase",
                  letterSpacing: 1.2,
                }}
                maxFontSizeMultiplier={1.3}
              >
                {typeLabel}
              </Text>

              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 38,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -1,
                }}
                maxFontSizeMultiplier={1.2}
                accessibilityLabel={`Amount: ${amountKES.toLocaleString()} Kenyan Shillings`}
              >
                KSh {amountKES.toLocaleString()}
              </Text>
            </View>

            {/* Dashed divider */}
            <View
              style={{
                borderBottomWidth: 1.5,
                borderBottomColor: tc.dark.border + "40",
                borderStyle: "dashed",
                marginHorizontal: 20,
              }}
            />

            {/* Details section */}
            <View style={{ padding: 24, gap: 18 }}>
              {/* Recipient */}
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
                    fontSize: 14,
                    fontFamily: "DMSans_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {recipientLabel}
                </Text>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 14,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {recipientValue}
                </Text>
              </View>

              {isPaybill && params.account_number && (
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
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {t("payment.account")}
                  </Text>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 14,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {params.account_number}
                  </Text>
                </View>
              )}

              {/* Separator */}
              <View
                style={{
                  borderBottomWidth: 1,
                  borderBottomColor: tc.dark.border + "30",
                  borderStyle: "dashed",
                }}
              />

              {/* Paying with - green pill */}
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
                    fontSize: 14,
                    fontFamily: "DMSans_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {t("payment.payingWith")}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: tc.primary[500] + "1A",
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                  }}
                >
                  <Text
                    style={{
                      color: tc.primary[400],
                      fontSize: 14,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {params.crypto_amount} {params.crypto_currency}
                  </Text>
                </View>
              </View>

              {/* Rate */}
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
                    fontSize: 14,
                    fontFamily: "DMSans_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {t("payment.rate")}
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  1 {params.crypto_currency} = KSh{" "}
                  {parseFloat(params.rate).toLocaleString()}
                </Text>
              </View>

              {/* Fee */}
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
                    fontSize: 14,
                    fontFamily: "DMSans_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {t("payment.fee")}
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  KSh {parseFloat(params.fee).toLocaleString()}
                </Text>
              </View>

              {/* Excise Duty (VASP Act 2025) */}
              {params.excise_duty && parseFloat(params.excise_duty) > 0 && (
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
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {t("payment.exciseDuty")}
                  </Text>
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    KSh {parseFloat(params.excise_duty).toLocaleString()}
                  </Text>
                </View>
              )}
            </View>
          </GlassCard>

          {/* Pay Now / Expired Button */}
          <View style={{ marginTop: 24, marginBottom: isDesktop ? 8 : 32, maxWidth: isDesktop ? 420 : undefined, alignSelf: isDesktop ? "center" : undefined, width: isDesktop ? "100%" : undefined }}>
            {quoteExpired ? (
              <Button
                title={t("payment.getNewQuote")}
                onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)" as any); }}
                size="lg"
                variant="outline"
                icon={<Ionicons name="refresh-outline" size={20} color={colors.primary[400]} />}
                testID="new-quote-button"
              />
            ) : (
              <Button
                title={t("payment.payNow")}
                onPress={handleConfirm}
                size="lg"
                icon={<Ionicons name="send-outline" size={20} color="#FFFFFF" />}
                testID="pay-now-button"
                style={{
                  ...ts.glow(tc.primary[500], 0.35),
                }}
              />
            )}
          </View>

          {/* Security note */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginBottom: isDesktop ? 0 : 16,
            }}
          >
            <Ionicons name="shield-checkmark" size={14} color={tc.primary[400]} />
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

          {!isDesktop && <View style={{ flex: 1 }} />}
        </ScrollView>
      ) : (
        /* PIN Entry Step */
        <View
          style={{
            flex: 1,
            paddingHorizontal: isDesktop ? 28 : 20,
            maxWidth: isDesktop ? 480 : undefined,
            alignSelf: isDesktop ? "center" : undefined,
            width: isDesktop ? "100%" : undefined,
            justifyContent: isDesktop ? "center" : undefined,
          }}
        >
          {/* PIN card wrapper for desktop */}
          <View
            style={isDesktop ? {
              backgroundColor: tc.dark.card,
              borderRadius: 28,
              padding: 40,
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...(isWeb ? { boxShadow: '0 8px 32px rgba(0,0,0,0.3)' } as any : {}),
            } : { paddingTop: 40 }}
          >
            {/* Lock icon */}
            <View style={{ alignItems: "center", marginBottom: 24 }}>
              <View
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: 20,
                  backgroundColor: tc.primary[500] + "1A",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1.5,
                  borderColor: tc.primary[500] + "25",
                }}
              >
                <Ionicons name="lock-closed" size={30} color={tc.primary[400]} />
              </View>
            </View>

            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 22,
                fontFamily: "DMSans_700Bold",
                textAlign: "center",
                marginBottom: 8,
              }}
              maxFontSizeMultiplier={1.3}
            >
              {t("payment.enterYourPin")}
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
                marginBottom: 8,
                lineHeight: 20,
              }}
              maxFontSizeMultiplier={1.3}
            >
              {t("payment.confirmPaymentOf")}
            </Text>

            {/* Amount badge - glass card pill */}
            <View
              style={{
                alignSelf: "center",
                backgroundColor: isDesktop ? tc.dark.elevated : tc.dark.card,
                borderRadius: 16,
                paddingHorizontal: 20,
                paddingVertical: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginBottom: 36,
                borderWidth: 1,
                borderColor: tc.glass.border,
              }}
            >
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 17,
                  fontFamily: "DMSans_700Bold",
                }}
              >
                KSh {amountKES.toLocaleString()}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={tc.textMuted} />
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 15,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                {recipientValue}
              </Text>
            </View>

            {quoteExpired ? (
              <View style={{ alignItems: "center", gap: 16 }}>
                <Ionicons name="time-outline" size={40} color={tc.error} />
                <Text
                  style={{
                    color: tc.error,
                    fontSize: 16,
                    fontFamily: "DMSans_600SemiBold",
                    textAlign: "center",
                  }}
                >
                  {t("payment.quoteExpired")}
                </Text>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 14,
                    fontFamily: "DMSans_400Regular",
                    textAlign: "center",
                  }}
                >
                  {t("payment.quoteExpiredMessage")}
                </Text>
                <Button
                  title={t("payment.getNewQuote")}
                  onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)" as any); }}
                  size="lg"
                  variant="outline"
                  icon={<Ionicons name="refresh-outline" size={20} color={colors.primary[400]} />}
                  style={{ marginTop: 8, width: "100%" }}
                />
              </View>
            ) : (
              <PinInput onComplete={handlePinComplete} error={pinError} loading={loading} testID="confirm-pin-input" />
            )}

            {loading && (
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  marginTop: 32,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <PulsingDot />
                  <Text
                    style={{
                      color: tc.primary[400],
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    {pollingStatus === "confirming"
                      ? t("payment.waitingMpesaConfirmation")
                      : pollingStatus === "processing"
                        ? t("payment.processingPayment")
                        : t("payment.processingPayment")}
                  </Text>
                </View>
                {pollingStatus && (
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_400Regular",
                      textAlign: "center",
                      marginTop: 4,
                    }}
                  >
                    {t("payment.completeMpesaPrompt")}
                  </Text>
                )}
              </View>
            )}

            {/* Security footer */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                marginTop: 32,
                opacity: 0.6,
              }}
            >
              <Ionicons name="shield-checkmark" size={14} color={tc.textMuted} />
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                }}
              >
                {t("payment.pinNeverStored")}
              </Text>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
