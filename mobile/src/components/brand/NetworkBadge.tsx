/**
 * NetworkBadge — asset · network chip used on Deposit + Send screens.
 *
 * Replaces labels like "USDT (TRON)" with a proper chip with a
 * color-coded dot + monospace code. Colors match ChainConverge so a
 * user's eye ties them together across screens.
 *
 *   USDT · TRON    — emerald
 *   BTC            — amber
 *   ETH · ERC-20   — indigo
 *   SOL            — violet
 *
 * Note: the brand brief overrides these on app surfaces where "emerald
 * is the ONLY accent" — pass `mono` to render all chips in ink-2 +
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
}

export function NetworkBadge({ chain, compact = false, mono = false }: NetworkBadgeProps) {
  const m = META[chain];
  const dot = mono ? "#10B981" : m.color;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: PAPER_SUBTLE,
        borderWidth: 1,
        borderColor: LINE,
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
          color: INK2,
        }}
      >
        {m.asset}
      </Text>
      {!compact ? (
        <>
          <Text style={{ fontSize: 10, color: MUTED }}>·</Text>
          <Text
            style={{
              fontSize: 11,
              fontFamily: Platform.OS === "web" ? "JetBrainsMono_500Medium, 'JetBrains Mono', monospace" : "JetBrainsMono_500Medium",
              letterSpacing: 0.5,
              color: MUTED,
            }}
          >
            {m.net}
          </Text>
        </>
      ) : null}
    </View>
  );
}
