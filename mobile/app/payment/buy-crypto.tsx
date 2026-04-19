import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Animated,
  Easing,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CryptoLogo } from "../../src/components/CryptoLogo";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { paymentsApi } from "../../src/api/payments";
import { ratesApi, Quote } from "../../src/api/rates";
import { normalizeError } from "../../src/utils/apiErrors";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { useTransactionPoller } from "../../src/hooks/useTransactionPoller";
import { useAuth } from "../../src/stores/auth";
import { colors, shadows, CURRENCIES, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { GlassCard } from "../../src/components/GlassCard";
import { useLocale } from "../../src/hooks/useLocale";
import { Spinner } from "../../src/components/brand/Spinner";

type CryptoOption = "USDT" | "USDC" | "BTC" | "ETH" | "SOL";

const CRYPTO_OPTIONS: { id: CryptoOption; name: string; color: string }[] = [
  { id: "USDT", name: "Tether", color: colors.crypto.USDT },
  { id: "USDC", name: "USD Coin", color: colors.crypto.USDC },
  { id: "BTC", name: "Bitcoin", color: colors.crypto.BTC },
  { id: "ETH", name: "Ethereum", color: colors.crypto.ETH },
  { id: "SOL", name: "Solana", color: colors.crypto.SOL },
];

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

function generateIdempotencyKey(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function BuyCryptoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ preset_amount?: string; preset_currency?: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();

  const [step, setStep] = useState<"form" | "preview" | "pin">("form");
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoOption>(
    (params.preset_currency as CryptoOption) || "USDT"
  );
  const [amountKES, setAmountKES] = useState(params.preset_amount || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);
  const { pollTransaction, cancel: cancelPoll } = useTransactionPoller();
  const [liveRates, setLiveRates] = useState<Record<string, string>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const amountInputRef = useRef<TextInput>(null);

  useScreenSecurity(step === "pin");

  // Fetch live rates for all cryptos
  useEffect(() => {
    Promise.all(
      CRYPTO_OPTIONS.map(async (opt) => {
        try {
          const { data } = await ratesApi.getRate(opt.id);
          return [opt.id, data.final_rate] as const;
        } catch {
          return [opt.id, ""] as const;
        }
      })
    ).then((results) => {
      const rates: Record<string, string> = {};
      for (const [id, rate] of results) {
        if (rate) rates[id] = rate;
      }
      setLiveRates(rates);
    });
  }, []);

  // Pre-fill phone from user profile when available
  useEffect(() => {
    if (user?.phone && !phone) {
      setPhone(user.phone);
    }
  }, [user?.phone]);

  // Debounced quote fetch
  const fetchQuote = useCallback(
    (amount: string, crypto: CryptoOption) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setQuote(null);
      setQuoteError(null);

      const numAmount = parseFloat(amount);
      if (!amount || isNaN(numAmount) || numAmount < 10) {
        setQuoteLoading(false);
        return;
      }

      setQuoteLoading(true);

      debounceRef.current = setTimeout(async () => {
        try {
          const { data } = await ratesApi.getQuote(amount, "KES", crypto);
          setQuote(data);
          setQuoteError(null);
        } catch (err: unknown) {
          const appError = normalizeError(err);
          setQuoteError(appError.message);
        } finally {
          setQuoteLoading(false);
        }
      }, 600);
    },
    []
  );

  // Fetch quote when amount or crypto changes
  useEffect(() => {
    fetchQuote(amountKES, selectedCrypto);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [amountKES, selectedCrypto, fetchQuote]);

  const handleCryptoSelect = (crypto: CryptoOption) => {
    setSelectedCrypto(crypto);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleAmountChange = (text: string) => {
    // Allow only numbers and one decimal point
    const cleaned = text.replace(/[^0-9.]/g, "");
    // Prevent multiple decimal points
    const parts = cleaned.split(".");
    const formatted = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
    setAmountKES(formatted);
  };

  const handleContinue = () => {
    if (!amountKES || parseFloat(amountKES) < 10) {
      toast.warning("Minimum Amount", "Enter at least KSh 10");
      return;
    }
    if (!phone || phone.length < 10) {
      toast.warning("Phone Required", "Enter a valid M-Pesa phone number");
      return;
    }
    if (!quote) {
      toast.warning("No Quote", "Wait for the rate quote to load");
      return;
    }
    setStep("preview");
  };

  const handleConfirmPayment = () => {
    setStep("pin");
  };

  const handlePinComplete = async (pin: string) => {
    if (!quote) return;

    setLoading(true);
    setPinError(false);

    const idempotencyKey = generateIdempotencyKey();

    try {
      const txResponse = await paymentsApi.buyCrypto({
        phone,
        quote_id: quote.quote_id,
        pin,
        idempotency_key: idempotencyKey,
      });

      const transactionId = txResponse?.data?.id || "";

      // Poll for backend confirmation (waits for M-Pesa PIN entry + callback)
      setPollingStatus("processing");

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
        toast.error("Deposit Failed", "The M-Pesa transaction was not completed.");
        setPollingStatus(null);
        setStep("form");
        return;
      }

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          finalStatus === "completed"
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning
        );
      }
      router.replace({
        pathname: "/payment/success",
        params: {
          amount_kes: quote.total_kes || quote.kes_amount || amountKES,
          crypto_amount: quote.crypto_amount,
          crypto_currency: selectedCrypto,
          recipient: phone,
          tx_status: finalStatus,
          transaction_id: transactionId,
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

  const selectedOption = CRYPTO_OPTIONS.find((c) => c.id === selectedCrypto)!;
  const parsedAmount = parseFloat(amountKES) || 0;

  // --- RENDER: Form Step ---
  if (step === "form") {
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
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)" as any);
            }}
            hitSlop={12}
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              backgroundColor: tc.dark.card,
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
            Buy Crypto
          </Text>
        </View>

        <KeyboardAvoidingView
          behavior="padding"
          style={{ flex: 1 }}
        >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: isDesktop ? 28 : 20,
            maxWidth: isDesktop ? 640 : undefined,
            alignSelf: isDesktop ? "center" : undefined,
            width: isDesktop ? "100%" : undefined,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Crypto Selector */}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1.2,
              marginBottom: 12,
              marginTop: 8,
              paddingLeft: 4,
            }}
            maxFontSizeMultiplier={1.3}
            accessibilityRole="header"
          >
            Select Crypto
          </Text>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 24,
            }}
            accessibilityRole="radiogroup"
            accessibilityLabel="Select cryptocurrency"
            testID="crypto-selector"
          >
            {CRYPTO_OPTIONS.map((crypto) => {
              const isSelected = selectedCrypto === crypto.id;
              return (
                <Pressable
                  key={crypto.id}
                  onPress={() => handleCryptoSelect(crypto.id)}
                  style={({ pressed }) => ({
                    flexDirection: "row" as const,
                    alignItems: "center" as const,
                    alignSelf: "flex-start" as const,
                    gap: 8,
                    backgroundColor: isSelected
                      ? crypto.color + "1A"
                      : tc.dark.card,
                    borderRadius: 14,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderWidth: 1.5,
                    borderColor: isSelected
                      ? crypto.color + "60"
                      : tc.glass.border,
                    opacity: pressed ? 0.85 : 1,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                    ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                  })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${crypto.name} (${crypto.id})`}
                  testID={`crypto-pill-${crypto.id}`}
                >
                  <CryptoLogo
                    currency={crypto.id}
                    size={24}
                    fallbackColor={crypto.color}
                  />
                  <View>
                    <Text
                      style={{
                        color: isSelected ? tc.textPrimary : tc.textSecondary,
                        fontSize: 14,
                        fontFamily: isSelected ? "DMSans_700Bold" : "DMSans_500Medium",
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {crypto.id}
                    </Text>
                    {liveRates[crypto.id] ? (
                      <Text
                        style={{
                          color: tc.textMuted,
                          fontSize: 10,
                          fontFamily: "DMSans_400Regular",
                          marginTop: 1,
                        }}
                        maxFontSizeMultiplier={1.3}
                      >
                        KSh {parseFloat(liveRates[crypto.id]).toLocaleString("en-KE", { maximumFractionDigits: 0 })}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Amount Input */}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1.2,
              marginBottom: 12,
              paddingLeft: 4,
            }}
            maxFontSizeMultiplier={1.3}
          >
            Amount (KES)
          </Text>
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 16,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: tc.glass.border,
              paddingHorizontal: 16,
              marginBottom: 8,
            }}
            testID="amount-input-container"
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
                marginRight: 8,
              }}
            >
              KSh
            </Text>
            <TextInput
              ref={amountInputRef}
              value={amountKES}
              onChangeText={handleAmountChange}
              placeholder="0.00"
              placeholderTextColor={tc.dark.muted}
              keyboardType="decimal-pad"
              style={{
                flex: 1,
                color: tc.textPrimary,
                fontSize: 24,
                fontFamily: "DMSans_700Bold",
                paddingVertical: 18,
                ...(isWeb ? { outline: "none" } as any : {}),
              }}
              maxFontSizeMultiplier={1.2}
              accessibilityLabel="Amount in Kenyan Shillings"
              accessibilityHint="Enter the amount you want to spend in KES"
              testID="amount-input"
            />
            {quoteLoading && (
              <Spinner size={16} color={tc.primary[400]} style={{ marginLeft: 8 }} />
            )}
          </View>

          {/* Rate Quote & Fee Breakdown */}
          {quote && !quoteLoading && parsedAmount >= 10 && (
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 14,
                padding: 14,
                gap: 8,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: tc.glass.border,
              }}
              accessibilityRole="text"
              testID="rate-preview"
            >
              {/* You'll get */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="swap-horizontal" size={14} color={tc.primary[400]} />
                <Text style={{ color: tc.primary[400], fontSize: 13, fontFamily: "DMSans_500Medium", flex: 1 }}>
                  You'll receive
                </Text>
                <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_700Bold" }}>
                  {quote.crypto_amount} {selectedCrypto}
                </Text>
              </View>
              {/* Rate */}
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>
                  Rate (1 {selectedCrypto})
                </Text>
                <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                  KSh {parseFloat(quote.exchange_rate).toLocaleString("en-KE", { maximumFractionDigits: 2 })}
                </Text>
              </View>
              {/* Service fee */}
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>
                  Service fee
                </Text>
                <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                  KSh {parseFloat(quote.fee_kes).toLocaleString("en-KE")}
                </Text>
              </View>
              {/* Excise duty */}
              {parseFloat(quote.excise_duty_kes || "0") > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>
                    Excise duty ({quote.excise_duty_percent || 10}%)
                  </Text>
                  <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                    KSh {parseFloat(quote.excise_duty_kes).toLocaleString("en-KE")}
                  </Text>
                </View>
              )}
              {/* Divider */}
              <View style={{ height: 1, backgroundColor: tc.glass.border, marginVertical: 2 }} />
              {/* Total */}
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>
                  Total M-Pesa charge
                </Text>
                <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_700Bold" }}>
                  KSh {parseFloat(quote.total_kes).toLocaleString("en-KE")}
                </Text>
              </View>
            </View>
          )}

          {quoteError && !quoteLoading && (
            <View
              style={{
                backgroundColor: tc.error + "12",
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginBottom: 24,
                borderWidth: 1,
                borderColor: tc.error + "30",
              }}
              accessibilityRole="alert"
              testID="quote-error"
            >
              <Ionicons name="alert-circle" size={16} color={tc.error} />
              <Text
                style={{
                  color: tc.error,
                  fontSize: 13,
                  fontFamily: "DMSans_400Regular",
                  flex: 1,
                }}
                maxFontSizeMultiplier={1.3}
              >
                {quoteError}
              </Text>
            </View>
          )}

          {!quote && !quoteLoading && !quoteError && (
            <View style={{ marginBottom: 24 }} />
          )}

          {/* Phone Number Input */}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1.2,
              marginBottom: 12,
              paddingLeft: 4,
            }}
            maxFontSizeMultiplier={1.3}
          >
            M-Pesa Phone Number
          </Text>
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 16,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: tc.glass.border,
              paddingHorizontal: 16,
              marginBottom: 8,
            }}
            testID="phone-input-container"
          >
            <Ionicons
              name="phone-portrait-outline"
              size={18}
              color={tc.textMuted}
              style={{ marginRight: 10 }}
            />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="07XXXXXXXX"
              placeholderTextColor={tc.dark.muted}
              keyboardType="phone-pad"
              style={{
                flex: 1,
                color: tc.textPrimary,
                fontSize: 16,
                fontFamily: "DMSans_500Medium",
                paddingVertical: 16,
                ...(isWeb ? { outline: "none" } as any : {}),
              }}
              maxLength={13}
              maxFontSizeMultiplier={1.3}
              accessibilityLabel="M-Pesa phone number"
              accessibilityHint="Enter the phone number for STK push payment"
              testID="phone-input"
            />
          </View>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              paddingLeft: 4,
              marginBottom: 24,
            }}
            maxFontSizeMultiplier={1.3}
          >
            You'll receive an M-Pesa STK push to confirm payment
          </Text>

          {/* Security note */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginTop: 8,
              marginBottom: 20,
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
              Secured by end-to-end encryption
            </Text>
          </View>

          <View style={{ flex: 1 }} />

          {/* Continue Button */}
          <View style={{ marginBottom: 32, maxWidth: isDesktop ? 420 : undefined, alignSelf: isDesktop ? "center" : undefined, width: isDesktop ? "100%" : undefined }}>
            <Button
              title="Continue"
              onPress={handleContinue}
              size="lg"
              disabled={!amountKES || parsedAmount < 10 || !phone || phone.length < 10 || !quote || quoteLoading}
              icon={<Ionicons name="arrow-forward-circle-outline" size={20} color="#FFFFFF" />}
              testID="continue-button"
              style={{
                ...ts.glow(tc.primary[500], 0.35),
              }}
            />
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // --- RENDER: Preview Step ---
  if (step === "preview" && quote) {
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
            onPress={() => setStep("form")}
            hitSlop={12}
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              backgroundColor: tc.dark.card,
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
            Confirm Purchase
          </Text>

          {/* Step indicator */}
          <PaymentStepper currentStep={1} />
        </View>

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
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              marginTop: isDesktop ? 0 : 12,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...(isWeb ? { boxShadow: '0 8px 32px rgba(0,0,0,0.3)' } as any : {}),
            }}
            testID="preview-card"
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
              accessibilityLabel={`Buy ${quote.crypto_amount} ${selectedCrypto} for KSh ${parsedAmount.toLocaleString()}`}
              testID="purchase-summary"
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 20,
                  backgroundColor: selectedOption.color + "18",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                  borderWidth: 1.5,
                  borderColor: selectedOption.color + "30",
                }}
              >
                <CryptoLogo
                  currency={selectedOption.id}
                  size={32}
                  fallbackColor={selectedOption.color}
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
                Buy {selectedCrypto}
              </Text>

              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 38,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -1,
                }}
                maxFontSizeMultiplier={1.2}
                accessibilityLabel={`Amount: ${parsedAmount.toLocaleString()} Kenyan Shillings`}
              >
                KSh {parsedAmount.toLocaleString()}
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
              {/* You receive - green pill */}
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
                  You receive
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
                    {quote.crypto_amount} {selectedCrypto}
                  </Text>
                </View>
              </View>

              {/* Phone */}
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
                  M-Pesa Number
                </Text>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 14,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {phone}
                </Text>
              </View>

              {/* Separator */}
              <View
                style={{
                  borderBottomWidth: 1,
                  borderBottomColor: tc.dark.border + "30",
                  borderStyle: "dashed",
                }}
              />

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
                  Rate
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  1 {selectedCrypto} = KSh{" "}
                  {parseFloat(quote.final_rate).toLocaleString()}
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
                  Fee
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  KSh {parseFloat(quote.fee_kes).toLocaleString()}
                </Text>
              </View>

              {/* Total */}
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: tc.dark.border + "30",
                  borderStyle: "dashed",
                  paddingTop: 18,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Total
                </Text>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "DMSans_700Bold",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  KSh {parseFloat(quote.total_kes).toLocaleString()}
                </Text>
              </View>
            </View>
          </View>

          {/* Buy Now Button */}
          <View style={{ marginTop: 24, marginBottom: isDesktop ? 8 : 32, maxWidth: isDesktop ? 420 : undefined, alignSelf: isDesktop ? "center" : undefined, width: isDesktop ? "100%" : undefined }}>
            <Button
              title="Buy Now"
              onPress={handleConfirmPayment}
              size="lg"
              icon={<Ionicons name="card-outline" size={20} color="#FFFFFF" />}
              testID="buy-now-button"
              style={{
                ...ts.glow(tc.primary[500], 0.35),
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
            <Ionicons name="shield-checkmark" size={14} color={tc.primary[400]} />
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
              }}
            >
              Secured by end-to-end encryption
            </Text>
          </View>

          {!isDesktop && <View style={{ flex: 1 }} />}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // --- RENDER: PIN Step ---
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: isDesktop ? 28 : 20,
          paddingVertical: 14,
          maxWidth: isDesktop ? 480 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
        }}
      >
        <Pressable
          onPress={() => setStep("preview")}
          hitSlop={12}
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            backgroundColor: tc.dark.card,
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
          Enter PIN
        </Text>

        {/* Step indicator */}
        <PaymentStepper currentStep={1} />
      </View>

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
            Enter your PIN
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
            Confirm purchase of
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
              {quote?.crypto_amount} {selectedCrypto}
            </Text>
            <Ionicons name="arrow-forward" size={14} color={tc.textMuted} />
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 15,
                fontFamily: "DMSans_500Medium",
              }}
            >
              KSh {parsedAmount.toLocaleString()}
            </Text>
          </View>

          <PinInput onComplete={handlePinComplete} error={pinError} testID="buy-crypto-pin-input" />

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
                      ? t("payment.enterMpesaPin")
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
              Your PIN is never stored or shared
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
