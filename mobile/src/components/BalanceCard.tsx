import { View, Text, Pressable, StyleSheet } from "react-native";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Wallet } from "../api/wallets";
import { CURRENCIES, CurrencyCode, colors, shadows } from "../constants/theme";

interface BalanceCardProps {
  wallets: Wallet[];
}

export function BalanceCard({ wallets }: BalanceCardProps) {
  const [hidden, setHidden] = useState(false);

  // Defensive: ensure wallets is always an array
  const safeWallets = Array.isArray(wallets) ? wallets : [];

  const kesWallet = safeWallets.find((w) => w.currency === "KES");
  const kesBalance = kesWallet ? parseFloat(kesWallet.balance) : 0;

  const cryptoWallets = safeWallets.filter((w) => w.currency !== "KES");

  return (
    <View
      style={[styles.card, shadows.md]}
      accessibilityRole="summary"
      accessibilityLabel={
        hidden
          ? "Total balance hidden"
          : `Total balance: ${kesBalance.toLocaleString("en-KE", {
              minimumFractionDigits: 2,
            })} Kenyan Shillings`
      }
      testID="balance-card"
    >
      {/* Decorative circles */}
      <View style={[styles.circle, styles.circleTopRight]} />
      <View style={[styles.circle, styles.circleBottomLeft]} />

      {/* Total KES Balance */}
      <View style={styles.header}>
        <Text
          style={styles.totalLabel}
          maxFontSizeMultiplier={1.3}
        >
          TOTAL BALANCE
        </Text>
        <Pressable
          onPress={() => setHidden(!hidden)}
          hitSlop={12}
          style={styles.eyeButton}
          accessibilityRole="button"
          accessibilityLabel={hidden ? "Show balance" : "Hide balance"}
          testID="toggle-balance-visibility"
        >
          <Ionicons
            name={hidden ? "eye-off-outline" : "eye-outline"}
            size={20}
            color={colors.primary[100]}
          />
        </Pressable>
      </View>

      <Text
        style={styles.balance}
        maxFontSizeMultiplier={1.2}
        accessibilityElementsHidden={hidden}
      >
        {hidden
          ? "KSh \u2022\u2022\u2022\u2022\u2022\u2022"
          : `KSh ${kesBalance.toLocaleString("en-KE", {
              minimumFractionDigits: 2,
            })}`}
      </Text>

      {/* Crypto Balances Row */}
      <View style={styles.cryptoRow}>
        {cryptoWallets.map((w) => {
          const info = CURRENCIES[w.currency as CurrencyCode];
          const bal = parseFloat(w.balance);
          const brandColor = colors.crypto[w.currency] || colors.primary[400];
          return (
            <View
              key={w.id}
              style={styles.cryptoPill}
              accessibilityLabel={
                hidden
                  ? `${info?.symbol || w.currency} balance hidden`
                  : `${info?.symbol || w.currency}: ${bal.toFixed(
                      info?.decimals ?? 2
                    )}`
              }
            >
              <View style={styles.cryptoPillHeader}>
                <View
                  style={[
                    styles.cryptoDot,
                    { backgroundColor: brandColor },
                  ]}
                />
                <Text
                  style={styles.cryptoSymbol}
                  maxFontSizeMultiplier={1.3}
                >
                  {info?.symbol || w.currency}
                </Text>
              </View>
              <Text
                style={styles.cryptoBalance}
                maxFontSizeMultiplier={1.2}
              >
                {hidden
                  ? "\u2022\u2022\u2022\u2022"
                  : bal.toFixed(info?.decimals ?? 2)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primary[500],
    borderRadius: 28,
    padding: 24,
    marginHorizontal: 16,
    overflow: "hidden",
    position: "relative",
  },
  // Decorative circles
  circle: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.1)",
    backgroundColor: "transparent",
  },
  circleTopRight: {
    width: 140,
    height: 140,
    top: -40,
    right: -30,
  },
  circleBottomLeft: {
    width: 100,
    height: 100,
    bottom: -30,
    left: -20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  totalLabel: {
    color: colors.primary[100],
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1.5,
  },
  eyeButton: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  balance: {
    color: "#FFFFFF",
    fontSize: 34,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
    marginBottom: 20,
  },
  cryptoRow: {
    flexDirection: "row",
    gap: 10,
  },
  cryptoPill: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  cryptoPillHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 3,
  },
  cryptoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cryptoSymbol: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  cryptoBalance: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
