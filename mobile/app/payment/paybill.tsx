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

const C = {
  bg: "#060E1F",
  card: "#0C1A2E",
  text: "#F0F4F8",
  muted: "#556B82",
  secondary: "#8899AA",
  border: colors.dark.border,
  green: colors.primary[500],
  greenLight: colors.primary[400],
  greenFaint: "rgba(16, 185, 129, 0.10)",
  greenBorder: "rgba(16, 185, 129, 0.30)",
  error: colors.error,
};

export default function PayBillScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= 768;
  const { data: wallets } = useWallets();
  const [paybillNumber, setPaybillNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CurrencyCode>("USDT");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);

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
    focusedField === field ? C.green : C.border;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
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
          {/* Desktop wrapper card */}
          <View
            style={
              isDesktop
                ? {
                    width: "100%",
                    maxWidth: 560,
                    backgroundColor: C.card,
                    borderRadius: 20,
                    padding: 36,
                    borderWidth: 1,
                    borderColor: C.border,
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
              <Pressable
                onPress={() => router.back()}
                hitSlop={12}
                style={{ padding: 8 }}
              >
                <Ionicons name="arrow-back" size={24} color={C.text} />
              </Pressable>
              <Text
                style={{
                  color: C.text,
                  fontSize: isDesktop ? 22 : 18,
                  fontWeight: "600",
                  marginLeft: 8,
                }}
              >
                Pay Bill
              </Text>
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
                  color: C.secondary,
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
                placeholderTextColor={C.muted}
                keyboardType="number-pad"
                onFocus={() => setFocusedField("paybill")}
                onBlur={() => setFocusedField(null)}
                style={{
                  backgroundColor: C.card,
                  color: C.text,
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
                  color: C.secondary,
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
                placeholderTextColor={C.muted}
                onFocus={() => setFocusedField("account")}
                onBlur={() => setFocusedField(null)}
                style={{
                  backgroundColor: C.card,
                  color: C.text,
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
                  color: C.secondary,
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
                  backgroundColor: C.card,
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
                    color: C.secondary,
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
                  placeholderTextColor={C.muted}
                  keyboardType="numeric"
                  onFocus={() => setFocusedField("amount")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: C.text,
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
                  color: C.secondary,
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
                  const brandColor = colors.crypto[crypto] ?? C.green;

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
                        borderColor: isSelected ? C.green : C.border,
                        backgroundColor: isSelected ? C.greenFaint : C.card,
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
                              : C.border,
                            alignItems: "center",
                            justifyContent: "center",
                            marginRight: 6,
                          }}
                        >
                          <Text
                            style={{
                              color: isSelected ? "#fff" : C.secondary,
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
                            color: isSelected ? C.greenLight : C.text,
                          }}
                        >
                          {info.symbol}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: C.muted,
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
                    backgroundColor: C.card,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: C.greenBorder,
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
                    <Text style={{ color: C.muted, fontSize: 14 }}>Rate</Text>
                    <Text
                      style={{
                        color: C.text,
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
                    <Text style={{ color: C.muted, fontSize: 14 }}>Fee</Text>
                    <Text
                      style={{
                        color: C.text,
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
                      <Text style={{ color: C.muted, fontSize: 14 }}>Excise Duty (10%)</Text>
                      <Text
                        style={{
                          color: C.text,
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
                      backgroundColor: C.border,
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
                        color: C.secondary,
                        fontSize: 14,
                        fontWeight: "500",
                      }}
                    >
                      Total
                    </Text>
                    <Text
                      style={{
                        color: C.greenLight,
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
                        color: C.error,
                        fontSize: 12,
                        marginTop: 8,
                      }}
                    >
                      Insufficient {selectedCrypto} balance
                    </Text>
                  )}
                  <Text
                    style={{
                      color: C.muted,
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
