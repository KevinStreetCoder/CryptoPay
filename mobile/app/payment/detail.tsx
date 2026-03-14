import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { paymentsApi, Transaction, getTxKesAmount, getTxCrypto, getTxRecipient } from "../../src/api/payments";
import { useToast } from "../../src/components/Toast";
import { colors, shadows, CURRENCIES, CurrencyCode, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { usePhonePrivacy } from "../../src/utils/privacy";

const isWeb = Platform.OS === "web";

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

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  completed: { color: colors.success, bg: colors.success + "1F", label: "Completed" },
  pending: { color: colors.warning, bg: colors.warning + "1F", label: "Pending" },
  processing: { color: colors.info, bg: colors.info + "1F", label: "Processing" },
  failed: { color: colors.error, bg: colors.error + "1F", label: "Failed" },
  reversed: { color: colors.dark.muted, bg: colors.dark.muted + "1F", label: "Reversed" },
};

export default function TransactionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const { data: txData, isLoading } = useQuery({
    queryKey: ["transaction-detail", id],
    queryFn: async () => {
      // Try to find from history first
      const { data } = await paymentsApi.history();
      const found = data.results.find((tx: Transaction) => tx.id === id);
      return found || null;
    },
    enabled: !!id,
  });

  const tx = txData as Transaction | null;
  const typeConfig = tx ? TYPE_CONFIG[tx.type] || { icon: "ellipsis-horizontal", label: tx.type, color: tc.dark.muted } : null;
  const statusConfig = tx ? STATUS_CONFIG[tx.status] || { color: tc.dark.muted, bg: tc.dark.muted + "1F", label: tx.status } : null;

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
    // Mask phone numbers for SEND_MPESA based on privacy setting
    if (raw && tx.type === "SEND_MPESA") return formatPhone(raw);
    return raw;
  };

  const containerMaxWidth = isDesktop ? 560 : "100%";

  const renderDetailRow = (label: string, value: string, iconName?: string) => {
    if (!value) return null;
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: tc.glass.border,
        }}
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
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
            textAlign: "right",
            flex: 1,
            marginLeft: 12,
          }}
          selectable
        >
          {value}
        </Text>
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
          paddingHorizontal: isDesktop ? 32 : 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: tc.glass.border,
        }}
      >
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
                  {statusConfig!.label}
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

            {/* Detail Card */}
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                paddingHorizontal: 20,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: tc.glass.border,
                ...(isDesktop ? shadows.sm : {}),
              }}
            >
              {renderDetailRow(
                "Recipient",
                getRecipient(tx),
                "person-outline"
              )}

              {tx.mpesa_paybill && tx.mpesa_account
                ? renderDetailRow(
                    "Account Number",
                    tx.mpesa_account,
                    "document-text-outline"
                  )
                : null}

              {renderDetailRow(
                "Transaction ID",
                tx.id,
                "finger-print-outline"
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

              {tx.mpesa_receipt
                ? renderDetailRow(
                    "M-Pesa Receipt",
                    tx.mpesa_receipt,
                    "receipt-outline"
                  )
                : null}

              {tx.exchange_rate
                ? renderDetailRow(
                    "Rate Used",
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

            {/* Action Buttons */}
            {tx.status === "completed" && (
              <Pressable
                onPress={async () => {
                  setDownloadingReceipt(true);
                  try {
                    if (isWeb) {
                      // Open in new tab with token as query param.
                      // This bypasses IDM browser extension (which intercepts fetch/XHR
                      // and returns 204, breaking CORS). Direct navigation works fine.
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
                  marginTop: 28,
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
                marginTop: tx.status === "completed" ? 12 : 28,
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
