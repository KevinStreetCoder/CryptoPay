import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Transaction, getTxKesAmount, getTxRecipient } from "../api/payments";
import { colors } from "../constants/theme";
import { usePhonePrivacy } from "../utils/privacy";

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
  FEE: {
    icon: "pricetag-outline",
    label: "Fee",
    color: colors.dark.muted,
  },
};

const STATUS_CONFIG: Record<
  string,
  { color: string; bg: string }
> = {
  completed: { color: colors.success, bg: colors.success + "1F" },
  pending: { color: colors.warning, bg: colors.warning + "1F" },
  processing: { color: colors.info, bg: colors.info + "1F" },
  failed: { color: colors.error, bg: colors.error + "1F" },
  reversed: { color: colors.dark.muted, bg: colors.dark.muted + "1F" },
};

interface TransactionItemProps {
  transaction: Transaction;
  onPress?: () => void;
}

export function TransactionItem({ transaction, onPress }: TransactionItemProps) {
  const router = useRouter();
  const { formatPhone } = usePhonePrivacy();

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/payment/detail?id=${transaction.id}` as any);
    }
  };

  const config = TYPE_CONFIG[transaction.type] || {
    icon: "ellipsis-horizontal",
    label: transaction.type,
    color: colors.dark.muted,
  };

  const statusConfig = STATUS_CONFIG[transaction.status] || {
    color: colors.dark.muted,
    bg: colors.dark.muted + "1F",
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
    <View>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.container,
          pressed && styles.containerPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${config.label} ${
          recipient || ""
        } KSh ${kesAmount.toLocaleString("en-KE")} ${transaction.status}`}
      >
        {/* Icon */}
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: config.color + "1A" }, // 10% opacity
          ]}
        >
          <Ionicons name={config.icon as any} size={22} color={config.color} />
        </View>

        {/* Details */}
        <View style={styles.details}>
          <Text style={styles.label} maxFontSizeMultiplier={1.3}>
            {config.label}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {recipient || `${dateStr} ${timeStr}`}
          </Text>
        </View>

        {/* Amount & Status */}
        <View style={styles.amountContainer}>
          <Text style={styles.amount} maxFontSizeMultiplier={1.2}>
            KSh{" "}
            {kesAmount.toLocaleString("en-KE", { minimumFractionDigits: 0 })}
          </Text>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: statusConfig.bg },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: statusConfig.color },
              ]}
            />
            <Text
              style={[
                styles.statusText,
                { color: statusConfig.color },
              ]}
            >
              {transaction.status}
            </Text>
          </View>
        </View>
      </Pressable>

      {/* Subtle divider */}
      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  containerPressed: {
    backgroundColor: "rgba(22, 39, 66, 0.4)",
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  details: {
    flex: 1,
  },
  label: {
    color: colors.textPrimary,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  subtitle: {
    color: colors.dark.muted,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  amountContainer: {
    alignItems: "flex-end",
  },
  amount: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "capitalize",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    marginLeft: 72, // align with text after icon
  },
});
