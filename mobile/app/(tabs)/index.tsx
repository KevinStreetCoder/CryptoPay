import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BalanceCard } from "../../src/components/BalanceCard";
import { QuickAction } from "../../src/components/QuickAction";
import { TransactionItem } from "../../src/components/TransactionItem";
import { RateTicker } from "../../src/components/RateTicker";
import { BalanceCardSkeleton, TransactionSkeleton } from "../../src/components/Skeleton";
import { useWallets } from "../../src/hooks/useWallets";
import { useTransactions } from "../../src/hooks/useTransactions";
import { useAuth } from "../../src/stores/auth";
import { ratesApi, Rate } from "../../src/api/rates";
import { colors } from "../../src/constants/theme";

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

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    data: wallets,
    refetch: refetchWallets,
    isLoading: walletsLoading,
  } = useWallets();
  const { data: txData, refetch: refetchTx } = useTransactions();
  const { data: rates } = useRates();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchWallets(), refetchTx()]);
    setRefreshing(false);
  };

  const recentTx = txData?.results?.slice(0, 5) || [];

  // Build rate ticker data
  const tickerRates = (rates || []).map((r) => ({
    symbol: r.currency,
    rate: parseFloat(r.kes_rate),
    change24h: parseFloat(r.spread) * (Math.random() > 0.5 ? 1 : -1) * 10,
  }));

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
        <View className="flex-row items-center justify-between px-5 pt-2 pb-4">
          <View>
            <Text className="text-textSecondary text-sm font-inter">
              Welcome back
            </Text>
            <Text className="text-white text-xl font-inter-bold">
              {user?.full_name || "User"}
            </Text>
          </View>
          <Pressable
            className="w-10 h-10 rounded-full bg-dark-card items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            testID="notifications-button"
          >
            <Ionicons
              name="notifications-outline"
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>

        {/* Promotional Banner */}
        <Pressable
          onPress={() => router.push("/(tabs)/pay")}
          className="mx-4 mb-4"
        >
          <View
            style={{
              borderRadius: 20,
              overflow: "hidden",
              backgroundColor: "#0D9F6E",
              padding: 20,
            }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 mr-4">
                <Text
                  style={{
                    color: "#ECFDF5",
                    fontSize: 12,
                    fontFamily: "Inter_500Medium",
                    marginBottom: 4,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Pay Any Bill
                </Text>
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 20,
                    fontFamily: "Inter_700Bold",
                    marginBottom: 8,
                    lineHeight: 26,
                  }}
                >
                  Pay bills with crypto{"\n"}via M-Pesa
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "rgba(255,255,255,0.2)",
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    alignSelf: "flex-start",
                    gap: 4,
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 13,
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    Get started
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
                </View>
              </View>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: "rgba(255,255,255,0.15)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="flash" size={32} color="#FFFFFF" />
              </View>
            </View>
          </View>
        </Pressable>

        {/* Live Rate Ticker */}
        {tickerRates.length > 0 && (
          <View className="mx-4 mb-4">
            <RateTicker rates={tickerRates} />
          </View>
        )}

        {/* Balance Card */}
        {wallets && <BalanceCard wallets={wallets} />}
        {walletsLoading && <BalanceCardSkeleton />}

        {/* Quick Actions */}
        <View className="flex-row px-4 mt-6 mb-2">
          <QuickAction
            icon="receipt-outline"
            label="Pay Bill"
            color={colors.primary[400]}
            onPress={() => router.push("/payment/paybill")}
          />
          <QuickAction
            icon="cart-outline"
            label="Buy Goods"
            color={colors.info}
            onPress={() => router.push("/payment/till")}
          />
          <QuickAction
            icon="arrow-down-circle-outline"
            label="Deposit"
            color={colors.success}
            onPress={() => router.push("/(tabs)/wallet")}
          />
          <QuickAction
            icon="swap-horizontal-outline"
            label="Convert"
            color={colors.accent}
            onPress={() => {}}
          />
        </View>

        {/* Recent Transactions */}
        <View className="mt-4">
          <View className="flex-row items-center justify-between px-5 mb-2">
            <Text className="text-white text-lg font-inter-semibold">
              Recent Activity
            </Text>
            <Text
              className="text-primary-400 text-sm font-inter-medium"
              onPress={() => router.push("/(tabs)/wallet")}
            >
              See All
            </Text>
          </View>

          <View className="bg-dark-card rounded-2xl mx-4 overflow-hidden">
            {recentTx.length === 0 ? (
              <View className="py-12 items-center">
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
                  <Ionicons
                    name="receipt-outline"
                    size={32}
                    color={colors.primary[400]}
                  />
                </View>
                <Text className="text-white text-base font-inter-semibold mb-1">
                  No transactions yet
                </Text>
                <Text className="text-textMuted text-sm font-inter mb-5 text-center px-8">
                  Start by depositing crypto or paying a bill
                </Text>
                <Pressable
                  onPress={() => router.push("/(tabs)/pay")}
                  style={{
                    backgroundColor: "rgba(13, 159, 110, 0.15)",
                    borderRadius: 12,
                    paddingHorizontal: 20,
                    paddingVertical: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={18}
                    color={colors.primary[400]}
                  />
                  <Text
                    style={{
                      color: colors.primary[400],
                      fontSize: 14,
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    Make a Payment
                  </Text>
                </Pressable>
              </View>
            ) : (
              recentTx.map((tx) => (
                <TransactionItem key={tx.id} transaction={tx} />
              ))
            )}
          </View>
        </View>

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
