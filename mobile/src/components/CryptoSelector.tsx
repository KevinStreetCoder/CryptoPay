import { View, Text, Pressable, Platform, useWindowDimensions } from "react-native";
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
  const { width } = useWindowDimensions();

  // 2026-05-09 · responsive flex-wrap grid · 2 cols phone, 3 small
  // tablet, 4 desktop. CryptoSelector renders inside parent screens
  // that have varying horizontal padding · we compute card width
  // from the viewport AND let the consumer's parent container
  // constrain us via flex layout. The `width` we compute assumes
  // the parent gives us the full content area minus its own
  // horizontal padding (most callers use hPad = 16 on mobile).
  // Native RN does NOT support `flexBasis: calc(...)` so we use
  // a pixel value · works on both web and native.
  const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const gap = 10;
  // Estimate parent's available width · phones use 16 px h-padding
  // around the deposit/send/swap content area, desktop uses more
  // but viewport-relative pixel math still gets us close.
  const hPadGuess = width >= 900 ? 48 : 16;
  const cardW = (width - 2 * hPadGuess - gap * (columns - 1)) / columns;

  return (
    <View
      style={{
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap,
        marginTop: 4,
      }}
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
              width: cardW,
              borderRadius: 16,
              paddingHorizontal: 14,
              paddingVertical: 14,
              borderWidth: 1,
              alignItems: "center" as const,
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
              transform: [{ scale: pressed ? 0.98 : 1 }],
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
                marginBottom: 6,
              }}
            >
              <View style={{ marginRight: 6 }}>
                <CryptoLogo currency={crypto} size={22} />
              </View>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: "DMSans_700Bold",
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
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
                marginBottom: 2,
              }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {bal.toFixed(info.decimals > 4 ? 4 : info.decimals)}
            </Text>
            {/* Network chip · stamps every coin card with its
                settlement network so the grid is internally consistent
                ("USDT TRON" alongside "BTC BITCOIN") without forcing
                the user to read a separate badge below. */}
            {COIN_NETWORK[crypto] ? (
              <Text
                style={{
                  color: isSelected ? colors.primary[400] : tc.dark.muted,
                  fontSize: 10,
                  fontFamily: "DMSans_600SemiBold",
                  letterSpacing: 0.5,
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
    </View>
  );
}
