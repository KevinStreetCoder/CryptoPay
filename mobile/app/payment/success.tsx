import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import * as Haptics from "expo-haptics";
import { Button } from "../../src/components/Button";
import { colors } from "../../src/constants/theme";

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    amount_kes: string;
    crypto_amount: string;
    crypto_currency: string;
    recipient: string;
  }>();

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-dark-bg">
      <View className="flex-1 items-center justify-center px-6">
        {/* Success Icon */}
        <View className="w-24 h-24 rounded-full bg-success/15 items-center justify-center mb-6">
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        </View>

        <Text className="text-white text-2xl font-inter-bold mb-2">
          Payment Sent!
        </Text>
        <Text className="text-textSecondary text-sm font-inter text-center mb-8">
          Your payment is being processed via M-Pesa
        </Text>

        {/* Details Card */}
        <View className="bg-dark-card rounded-2xl p-5 w-full mb-8">
          <View className="flex-row justify-between mb-3">
            <Text className="text-textMuted text-sm font-inter">Amount</Text>
            <Text className="text-white text-base font-inter-bold">
              KSh {parseFloat(params.amount_kes || "0").toLocaleString()}
            </Text>
          </View>
          <View className="flex-row justify-between mb-3">
            <Text className="text-textMuted text-sm font-inter">Crypto Used</Text>
            <Text className="text-white text-sm font-inter-medium">
              {params.crypto_amount} {params.crypto_currency}
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-textMuted text-sm font-inter">Sent To</Text>
            <Text className="text-white text-sm font-inter-medium">
              {params.recipient}
            </Text>
          </View>
        </View>

        <Text className="text-textMuted text-xs font-inter text-center mb-8">
          You'll receive an M-Pesa confirmation SMS shortly.{"\n"}
          Transaction details are in your history.
        </Text>
      </View>

      <View className="px-6 mb-8 gap-3">
        <Button
          title="Done"
          onPress={() => router.replace("/(tabs)")}
          size="lg"
        />
        <Button
          title="Make Another Payment"
          onPress={() => router.replace("/(tabs)/pay")}
          variant="secondary"
          size="lg"
        />
      </View>
    </SafeAreaView>
  );
}
