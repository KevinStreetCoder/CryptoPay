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
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { useWallets } from "../../src/hooks/useWallets";
import { ratesApi, Quote } from "../../src/api/rates";
import { normalizeError } from "../../src/utils/apiErrors";
import { getThemeColors, getThemeShadows, CURRENCIES, CurrencyCode, colors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "BTC", "ETH"];

export default function PayBillScreen() {
  const router = useRouter();
  const { prefill, name: prefillName } = useLocalSearchParams<{ prefill?: string; name?: string }>();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= 768;
  const { data: wallets } = useWallets();
  const [paybillNumber, setPaybillNumber] = useState(prefill || "");
  const [accountNumber, setAccountNumber] = useState("");
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

  const handleGetQuote = async () => {
    if (!paybillNumber || !accountNumber || !amount) {
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
        type: "paybill",
        paybill_number: paybillNumber,
        account_number: accountNumber,
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

  const inputBorder = (field: string) =>
    focusedField === field ? tc.primary[500] : tc.dark.border;

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
          {/* Top-level back button (outside card) */}
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
              marginLeft: isDesktop ? 0 : 16,
              opacity: pressed ? 0.9 : 1,
              ...(Platform.OS === "web"
                ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any)
                : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
            <Text style={{ color: tc.textSecondary, fontSize: 15, fontWeight: "500" }}>
              Back
            </Text>
          </Pressable>

          {/* Desktop wrapper card */}
          <View
            style={
              isDesktop
                ? {
                    width: "100%",
                    maxWidth: 560,
                    backgroundColor: tc.dark.card,
                    borderRadius: 20,
                    padding: 36,
                    borderWidth: 1,
                    borderColor: tc.dark.border,
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
                marginBottom: isDesktop ? 12 : 0,
              }}
            >
              {/* Card back button → Pay page */}
              <Pressable
                onPress={() => router.replace("/(tabs)/pay" as any)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                testID="back-button"
                style={({ pressed, hovered }: any) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  backgroundColor: hovered ? tc.dark.elevated : tc.dark.card,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  opacity: pressed ? 0.8 : 1,
                  ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
                })}
              >
                <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
              </Pressable>

              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isDesktop ? 22 : 18,
                  fontWeight: "600",
                  marginLeft: 14,
                  flex: 1,
                }}
                maxFontSizeMultiplier={1.3}
              >
                Pay Bill
              </Text>

              {/* Step indicator pills */}
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
              {/* Paybill Number */}
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 14,
                  fontWeight: "500",
                  marginBottom: 8,
                }}
              >
                Paybill Number
              </Text>
              <TextInput
                value={paybillNumber}
                onChangeText={setPaybillNumber}
                placeholder="e.g. 888880"
                placeholderTextColor={tc.dark.muted}
                keyboardType="number-pad"
                onFocus={() => setFocusedField("paybill")}
                onBlur={() => setFocusedField(null)}
                style={{
                  backgroundColor: tc.dark.card,
                  color: tc.textPrimary,
                  fontSize: 16,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorder("paybill"),
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 16,
                  ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
                  ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as any : {}),
                  ...(focusedField === 'paybill' && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.15)' } as any : {}),
                }}
                accessibilityLabel="Paybill Number"
                testID="paybill-number-input"
                maxFontSizeMultiplier={1.3}
              />

              {/* Account Number */}
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 14,
                  fontWeight: "500",
                  marginBottom: 8,
                }}
              >
                Account Number
              </Text>
              <TextInput
                value={accountNumber}
                onChangeText={setAccountNumber}
                placeholder="e.g. 12345678"
                placeholderTextColor={tc.dark.muted}
                onFocus={() => setFocusedField("account")}
                onBlur={() => setFocusedField(null)}
                style={{
                  backgroundColor: tc.dark.card,
                  color: tc.textPrimary,
                  fontSize: 16,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorder("account"),
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 16,
                  ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
                  ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as any : {}),
                  ...(focusedField === 'account' && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.15)' } as any : {}),
                }}
                accessibilityLabel="Account Number"
                testID="account-number-input"
                maxFontSizeMultiplier={1.3}
              />

              {/* Amount */}
              <Text
                style={{
                  color: tc.textSecondary,
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
                  backgroundColor: tc.dark.card,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorder("amount"),
                  paddingHorizontal: 16,
                  ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as any : {}),
                  ...(focusedField === 'amount' && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.15)' } as any : {}),
                }}
              >
                <Text
                  style={{
                    color: tc.textSecondary,
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
                  placeholderTextColor={tc.dark.muted}
                  keyboardType="numeric"
                  onFocus={() => setFocusedField("amount")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
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
                  color: tc.textSecondary,
                  fontSize: 14,
                  fontWeight: "500",
                  marginTop: 20,
                  marginBottom: 8,
                }}
              >
                Pay with
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                }}
              >
                {CRYPTO_OPTIONS.map((crypto) => {
                  const info = CURRENCIES[crypto];
                  const isSelected = selectedCrypto === crypto;
                  const wallet = wallets?.find((w) => w.currency === crypto);
                  const bal = wallet ? parseFloat(wallet.balance) : 0;
                  const brandColor = colors.crypto[crypto] ?? tc.primary[500];

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
                        borderColor: isSelected ? tc.primary[500] : tc.dark.border,
                        backgroundColor: isSelected ? tc.primary[500] + "1A" : tc.dark.card,
                        ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginBottom: 4,
                        }}
                      >
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            backgroundColor: isSelected
                              ? brandColor
                              : tc.dark.border,
                            alignItems: "center",
                            justifyContent: "center",
                            marginRight: 6,
                          }}
                        >
                          <Text
                            style={{
                              color: isSelected ? "#fff" : tc.textSecondary,
                              fontSize: 13,
                              fontWeight: "700",
                            }}
                          >
                            {info.iconSymbol}
                          </Text>
                        </View>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "600",
                            color: isSelected ? tc.primary[400] : tc.textPrimary,
                          }}
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
                      >
                        {bal.toFixed(
                          info.decimals > 4 ? 4 : info.decimals
                        )}
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
                    borderColor: tc.primary[500] + "4D",
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
                    <Text style={{ color: tc.dark.muted, fontSize: 14 }}>Rate</Text>
                    <Text
                      style={{
                        color: tc.textPrimary,
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
                    <Text style={{ color: tc.dark.muted, fontSize: 14 }}>Fee</Text>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontWeight: "500",
                      }}
                    >
                      KSh {quote.fee_kes}
                    </Text>
                  </View>
                  {quote.excise_duty_kes && parseFloat(quote.excise_duty_kes) > 0 && (
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: tc.dark.muted, fontSize: 14 }}>Excise Duty (10%)</Text>
                      <Text
                        style={{
                          color: tc.textPrimary,
                          fontSize: 14,
                          fontWeight: "500",
                        }}
                      >
                        KSh {quote.excise_duty_kes}
                      </Text>
                    </View>
                  )}
                  <View
                    style={{
                      height: 1,
                      backgroundColor: tc.dark.border,
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
                        color: tc.textSecondary,
                        fontSize: 14,
                        fontWeight: "500",
                      }}
                    >
                      Total
                    </Text>
                    <Text
                      style={{
                        color: tc.primary[400],
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
                        color: tc.error,
                        fontSize: 12,
                        marginTop: 8,
                      }}
                    >
                      Insufficient {selectedCrypto} balance
                    </Text>
                  )}
                  <Text
                    style={{
                      color: tc.dark.muted,
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
                    disabled={!paybillNumber || !accountNumber || !amount}
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
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
