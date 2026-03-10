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

export default function PayTillScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= 768;
  const { data: wallets } = useWallets();
  const [tillNumber, setTillNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CurrencyCode>("USDT");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [tillFocused, setTillFocused] = useState(false);
  const [amountFocused, setAmountFocused] = useState(false);

  const selectedWallet = wallets?.find((w) => w.currency === selectedCrypto);
  const balance = selectedWallet ? parseFloat(selectedWallet.balance) : 0;

  const toast = useToast();

  const handleGetQuote = async () => {
    if (!tillNumber || !amount) {
      toast.warning("Missing Fields", "Please fill in all fields");
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
    router.push({
      pathname: "/payment/confirm",
      params: {
        type: "till",
        till_number: tillNumber,
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
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={{ padding: 8 }}
            >
              <Ionicons name="arrow-back" size={24} color={colors.white} />
            </Pressable>
            <Text
              style={{
                color: colors.white,
                fontSize: 18,
                fontWeight: "600",
                marginLeft: 8,
              }}
            >
              Buy Goods
            </Text>
          </View>

          {/* Main Content — centered card on desktop */}
          <View
            style={
              isDesktop
                ? {
                    alignSelf: "center",
                    width: "100%",
                    maxWidth: 560,
                    backgroundColor: colors.dark.card,
                    borderRadius: 20,
                    padding: 32,
                    marginTop: 16,
                    marginBottom: 32,
                  }
                : {
                    paddingHorizontal: 20,
                    marginTop: 8,
                  }
            }
          >
            {/* Till Number */}
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 14,
                fontWeight: "500",
                marginBottom: 8,
              }}
            >
              Till Number
            </Text>
            <TextInput
              value={tillNumber}
              onChangeText={setTillNumber}
              placeholder="e.g. 5678901"
              placeholderTextColor={colors.dark.muted}
              keyboardType="number-pad"
              onFocus={() => setTillFocused(true)}
              onBlur={() => setTillFocused(false)}
              style={{
                backgroundColor: colors.dark.card,
                color: colors.white,
                fontSize: 16,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: tillFocused
                  ? colors.primary[500]
                  : colors.dark.border,
                paddingHorizontal: 16,
                paddingVertical: 14,
                marginBottom: 16,
                ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
                ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as any : {}),
                ...(tillFocused && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.15)' } as any : {}),
              }}
              accessibilityLabel="Till Number"
              testID="till-number-input"
              maxFontSizeMultiplier={1.3}
            />

            {/* Amount */}
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 14,
                fontWeight: "500",
                marginBottom: 8,
              }}
            >
              Amount (KES)
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: colors.dark.card,
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
                  fontWeight: "700",
                  marginRight: 4,
                }}
              >
                KSh
              </Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={colors.dark.muted}
                keyboardType="numeric"
                onFocus={() => setAmountFocused(true)}
                onBlur={() => setAmountFocused(false)}
                style={{
                  flex: 1,
                  color: colors.white,
                  fontSize: 24,
                  fontWeight: "700",
                  paddingVertical: 12,
                  ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
                }}
              />
            </View>

            {/* Crypto Selector */}
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 14,
                fontWeight: "500",
                marginTop: 20,
                marginBottom: 8,
              }}
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
                      borderRadius: 12,
                      padding: 12,
                      borderWidth: 1,
                      borderColor: isSelected
                        ? colors.primary[500]
                        : colors.dark.border,
                      backgroundColor: isSelected
                        ? "rgba(16, 185, 129, 0.1)"
                        : colors.dark.card,
                      ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: isSelected
                          ? colors.primary[400]
                          : colors.white,
                      }}
                    >
                      {info.symbol}
                    </Text>
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 12,
                        marginTop: 2,
                      }}
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
                  backgroundColor: colors.dark.card,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "rgba(16, 185, 129, 0.3)",
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
                    }}
                  >
                    Rate
                  </Text>
                  <Text
                    style={{
                      color: colors.white,
                      fontSize: 14,
                      fontWeight: "500",
                    }}
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
                    }}
                  >
                    Fee
                  </Text>
                  <Text
                    style={{
                      color: colors.white,
                      fontSize: 14,
                      fontWeight: "500",
                    }}
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
                      fontWeight: "500",
                    }}
                  >
                    Total
                  </Text>
                  <Text
                    style={{
                      color: colors.primary[400],
                      fontSize: 16,
                      fontWeight: "700",
                    }}
                  >
                    {quote.crypto_amount} {selectedCrypto}
                  </Text>
                </View>
                {parseFloat(quote.crypto_amount) > balance && (
                  <Text
                    style={{
                      color: colors.error,
                      fontSize: 12,
                      marginTop: 8,
                    }}
                  >
                    Insufficient {selectedCrypto} balance
                  </Text>
                )}
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 12,
                    marginTop: 8,
                  }}
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
                  disabled={!tillNumber || !amount}
                  size="lg"
                />
              ) : (
                <Button
                  title="Confirm Payment"
                  onPress={handleConfirm}
                  disabled={parseFloat(quote.crypto_amount) > balance}
                  size="lg"
                />
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
