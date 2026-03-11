import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "../../src/components/Button";
import { CryptoLogo } from "../../src/components/CryptoLogo";
import { useToast } from "../../src/components/Toast";
import { useWallets } from "../../src/hooks/useWallets";
import { ratesApi, Quote } from "../../src/api/rates";
import { normalizeError } from "../../src/utils/apiErrors";
import { colors, getThemeColors, getThemeShadows, CURRENCIES, CurrencyCode } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { useLocale } from "../../src/hooks/useLocale";

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "BTC", "ETH"];

export default function SendMpesaScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;
  const { data: wallets } = useWallets();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CurrencyCode>("USDT");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const selectedWallet = wallets?.find((w) => w.currency === selectedCrypto);
  const balance = selectedWallet ? parseFloat(selectedWallet.balance) : 0;

  const toast = useToast();
  const { t } = useLocale();

  const handleGetQuote = async () => {
    if (!phone || !amount) {
      toast.warning(t("payment.missingFields"), t("payment.fillAllFields"));
      return;
    }
    if (phone.length < 9) {
      toast.warning(t("payment.invalidPhone"), t("payment.enterValidPhone"));
      return;
    }
    setLoading(true);
    try {
      const { data } = await ratesApi.lockRate({
        currency: selectedCrypto,
        kes_amount: amount,
      });
      setQuote(data);
    } catch (err: unknown) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!quote) return;
    const fullPhone = phone.startsWith("0")
      ? "+254" + phone.slice(1)
      : phone.startsWith("254")
        ? "+" + phone
        : phone.startsWith("+254")
          ? phone
          : "+254" + phone;
    router.push({
      pathname: "/payment/confirm",
      params: {
        type: "send",
        phone: fullPhone,
        amount_kes: amount,
        crypto_currency: selectedCrypto,
        quote_id: quote.quote_id,
        crypto_amount: quote.crypto_amount,
        rate: quote.exchange_rate,
        fee: quote.fee_kes,
        excise_duty: quote.excise_duty_kes || "0",
      },
    });
  };

  const inputBorderColor = (field: string) =>
    focusedField === field ? colors.primary[400] + "60" : tc.dark.border;

  const inputFocusGlow = (field: string) =>
    focusedField === field && isWeb
      ? ({ boxShadow: `0 0 0 3px ${colors.primary[500]}15` } as any)
      : {};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={
            isDesktop
              ? { alignItems: "center", paddingVertical: 32 }
              : undefined
          }
        >
          {/* Top-level back button */}
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
              backgroundColor: isWeb && hovered
                ? tc.glass.highlight
                : pressed
                  ? tc.dark.elevated
                  : "transparent",
              alignSelf: "flex-start",
              marginBottom: 12,
              marginLeft: isDesktop ? 0 : 16,
              opacity: pressed ? 0.85 : 1,
              ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
            <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
              {t("common.back")}
            </Text>
          </Pressable>

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
                onPress={() => router.replace("/(tabs)/pay" as any)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={({ pressed, hovered }: any) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  backgroundColor: isWeb && hovered ? tc.dark.elevated : tc.dark.card,
                  borderColor: isWeb && hovered ? tc.glass.borderStrong : tc.glass.border,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  opacity: pressed ? 0.85 : 1,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
              >
                <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
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
                maxFontSizeMultiplier={1.3}
              >
                {t("payment.sendToMpesa")}
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
                    backgroundColor: tc.dark.elevated,
                  }}
                />
              </View>
            </View>

            <View
              style={{
                paddingHorizontal: isDesktop ? 0 : 20,
                marginTop: isDesktop ? 0 : 8,
              }}
            >
              {/* Phone Number */}
              <SectionHeader title={t("payment.phoneNumber")} icon="call-outline" iconColor={colors.primary[400]} />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: tc.dark.card,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorderColor("phone"),
                  paddingHorizontal: 16,
                  marginBottom: 20,
                  ...(isWeb ? { transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                  ...inputFocusGlow("phone"),
                }}
              >
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 16,
                    fontFamily: "DMSans_600SemiBold",
                    marginRight: 4,
                  }}
                >
                  +254
                </Text>
                <TextInput
                  value={phone}
                  onChangeText={(text) => {
                    setPhone(text.replace(/[^0-9]/g, ""));
                    setQuote(null);
                  }}
                  placeholder="7XXXXXXXX"
                  placeholderTextColor={tc.dark.muted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  onFocus={() => setFocusedField("phone")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 16,
                    paddingVertical: 14,
                    ...(isWeb ? { outlineStyle: "none" } as any : {}),
                  }}
                  accessibilityLabel="Phone Number"
                  testID="phone-number-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              {/* Amount */}
              <SectionHeader title={t("payment.amountKes")} icon="cash-outline" iconColor={colors.primary[400]} />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: tc.dark.card,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorderColor("amount"),
                  paddingHorizontal: 16,
                  ...(isWeb ? { transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                  ...inputFocusGlow("amount"),
                }}
              >
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 18,
                    fontFamily: "DMSans_700Bold",
                    marginRight: 4,
                  }}
                >
                  KSh
                </Text>
                <TextInput
                  value={amount}
                  onChangeText={(text) => {
                    setAmount(text);
                    setQuote(null);
                  }}
                  placeholder="0"
                  placeholderTextColor={tc.dark.muted}
                  keyboardType="numeric"
                  onFocus={() => setFocusedField("amount")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 24,
                    fontFamily: "DMSans_700Bold",
                    paddingVertical: 12,
                    ...(isWeb ? { outlineStyle: "none" } as any : {}),
                  }}
                  accessibilityLabel="Amount in KES"
                  testID="amount-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              {/* Crypto Selector */}
              <View style={{ marginTop: 24 }}>
                <SectionHeader title={t("payment.payWith")} icon="wallet-outline" iconColor={colors.primary[400]} />
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {CRYPTO_OPTIONS.map((crypto) => {
                  const info = CURRENCIES[crypto];
                  const isSelected = selectedCrypto === crypto;
                  const wallet = wallets?.find((w) => w.currency === crypto);
                  const bal = wallet ? parseFloat(wallet.balance) : 0;
                  const brandColor = colors.crypto[crypto] ?? colors.primary[500];

                  return (
                    <Pressable
                      key={crypto}
                      onPress={() => {
                        setSelectedCrypto(crypto);
                        setQuote(null);
                      }}
                      style={({ pressed, hovered }: any) => ({
                        flex: 1,
                        borderRadius: 16,
                        padding: 12,
                        borderWidth: 1,
                        borderColor: isSelected
                          ? colors.primary[500]
                          : isWeb && hovered
                            ? tc.glass.borderStrong
                            : tc.dark.border,
                        backgroundColor: isSelected
                          ? colors.primary[500] + "1A"
                          : isWeb && hovered
                            ? tc.dark.elevated
                            : tc.dark.card,
                        opacity: pressed ? 0.85 : 1,
                        ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={`Pay with ${crypto}`}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginBottom: 4,
                        }}
                      >
                        <View style={{ marginRight: 6 }}>
                          <CryptoLogo currency={crypto} size={22} />
                        </View>
                        <Text
                          style={{
                            fontSize: 14,
                            fontFamily: "DMSans_600SemiBold",
                            color: isSelected ? colors.primary[400] : tc.textPrimary,
                          }}
                          maxFontSizeMultiplier={1.3}
                        >
                          {info.symbol}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: tc.dark.muted,
                          fontSize: 12,
                          marginTop: 2,
                        }}
                        maxFontSizeMultiplier={1.3}
                      >
                        {bal.toFixed(info.decimals > 4 ? 4 : info.decimals)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Quote Display */}
              {quote && (
                <View
                  style={{
                    backgroundColor: tc.dark.card,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.primary[500] + "4D",
                    padding: 16,
                    marginTop: 24,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <Text
                      style={{ color: tc.dark.muted, fontSize: 14 }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t("payment.rate")}
                    </Text>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_500Medium",
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      1 {selectedCrypto} = KSh{" "}
                      {parseFloat(quote.exchange_rate).toLocaleString()}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <Text
                      style={{ color: tc.dark.muted, fontSize: 14 }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t("payment.fee")}
                    </Text>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_500Medium",
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      KSh {quote.fee_kes}
                    </Text>
                  </View>
                  {quote.excise_duty_kes && parseFloat(quote.excise_duty_kes) > 0 && (
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        marginBottom: 10,
                      }}
                    >
                      <Text
                        style={{ color: tc.dark.muted, fontSize: 14 }}
                        maxFontSizeMultiplier={1.3}
                      >
                        {t("payment.exciseDuty")}
                      </Text>
                      <Text
                        style={{
                          color: tc.textPrimary,
                          fontSize: 14,
                          fontFamily: "DMSans_500Medium",
                        }}
                        maxFontSizeMultiplier={1.3}
                      >
                        KSh {parseFloat(quote.excise_duty_kes).toLocaleString()}
                      </Text>
                    </View>
                  )}
                  <View
                    style={{
                      height: 1,
                      backgroundColor: tc.dark.border,
                      marginVertical: 10,
                    }}
                  />
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
                      maxFontSizeMultiplier={1.3}
                    >
                      {t("payment.total")}
                    </Text>
                    <Text
                      style={{
                        color: colors.primary[400],
                        fontSize: 16,
                        fontFamily: "DMSans_700Bold",
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {quote.crypto_amount} {selectedCrypto}
                    </Text>
                  </View>
                  {parseFloat(quote.crypto_amount) > balance && (
                    <Text
                      style={{
                        color: tc.error,
                        fontSize: 12,
                        marginTop: 8,
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t("payment.insufficientBalance", { currency: selectedCrypto })}
                    </Text>
                  )}
                  <Text
                    style={{
                      color: tc.dark.muted,
                      fontSize: 12,
                      marginTop: 8,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {t("payment.rateLocked30")}
                  </Text>
                </View>
              )}

              {/* Action Button */}
              <View style={{ marginTop: 28, marginBottom: 32 }}>
                {!quote ? (
                  <Button
                    title={t("payment.getQuote")}
                    onPress={handleGetQuote}
                    loading={loading}
                    disabled={!phone || !amount}
                    size="lg"
                    testID="get-quote-button"
                  />
                ) : (
                  <Button
                    title={t("payment.confirmPayment")}
                    onPress={handleConfirm}
                    disabled={parseFloat(quote.crypto_amount) > balance}
                    size="lg"
                    testID="confirm-payment-button"
                  />
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
