/**
 * NetworkBadge · asset · network chip used on Deposit + Send screens.
 *
 * Replaces labels like "USDT (TRON)" with a proper chip with a
 * color-coded dot + monospace code. Colors match ChainConverge so a
 * user's eye ties them together across screens.
 *
 *   USDT · TRON    · emerald
 *   BTC            · amber
 *   ETH · ERC-20   · indigo
 *   SOL            · violet
 *
 * Note: the brand brief overrides these on app surfaces where "emerald
 * is the ONLY accent" · pass `mono` to render all chips in ink-2 +
 * single-dot style for those contexts.
 */
import { View, Text, Platform } from "react-native";

const INK2 = "#1F2937";
const MUTED = "#64748B";
const PAPER_SUBTLE = "#F8FAFC";
const LINE = "#E5E7EB";

export type ChainKey =
  | "usdt-tron"
  | "usdt-erc20"
  | "usdt-polygon"
  | "btc"
  | "eth-erc20"
  | "sol"
  | "usdc-polygon";

const META: Record<ChainKey, { asset: string; net: string; color: string }> = {
  "usdt-tron": { asset: "USDT", net: "TRON", color: "#10B981" },
  "usdt-erc20": { asset: "USDT", net: "ERC-20", color: "#10B981" },
  "usdt-polygon": { asset: "USDT", net: "POLYGON", color: "#10B981" },
  btc: { asset: "BTC", net: "BITCOIN", color: "#F59E0B" },
  "eth-erc20": { asset: "ETH", net: "ERC-20", color: "#6366F1" },
  sol: { asset: "SOL", net: "SOLANA", color: "#A855F7" },
  "usdc-polygon": { asset: "USDC", net: "POLYGON", color: "#2775CA" },
};

export interface NetworkBadgeProps {
  chain: ChainKey;
  /** Hide the network subtitle, show asset only. */
  compact?: boolean;
  /** Force monochrome ink rendering (emerald-only surfaces). */
  mono?: boolean;
  /** Dark-surface variant · use on app screens (deposit, send). */
  dark?: boolean;
}

export function NetworkBadge({ chain, compact = false, mono = false, dark = false }: NetworkBadgeProps) {
  const m = META[chain];
  const dot = mono ? "#10B981" : m.color;

  const bg = dark ? "rgba(22,39,66,0.55)" : PAPER_SUBTLE;
  const border = dark ? "rgba(255,255,255,0.1)" : LINE;
  const assetColor = dark ? "#E8EEF7" : INK2;
  const netColor = dark ? "#8396AD" : MUTED;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: dot,
        }}
      />
      <Text
        style={{
          fontSize: 12,
          fontFamily: "DMSans_700Bold",
          letterSpacing: -0.2,
          color: assetColor,
        }}
      >
        {m.asset}
      </Text>
      {!compact ? (
        <>
          <Text style={{ fontSize: 10, color: netColor }}>·</Text>
          <Text
            style={{
              fontSize: 11,
              fontFamily: Platform.OS === "web" ? "JetBrainsMono_500Medium, 'JetBrains Mono', monospace" : "JetBrainsMono_500Medium",
              letterSpacing: 0.5,
              color: netColor,
            }}
          >
            {m.net}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/** Helper: map our app currency codes to ChainKey. */
export function currencyToChain(currency: string): ChainKey {
  switch (currency) {
    case "USDT": return "usdt-tron";
    case "BTC": return "btc";
    case "ETH": return "eth-erc20";
    case "SOL": return "sol";
    case "USDC": return "usdc-polygon";
    default: return "usdt-tron";
  }
}
