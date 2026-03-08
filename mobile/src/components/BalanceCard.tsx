import { View, Text, Pressable } from "react-native";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Wallet } from "../api/wallets";
import { CURRENCIES, CurrencyCode } from "../constants/theme";

interface BalanceCardProps {
  wallets: Wallet[];
}

export function BalanceCard({ wallets }: BalanceCardProps) {
  const [hidden, setHidden] = useState(false);

  const kesWallet = wallets.find((w) => w.currency === "KES");
  const kesBalance = kesWallet ? parseFloat(kesWallet.balance) : 0;

  const cryptoWallets = wallets.filter((w) => w.currency !== "KES");

  return (
    <View
      className="bg-primary-500 rounded-2xl p-5 mx-4"
      accessibilityRole="summary"
      accessibilityLabel={
        hidden
          ? "Total balance hidden"
          : `Total balance: ${kesBalance.toLocaleString("en-KE", { minimumFractionDigits: 2 })} Kenyan Shillings`
      }
      testID="balance-card"
    >
      {/* Total KES Balance */}
      <View className="flex-row items-center justify-between mb-1">
        <Text
          className="text-primary-100 text-sm font-inter-medium"
          maxFontSizeMultiplier={1.3}
        >
          Total Balance
        </Text>
        <Pressable
          onPress={() => setHidden(!hidden)}
          hitSlop={12}
          className="p-1"
          style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
          accessibilityRole="button"
          accessibilityLabel={hidden ? "Show balance" : "Hide balance"}
          testID="toggle-balance-visibility"
        >
          <Ionicons
            name={hidden ? "eye-off-outline" : "eye-outline"}
            size={20}
            color="#D1FAE5"
          />
        </Pressable>
      </View>

      <Text
        className="text-white text-3xl font-inter-bold mb-4"
        maxFontSizeMultiplier={1.2}
        accessibilityElementsHidden={hidden}
      >
        {hidden
          ? "KSh ••••••"
          : `KSh ${kesBalance.toLocaleString("en-KE", {
              minimumFractionDigits: 2,
            })}`}
      </Text>

      {/* Crypto Balances Row */}
      <View className="flex-row gap-3">
        {cryptoWallets.map((w) => {
          const info = CURRENCIES[w.currency as CurrencyCode];
          const bal = parseFloat(w.balance);
          return (
            <View
              key={w.id}
              className="bg-primary-600/50 rounded-xl px-3 py-2 flex-1"
              accessibilityLabel={
                hidden
                  ? `${info?.symbol || w.currency} balance hidden`
                  : `${info?.symbol || w.currency}: ${bal.toFixed(info?.decimals ?? 2)}`
              }
            >
              <Text
                className="text-primary-200 text-xs font-inter-medium"
                maxFontSizeMultiplier={1.3}
              >
                {info?.symbol || w.currency}
              </Text>
              <Text
                className="text-white text-sm font-inter-semibold"
                maxFontSizeMultiplier={1.2}
              >
                {hidden ? "••••" : bal.toFixed(info?.decimals ?? 2)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
