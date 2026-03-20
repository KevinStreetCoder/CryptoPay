import { View, Text, Pressable, Animated, Platform } from "react-native";
import { useRef, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Transaction, getTxKesAmount, getTxRecipient } from "../api/payments";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { usePhonePrivacy } from "../utils/privacy";

const useNative = Platform.OS !== "web";

const CHAIN_LABELS: Record<string, string> = {
  tron: "TRC-20",
  ethereum: "ERC-20",
  bitcoin: "BTC",
  solana: "SOL",
  polygon: "Polygon",
};

const TYPE_CONFIG: Record<
  string,
  { icon: string; label: string; color: string; getSubtitle?: (tx: Transaction) => string }
> = {
  CRYPTO_DEPOSIT: {
    icon: "arrow-down-circle",
    label: "Received",
    color: colors.success,
    getSubtitle: (tx) => {
      const amt = parseFloat(tx.source_amount || "0");
      const chain = CHAIN_LABELS[tx.chain] || tx.chain;
      return `${amt > 0 ? amt : ""} ${tx.source_currency}${chain ? ` (${chain})` : ""}`;
    },
  },
  PAYBILL_PAYMENT: {
    icon: "receipt-outline",
    label: "Pay Bill",
    color: colors.info,
    getSubtitle: (tx) => {
      const parts = [];
      if (tx.mpesa_paybill) parts.push(`Paybill ${tx.mpesa_paybill}`);
      if (tx.mpesa_account) parts.push(`Acc: ${tx.mpesa_account}`);
      return parts.join(" - ") || "";
    },
  },
  TILL_PAYMENT: {
    icon: "cart-outline",
    label: "Buy Goods",
    color: "#8B5CF6",
    getSubtitle: (tx) => tx.mpesa_till ? `Till ${tx.mpesa_till}` : "",
  },
  DEPOSIT: {
    icon: "arrow-down-circle-outline",
    label: "Deposit",
    color: colors.success,
  },
  WITHDRAWAL: {
    icon: "arrow-up-circle",
    label: "Withdraw",
    color: colors.error,
    getSubtitle: (tx) => {
      const amt = parseFloat(tx.source_amount || "0");
      return `${amt > 0 ? amt : ""} ${tx.source_currency || ""}`.trim();
    },
  },
  SEND_MPESA: {
    icon: "send-outline",
    label: "Send M-Pesa",
    color: colors.accent,
  },
  BUY: {
    icon: "add-circle-outline",
    label: "Buy",
    color: "#10B981",
    getSubtitle: (tx) => {
      const amt = parseFloat(tx.dest_amount || "0");
      return amt > 0 ? `Bought ${amt} ${tx.dest_currency}` : "";
    },
  },
  SELL: {
    icon: "swap-vertical-outline",
    label: "Sell",
    color: colors.accentDark,
  },
  SWAP: {
    icon: "swap-horizontal-outline",
    label: "Swap",
    color: colors.crypto?.ETH || "#627EEA",
    getSubtitle: (tx) => {
      const srcAmt = parseFloat(tx.source_amount || "0");
      const destAmt = parseFloat(tx.dest_amount || "0");
      return `${srcAmt} ${tx.source_currency} → ${destAmt > 0 ? destAmt.toFixed(6) : ""} ${tx.dest_currency}`;
    },
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
      router.push(`/payment/detail?id=${transaction.id}&type=${transaction.type}` as any);
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
    confirming: { color: colors.info, bg: colors.info + "1F" },
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

  // Build subtitle: type-specific or recipient or date
  let subtitle = "";
  if (config.getSubtitle) {
    subtitle = config.getSubtitle(transaction);
  }
  if (!subtitle) {
    const rawRecipient = getTxRecipient(transaction);
    subtitle = rawRecipient && transaction.type === "SEND_MPESA"
      ? formatPhone(rawRecipient)
      : rawRecipient || `${dateStr} ${timeStr}`;
  }

  // For crypto deposits, show chain badge
  const showChainBadge = transaction.type === "CRYPTO_DEPOSIT" && transaction.chain;

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
        accessibilityLabel={`${config.label} ${subtitle} KSh ${kesAmount.toLocaleString("en-KE")} ${transaction.status}`}
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
          {/* Chain badge for crypto deposits */}
          {showChainBadge && (
            <View
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                backgroundColor: tc.dark.card,
                borderRadius: 6,
                paddingHorizontal: 4,
                paddingVertical: 1,
                borderWidth: 1,
                borderColor: tc.glass.border,
              }}
            >
              <Text
                style={{
                  fontSize: 8,
                  fontFamily: "DMSans_600SemiBold",
                  color: tc.textSecondary,
                  textTransform: "uppercase",
                }}
              >
                {CHAIN_LABELS[transaction.chain] || transaction.chain}
              </Text>
            </View>
          )}
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
            {subtitle}
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
