import { useState } from "react";
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

  // 2026-05-15 v5 · measure the ACTUAL parent width via onLayout instead
  // of trusting the viewport. On web, payment screens wrap the picker in
  // a centred max-width container (~540 px desktop) while the viewport
  // can be 1500 px+ · v4 read viewport, computed 4 cols × ~314 px each,
  // and Yoga flex-wrapped each card to its own row because the parent
  // couldn't fit them. The grid ended up as a stacked horizontal list
  // with the orphan-span making the last card span the entire parent.
  //
  // `containerW` is null on first render (before onLayout fires); we
  // fall back to a conservative phone-equivalent width so the first
  // paint isn't blank. The component then re-renders once we have the
  // real width and the grid snaps to the right column count.
  const [containerW, setContainerW] = useState<number | null>(null);

  const effectiveW = containerW ?? Math.min(screenW, 540);

  // Column count · target ~110-130 px per card. On a 540-px parent that
  // gives 4 cols (~125 px each); on a 360-px phone parent, 3 cols
  // (~110 px each). Matches the Deposit-screen design at both extremes.
  const columns = effectiveW >= 480 ? 4 : 3;
  const gap = 8;
  // No external padding subtraction · `effectiveW` is already the inner
  // width of the parent (onLayout reports content-box width). The
  // (columns - 1) gaps come straight off this width, then divide.
  const cardW = Math.floor((effectiveW - gap * (columns - 1)) / columns);

  // Last-row orphan span · only fires when `length % columns === 1`.
  // 5 items in 4 cols → 5%4 = 1 → orphan, last spans the row.
  // 5 items in 3 cols → 5%3 = 2 → no orphan.
  const lastIsOrphan = options.length % columns === 1;

  return (
    <View
      onLayout={(e) => {
        const w = Math.floor(e.nativeEvent.layout.width);
        // Guard against onLayout firing with the same width (it does on
        // some platforms when the parent re-renders) · avoids a render
        // loop.
        if (w > 0 && w !== containerW) setContainerW(w);
      }}
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
        // Last orphan spans the full parent width (`effectiveW`) so the
        // grid doesn't end with one half-width card hanging off the
        // bottom-left corner. Fires only when length % columns === 1.
        const cardWidth = isLast && lastIsOrphan ? effectiveW : cardW;

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
