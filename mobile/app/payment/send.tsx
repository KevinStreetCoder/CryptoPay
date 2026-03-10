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
import { useToast } from "../../src/components/Toast";
import { useWallets } from "../../src/hooks/useWallets";
import { ratesApi, Quote } from "../../src/api/rates";
import { normalizeError } from "../../src/utils/apiErrors";
import { CURRENCIES, CurrencyCode, colors } from "../../src/constants/theme";

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "BTC", "ETH"];

export default function SendMpesaScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const { data: wallets } = useWallets();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CurrencyCode>("USDT");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [amountFocused, setAmountFocused] = useState(false);

  const selectedWallet = wallets?.find((w) => w.currency === selectedCrypto);
  const balance = selectedWallet ? parseFloat(selectedWallet.balance) : 0;

  const toast = useToast();

  const handleGetQuote = async () => {
    if (!phone || !amount) {
      toast.warning("Missing Fields", "Please fill in all fields");
      return;
    }
    if (phone.length < 9) {
      toast.warning("Invalid Phone", "Please enter a valid phone number");
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={
            isDesktop
              ? { alignItems: "center", paddingTop: 20 }
              : undefined
          }
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingVertical: 12,
              width: isDesktop ? 560 : "100%",
            }}
          >
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={{ padding: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </Pressable>
            <Text
              style={{
                color: "#fff",
                fontSize: 18,
                fontFamily: "Inter_600SemiBold",
                marginLeft: 8,
              }}
              maxFontSizeMultiplier={1.3}
            >
              Send to M-Pesa
            </Text>
          </View>

          <View
            style={{
              paddingHorizontal: 20,
              marginTop: 8,
              width: isDesktop ? 560 : "100%",
            }}
          >
            {/* Phone Number */}
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 14,
                fontFamily: "Inter_500Medium",
                marginBottom: 8,
              }}
              maxFontSizeMultiplier={1.3}
            >
              Phone Number
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#0C1A2E",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: phoneFocused
                  ? colors.primary[500]
                  : colors.dark.border,
                paddingHorizontal: 16,
                ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as any : {}),
                ...(phoneFocused && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.15)' } as any : {}),
              }}
            >
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 16,
                  fontFamily: "Inter_600SemiBold",
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
                placeholderTextColor={colors.dark.muted}
                keyboardType="phone-pad"
                maxLength={10}
                style={{
                  flex: 1,
                  color: "#fff",
                  fontSize: 16,
                  fontFamily: "Inter_400Regular",
                  paddingVertical: 14,
                  ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
                }}
                onFocus={() => setPhoneFocused(true)}
                onBlur={() => setPhoneFocused(false)}
                accessibilityLabel="Phone Number"
                testID="phone-number-input"
                maxFontSizeMultiplier={1.3}
              />
            </View>

            {/* Amount */}
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 14,
                fontFamily: "Inter_500Medium",
                marginTop: 20,
                marginBottom: 8,
              }}
              maxFontSizeMultiplier={1.3}
            >
              Amount (KES)
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#0C1A2E",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: amountFocused
                  ? colors.primary[500]
                  : colors.dark.border,
                paddingHorizontal: 16,
                ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as any : {}),
                ...(amountFocused && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.15)' } as any : {}),
              }}
            >
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 18,
                  fontFamily: "Inter_700Bold",
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
                placeholderTextColor={colors.dark.muted}
                keyboardType="numeric"
                style={{
                  flex: 1,
                  color: "#fff",
                  fontSize: 24,
                  fontFamily: "Inter_700Bold",
                  paddingVertical: 12,
                  ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
                }}
                onFocus={() => setAmountFocused(true)}
                onBlur={() => setAmountFocused(false)}
                accessibilityLabel="Amount in KES"
                testID="amount-input"
                maxFontSizeMultiplier={1.3}
              />
            </View>

            {/* Crypto Selector */}
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 14,
                fontFamily: "Inter_500Medium",
                marginTop: 20,
                marginBottom: 8,
              }}
              maxFontSizeMultiplier={1.3}
            >
              Pay with
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {CRYPTO_OPTIONS.map((crypto) => {
                const info = CURRENCIES[crypto];
                const isSelected = selectedCrypto === crypto;
                const wallet = wallets?.find((w) => w.currency === crypto);
                const bal = wallet ? parseFloat(wallet.balance) : 0;

                return (
                  <Pressable
                    key={crypto}
                    onPress={() => {
                      setSelectedCrypto(crypto);
                      setQuote(null);
                    }}
                    style={{
                      flex: 1,
                      borderRadius: 16,
                      padding: 12,
                      borderWidth: 1,
                      borderColor: isSelected
                        ? colors.primary[500]
                        : colors.dark.border,
                      backgroundColor: isSelected
                        ? colors.primary[500] + "1A"
                        : "#0C1A2E",
                      ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Pay with ${crypto}`}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontFamily: "Inter_600SemiBold",
                        color: isSelected ? colors.primary[400] : "#fff",
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {info.symbol}
                    </Text>
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 12,
                        fontFamily: "Inter_400Regular",
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
                  backgroundColor: "#0C1A2E",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.primary[500] + "4D",
                  padding: 16,
                  marginTop: 20,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 8,
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
                      color: "#fff",
                      fontSize: 14,
                      fontFamily: "Inter_500Medium",
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
                    marginBottom: 8,
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
                      color: "#fff",
                      fontSize: 14,
                      fontFamily: "Inter_500Medium",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    KSh {quote.fee_kes}
                  </Text>
                </View>
                <View
                  style={{
                    height: 1,
                    backgroundColor: colors.dark.border,
                    marginVertical: 8,
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
                      color: colors.textSecondary,
                      fontSize: 14,
                      fontFamily: "Inter_500Medium",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Total
                  </Text>
                  <Text
                    style={{
                      color: colors.primary[400],
                      fontSize: 16,
                      fontFamily: "Inter_700Bold",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {quote.crypto_amount} {selectedCrypto}
                  </Text>
                </View>
                {parseFloat(quote.crypto_amount) > balance && (
                  <Text
                    style={{
                      color: colors.error,
                      fontSize: 12,
                      fontFamily: "Inter_400Regular",
                      marginTop: 8,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Insufficient {selectedCrypto} balance
                  </Text>
                )}
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 12,
                    fontFamily: "Inter_400Regular",
                    marginTop: 8,
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Rate locked for 30 seconds
                </Text>
              </View>
            )}

            {/* Action Button */}
            <View style={{ marginTop: 24, marginBottom: 32 }}>
              {!quote ? (
                <Button
                  title="Get Quote"
                  onPress={handleGetQuote}
                  loading={loading}
                  disabled={!phone || !amount}
                  size="lg"
                  testID="get-quote-button"
                />
              ) : (
                <Button
                  title="Confirm Payment"
                  onPress={handleConfirm}
                  disabled={parseFloat(quote.crypto_amount) > balance}
                  size="lg"
                  testID="confirm-payment-button"
                />
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
