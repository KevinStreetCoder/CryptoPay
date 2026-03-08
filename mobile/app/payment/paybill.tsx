import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
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

export default function PayBillScreen() {
  const router = useRouter();
  const { data: wallets } = useWallets();
  const [paybillNumber, setPaybillNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CurrencyCode>("USDT");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);

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
        crypto_amount: quote.total_crypto,
        rate: quote.rate,
        fee: quote.fee,
      },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-dark-bg">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View className="flex-row items-center px-4 py-3">
            <Pressable onPress={() => router.back()} hitSlop={12} className="p-2">
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </Pressable>
            <Text className="text-white text-lg font-inter-semibold ml-2">
              Pay Bill
            </Text>
          </View>

          <View className="px-5 mt-2">
            {/* Paybill Number */}
            <Text className="text-textSecondary text-sm font-inter-medium mb-2">
              Paybill Number
            </Text>
            <TextInput
              value={paybillNumber}
              onChangeText={setPaybillNumber}
              placeholder="e.g. 888880"
              placeholderTextColor={colors.dark.muted}
              keyboardType="number-pad"
              className="bg-dark-card text-white text-base font-inter rounded-xl border border-dark-border px-4 py-3.5 mb-4"
              accessibilityLabel="Paybill Number"
              testID="paybill-number-input"
              maxFontSizeMultiplier={1.3}
            />

            {/* Account Number */}
            <Text className="text-textSecondary text-sm font-inter-medium mb-2">
              Account Number
            </Text>
            <TextInput
              value={accountNumber}
              onChangeText={setAccountNumber}
              placeholder="e.g. 12345678"
              placeholderTextColor={colors.dark.muted}
              className="bg-dark-card text-white text-base font-inter rounded-xl border border-dark-border px-4 py-3.5 mb-4"
              accessibilityLabel="Account Number"
              testID="account-number-input"
              maxFontSizeMultiplier={1.3}
            />

            {/* Amount */}
            <Text className="text-textSecondary text-sm font-inter-medium mb-2">
              Amount (KES)
            </Text>
            <View className="flex-row items-center bg-dark-card rounded-xl border border-dark-border px-4">
              <Text className="text-textSecondary text-lg font-inter-bold mr-1">
                KSh
              </Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={colors.dark.muted}
                keyboardType="numeric"
                className="flex-1 text-white text-2xl font-inter-bold py-3"
              />
            </View>

            {/* Crypto Selector */}
            <Text className="text-textSecondary text-sm font-inter-medium mt-5 mb-2">
              Pay with
            </Text>
            <View className="flex-row gap-2">
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
                    className={`flex-1 rounded-xl p-3 border ${
                      isSelected
                        ? "border-primary-500 bg-primary-500/10"
                        : "border-dark-border bg-dark-card"
                    }`}
                  >
                    <Text
                      className={`text-sm font-inter-semibold ${
                        isSelected ? "text-primary-400" : "text-white"
                      }`}
                    >
                      {info.symbol}
                    </Text>
                    <Text className="text-textMuted text-xs font-inter mt-0.5">
                      {bal.toFixed(info.decimals > 4 ? 4 : info.decimals)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Quote Display */}
            {quote && (
              <View className="bg-dark-card rounded-xl border border-primary-500/30 p-4 mt-5">
                <View className="flex-row justify-between mb-2">
                  <Text className="text-textMuted text-sm font-inter">Rate</Text>
                  <Text className="text-white text-sm font-inter-medium">
                    1 {selectedCrypto} = KSh{" "}
                    {parseFloat(quote.rate).toLocaleString()}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-textMuted text-sm font-inter">Fee</Text>
                  <Text className="text-white text-sm font-inter-medium">
                    {quote.fee} {selectedCrypto}
                  </Text>
                </View>
                <View className="h-px bg-dark-border my-2" />
                <View className="flex-row justify-between">
                  <Text className="text-textSecondary text-sm font-inter-medium">
                    Total
                  </Text>
                  <Text className="text-primary-400 text-base font-inter-bold">
                    {quote.total_crypto} {selectedCrypto}
                  </Text>
                </View>
                {parseFloat(quote.total_crypto) > balance && (
                  <Text className="text-error text-xs font-inter mt-2">
                    Insufficient {selectedCrypto} balance
                  </Text>
                )}
                <Text className="text-textMuted text-xs font-inter mt-2">
                  Rate locked for 30 seconds
                </Text>
              </View>
            )}

            {/* Action Button */}
            <View className="mt-6 mb-8">
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
                  disabled={parseFloat(quote.total_crypto) > balance}
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
