import { useState } from "react";
import { View, Text, Pressable, Animated, Easing, Platform, useWindowDimensions, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { paymentsApi } from "../../src/api/payments";
import { normalizeError } from "../../src/utils/apiErrors";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { CURRENCIES, CurrencyCode, colors, shadows } from "../../src/constants/theme";

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

export default function ConfirmPaymentScreen() {
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;

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
  }>();

  const [step, setStep] = useState<"review" | "pin">("review");
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);

  useScreenSecurity(step === "pin");

  const handleConfirm = () => {
    setStep("pin");
  };

  const handlePinComplete = async (pin: string) => {
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
    ? colors.primary[500]
    : isSend
      ? "#F59E0B"
      : colors.accent;
  const typeLabel = isPaybill ? "Pay Bill" : isSend ? "Send to M-Pesa" : "Buy Goods";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
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
          onPress={() => (step === "pin" ? setStep("review") : router.back())}
          hitSlop={12}
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            backgroundColor: colors.dark.card,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: colors.glass.border,
          }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="back-button"
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 18,
            fontFamily: "Inter_600SemiBold",
            marginLeft: 14,
            flex: 1,
          }}
          maxFontSizeMultiplier={1.3}
        >
          {step === "review" ? "Confirm Payment" : "Enter PIN"}
        </Text>

        {/* Step indicator pills */}
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View
            style={{
              width: 24,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.primary[500],
            }}
          />
          <View
            style={{
              width: 24,
              height: 4,
              borderRadius: 2,
              backgroundColor:
                step === "pin" ? colors.primary[500] : colors.dark.elevated,
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
          {/* Premium Receipt Card */}
          <View
            style={{
              backgroundColor: colors.dark.card,
              borderRadius: 24,
              marginTop: isDesktop ? 0 : 12,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: colors.glass.border,
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
                  color: colors.textMuted,
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
                  color: colors.textPrimary,
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
                borderBottomColor: colors.dark.border + "40",
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
                    color: colors.textMuted,
                    fontSize: 14,
                    fontFamily: "Inter_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {recipientLabel}
                </Text>
                <Text
                  style={{
                    color: colors.textPrimary,
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
                      color: colors.textMuted,
                      fontSize: 14,
                      fontFamily: "Inter_400Regular",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Account
                  </Text>
                  <Text
                    style={{
                      color: colors.textPrimary,
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
                  borderBottomColor: colors.dark.border + "30",
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
                    color: colors.textMuted,
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
                    backgroundColor: colors.primary[500] + "1A",
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                  }}
                >
                  <Text
                    style={{
                      color: colors.primary[400],
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
                    color: colors.textMuted,
                    fontSize: 14,
                    fontFamily: "Inter_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Rate
                </Text>
                <Text
                  style={{
                    color: colors.textSecondary,
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
                    color: colors.textMuted,
                    fontSize: 14,
                    fontFamily: "Inter_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Fee
                </Text>
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: 14,
                    fontFamily: "Inter_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  KSh {parseFloat(params.fee).toLocaleString()}
                </Text>
              </View>
            </View>
          </View>

          {/* Pay Now Button */}
          <View style={{ marginTop: 24, marginBottom: isDesktop ? 8 : 32 }}>
            <Button
              title="Pay Now"
              onPress={handleConfirm}
              size="lg"
              testID="pay-now-button"
              style={{
                ...shadows.glow(colors.primary[500], 0.35),
              }}
            />
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
            <Ionicons name="shield-checkmark" size={14} color={colors.primary[400]} />
            <Text
              style={{
                color: colors.textMuted,
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
              backgroundColor: colors.dark.card,
              borderRadius: 28,
              padding: 40,
              borderWidth: 1,
              borderColor: colors.glass.border,
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
                  backgroundColor: colors.primary[500] + "1A",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1.5,
                  borderColor: colors.primary[500] + "25",
                }}
              >
                <Ionicons name="lock-closed" size={30} color={colors.primary[400]} />
              </View>
            </View>

            <Text
              style={{
                color: colors.textPrimary,
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
                color: colors.textMuted,
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
                backgroundColor: isDesktop ? colors.dark.elevated : colors.dark.card,
                borderRadius: 16,
                paddingHorizontal: 20,
                paddingVertical: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginBottom: 36,
                borderWidth: 1,
                borderColor: colors.glass.border,
              }}
            >
              <Text
                style={{
                  color: colors.textPrimary,
                  fontSize: 17,
                  fontFamily: "Inter_700Bold",
                }}
              >
                KSh {amountKES.toLocaleString()}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 15,
                  fontFamily: "Inter_500Medium",
                }}
              >
                {recipientValue}
              </Text>
            </View>

            <PinInput onComplete={handlePinComplete} error={pinError} testID="confirm-pin-input" />

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
                    color: colors.primary[400],
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
              <Ionicons name="shield-checkmark" size={14} color={colors.textMuted} />
              <Text
                style={{
                  color: colors.textMuted,
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
