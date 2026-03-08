import { useState } from "react";
import { View, Text, Alert, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { paymentsApi } from "../../src/api/payments";
import { colors } from "../../src/constants/theme";

export default function ConfirmPaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    type: string;
    paybill_number?: string;
    account_number?: string;
    till_number?: string;
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
          paybill_number: params.paybill_number!,
          account_number: params.account_number!,
          amount_kes: params.amount_kes,
          crypto_currency: params.crypto_currency,
          pin,
          idempotency_key: idempotencyKey,
          quote_id: params.quote_id,
        });
      } else {
        await paymentsApi.payTill({
          till_number: params.till_number!,
          amount_kes: params.amount_kes,
          crypto_currency: params.crypto_currency,
          pin,
          idempotency_key: idempotencyKey,
          quote_id: params.quote_id,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({
        pathname: "/payment/success",
        params: {
          amount_kes: params.amount_kes,
          crypto_amount: params.crypto_amount,
          crypto_currency: params.crypto_currency,
          recipient: params.paybill_number || params.till_number || "",
        },
      });
    } catch (err: any) {
      setPinError(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Payment Failed",
        err.response?.data?.error || "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const isPaybill = params.type === "paybill";

  return (
    <SafeAreaView className="flex-1 bg-dark-bg">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3">
        <Pressable onPress={() => router.back()} hitSlop={12} className="p-2">
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text className="text-white text-lg font-inter-semibold ml-2">
          {step === "review" ? "Confirm Payment" : "Enter PIN"}
        </Text>
      </View>

      {step === "review" ? (
        <View className="flex-1 px-5">
          {/* Payment Summary Card */}
          <View className="bg-dark-card rounded-2xl p-5 mt-4">
            <View className="items-center mb-4">
              <View className="w-14 h-14 rounded-full bg-primary-500/15 items-center justify-center mb-2">
                <Ionicons
                  name={isPaybill ? "receipt-outline" : "cart-outline"}
                  size={28}
                  color={colors.primary[400]}
                />
              </View>
              <Text className="text-textMuted text-sm font-inter">
                {isPaybill ? "Pay Bill" : "Buy Goods"}
              </Text>
            </View>

            {/* Amount */}
            <Text className="text-white text-3xl font-inter-bold text-center mb-6">
              KSh {parseFloat(params.amount_kes).toLocaleString()}
            </Text>

            {/* Details */}
            <View className="gap-3">
              <View className="flex-row justify-between">
                <Text className="text-textMuted text-sm font-inter">
                  {isPaybill ? "Paybill" : "Till Number"}
                </Text>
                <Text className="text-white text-sm font-inter-medium">
                  {isPaybill ? params.paybill_number : params.till_number}
                </Text>
              </View>

              {isPaybill && params.account_number && (
                <View className="flex-row justify-between">
                  <Text className="text-textMuted text-sm font-inter">
                    Account
                  </Text>
                  <Text className="text-white text-sm font-inter-medium">
                    {params.account_number}
                  </Text>
                </View>
              )}

              <View className="h-px bg-dark-border" />

              <View className="flex-row justify-between">
                <Text className="text-textMuted text-sm font-inter">
                  Paying with
                </Text>
                <Text className="text-white text-sm font-inter-medium">
                  {params.crypto_amount} {params.crypto_currency}
                </Text>
              </View>

              <View className="flex-row justify-between">
                <Text className="text-textMuted text-sm font-inter">Rate</Text>
                <Text className="text-white text-sm font-inter-medium">
                  1 {params.crypto_currency} = KSh{" "}
                  {parseFloat(params.rate).toLocaleString()}
                </Text>
              </View>

              <View className="flex-row justify-between">
                <Text className="text-textMuted text-sm font-inter">Fee</Text>
                <Text className="text-white text-sm font-inter-medium">
                  {params.fee} {params.crypto_currency}
                </Text>
              </View>
            </View>
          </View>

          <View className="flex-1" />

          <View className="mb-8">
            <Button title="Pay Now" onPress={handleConfirm} size="lg" />
          </View>
        </View>
      ) : (
        <View className="flex-1 px-5 pt-12">
          <Text className="text-white text-lg font-inter-semibold text-center mb-2">
            Enter your PIN to confirm
          </Text>
          <Text className="text-textMuted text-sm font-inter text-center mb-8">
            KSh {parseFloat(params.amount_kes).toLocaleString()} →{" "}
            {params.paybill_number || params.till_number}
          </Text>

          <PinInput onComplete={handlePinComplete} error={pinError} />

          {loading && (
            <Text className="text-primary-400 text-sm font-inter text-center mt-8">
              Processing payment...
            </Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
