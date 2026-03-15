import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  Linking,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { paymentsApi, Transaction, getTxKesAmount, getTxCrypto, getTxRecipient } from "../../src/api/payments";
import { useToast } from "../../src/components/Toast";
import { colors, shadows, CURRENCIES, CurrencyCode, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { usePhonePrivacy } from "../../src/utils/privacy";
import { useLocale } from "../../src/hooks/useLocale";

const isWeb = Platform.OS === "web";

const CHAIN_LABELS: Record<string, string> = {
  tron: "Tron (TRC-20)",
  ethereum: "Ethereum (ERC-20)",
  bitcoin: "Bitcoin",
  solana: "Solana",
  polygon: "Polygon",
};

const EXPLORER_TX: Record<string, string> = {
  tron: "https://tronscan.org/#/transaction/",
  ethereum: "https://etherscan.io/tx/",
  bitcoin: "https://mempool.space/tx/",
  solana: "https://solscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
};

const EXPLORER_ADDR: Record<string, string> = {
  tron: "https://tronscan.org/#/address/",
  ethereum: "https://etherscan.io/address/",
  bitcoin: "https://mempool.space/address/",
  solana: "https://solscan.io/account/",
  polygon: "https://polygonscan.com/address/",
};

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  CRYPTO_DEPOSIT: { icon: "arrow-down-circle", label: "Crypto Deposit", color: colors.success },
  PAYBILL_PAYMENT: { icon: "receipt-outline", label: "Pay Bill", color: colors.info },
  TILL_PAYMENT: { icon: "cart-outline", label: "Buy Goods", color: "#8B5CF6" },
  DEPOSIT: { icon: "arrow-down-circle-outline", label: "Deposit", color: colors.success },
  WITHDRAWAL: { icon: "arrow-up-circle", label: "Withdrawal", color: colors.error },
  SEND_MPESA: { icon: "send-outline", label: "Send M-Pesa", color: colors.accent },
  BUY: { icon: "add-circle-outline", label: "Buy Crypto", color: "#10B981" },
  SELL: { icon: "swap-vertical-outline", label: "Sell", color: colors.accentDark },
  FEE: { icon: "pricetag-outline", label: "Fee", color: colors.dark.muted },
  KES_DEPOSIT: { icon: "arrow-down-circle-outline", label: "KES Deposit", color: colors.success },
  KES_DEPOSIT_C2B: { icon: "arrow-down-circle-outline", label: "KES Deposit (Paybill)", color: colors.success },
};

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  completed: { color: colors.success, bg: colors.success + "1F" },
  pending: { color: colors.warning, bg: colors.warning + "1F" },
  processing: { color: colors.info, bg: colors.info + "1F" },
  confirming: { color: colors.info, bg: colors.info + "1F" },
  failed: { color: colors.error, bg: colors.error + "1F" },
  reversed: { color: colors.dark.muted, bg: colors.dark.muted + "1F" },
};

const STATUS_I18N_KEY: Record<string, string> = {
  completed: "payment.completed",
  pending: "payment.pending",
  processing: "payment.processing",
  confirming: "payment.confirming",
  failed: "payment.failed",
  reversed: "payment.reversed",
};

// Timeline step definition
interface TimelineStep {
  label: string;
  icon: string;
  reached: boolean;
  active: boolean;
}

function getTimelineSteps(tx: Transaction): TimelineStep[] {
  const statusOrder = ["pending", "processing", "confirming", "completed"];
  const idx = statusOrder.indexOf(tx.status);
  const isFailed = tx.status === "failed" || tx.status === "reversed";

  // For crypto deposits, use a different flow
  if (tx.type === "CRYPTO_DEPOSIT") {
    const depositSteps = [
      { label: "Detected", icon: "search-outline", status: "pending" },
      { label: "Confirming", icon: "hourglass-outline", status: "confirming" },
      { label: "Credited", icon: "checkmark-circle-outline", status: "completed" },
    ];
    const depositIdx = tx.status === "completed" ? 2 : tx.status === "confirming" ? 1 : 0;
    return depositSteps.map((s, i) => ({
      label: s.label,
      icon: s.icon,
      reached: isFailed ? i === 0 : i <= depositIdx,
      active: isFailed ? false : i === depositIdx,
    }));
  }

  const steps = [
    { label: "Created", icon: "add-circle-outline", status: "pending" },
    { label: "Processing", icon: "hourglass-outline", status: "processing" },
    { label: "Completed", icon: "checkmark-circle-outline", status: "completed" },
  ];

  return steps.map((s, i) => ({
    label: s.label,
    icon: s.icon,
    reached: isFailed ? i === 0 : i <= Math.min(idx, steps.length - 1),
    active: isFailed ? false : statusOrder[Math.min(idx, steps.length - 1)] === s.status,
  }));
}

export default function TransactionDetailScreen() {
  const router = useRouter();
  const { id, type: txType } = useLocalSearchParams<{ id: string; type?: string }>();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();

  const { data: txData, isLoading } = useQuery({
    queryKey: ["transaction-detail", id],
    queryFn: async () => {
      // Use the unified activity endpoint to find the transaction
      const { data } = await paymentsApi.activity({ page_size: 50 });
      const found = data.results.find((tx: Transaction) => tx.id === id);
      if (found) return found;
      // Fallback: try old history endpoint
      const { data: historyData } = await paymentsApi.history();
      const historyFound = historyData.results.find((tx: Transaction) => tx.id === id);
      return historyFound || null;
    },
    enabled: !!id,
  });

  const tx = txData as Transaction | null;
  const typeConfig = tx ? TYPE_CONFIG[tx.type] || { icon: "ellipsis-horizontal", label: tx.type, color: tc.dark.muted } : null;
  const statusConfig = tx ? STATUS_CONFIG[tx.status] || { color: tc.dark.muted, bg: tc.dark.muted + "1F" } : null;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-KE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-KE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const { formatPhone } = usePhonePrivacy();

  const getRecipient = (tx: Transaction) => {
    const raw = getTxRecipient(tx);
    if (raw && tx.type === "SEND_MPESA") return formatPhone(raw);
    return raw;
  };

  const truncateHash = (hash: string) => {
    if (!hash || hash.length <= 16) return hash;
    return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await Clipboard.setStringAsync(text);
      toast.success("Copied", `${label} copied to clipboard`);
    } catch {
      // Fallback: do nothing
    }
  };

  const handleShare = async () => {
    if (!tx) return;
    const kesAmount = getTxKesAmount(tx);
    const crypto = getTxCrypto(tx);
    const message = [
      `CryptoPay Transaction`,
      `Type: ${typeConfig?.label || tx.type}`,
      `Amount: KSh ${kesAmount.toLocaleString("en-KE")}`,
      crypto.currency ? `Crypto: ${crypto.amount} ${crypto.currency}` : "",
      `Status: ${tx.status}`,
      `Date: ${formatDate(tx.created_at)}`,
      tx.tx_hash ? `TX Hash: ${tx.tx_hash}` : "",
      `ID: ${tx.id}`,
    ].filter(Boolean).join("\n");

    if (isWeb) {
      try {
        await Clipboard.setStringAsync(message);
        toast.success("Copied", "Transaction details copied to clipboard");
      } catch {}
    } else {
      try {
        await Share.share({ message });
      } catch {}
    }
  };

  const containerMaxWidth = isDesktop ? 560 : "100%";

  const isCryptoDeposit = tx?.type === "CRYPTO_DEPOSIT";
  const isWithdrawal = tx?.type === "WITHDRAWAL";
  const isMpesaPayment = tx?.type === "PAYBILL_PAYMENT" || tx?.type === "TILL_PAYMENT" || tx?.type === "SEND_MPESA";

  const renderDetailRow = (label: string, value: string | undefined | null, iconName?: string, options?: { copiable?: boolean; onPress?: () => void }) => {
    if (!value) return null;
    return (
      <Pressable
        onPress={options?.copiable ? () => copyToClipboard(value, label) : options?.onPress}
        disabled={!options?.copiable && !options?.onPress}
        style={({ pressed }) => ({
          flexDirection: "row" as const,
          alignItems: "center" as const,
          justifyContent: "space-between" as const,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: tc.glass.border,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          {iconName ? (
            <Ionicons name={iconName as any} size={16} color={tc.textMuted} />
          ) : null}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 14,
              fontFamily: "DMSans_400Regular",
            }}
          >
            {label}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 14,
              fontFamily: "DMSans_500Medium",
              textAlign: "right",
            }}
            selectable
            numberOfLines={1}
          >
            {value}
          </Text>
          {options?.copiable && (
            <Ionicons name="copy-outline" size={14} color={tc.textMuted} />
          )}
          {options?.onPress && (
            <Ionicons name="open-outline" size={14} color={colors.primary[400]} />
          )}
        </View>
      </Pressable>
    );
  };

  // Timeline component
  const renderTimeline = (tx: Transaction) => {
    const steps = getTimelineSteps(tx);
    const isFailed = tx.status === "failed" || tx.status === "reversed";
    return (
      <View
        style={{
          backgroundColor: tc.dark.card,
          borderRadius: 20,
          paddingHorizontal: 20,
          paddingVertical: 20,
          borderWidth: 1,
          borderColor: tc.glass.border,
          marginBottom: 16,
          ...(isDesktop ? shadows.sm : {}),
        }}
      >
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 15,
            fontFamily: "DMSans_600SemiBold",
            marginBottom: 16,
          }}
        >
          Status Timeline
        </Text>
        <View style={{ paddingLeft: 4 }}>
          {steps.map((step, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "flex-start" }}>
              {/* Connector + dot */}
              <View style={{ alignItems: "center", width: 28, marginRight: 12 }}>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: step.reached
                      ? (isFailed && i === 0 ? colors.error + "20" : colors.success + "20")
                      : tc.dark.elevated,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: step.active ? 2 : 0,
                    borderColor: step.active
                      ? (isFailed ? colors.error : colors.success)
                      : "transparent",
                  }}
                >
                  <Ionicons
                    name={(step.reached ? "checkmark" : step.icon) as any}
                    size={12}
                    color={step.reached
                      ? (isFailed && i === 0 ? colors.error : colors.success)
                      : tc.textMuted
                    }
                  />
                </View>
                {i < steps.length - 1 && (
                  <View
                    style={{
                      width: 2,
                      height: 24,
                      backgroundColor: steps[i + 1]?.reached
                        ? colors.success + "40"
                        : tc.glass.border,
                    }}
                  />
                )}
              </View>
              {/* Label */}
              <View style={{ paddingTop: 2, paddingBottom: i < steps.length - 1 ? 14 : 0 }}>
                <Text
                  style={{
                    color: step.reached ? tc.textPrimary : tc.textMuted,
                    fontSize: 14,
                    fontFamily: step.active ? "DMSans_600SemiBold" : "DMSans_400Regular",
                  }}
                >
                  {step.label}
                </Text>
              </View>
            </View>
          ))}
          {/* Failed step if applicable */}
          {isFailed && (
            <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 8 }}>
              <View style={{ alignItems: "center", width: 28, marginRight: 12 }}>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: colors.error + "20",
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 2,
                    borderColor: colors.error,
                  }}
                >
                  <Ionicons name="close" size={12} color={colors.error} />
                </View>
              </View>
              <View style={{ paddingTop: 2 }}>
                <Text
                  style={{
                    color: colors.error,
                    fontSize: 14,
                    fontFamily: "DMSans_600SemiBold",
                    textTransform: "capitalize",
                  }}
                >
                  {tx.status}
                </Text>
                {tx.failure_reason ? (
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_400Regular",
                      marginTop: 2,
                    }}
                  >
                    {tx.failure_reason}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: isDesktop ? 32 : 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: tc.glass.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)" as any);
            }}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: pressed ? tc.dark.elevated : "transparent",
              alignItems: "center",
              justifyContent: "center",
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={22} color={tc.textPrimary} />
          </Pressable>
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 18,
              fontFamily: "DMSans_600SemiBold",
              marginLeft: 12,
            }}
          >
            Transaction Details
          </Text>
        </View>

        {/* Share button */}
        <Pressable
          onPress={handleShare}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: pressed ? tc.dark.elevated : "transparent",
            alignItems: "center",
            justifyContent: "center",
          })}
          accessibilityRole="button"
          accessibilityLabel="Share transaction"
        >
          <Ionicons name="share-outline" size={20} color={tc.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 40,
          alignItems: isDesktop ? "center" : undefined,
        }}
      >
        {isLoading ? (
          <View style={{ paddingTop: 80, alignItems: "center" }}>
            <ActivityIndicator size="large" color={colors.primary[400]} />
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                fontFamily: "DMSans_400Regular",
                marginTop: 16,
              }}
            >
              Loading transaction...
            </Text>
          </View>
        ) : !tx ? (
          <View style={{ paddingTop: 80, alignItems: "center", paddingHorizontal: 24 }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 22,
                backgroundColor: colors.error + "15",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="alert-circle-outline" size={36} color={colors.error} />
            </View>
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 18,
                fontFamily: "DMSans_600SemiBold",
                marginBottom: 8,
              }}
            >
              Transaction not found
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
              }}
            >
              This transaction may have been removed or the ID is invalid.
            </Text>
            <Pressable
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/(tabs)" as any);
              }}
              style={({ pressed }) => ({
                marginTop: 24,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: colors.primary[500],
                borderRadius: 14,
                paddingHorizontal: 24,
                paddingVertical: 12,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="arrow-back-outline" size={18} color="#FFFFFF" />
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                Go Back
              </Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={{
              width: containerMaxWidth as any,
              paddingHorizontal: isDesktop ? 0 : 16,
              paddingTop: 24,
            }}
          >
            {/* Type Icon + Label */}
            <View style={{ alignItems: "center", marginBottom: 8 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 20,
                  backgroundColor: typeConfig!.color + "1A",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <Ionicons name={typeConfig!.icon as any} size={30} color={typeConfig!.color} />
              </View>
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 18,
                  fontFamily: "DMSans_600SemiBold",
                  marginBottom: 8,
                }}
              >
                {typeConfig!.label}
              </Text>

              {/* Status Badge */}
              <View
                style={{
                  backgroundColor: statusConfig!.bg,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 3.5,
                    backgroundColor: statusConfig!.color,
                  }}
                />
                <Text
                  style={{
                    color: statusConfig!.color,
                    fontSize: 13,
                    fontFamily: "DMSans_600SemiBold",
                    textTransform: "capitalize",
                  }}
                >
                  {t(STATUS_I18N_KEY[tx.status] || "payment.processing")}
                </Text>
              </View>
            </View>

            {/* KES Amount (prominent) */}
            <View style={{ alignItems: "center", marginTop: 20, marginBottom: 28 }}>
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 40,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -1,
                }}
              >
                KSh{" "}
                {getTxKesAmount(tx).toLocaleString("en-KE", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}
              </Text>
              {(() => {
                const crypto = getTxCrypto(tx);
                return crypto.currency && crypto.amount ? (
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 15,
                      fontFamily: "DMSans_500Medium",
                      marginTop: 6,
                    }}
                  >
                    {parseFloat(crypto.amount).toFixed(
                      CURRENCIES[crypto.currency as CurrencyCode]?.decimals ?? 4
                    )}{" "}
                    {crypto.currency}
                  </Text>
                ) : null;
              })()}
            </View>

            {/* Status Timeline */}
            {renderTimeline(tx)}

            {/* Detail Card */}
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                paddingHorizontal: 20,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: tc.glass.border,
                marginBottom: 16,
                ...(isDesktop ? shadows.sm : {}),
              }}
            >
              {/* Common fields */}
              {isMpesaPayment && renderDetailRow(
                "Recipient",
                getRecipient(tx),
                "person-outline"
              )}

              {tx.mpesa_paybill && tx.mpesa_account
                ? renderDetailRow(
                    "Account Number",
                    tx.mpesa_account,
                    "document-text-outline",
                    { copiable: true }
                  )
                : null}

              {tx.mpesa_paybill
                ? renderDetailRow(
                    "Paybill Number",
                    tx.mpesa_paybill,
                    "business-outline",
                    { copiable: true }
                  )
                : null}

              {tx.mpesa_till
                ? renderDetailRow(
                    "Till Number",
                    tx.mpesa_till,
                    "storefront-outline",
                    { copiable: true }
                  )
                : null}

              {tx.mpesa_receipt
                ? renderDetailRow(
                    "M-Pesa Receipt",
                    tx.mpesa_receipt,
                    "receipt-outline",
                    { copiable: true }
                  )
                : null}

              {renderDetailRow(
                "Transaction ID",
                tx.id,
                "finger-print-outline",
                { copiable: true }
              )}

              {renderDetailRow(
                "Date",
                formatDate(tx.created_at),
                "calendar-outline"
              )}

              {renderDetailRow(
                "Time",
                formatTime(tx.created_at),
                "time-outline"
              )}

              {tx.exchange_rate
                ? renderDetailRow(
                    "Exchange Rate",
                    `1 ${getTxCrypto(tx).currency} = KSh ${parseFloat(tx.exchange_rate).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    "trending-up-outline"
                  )
                : null}

              {tx.fee_amount && parseFloat(tx.fee_amount) > 0
                ? renderDetailRow(
                    "Fee",
                    `KSh ${parseFloat(tx.fee_amount).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
                    "pricetag-outline"
                  )
                : null}

              {tx.excise_duty_amount && parseFloat(tx.excise_duty_amount) > 0
                ? renderDetailRow(
                    "Excise Duty",
                    `KSh ${parseFloat(tx.excise_duty_amount).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
                    "document-outline"
                  )
                : null}

              {tx.completed_at
                ? renderDetailRow(
                    "Completed",
                    formatDate(tx.completed_at) + " " + formatTime(tx.completed_at),
                    "checkmark-done-outline"
                  )
                : null}
            </View>

            {/* Blockchain Details Card (for crypto deposits and withdrawals) */}
            {(isCryptoDeposit || isWithdrawal || tx.tx_hash) && (
              <View
                style={{
                  backgroundColor: tc.dark.card,
                  borderRadius: 20,
                  paddingHorizontal: 20,
                  paddingVertical: 4,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  marginBottom: 16,
                  ...(isDesktop ? shadows.sm : {}),
                }}
              >
                {/* Section header */}
                <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: tc.glass.border }}>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 15,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    Blockchain Details
                  </Text>
                </View>

                {tx.chain
                  ? renderDetailRow(
                      "Network",
                      CHAIN_LABELS[tx.chain] || tx.chain,
                      "globe-outline"
                    )
                  : null}

                {tx.tx_hash
                  ? renderDetailRow(
                      "TX Hash",
                      truncateHash(tx.tx_hash),
                      "link-outline",
                      {
                        copiable: true,
                        onPress: () => copyToClipboard(tx.tx_hash, "TX Hash"),
                      }
                    )
                  : null}

                {tx.block_number
                  ? renderDetailRow(
                      "Block Number",
                      tx.block_number.toString(),
                      "layers-outline"
                    )
                  : null}

                {tx.confirmations !== undefined && tx.confirmations > 0
                  ? renderDetailRow(
                      "Confirmations",
                      tx.required_confirmations
                        ? `${tx.confirmations} / ${tx.required_confirmations}`
                        : tx.confirmations.toString(),
                      "shield-checkmark-outline"
                    )
                  : null}

                {tx.from_address
                  ? renderDetailRow(
                      "From Address",
                      truncateHash(tx.from_address),
                      "arrow-forward-outline",
                      { copiable: true, onPress: () => copyToClipboard(tx.from_address!, "From Address") }
                    )
                  : null}

                {tx.to_address
                  ? renderDetailRow(
                      "To Address",
                      truncateHash(tx.to_address),
                      "arrow-down-outline",
                      { copiable: true, onPress: () => copyToClipboard(tx.to_address!, "To Address") }
                    )
                  : null}

                {tx.destination_address
                  ? renderDetailRow(
                      "Destination",
                      truncateHash(tx.destination_address),
                      "navigate-outline",
                      { copiable: true, onPress: () => copyToClipboard(tx.destination_address!, "Destination") }
                    )
                  : null}

                {/* View on Explorer button */}
                {tx.tx_hash && tx.chain && EXPLORER_TX[tx.chain] && (
                  <Pressable
                    onPress={() => {
                      const url = EXPLORER_TX[tx.chain] + tx.tx_hash;
                      Linking.openURL(url);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      paddingVertical: 14,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Ionicons name="open-outline" size={16} color={colors.primary[400]} />
                    <Text
                      style={{
                        color: colors.primary[400],
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      View on Explorer
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Failure reason card */}
            {tx.failure_reason ? (
              <View
                style={{
                  backgroundColor: colors.error + "10",
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: colors.error + "20",
                  marginBottom: 16,
                  flexDirection: "row",
                  gap: 12,
                }}
              >
                <Ionicons name="alert-circle" size={20} color={colors.error} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.error,
                      fontSize: 14,
                      fontFamily: "DMSans_600SemiBold",
                      marginBottom: 4,
                    }}
                  >
                    Failure Reason
                  </Text>
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 13,
                      fontFamily: "DMSans_400Regular",
                      lineHeight: 19,
                    }}
                  >
                    {tx.failure_reason}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Action Buttons */}
            {tx.status === "completed" && !isCryptoDeposit && (
              <Pressable
                onPress={async () => {
                  setDownloadingReceipt(true);
                  try {
                    if (isWeb) {
                      const { storage } = require("../../src/utils/storage");
                      const { config } = require("../../src/constants/config");
                      const token = await storage.getItemAsync("access_token");
                      const url = `${config.apiUrl}/payments/${tx.id}/receipt/?token=${encodeURIComponent(token || "")}`;
                      window.open(url, "_blank");
                      toast.success("Downloading", "Receipt opened in new tab");
                    } else {
                      const { authApi } = require("../../src/api/auth");
                      const response = await authApi.downloadReceipt(tx.id);
                      toast.success("Generated", "Receipt is being prepared");
                    }
                  } catch {
                    toast.error("Error", "Could not download receipt. Try again later.");
                  } finally {
                    setDownloadingReceipt(false);
                  }
                }}
                disabled={downloadingReceipt}
                style={({ pressed, hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: colors.primary[500] + "15",
                  borderRadius: 16,
                  paddingVertical: 16,
                  marginBottom: 12,
                  borderWidth: 1,
                  borderColor: colors.primary[500] + "30",
                  opacity: downloadingReceipt ? 0.6 : pressed ? 0.85 : 1,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
              >
                <Ionicons name="download-outline" size={20} color={colors.primary[400]} />
                <Text
                  style={{
                    color: colors.primary[400],
                    fontSize: 16,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  {downloadingReceipt ? "Downloading..." : "Download PDF Receipt"}
                </Text>
              </Pressable>
            )}

            {/* Share Button */}
            <Pressable
              onPress={handleShare}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: tc.dark.elevated,
                borderRadius: 16,
                paddingVertical: 16,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: tc.glass.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="share-outline" size={20} color="#FFFFFF" />
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 16,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                Share Details
              </Text>
            </Pressable>

            {/* Back Button */}
            <Pressable
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/(tabs)" as any);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: pressed ? tc.dark.border : tc.dark.elevated,
                borderRadius: 16,
                paddingVertical: 16,
                borderWidth: 1,
                borderColor: tc.glass.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="arrow-back-outline" size={20} color="#FFFFFF" />
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 16,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                Back
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
