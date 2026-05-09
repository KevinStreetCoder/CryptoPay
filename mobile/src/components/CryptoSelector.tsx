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
 * Compact responsive crypto picker · 2026-05-09 redesign (v3).
 *
 *   < 600 px (phones)            · 2 cols → matches Deposit-screen design
 *   600 – 899 px (small tablets) · 3 cols
 *   ≥ 900 px (tablets / desktop) · 4 cols
 *
 * **Padding-agnostic layout** · v2 used `width: cardW` computed from
 * the viewport with a hard-coded `hPad = 16` assumption. On screens
 * where the parent had `paddingHorizontal: 20` (Send / Buy-Goods /
 * Pay-Bill / Pay-Till), the calc was 4 dp too wide → cards couldn't
 * fit 2-per-row → wrapped to 1-col. v3 uses `flexBasis: 48%` +
 * `flexGrow: 1`, which adapts to whatever the parent gives us.
 *
 * **Last-row span fallback** · when the orphan count in the last
 * row is exactly 1, that one card takes 100% width so the grid
 * doesn't end with a single half-width card next to empty space.
 * For 5 cryptos in 2 cols: row1 = USDT|USDC, row2 = BTC|ETH,
 * row3 = SOL spanning full width.
 *
 * Compact card · 22 px logo, 13 px symbol, 11 px balance, 9 px
 * network chip.
 */
export function CryptoSelector({ options, selected, wallets, onSelect }: CryptoSelectorProps) {
  const isWeb = Platform.OS === "web";
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { width } = useWindowDimensions();

  // Column count drives the percentage width.
  const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const gap = 8;
  // Each card claims ~`100/columns - 2`% so the gap fits naturally.
  // Percentage widths in RN are RELATIVE to the parent, so this is
  // padding-agnostic — works at any hPad the parent chooses.
  const cardWPct = `${100 / columns - (columns === 2 ? 1 : 1.5)}%`;

  // Last-row orphan span · only fires when `length % columns === 1`.
  // 5 items in 2 cols → 5%2 = 1 leftover → SPAN.
  // 4 items in 2 cols → 4%2 = 0 → NO span (last row has 2).
  // 5 items in 3 cols → 5%3 = 2 → NO span (last row has 2).
  const lastIsOrphan = options.length % columns === 1;

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
        // Last orphan spans the full row · 100% width.
        const widthValue = isLast && lastIsOrphan ? "100%" : cardWPct;

        return (
          <Pressable
            key={crypto}
            onPress={() => onSelect(crypto)}
            style={({ pressed, hovered }: any) => ({
              flexBasis: widthValue as any,
              flexGrow: 0,
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
