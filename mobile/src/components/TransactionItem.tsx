import { View, Text, Pressable, Animated, Platform } from "react-native";
import { useRef, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Transaction, getTxKesAmount, getTxRecipient } from "../api/payments";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { usePhonePrivacy } from "../utils/privacy";

const useNative = Platform.OS !== "web";

const TYPE_CONFIG: Record<
  string,
  { icon: string; label: string; color: string }
> = {
  PAYBILL_PAYMENT: {
    icon: "receipt-outline",
    label: "Pay Bill",
    color: colors.primary[400],
  },
  TILL_PAYMENT: {
    icon: "cart-outline",
    label: "Buy Goods",
    color: colors.info,
  },
  DEPOSIT: {
    icon: "arrow-down-circle-outline",
    label: "Deposit",
    color: colors.success,
  },
  WITHDRAWAL: {
    icon: "arrow-up-circle-outline",
    label: "Withdraw",
    color: colors.warning,
  },
  SEND_MPESA: {
    icon: "phone-portrait-outline",
    label: "Send M-Pesa",
    color: colors.accent,
  },
  BUY: {
    icon: "swap-horizontal-outline",
    label: "Buy",
    color: colors.primary[400],
  },
  SELL: {
    icon: "swap-vertical-outline",
    label: "Sell",
    color: colors.accentDark,
  },
  KES_DEPOSIT: {
    icon: "arrow-down-circle-outline",
    label: "KES Deposit",
    color: colors.success,
  },
  KES_DEPOSIT_C2B: {
    icon: "arrow-down-circle-outline",
    label: "KES Deposit (Paybill)",
    color: colors.success,
  },
};

interface TransactionItemProps {
  transaction: Transaction;
  onPress?: () => void;
}

export function TransactionItem({ transaction, onPress }: TransactionItemProps) {
  const router = useRouter();
  const { formatPhone } = usePhonePrivacy();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/payment/detail?id=${transaction.id}` as any);
    }
  };

  const scale = useRef(new Animated.Value(1)).current;
  const handlePressIn = useCallback(() => {
    Animated.spring(scale, { toValue: 0.97, friction: 8, useNativeDriver: useNative }).start();
  }, []);
  const handlePressOut = useCallback(() => {
    Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: useNative }).start();
  }, []);

  const config = TYPE_CONFIG[transaction.type] || {
    icon: "ellipsis-horizontal",
    label: transaction.type,
    color: tc.dark.muted,
  };

  // FEE type uses theme-dependent muted color
  const resolvedColor =
    transaction.type === "FEE" ? tc.dark.muted : config.color;

  const statusConfig: Record<string, { color: string; bg: string }> = {
    completed: { color: colors.success, bg: colors.success + "1F" },
    pending: { color: colors.warning, bg: colors.warning + "1F" },
    processing: { color: colors.info, bg: colors.info + "1F" },
    failed: { color: colors.error, bg: colors.error + "1F" },
    reversed: { color: tc.dark.muted, bg: tc.dark.muted + "1F" },
  };

  const currentStatus = statusConfig[transaction.status] || {
    color: tc.dark.muted,
    bg: tc.dark.muted + "1F",
  };

  const kesAmount = getTxKesAmount(transaction);
  const date = new Date(transaction.created_at);
  const timeStr = date.toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = date.toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
  });

  const rawRecipient = getTxRecipient(transaction);
  // Mask phone numbers based on privacy setting; leave paybill/till numbers unmasked
  const recipient = rawRecipient && transaction.type === "SEND_MPESA"
    ? formatPhone(rawRecipient)
    : rawRecipient;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({ pressed, hovered }: any) => [
          {
            flexDirection: "row" as const,
            alignItems: "center" as const,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderRadius: 12,
            ...(Platform.OS === "web" ? { cursor: "pointer", transition: "background-color 0.15s ease" } as any : {}),
          },
          (hovered && Platform.OS === "web") && { backgroundColor: tc.glass.highlight },
          pressed && { backgroundColor: tc.glass.bgLight },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${config.label} ${
          recipient || ""
        } KSh ${kesAmount.toLocaleString("en-KE")} ${transaction.status}`}
      >
        {/* Icon */}
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
            backgroundColor: resolvedColor + "1A",
          }}
        >
          <Ionicons name={config.icon as any} size={22} color={resolvedColor} />
        </View>

        {/* Details */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 15,
              fontFamily: "DMSans_600SemiBold",
              marginBottom: 2,
            }}
            maxFontSizeMultiplier={1.3}
          >
            {config.label}
          </Text>
          <Text
            style={{
              color: tc.dark.muted,
              fontSize: 13,
              fontFamily: "DMSans_400Regular",
            }}
            numberOfLines={1}
          >
            {recipient || `${dateStr} ${timeStr}`}
          </Text>
        </View>

        {/* Amount & Status */}
        <View style={{ alignItems: "flex-end" as const }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 15,
              fontFamily: "DMSans_700Bold",
              marginBottom: 4,
            }}
            maxFontSizeMultiplier={1.2}
          >
            KSh{" "}
            {kesAmount.toLocaleString("en-KE", { minimumFractionDigits: 0 })}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 10,
              gap: 4,
              backgroundColor: currentStatus.bg,
            }}
          >
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 2.5,
                backgroundColor: currentStatus.color,
              }}
            />
            <Text
              style={{
                fontSize: 11,
                fontFamily: "DMSans_500Medium",
                textTransform: "capitalize",
                color: currentStatus.color,
              }}
            >
              {transaction.status}
            </Text>
          </View>
        </View>
      </Pressable>

      {/* Subtle divider */}
      <View
        style={{
          height: 1,
          backgroundColor: tc.glass.border,
          marginLeft: 72,
        }}
      />
    </Animated.View>
  );
}
