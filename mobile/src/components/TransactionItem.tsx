import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Transaction } from "../api/payments";
import { colors } from "../constants/theme";

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  PAYBILL_PAYMENT: { icon: "receipt-outline", label: "Pay Bill", color: colors.primary[400] },
  TILL_PAYMENT: { icon: "cart-outline", label: "Buy Goods", color: colors.info },
  DEPOSIT: { icon: "arrow-down-circle-outline", label: "Deposit", color: colors.success },
  WITHDRAWAL: { icon: "arrow-up-circle-outline", label: "Withdraw", color: colors.warning },
  SEND_MPESA: { icon: "phone-portrait-outline", label: "Send M-Pesa", color: colors.accent },
  BUY: { icon: "swap-horizontal-outline", label: "Buy", color: colors.primary[400] },
  SELL: { icon: "swap-vertical-outline", label: "Sell", color: colors.accentDark },
  FEE: { icon: "pricetag-outline", label: "Fee", color: colors.dark.muted },
};

const STATUS_COLORS: Record<string, string> = {
  completed: colors.success,
  pending: colors.warning,
  processing: colors.info,
  failed: colors.error,
  reversed: colors.dark.muted,
};

interface TransactionItemProps {
  transaction: Transaction;
  onPress?: () => void;
}

export function TransactionItem({ transaction, onPress }: TransactionItemProps) {
  const config = TYPE_CONFIG[transaction.type] || {
    icon: "ellipsis-horizontal",
    label: transaction.type,
    color: colors.dark.muted,
  };

  const kesAmount = parseFloat(transaction.kes_amount);
  const date = new Date(transaction.created_at);
  const timeStr = date.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  const dateStr = date.toLocaleDateString("en-KE", { day: "numeric", month: "short" });

  const recipient =
    transaction.recipient_name ||
    transaction.paybill_number ||
    transaction.till_number ||
    "";

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3 active:bg-dark-elevated"
    >
      {/* Icon */}
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: config.color + "20" }}
      >
        <Ionicons name={config.icon as any} size={20} color={config.color} />
      </View>

      {/* Details */}
      <View className="flex-1">
        <Text className="text-white text-sm font-inter-semibold">
          {config.label}
        </Text>
        <Text className="text-dark-muted text-xs font-inter" numberOfLines={1}>
          {recipient || `${dateStr} ${timeStr}`}
        </Text>
      </View>

      {/* Amount & Status */}
      <View className="items-end">
        <Text className="text-white text-sm font-inter-bold">
          KSh {kesAmount.toLocaleString("en-KE", { minimumFractionDigits: 0 })}
        </Text>
        <Text
          className="text-xs font-inter-medium capitalize"
          style={{ color: STATUS_COLORS[transaction.status] || colors.dark.muted }}
        >
          {transaction.status}
        </Text>
      </View>
    </Pressable>
  );
}
