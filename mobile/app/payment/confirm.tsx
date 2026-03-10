import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, Pressable, Animated, Easing, Platform, useWindowDimensions, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { paymentsApi } from "../../src/api/payments";
import { normalizeError } from "../../src/utils/apiErrors";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { CURRENCIES, CurrencyCode, colors } from "../../src/constants/theme";
import { getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

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
        // Haptic warning at 10 seconds left
        if (prev === 11 && Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: isCritical
          ? colors.error + "18"
          : isUrgent
            ? colors.warning + "15"
            : colors.primary[500] + "12",
      }}
    >
      <Ionicons
        name="timer-outline"
        size={16}
        color={isCritical ? colors.error : isUrgent ? colors.warning : colors.primary[400]}
      />
      <Text
        style={{
          color: isCritical ? colors.error : isUrgent ? colors.warning : colors.primary[400],
          fontSize: 13,
          fontFamily: "Inter_600SemiBold",
        }}
      >
        Rate locked — {display}
      </Text>
      {/* Progress bar */}
      <View
        style={{
          flex: 1,
          maxWidth: 60,
          height: 3,
          borderRadius: 2,
          backgroundColor: tc.dark.elevated,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            borderRadius: 2,
            backgroundColor: isCritical ? colors.error : isUrgent ? colors.warning : colors.primary[400],
          }}
        />
      </View>
    </View>
  );
}

export default function ConfirmPaymentScreen() {
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

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
  }>();

  const [step, setStep] = useState<"review" | "pin">("review");
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [quoteExpired, setQuoteExpired] = useState(false);

  useScreenSecurity(step === "pin");

  const handleQuoteExpired = useCallback(() => {
    setQuoteExpired(true);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    toast.error("Quote Expired", "The rate lock has expired. Please get a new quote.");
  }, [toast]);

  const handleConfirm = () => {
    if (quoteExpired) return;
    setStep("pin");
  };

  const handlePinComplete = async (pin: string) => {
    if (quoteExpired) return;
    setLoading(true);
    setPinError(false);

    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      if (params.type === "paybill") {
        await paymentsApi.payBill({
          paybill: params.paybill_number!,
          account: params.account_number!,
          pin,
          idempotency_key: idempotencyKey,
          quote_id: params.quote_id,
        });
      } else if (params.type === "till") {
        await paymentsApi.payTill({
          till: params.till_number!,
          pin,
          idempotency_key: idempotencyKey,
          quote_id: params.quote_id,
        });
      } else if (params.type === "send") {
        await paymentsApi.sendMpesa({
          phone: params.phone!,
          amount_kes: params.amount_kes,
          crypto_currency: params.crypto_currency,
          pin,
          idempotency_key: idempotencyKey,
          quote_id: params.quote_id,
        });
      }

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.replace({
        pathname: "/payment/success",
        params: {
          amount_kes: params.amount_kes,
          crypto_amount: params.crypto_amount,
          crypto_currency: params.crypto_currency,
          recipient: params.paybill_number || params.till_number || params.phone || "",
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

  const isPaybill = params.type === "paybill";
  const isSend = params.type === "send";
  const amountKES = parseFloat(params.amount_kes);
  const recipientLabel = isPaybill ? "Paybill" : isSend ? "Phone Number" : "Till Number";
  const recipientValue = isPaybill
    ? params.paybill_number
    : isSend
      ? params.phone
      : params.till_number;
  const typeIcon = isPaybill
    ? "receipt-outline"
    : isSend
      ? "phone-portrait-outline"
      : "cart-outline";
  const typeColor = isPaybill
    ? tc.primary[500]
    : isSend
      ? "#F59E0B"
      : tc.accent;
  const typeLabel = isPaybill ? "Pay Bill" : isSend ? "Send to M-Pesa" : "Buy Goods";

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
            fontFamily: "Inter_600SemiBold",
            marginLeft: 14,
            flex: 1,
          }}
          maxFontSizeMultiplier={1.3}
        >
          {step === "review" ? "Confirm Payment" : "Enter PIN"}
        </Text>

        {/* Step indicator pills — step 2 of 2, both filled */}
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View
            style={{
              width: 24,
              height: 4,
              borderRadius: 2,
              backgroundColor: tc.primary[500],
            }}
          />
          <View
            style={{
              width: 24,
              height: 4,
              borderRadius: 2,
              backgroundColor: tc.primary[500],
            }}
          />
        </View>
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
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              marginTop: isDesktop ? 0 : 12,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...(isWeb ? { boxShadow: '0 8px 32px rgba(0,0,0,0.3)' } as any : {}),
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
                  fontFamily: "Inter_500Medium",
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
                  fontFamily: "Inter_700Bold",
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
                    fontFamily: "Inter_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {recipientLabel}
                </Text>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 14,
                    fontFamily: "Inter_600SemiBold",
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
                      fontFamily: "Inter_400Regular",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Account
                  </Text>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 14,
                      fontFamily: "Inter_600SemiBold",
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
                    fontFamily: "Inter_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Paying with
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
                      fontFamily: "Inter_600SemiBold",
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
                    fontFamily: "Inter_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Rate
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "Inter_500Medium",
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
                    fontFamily: "Inter_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Fee
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "Inter_500Medium",
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
                      fontFamily: "Inter_400Regular",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Excise Duty (10%)
                  </Text>
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 14,
                      fontFamily: "Inter_500Medium",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    KSh {parseFloat(params.excise_duty).toLocaleString()}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Pay Now / Expired Button */}
          <View style={{ marginTop: 24, marginBottom: isDesktop ? 8 : 32 }}>
            {quoteExpired ? (
              <Button
                title="Get New Quote"
                onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)" as any); }}
                size="lg"
                variant="outline"
                testID="new-quote-button"
              />
            ) : (
              <Button
                title="Pay Now"
                onPress={handleConfirm}
                size="lg"
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
                fontFamily: "Inter_400Regular",
              }}
            >
              Secured by end-to-end encryption
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
                fontFamily: "Inter_700Bold",
                textAlign: "center",
                marginBottom: 8,
              }}
              maxFontSizeMultiplier={1.3}
            >
              Enter your PIN
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                fontFamily: "Inter_400Regular",
                textAlign: "center",
                marginBottom: 8,
                lineHeight: 20,
              }}
              maxFontSizeMultiplier={1.3}
            >
              Confirm payment of
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
                  fontFamily: "Inter_700Bold",
                }}
              >
                KSh {amountKES.toLocaleString()}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={tc.textMuted} />
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 15,
                  fontFamily: "Inter_500Medium",
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
                    fontFamily: "Inter_600SemiBold",
                    textAlign: "center",
                  }}
                >
                  Quote expired
                </Text>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 14,
                    fontFamily: "Inter_400Regular",
                    textAlign: "center",
                  }}
                >
                  The exchange rate has changed. Please go back and get a new quote.
                </Text>
                <Button
                  title="Get New Quote"
                  onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)" as any); }}
                  size="lg"
                  variant="outline"
                  style={{ marginTop: 8, width: "100%" }}
                />
              </View>
            ) : (
              <PinInput onComplete={handlePinComplete} error={pinError} testID="confirm-pin-input" />
            )}

            {loading && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  marginTop: 32,
                }}
              >
                <PulsingDot />
                <Text
                  style={{
                    color: tc.primary[400],
                    fontSize: 14,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  Processing payment...
                </Text>
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
                  fontFamily: "Inter_400Regular",
                }}
              >
                Your PIN is never stored or shared
              </Text>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
