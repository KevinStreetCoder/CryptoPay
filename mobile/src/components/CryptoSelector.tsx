import { View, Text, Pressable, Platform, useWindowDimensions } from "react-native";
import { CryptoLogo } from "./CryptoLogo";
import { Wallet } from "../api/wallets";
import { CURRENCIES, CurrencyCode, colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

// Network sub-label per coin · enforces internal consistency in the
// grid · "USDT TRON" alongside "BTC BITCOIN" alongside "ETH ERC-20"
// instead of only the active card being annotated below the row.
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

/**
 * Compact responsive crypto picker · 2026-05-09 redesign.
 *
 *   < 600 px (phones)            · 3 cols → 5 cryptos = 2 rows max
 *   600 – 899 px (small tablets) · 4 cols
 *   ≥ 900 px (tablets / desktop) · 5 cols
 *
 * The "max 2 rows" target on phones (per user feedback 2026-05-09)
 * drives the 3-col mobile choice over the previous 2-col, which
 * pushed 5 cryptos into 3 rows and let the orphan SOL render alone
 * on its own row taking full width.
 *
 * **Last-row span fallback** · when the orphan count in the last
 * row is exactly 1, that one card spans the full row width so the
 * grid doesn't end with a single half-width card next to empty space.
 *
 * Compact card · 22 px logo, 13 px symbol, 11 px balance, 9 px
 * network chip · designed to fit 3-up on a 360 dp phone with comfy
 * tap targets (~110 dp wide cards).
 */
export function CryptoSelector({ options, selected, wallets, onSelect }: CryptoSelectorProps) {
  const isWeb = Platform.OS === "web";
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { width } = useWindowDimensions();

  // Native RN doesn't support `flexBasis: calc(...)` · compute the
  // pixel width directly from the viewport.
  const columns = width >= 900 ? 5 : width >= 600 ? 4 : 3;
  const gap = 8;
  const hPadGuess = width >= 900 ? 48 : 16;
  const cardW = (width - 2 * hPadGuess - gap * (columns - 1)) / columns;

  // Last-row orphan span · if `length % columns === 1`, the last card
  // takes the full row. e.g. 5 items in 3 cols → row 1 has 3 items
  // (5 % 3 = 2 leftover · NOT 1, no span). 4 items in 3 cols → 4 % 3
  // = 1 leftover · span. 7 items in 3 cols → 7 % 3 = 1 leftover · span.
  const lastIsOrphan = options.length % columns === 1;
  const lastSpanWidth = width - 2 * hPadGuess;

  return (
    <View
      style={{
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap,
        marginTop: 4,
      }}
    >
      {options.map((crypto, idx) => {
        const info = CURRENCIES[crypto];
        const isSelected = selected === crypto;
        const wallet = wallets?.find((w) => w.currency === crypto);
        const bal = wallet ? parseFloat(wallet.balance) : 0;
        const isLast = idx === options.length - 1;
        const w = isLast && lastIsOrphan ? lastSpanWidth : cardW;

        return (
          <Pressable
            key={crypto}
            onPress={() => onSelect(crypto)}
            style={({ pressed, hovered }: any) => ({
              width: w,
              borderRadius: 14,
              paddingHorizontal: 8,
              paddingVertical: 12,
              borderWidth: 1.5,
              alignItems: "center" as const,
              justifyContent: "center" as const,
              minHeight: 92,
              borderColor: isSelected
                ? colors.primary[500]
                : isWeb && hovered
                  ? tc.glass.borderStrong
                  : tc.dark.border,
              backgroundColor: isSelected
                ? colors.primary[500] + "18"
                : isWeb && hovered
                  ? tc.dark.elevated
                  : tc.dark.card,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel={`Pay with ${crypto}`}
            accessibilityState={{ selected: isSelected }}
          >
            {/* Symbol + logo on one row · then balance · then network */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                marginBottom: 4,
              }}
            >
              <CryptoLogo currency={crypto} size={20} />
              <Text
                style={{
                  fontSize: 13,
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
                fontSize: 11,
                fontFamily: "DMSans_600SemiBold",
                marginBottom: 2,
              }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {bal.toFixed(info.decimals > 4 ? 4 : info.decimals)}
            </Text>
            {COIN_NETWORK[crypto] ? (
              <Text
                style={{
                  color: isSelected ? colors.primary[400] : tc.dark.muted,
                  fontSize: 9,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: 0.6,
                  opacity: isSelected ? 1 : 0.75,
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
