import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { useWallets } from "../../src/hooks/useWallets";
import { useTransactions } from "../../src/hooks/useTransactions";
import { TransactionItem } from "../../src/components/TransactionItem";
import { StatusBadge } from "../../src/components/StatusBadge";
import { WalletCardSkeleton, TransactionSkeleton } from "../../src/components/Skeleton";
import { ratesApi, Rate } from "../../src/api/rates";
import { CURRENCIES, CurrencyCode, colors } from "../../src/constants/theme";

function useRates() {
  return useQuery<Rate[]>({
    queryKey: ["rates"],
    queryFn: async () => {
      const currencies = ["USDT", "BTC", "ETH", "SOL"];
      const results = await Promise.all(
        currencies.map(async (c) => {
          try {
            const { data } = await ratesApi.getRate(c);
            return data;
          } catch {
            return null;
          }
        })
      );
      return results.filter(Boolean) as Rate[];
    },
    refetchInterval: 30000,
  });
}

export default function WalletScreen() {
  const { data: wallets, refetch: refetchWallets } = useWallets();
  const { data: txData, refetch: refetchTx } = useTransactions();
  const { data: rates } = useRates();
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [depositModal, setDepositModal] = useState<{
    address: string;
    currency: string;
  } | null>(null);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchWallets(), refetchTx()]);
    setRefreshing(false);
  };

  const copyAddress = async (address: string, id: string) => {
    await Clipboard.setStringAsync(address);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    // Clear clipboard after 30s for security
    setTimeout(() => {
      Clipboard.setStringAsync("").catch(() => {});
    }, 30000);
  };

  const cryptoWallets = wallets?.filter((w) => w.currency !== "KES") || [];
  const transactions = txData?.results || [];

  // Calculate total portfolio value in KES
  const totalKES = cryptoWallets.reduce((sum, w) => {
    const balance = parseFloat(w.balance);
    const rate = rates?.find((r) => r.currency === w.currency);
    const kesRate = rate ? parseFloat(rate.kes_rate) : 0;
    return sum + balance * kesRate;
  }, 0);

  // Add KES wallet balance
  const kesWallet = wallets?.find((w) => w.currency === "KES");
  const kesBalance = kesWallet ? parseFloat(kesWallet.balance) : 0;
  const grandTotal = totalKES + kesBalance;

  return (
    <SafeAreaView className="flex-1 bg-dark-bg">
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[400]}
            progressBackgroundColor={colors.dark.card}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="px-5 pt-2 pb-4">
          <Text className="text-white text-2xl font-inter-bold">Wallet</Text>
          <Text className="text-textSecondary text-sm font-inter mt-1">
            Manage your crypto assets
          </Text>
        </View>

        {/* Total Portfolio Value */}
        <View
          style={{
            marginHorizontal: 16,
            marginBottom: 16,
            borderRadius: 20,
            backgroundColor: colors.dark.card,
            padding: 20,
            borderWidth: 1,
            borderColor: colors.dark.border,
          }}
        >
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 13,
              fontFamily: "Inter_500Medium",
              marginBottom: 4,
            }}
          >
            Total Portfolio Value
          </Text>
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 32,
              fontFamily: "Inter_700Bold",
              marginBottom: 8,
            }}
          >
            KSh{" "}
            {grandTotal.toLocaleString("en-KE", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={() => {
                // Open deposit for first crypto wallet
                if (cryptoWallets.length > 0 && cryptoWallets[0].deposit_address) {
                  setDepositModal({
                    address: cryptoWallets[0].deposit_address,
                    currency: cryptoWallets[0].currency,
                  });
                }
              }}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.primary[500],
                borderRadius: 14,
                paddingVertical: 12,
                gap: 6,
              }}
            >
              <Ionicons name="arrow-down-circle" size={18} color="#FFFFFF" />
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 14,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Receive
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {}}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.dark.elevated,
                borderRadius: 14,
                paddingVertical: 12,
                gap: 6,
              }}
            >
              <Ionicons name="arrow-up-circle" size={18} color="#FFFFFF" />
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 14,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Send
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Crypto Wallets */}
        {cryptoWallets.length === 0 ? (
          <View
            style={{
              marginHorizontal: 16,
              backgroundColor: colors.dark.card,
              borderRadius: 20,
              padding: 32,
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: "rgba(13, 159, 110, 0.1)",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="wallet-outline" size={32} color={colors.primary[400]} />
            </View>
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 16,
                fontFamily: "Inter_600SemiBold",
                marginBottom: 6,
              }}
            >
              No crypto yet
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 14,
                fontFamily: "Inter_400Regular",
                textAlign: "center",
                lineHeight: 20,
              }}
            >
              Deposit crypto to start paying bills with M-Pesa
            </Text>
          </View>
        ) : (
          <View className="px-4 gap-3">
            {cryptoWallets.map((w) => {
              const info = CURRENCIES[w.currency as CurrencyCode];
              const balance = parseFloat(w.balance);
              const locked = parseFloat(w.locked_balance);
              const rate = rates?.find((r) => r.currency === w.currency);
              const kesValue = rate
                ? balance * parseFloat(rate.kes_rate)
                : 0;

              return (
                <View key={w.id} className="bg-dark-card rounded-2xl p-4">
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center">
                      <View className="w-10 h-10 rounded-full bg-primary-500/15 items-center justify-center mr-3">
                        <Text className="text-lg">{info?.icon || "?"}</Text>
                      </View>
                      <View>
                        <Text className="text-white text-base font-inter-semibold">
                          {info?.name || w.currency}
                        </Text>
                        <Text className="text-textMuted text-xs font-inter">
                          {info?.symbol || w.currency}
                        </Text>
                      </View>
                    </View>
                    <View className="items-end">
                      <Text className="text-white text-base font-inter-bold">
                        {balance.toFixed(info?.decimals ?? 4)}
                      </Text>
                      {kesValue > 0 && (
                        <Text
                          style={{
                            color: colors.textMuted,
                            fontSize: 11,
                            fontFamily: "Inter_400Regular",
                          }}
                        >
                          ~KSh {kesValue.toLocaleString("en-KE", { maximumFractionDigits: 0 })}
                        </Text>
                      )}
                      {locked > 0 && (
                        <Text className="text-warning text-xs font-inter">
                          {locked.toFixed(info?.decimals ?? 4)} locked
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Deposit Address */}
                  {w.deposit_address && (
                    <Pressable
                      onPress={() => copyAddress(w.deposit_address!, w.id)}
                      onLongPress={() =>
                        setDepositModal({
                          address: w.deposit_address!,
                          currency: w.currency,
                        })
                      }
                      className="bg-dark-bg rounded-xl px-3 py-2.5 flex-row items-center"
                    >
                      <Ionicons
                        name="wallet-outline"
                        size={16}
                        color={colors.textMuted}
                      />
                      <Text
                        className="text-textMuted text-xs font-inter ml-2 flex-1"
                        numberOfLines={1}
                      >
                        {w.deposit_address}
                      </Text>
                      <Ionicons
                        name={
                          copiedId === w.id
                            ? "checkmark-circle"
                            : "copy-outline"
                        }
                        size={16}
                        color={
                          copiedId === w.id
                            ? colors.success
                            : colors.primary[400]
                        }
                      />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Transaction History */}
        <View className="mt-6">
          <Text className="text-white text-lg font-inter-semibold px-5 mb-3">
            Transaction History
          </Text>
          <View className="bg-dark-card rounded-2xl mx-4 overflow-hidden">
            {transactions.length === 0 ? (
              <View className="py-12 items-center">
                <Ionicons
                  name="time-outline"
                  size={40}
                  color={colors.dark.muted}
                />
                <Text className="text-textMuted text-sm font-inter mt-3">
                  No transactions yet
                </Text>
              </View>
            ) : (
              transactions.map((tx) => (
                <TransactionItem key={tx.id} transaction={tx} />
              ))
            )}
          </View>
        </View>

        <View className="h-8" />
      </ScrollView>

      {/* Deposit Modal - shows address for receiving */}
      <Modal
        visible={!!depositModal}
        animationType="slide"
        transparent
        onRequestClose={() => setDepositModal(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: colors.dark.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: 40,
            }}
          >
            {/* Handle */}
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.dark.elevated,
                alignSelf: "center",
                marginBottom: 20,
              }}
            />

            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 20,
                fontFamily: "Inter_700Bold",
                textAlign: "center",
                marginBottom: 8,
              }}
            >
              Receive {depositModal?.currency}
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 14,
                fontFamily: "Inter_400Regular",
                textAlign: "center",
                marginBottom: 24,
              }}
            >
              Send {depositModal?.currency} to this address to deposit
            </Text>

            {/* QR Code placeholder - actual QR would use react-native-qrcode-svg */}
            <View
              style={{
                width: 200,
                height: 200,
                borderRadius: 16,
                backgroundColor: "#FFFFFF",
                alignSelf: "center",
                marginBottom: 20,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="qr-code" size={120} color={colors.dark.bg} />
              <Text
                style={{
                  color: colors.dark.muted,
                  fontSize: 10,
                  fontFamily: "Inter_400Regular",
                  position: "absolute",
                  bottom: 8,
                }}
              >
                QR Code
              </Text>
            </View>

            {/* Address */}
            <Pressable
              onPress={() => {
                if (depositModal?.address) {
                  Clipboard.setStringAsync(depositModal.address);
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success
                  );
                  // Clear clipboard after 30s for security
                  setTimeout(() => {
                    Clipboard.setStringAsync("").catch(() => {});
                  }, 30000);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Copy deposit address"
              accessibilityHint="Copies the address to clipboard. It will be cleared after 30 seconds."
              style={{
                backgroundColor: colors.dark.bg,
                borderRadius: 12,
                padding: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 13,
                  fontFamily: "Inter_400Regular",
                  flex: 1,
                }}
                numberOfLines={2}
              >
                {depositModal?.address}
              </Text>
              <Ionicons
                name="copy-outline"
                size={20}
                color={colors.primary[400]}
              />
            </Pressable>

            <Text
              style={{
                color: colors.warning,
                fontSize: 12,
                fontFamily: "Inter_400Regular",
                textAlign: "center",
                marginTop: 16,
              }}
            >
              Only send {depositModal?.currency} to this address.{"\n"}Sending
              other tokens may result in permanent loss.
            </Text>

            <Pressable
              onPress={() => setDepositModal(null)}
              style={{
                backgroundColor: colors.dark.elevated,
                borderRadius: 16,
                paddingVertical: 14,
                alignItems: "center",
                marginTop: 20,
              }}
            >
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 16,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Done
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
