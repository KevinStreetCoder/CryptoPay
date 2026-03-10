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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { paymentsApi } from "../../src/api/payments";
import { ratesApi, Quote } from "../../src/api/rates";
import { normalizeError } from "../../src/utils/apiErrors";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { useAuth } from "../../src/stores/auth";
import { colors, shadows, CURRENCIES } from "../../src/constants/theme";

type CryptoOption = "USDT" | "BTC" | "ETH";

const CRYPTO_OPTIONS: { id: CryptoOption; name: string; icon: string; color: string }[] = [
  { id: "USDT", name: "Tether", icon: "logo-usd", color: colors.crypto.USDT },
  { id: "BTC", name: "Bitcoin", icon: "logo-bitcoin", color: colors.crypto.BTC },
  { id: "ETH", name: "Ethereum", icon: "diamond-outline", color: colors.crypto.ETH },
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
  const toast = useToast();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;

  const [step, setStep] = useState<"form" | "preview" | "pin">("form");
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoOption>("USDT");
  const [amountKES, setAmountKES] = useState("");
  const [phone, setPhone] = useState(user?.phone || "");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const amountInputRef = useRef<TextInput>(null);

  useScreenSecurity(step === "pin");

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
      await paymentsApi.buyCrypto({
        phone,
        quote_id: quote.quote_id,
        pin,
        idempotency_key: idempotencyKey,
      });

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.replace({
        pathname: "/payment/success",
        params: {
          amount_kes: quote.kes_amount || amountKES,
          crypto_amount: quote.crypto_amount,
          crypto_currency: selectedCrypto,
          recipient: phone,
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
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)" as any);
            }}
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
            Buy Crypto
          </Text>
        </View>

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
              color: colors.textMuted,
              fontSize: 11,
              fontFamily: "Inter_600SemiBold",
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
            style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}
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
                    flex: 1,
                    backgroundColor: isSelected
                      ? crypto.color + "1A"
                      : colors.dark.card,
                    borderRadius: 16,
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    alignItems: "center",
                    borderWidth: 1.5,
                    borderColor: isSelected
                      ? crypto.color + "60"
                      : colors.glass.border,
                    opacity: pressed ? 0.85 : 1,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${crypto.name} (${crypto.id})`}
                  testID={`crypto-pill-${crypto.id}`}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 14,
                      backgroundColor: crypto.color + "20",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 8,
                      borderWidth: 1,
                      borderColor: crypto.color + "30",
                    }}
                  >
                    <Ionicons
                      name={crypto.icon as any}
                      size={20}
                      color={crypto.color}
                    />
                  </View>
                  <Text
                    style={{
                      color: isSelected ? colors.textPrimary : colors.textSecondary,
                      fontSize: 14,
                      fontFamily: "Inter_600SemiBold",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {crypto.id}
                  </Text>
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: 11,
                      fontFamily: "Inter_400Regular",
                      marginTop: 2,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {crypto.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Amount Input */}
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 11,
              fontFamily: "Inter_600SemiBold",
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
              backgroundColor: colors.dark.card,
              borderRadius: 16,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: colors.glass.border,
              paddingHorizontal: 16,
              marginBottom: 8,
            }}
            testID="amount-input-container"
          >
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 16,
                fontFamily: "Inter_600SemiBold",
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
              placeholderTextColor={colors.dark.muted}
              keyboardType="decimal-pad"
              style={{
                flex: 1,
                color: colors.textPrimary,
                fontSize: 24,
                fontFamily: "Inter_700Bold",
                paddingVertical: 18,
                ...(isWeb ? { outline: "none" } as any : {}),
              }}
              maxFontSizeMultiplier={1.2}
              accessibilityLabel="Amount in Kenyan Shillings"
              accessibilityHint="Enter the amount you want to spend in KES"
              testID="amount-input"
            />
            {quoteLoading && (
              <ActivityIndicator
                size="small"
                color={colors.primary[400]}
                style={{ marginLeft: 8 }}
              />
            )}
          </View>

          {/* Rate Quote Display */}
          {quote && !quoteLoading && parsedAmount >= 10 && (
            <View
              style={{
                backgroundColor: colors.primary[500] + "0D",
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginBottom: 24,
                borderWidth: 1,
                borderColor: colors.primary[500] + "1A",
              }}
              accessibilityRole="text"
              accessibilityLabel={`You will receive approximately ${quote.crypto_amount} ${selectedCrypto}`}
              testID="rate-preview"
            >
              <Ionicons name="swap-horizontal" size={16} color={colors.primary[400]} />
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 14,
                  fontFamily: "Inter_500Medium",
                  flex: 1,
                }}
                maxFontSizeMultiplier={1.3}
              >
                You'll get{" "}
                <Text style={{ fontFamily: "Inter_700Bold", color: colors.textPrimary }}>
                  {quote.crypto_amount} {selectedCrypto}
                </Text>
              </Text>
            </View>
          )}

          {quoteError && !quoteLoading && (
            <View
              style={{
                backgroundColor: colors.error + "12",
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginBottom: 24,
                borderWidth: 1,
                borderColor: colors.error + "30",
              }}
              accessibilityRole="alert"
              testID="quote-error"
            >
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text
                style={{
                  color: colors.error,
                  fontSize: 13,
                  fontFamily: "Inter_400Regular",
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
              color: colors.textMuted,
              fontSize: 11,
              fontFamily: "Inter_600SemiBold",
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
              backgroundColor: colors.dark.card,
              borderRadius: 16,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: colors.glass.border,
              paddingHorizontal: 16,
              marginBottom: 8,
            }}
            testID="phone-input-container"
          >
            <Ionicons
              name="phone-portrait-outline"
              size={18}
              color={colors.textMuted}
              style={{ marginRight: 10 }}
            />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="07XXXXXXXX"
              placeholderTextColor={colors.dark.muted}
              keyboardType="phone-pad"
              style={{
                flex: 1,
                color: colors.textPrimary,
                fontSize: 16,
                fontFamily: "Inter_500Medium",
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
              color: colors.textMuted,
              fontSize: 12,
              fontFamily: "Inter_400Regular",
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

          <View style={{ flex: 1 }} />

          {/* Continue Button */}
          <View style={{ marginBottom: 32 }}>
            <Button
              title="Continue"
              onPress={handleContinue}
              size="lg"
              disabled={!amountKES || parsedAmount < 10 || !phone || phone.length < 10 || !quote || quoteLoading}
              testID="continue-button"
              style={{
                ...shadows.glow(colors.primary[500], 0.35),
              }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // --- RENDER: Preview Step ---
  if (step === "preview" && quote) {
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
            onPress={() => setStep("form")}
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
            Confirm Purchase
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
                backgroundColor: colors.primary[500],
              }}
            />
            <View
              style={{
                width: 24,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.dark.elevated,
              }}
            />
          </View>
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
              backgroundColor: colors.dark.card,
              borderRadius: 24,
              marginTop: isDesktop ? 0 : 12,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: colors.glass.border,
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
                <Ionicons
                  name={selectedOption.icon as any}
                  size={28}
                  color={selectedOption.color}
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
                Buy {selectedCrypto}
              </Text>

              <Text
                style={{
                  color: colors.textPrimary,
                  fontSize: 38,
                  fontFamily: "Inter_700Bold",
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
                borderBottomColor: colors.dark.border + "40",
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
                    color: colors.textMuted,
                    fontSize: 14,
                    fontFamily: "Inter_400Regular",
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
                    color: colors.textMuted,
                    fontSize: 14,
                    fontFamily: "Inter_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  M-Pesa Number
                </Text>
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 14,
                    fontFamily: "Inter_600SemiBold",
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
                  borderBottomColor: colors.dark.border + "30",
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
                  KSh {parseFloat(quote.fee_kes).toLocaleString()}
                </Text>
              </View>

              {/* Total */}
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: colors.dark.border + "30",
                  borderStyle: "dashed",
                  paddingTop: 18,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 14,
                    fontFamily: "Inter_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Total
                </Text>
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 16,
                    fontFamily: "Inter_700Bold",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  KSh {parseFloat(quote.total_kes).toLocaleString()}
                </Text>
              </View>
            </View>
          </View>

          {/* Buy Now Button */}
          <View style={{ marginTop: 24, marginBottom: isDesktop ? 8 : 32 }}>
            <Button
              title="Buy Now"
              onPress={handleConfirmPayment}
              size="lg"
              testID="buy-now-button"
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
      </SafeAreaView>
    );
  }

  // --- RENDER: PIN Step ---
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
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
          Enter PIN
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
              backgroundColor: colors.primary[500],
            }}
          />
          <View
            style={{
              width: 24,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.primary[500],
            }}
          />
        </View>
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
            Confirm purchase of
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
              {quote?.crypto_amount} {selectedCrypto}
            </Text>
            <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 15,
                fontFamily: "Inter_500Medium",
              }}
            >
              KSh {parsedAmount.toLocaleString()}
            </Text>
          </View>

          <PinInput onComplete={handlePinComplete} error={pinError} testID="buy-crypto-pin-input" />

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
                Processing purchase...
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
    </SafeAreaView>
  );
}
