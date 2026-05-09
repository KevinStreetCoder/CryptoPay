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
 * Compact responsive crypto picker · 2026-05-09 redesign (v4).
 *
 *   < 600 px (phones)            · 3 cols → matches Deposit-screen layout
 *                                  so 5 cryptos fit in 2 rows max
 *                                  (3 + 2-with-spacer) instead of 3 rows
 *   600 – 899 px (small tablets) · 3 cols
 *   ≥ 900 px (tablets / desktop) · 4 cols
 *
 * **v4 layout fix** · v3 used `flexBasis: 49%` + flexWrap which on
 * some Android RN versions silently fell back to 1-col (Yoga's
 * percent-flexBasis path is finicky when children have intrinsic
 * content). v4 switches to fixed-point widths computed from
 * `useWindowDimensions().width` minus the parent's known padding,
 * which is rock-solid across all RN targets we ship to. The
 * `hPad` constant matches the 20-dp horizontal padding every
 * payment screen wraps the picker in.
 *
 * **Last-row span fallback** · when the orphan count in the last
 * row is exactly 1, that one card takes the full row width so the
 * grid doesn't end with a single half-width card. For 5 cryptos in
 * 3 cols: row1 = USDT|USDC|BTC, row2 = ETH|SOL (no orphan since
 * 5%3 = 2). Earlier 2-col layout gave 5%2 = 1 → orphan span.
 *
 * Compact card · 20 px logo, 13 px symbol, 11 px balance, 9 px
 * network chip.
 */
export function CryptoSelector({ options, selected, wallets, onSelect }: CryptoSelectorProps) {
  const isWeb = Platform.OS === "web";
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { width: screenW } = useWindowDimensions();

  // Column count · phones default to 3 (matches Deposit-screen design).
  const columns = screenW >= 900 ? 4 : 3;
  const gap = 8;
  // 2026-05-09 v4 · compute the card width in DP rather than a percent
  // so RN/Yoga doesn't fall back to 1-col on the percent-flexBasis
  // edge cases we hit on Galaxy / Pixel devices in vc 14.
  // Parent screens wrap the picker in `paddingHorizontal: isDesktop ? 0 : 20`
  // so we subtract 40 dp on phone (2 × 20). The (columns - 1) gaps
  // come out of the remaining width, then divide.
  const HPAD = screenW >= 900 ? 0 : 40;
  const usable = Math.max(0, screenW - HPAD);
  const cardW = Math.floor((usable - gap * (columns - 1)) / columns);

  // Last-row orphan span · only fires when `length % columns === 1`.
  // 5 items in 3 cols → 5%3 = 2 → NO span (last row has 2 already).
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
        // Last orphan spans the full row · uses the entire usable width.
        const cardWidth = isLast && lastIsOrphan ? usable : cardW;

        return (
          <Pressable
            key={crypto}
            onPress={() => onSelect(crypto)}
            style={({ pressed, hovered }: any) => ({
              width: cardWidth,
              borderRadius: 14,
              paddingHorizontal: 6,
              paddingVertical: 10,
              borderWidth: 1.5,
              alignItems: "center" as const,
              justifyContent: "center" as const,
              minHeight: 84,
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
