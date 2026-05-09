import { View, Text, Pressable, ScrollView, Platform } from "react-native";
import { CryptoLogo } from "./CryptoLogo";
import { Wallet } from "../api/wallets";
import { CURRENCIES, CurrencyCode, colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

// 2026-05-09 · network sub-label on every coin card · was inconsistent
// because only the standalone NetworkBadge below the row showed the
// chain ("USDT · TRON") and the cards themselves rendered just symbol
// + balance. Now every card shows its native network so a glance at
// the picker row tells the user "BTC settles on Bitcoin, USDC settles
// on Polygon, etc." without having to read the badge below.
const COIN_NETWORK: Record<string, string> = {
  USDT: "TRON",
  USDC: "POLYGON",
  BTC: "BITCOIN",
  ETH: "ERC-20",
  SOL: "SOLANA",
  KES: "M-PESA",
};

interface CryptoSelectorProps {
  options: CurrencyCode[];
  selected: CurrencyCode;
  wallets?: Wallet[];
  onSelect: (currency: CurrencyCode) => void;
}

export function CryptoSelector({ options, selected, wallets, onSelect }: CryptoSelectorProps) {
  const isWeb = Platform.OS === "web";
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
    >
      {options.map((crypto) => {
        const info = CURRENCIES[crypto];
        const isSelected = selected === crypto;
        const wallet = wallets?.find((w) => w.currency === crypto);
        const bal = wallet ? parseFloat(wallet.balance) : 0;

        return (
          <Pressable
            key={crypto}
            onPress={() => onSelect(crypto)}
            style={({ pressed, hovered }: any) => ({
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderWidth: 1,
              minWidth: 72,
              alignItems: "center",
              borderColor: isSelected
                ? colors.primary[500]
                : isWeb && hovered
                  ? tc.glass.borderStrong
                  : tc.dark.border,
              backgroundColor: isSelected
                ? colors.primary[500] + "1A"
                : isWeb && hovered
                  ? tc.dark.elevated
                  : tc.dark.card,
              opacity: pressed ? 0.85 : 1,
              ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel={`Pay with ${crypto}`}
            accessibilityState={{ selected: isSelected }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <View style={{ marginRight: 5 }}>
                <CryptoLogo currency={crypto} size={20} />
              </View>
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "DMSans_600SemiBold",
                  color: isSelected ? colors.primary[400] : tc.textPrimary,
                }}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {info.symbol}
              </Text>
            </View>
            <Text
              style={{
                color: tc.dark.muted,
                fontSize: 11,
                fontFamily: "DMSans_500Medium",
              }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {bal.toFixed(info.decimals > 4 ? 4 : info.decimals)}
            </Text>
            {/* Network chip · stamps every coin card with its
                settlement network so the row is internally consistent
                ("USDT TRON" alongside "BTC BITCOIN" alongside "ETH
                ERC-20" etc.) instead of only the active one being
                annotated below. */}
            {COIN_NETWORK[crypto] ? (
              <Text
                style={{
                  color: isSelected ? colors.primary[400] : tc.dark.muted,
                  fontSize: 9,
                  fontFamily: "DMSans_600SemiBold",
                  letterSpacing: 0.5,
                  marginTop: 2,
                  opacity: isSelected ? 1 : 0.7,
                }}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {COIN_NETWORK[crypto]}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
