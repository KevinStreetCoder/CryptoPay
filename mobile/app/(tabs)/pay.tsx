import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/theme";

const PAYMENT_OPTIONS = [
  {
    id: "paybill",
    title: "Pay Bill",
    subtitle: "KPLC, DSTV, Water, Internet & more",
    icon: "receipt-outline",
    color: colors.primary[400],
    route: "/payment/paybill" as const,
  },
  {
    id: "till",
    title: "Buy Goods & Services",
    subtitle: "Pay merchants via Till number",
    icon: "cart-outline",
    color: colors.info,
    route: "/payment/till" as const,
  },
  {
    id: "send",
    title: "Send to M-Pesa",
    subtitle: "Send money to any M-Pesa number",
    icon: "phone-portrait-outline",
    color: colors.success,
    route: "/payment/paybill" as const, // TODO: separate route
  },
];

export default function PayScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-dark-bg">
      {/* Header */}
      <View className="px-5 pt-2 pb-4">
        <Text className="text-white text-2xl font-inter-bold">Pay</Text>
        <Text className="text-textSecondary text-sm font-inter mt-1">
          Pay any Kenyan bill or merchant with crypto
        </Text>
      </View>

      {/* How it works */}
      <View className="bg-dark-card rounded-2xl mx-4 p-4 mb-5">
        <Text className="text-primary-400 text-sm font-inter-semibold mb-3">
          How it works
        </Text>
        <View className="flex-row items-start mb-2">
          <View className="w-6 h-6 rounded-full bg-primary-500/20 items-center justify-center mr-3 mt-0.5">
            <Text className="text-primary-400 text-xs font-inter-bold">1</Text>
          </View>
          <Text className="text-textSecondary text-sm font-inter flex-1">
            Enter the Paybill/Till number and amount in KES
          </Text>
        </View>
        <View className="flex-row items-start mb-2">
          <View className="w-6 h-6 rounded-full bg-primary-500/20 items-center justify-center mr-3 mt-0.5">
            <Text className="text-primary-400 text-xs font-inter-bold">2</Text>
          </View>
          <Text className="text-textSecondary text-sm font-inter flex-1">
            We convert your crypto to KES at the best rate
          </Text>
        </View>
        <View className="flex-row items-start">
          <View className="w-6 h-6 rounded-full bg-primary-500/20 items-center justify-center mr-3 mt-0.5">
            <Text className="text-primary-400 text-xs font-inter-bold">3</Text>
          </View>
          <Text className="text-textSecondary text-sm font-inter flex-1">
            Payment is sent instantly via M-Pesa
          </Text>
        </View>
      </View>

      {/* Payment Options */}
      <View className="px-4 gap-3">
        {PAYMENT_OPTIONS.map((option) => (
          <Pressable
            key={option.id}
            onPress={() => router.push(option.route)}
            className="bg-dark-card rounded-2xl p-4 flex-row items-center active:bg-dark-elevated"
          >
            <View
              className="w-12 h-12 rounded-xl items-center justify-center mr-4"
              style={{ backgroundColor: option.color + "15" }}
            >
              <Ionicons
                name={option.icon as any}
                size={24}
                color={option.color}
              />
            </View>
            <View className="flex-1">
              <Text className="text-white text-base font-inter-semibold">
                {option.title}
              </Text>
              <Text className="text-textMuted text-sm font-inter mt-0.5">
                {option.subtitle}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.dark.muted}
            />
          </Pressable>
        ))}
      </View>

      {/* Supported Providers */}
      <View className="mt-6 px-5">
        <Text className="text-textMuted text-xs font-inter text-center">
          Supported: KPLC, Safaricom, Airtel, Nairobi Water, DSTV, Zuku,
          StarTimes, NHIF, KRA and 1000+ more billers
        </Text>
      </View>
    </SafeAreaView>
  );
}
