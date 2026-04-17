import { View, Text, Pressable, StyleSheet, useWindowDimensions, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Wallet } from "../api/wallets";
import { CURRENCIES, CurrencyCode, colors, shadows, getThemeColors, getThemeShadows } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { useBalanceVisibility } from "../stores/balance";
import { CryptoLogo } from "./CryptoLogo";

const isWeb = Platform.OS === "web";

interface BalanceCardProps {
  wallets: Wallet[];
}

export function BalanceCard({ wallets }: BalanceCardProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { balanceHidden: hidden, toggleBalance } = useBalanceVisibility();
  const { width: screenWidth } = useWindowDimensions();
  const isSmall = screenWidth < 380;

  // Defensive: ensure wallets is always an array
  const safeWallets = Array.isArray(wallets) ? wallets : [];

  // Calculate total portfolio value in KES (KES balance + all crypto converted to KES)
  const kesWallet = safeWallets.find((w) => w.currency === "KES");
  const kesDirectBalance = kesWallet ? parseFloat(kesWallet.balance) : 0;

  // Sum KES equivalent from all wallets (use kes_value if backend provides it,
  // otherwise approximate from balance * rate shown in wallet pills)
  const cryptoWallets = safeWallets.filter((w) => w.currency !== "KES");
  const cryptoKesTotal = cryptoWallets.reduce((sum, w) => {
    const bal = parseFloat(w.balance) || 0;
    // Use kes_value from backend if available, otherwise estimate
    const kesVal = (w as any).kes_value ? parseFloat((w as any).kes_value) : 0;
    return sum + kesVal;
  }, 0);

  const kesBalance = kesDirectBalance + cryptoKesTotal;

  return (
    <View
      style={[styles.card, ts.md]}
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
          onPress={toggleBalance}
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
        style={[
          styles.balance,
          // Shrink the balance figure on narrow phones (iPhone SE / 320px) so
          // KES totals like "KSh 1,234,567.89" don't clip or wrap mid-figure.
          isSmall && { fontSize: 26, letterSpacing: -0.5, marginBottom: 16 },
        ]}
        adjustsFontSizeToFit
        numberOfLines={1}
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
      <View style={[styles.cryptoRow, isSmall && { gap: 6 }]}>
        {cryptoWallets.map((w) => {
          const info = CURRENCIES[w.currency as CurrencyCode];
          const bal = parseFloat(w.balance);
          // Cap decimals: max 4 on small screens, max 6 otherwise
          const maxDecimals = isSmall ? 4 : 6;
          const decimals = Math.min(info?.decimals ?? 2, maxDecimals);
          return (
            <View
              key={w.id}
              style={[styles.cryptoPill, isSmall && { paddingHorizontal: 8, paddingVertical: 8 }]}
              accessibilityLabel={
                hidden
                  ? `${info?.symbol || w.currency} balance hidden`
                  : `${info?.symbol || w.currency}: ${bal.toFixed(decimals)}`
              }
            >
              <View style={styles.cryptoPillHeader}>
                <CryptoLogo currency={w.currency} size={isSmall ? 14 : 16} />
                <Text
                  style={[styles.cryptoSymbol, isSmall && { fontSize: 11 }]}
                  maxFontSizeMultiplier={1.3}
                >
                  {info?.symbol || w.currency}
                </Text>
              </View>
              <Text
                style={[styles.cryptoBalance, isSmall && { fontSize: 13 }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {hidden
                  ? "\u2022\u2022\u2022\u2022"
                  : bal.toFixed(decimals)}
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
    ...(isWeb
      ? {
          boxShadow: `0 4px 24px rgba(16, 185, 129, 0.25), 0 0 40px rgba(16, 185, 129, 0.1)`,
        } as any
      : {
          shadowColor: colors.primary[500],
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 16,
          elevation: 10,
        }),
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
    fontFamily: "DMSans_500Medium",
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
    fontFamily: "DMSans_700Bold",
    letterSpacing: -1,
    marginBottom: 20,
  },
  cryptoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  cryptoPill: {
    minWidth: 60,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
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
    fontFamily: "DMSans_500Medium",
  },
  cryptoBalance: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "DMSans_600SemiBold",
  },
});
