/**
 * Cpay polish assets — empty states, error, QR frame, KYC illos, tx
 * status icons, network badges, onboarding icons + slide.
 *
 * Ported from the design handoff (cpay/project/polish-assets.jsx). Uses
 * react-native-svg primitives so each component works on web (via
 * react-native-web's svg shim) and native.
 *
 * Brand contract:
 *   - 200×200 viewBox, 1.5px ink-2 stroke, single emerald accent
 *   - prefers-reduced-motion safe
 *   - No emoji, no red — failed = ink-2 outline, not red
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, View, Text } from "react-native";
import Svg, { Circle, Rect, Path, Line, Ellipse, Text as SvgText, G, Defs, LinearGradient, Stop } from "react-native-svg";

const INK = "#0B1220";
const INK2 = "#1F2937";
const EMERALD = "#10B981";
const EMERALD_DARK = "#059669";
const EMERALD_SOFT = "#D1FAE5";
const LINE = "#E5E7EB";
const MUTED = "#64748B";
const PAPER = "#FFFFFF";

const isWeb = Platform.OS === "web";

// ═════════════════════════════════════════════════════════════════════════
// EMPTY STATES
// ═════════════════════════════════════════════════════════════════════════

export function EmptyNoTransactions({ size = 200 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Path d="M 60 45 L 140 45 L 140 145 L 128 138 L 116 145 L 104 138 L 92 145 L 80 138 L 68 145 L 60 138 Z" fill="none" stroke={INK2} strokeWidth="1.5" strokeLinejoin="round" />
      <Line x1="74" y1="72" x2="126" y2="72" stroke={LINE} strokeWidth="2" />
      <Line x1="74" y1="90" x2="126" y2="90" stroke={LINE} strokeWidth="2" />
      <Line x1="74" y1="108" x2="110" y2="108" stroke={LINE} strokeWidth="2" />
      <Circle cx="100" cy="38" r="5" fill={EMERALD} />
    </Svg>
  );
}

export function EmptyNoWallet({ size = 200 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Rect x="50" y="80" width="50" height="40" rx="6" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Line x1="60" y1="70" x2="60" y2="80" stroke={INK2} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="90" y1="70" x2="90" y2="80" stroke={INK2} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="110" y1="100" x2="122" y2="100" stroke={LINE} strokeWidth="2" strokeDasharray="2 3" />
      <Rect x="130" y="80" width="40" height="40" rx="6" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Circle cx="160" cy="100" r="4" fill={EMERALD} />
    </Svg>
  );
}

export function EmptyNoNotifications({ size = 200 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Path d="M 75 115 Q 75 70 100 65 Q 125 70 125 115 L 130 120 L 70 120 Z" fill="none" stroke={INK2} strokeWidth="1.5" strokeLinejoin="round" />
      <Line x1="96" y1="58" x2="104" y2="58" stroke={INK2} strokeWidth="2" strokeLinecap="round" />
      <Path d="M 92 130 Q 100 138 108 130" fill="none" stroke={INK2} strokeWidth="1.5" strokeLinecap="round" />
      <SvgText x="135" y="85" fontSize="14" fontWeight="700" fill={EMERALD} fontFamily="DMSans_700Bold">z</SvgText>
      <SvgText x="143" y="78" fontSize="10" fontWeight="700" fill={EMERALD} fontFamily="DMSans_700Bold" opacity="0.7">z</SvgText>
    </Svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// ERROR STATE — ink outline circle-X with emerald mark. Deliberately not red.
// ═════════════════════════════════════════════════════════════════════════

export function ErrorState({ size = 200 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Circle cx="100" cy="100" r="55" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Line x1="82" y1="82" x2="118" y2="118" stroke={EMERALD} strokeWidth="3" strokeLinecap="round" />
      <Line x1="118" y1="82" x2="82" y2="118" stroke={EMERALD} strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// TX STATUS ICONS — 24×24 monochrome glyphs. Use in transaction lists.
// `processing` rotates; others are static.
// ═════════════════════════════════════════════════════════════════════════

export type TxStatusKind = "pending" | "processing" | "confirmed" | "failed";

export function TxStatusIcon({ kind, size = 24 }: { kind: TxStatusKind; size?: number }) {
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (kind !== "processing") return;
    if (isWeb) {
      if (typeof document !== "undefined" && !document.getElementById("cpay-txstatus-kf2")) {
        const s = document.createElement("style");
        s.id = "cpay-txstatus-kf2";
        s.textContent = `
          @keyframes cpay-txstatus-rot2 { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) {
            [data-cpay-txproc] { animation: none !important; }
          }
        `;
        document.head.appendChild(s);
      }
      return;
    }
    const loop = Animated.loop(
      Animated.timing(rot, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [kind]);

  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  if (kind === "confirmed") {
    return (
      <Svg viewBox="0 0 24 24" width={size} height={size}>
        <Circle cx="12" cy="12" r="9" fill={EMERALD} />
        <Path d="M 8 12 L 11 15 L 16 9" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }
  if (kind === "failed") {
    return (
      <Svg viewBox="0 0 24 24" width={size} height={size}>
        <Circle cx="12" cy="12" r="9" fill="none" stroke={INK2} strokeWidth="2" />
        <Line x1="9" y1="9" x2="15" y2="15" stroke={INK2} strokeWidth="2" strokeLinecap="round" />
        <Line x1="15" y1="9" x2="9" y2="15" stroke={INK2} strokeWidth="2" strokeLinecap="round" />
      </Svg>
    );
  }
  if (kind === "pending") {
    return (
      <Svg viewBox="0 0 24 24" width={size} height={size}>
        <Circle cx="12" cy="12" r="9" fill="none" stroke={MUTED} strokeWidth="2" strokeDasharray="3 3" />
      </Svg>
    );
  }
  // processing
  const proc = (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Circle cx="12" cy="12" r="9" fill="none" stroke={LINE} strokeWidth="2" />
      <Path d="M 12 3 A 9 9 0 0 1 21 12" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
  if (isWeb) {
    return (
      <View {...({ "data-cpay-txproc": true } as any)} style={{ width: size, height: size, animation: "cpay-txstatus-rot2 1.4s linear infinite" } as any}>
        {proc}
      </View>
    );
  }
  return <Animated.View style={{ width: size, height: size, transform: [{ rotate: spin }] }}>{proc}</Animated.View>;
}

// ═════════════════════════════════════════════════════════════════════════
// NETWORK BADGE — asset-on-network chip. Use on deposit/send surfaces.
// ═════════════════════════════════════════════════════════════════════════

const NETWORK_COLORS: Record<string, string> = {
  USDT: "#22C55E",
  BTC: "#F59E0B",
  ETH: "#6366F1",
  SOL: "#9333EA",
  USDC: "#2775CA",
};

export function NetworkBadge({ asset, network, color }: { asset: string; network: string; color?: string }) {
  const fg = color || NETWORK_COLORS[asset] || EMERALD;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 12,
        paddingLeft: 8,
        borderRadius: 999,
        backgroundColor: PAPER,
        borderWidth: 1,
        borderColor: LINE,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: fg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: "#fff",
            fontSize: 9,
            fontFamily: "DMSans_700Bold",
            letterSpacing: 0.3,
          }}
        >
          {asset}
        </Text>
      </View>
      <Text style={{ color: INK, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
        {asset} · <Text style={{ color: MUTED, fontSize: 11, fontFamily: "DMSans_500Medium" }}>{network}</Text>
      </Text>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// KYC ILLUSTRATIONS — focus-frame with corner brackets + subject hint.
// ═════════════════════════════════════════════════════════════════════════

export function KycIdFront({ size = 200 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Rect x="40" y="60" width="120" height="80" rx="8" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Rect x="52" y="74" width="38" height="52" rx="2" fill={PAPER} stroke={INK2} strokeWidth="1.2" />
      <Circle cx="71" cy="92" r="8" fill="none" stroke={INK2} strokeWidth="1.2" />
      <Path d="M 58 118 Q 71 106 84 118" fill="none" stroke={INK2} strokeWidth="1.2" />
      <Line x1="100" y1="80" x2="148" y2="80" stroke={LINE} strokeWidth="2" />
      <Line x1="100" y1="92" x2="148" y2="92" stroke={LINE} strokeWidth="2" />
      <Line x1="100" y1="104" x2="138" y2="104" stroke={LINE} strokeWidth="2" />
      <Path d="M 30 50 L 30 44 L 36 44" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
      <Path d="M 164 44 L 170 44 L 170 50" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
      <Path d="M 170 150 L 170 156 L 164 156" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
      <Path d="M 36 156 L 30 156 L 30 150" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function KycSelfie({ size = 200 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Ellipse cx="100" cy="100" rx="50" ry="60" fill="none" stroke={INK2} strokeWidth="1.5" strokeDasharray="4 4" />
      <Circle cx="100" cy="92" r="14" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Path d="M 76 140 Q 100 120 124 140" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Path d="M 40 42 L 40 30 L 52 30" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
      <Path d="M 148 30 L 160 30 L 160 42" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
      <Path d="M 160 158 L 160 170 L 148 170" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
      <Path d="M 52 170 L 40 170 L 40 158" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function KycReview({ size = 200 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Path d="M 60 45 L 130 45 L 145 60 L 145 155 L 60 155 Z" fill="none" stroke={INK2} strokeWidth="1.5" strokeLinejoin="round" />
      <Path d="M 130 45 L 130 60 L 145 60" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Line x1="72" y1="78" x2="130" y2="78" stroke={LINE} strokeWidth="2" />
      <Line x1="72" y1="92" x2="130" y2="92" stroke={LINE} strokeWidth="2" />
      <Line x1="72" y1="106" x2="114" y2="106" stroke={LINE} strokeWidth="2" />
      <Circle cx="120" cy="130" r="16" fill="none" stroke={EMERALD} strokeWidth="2" />
      <Path d="M 112 130 L 118 136 L 128 124" fill="none" stroke={EMERALD} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// ONBOARDING ICONS — used inside OnboardingSlide cards.
// ═════════════════════════════════════════════════════════════════════════

export function OnboardingIcon1({ size = 160 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <LinearGradient id="obg1" x1="0" x2="1" y1="0" y2="1">
          <Stop offset="0" stopColor={EMERALD} stopOpacity="0.25" />
          <Stop offset="1" stopColor={EMERALD} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="58" y="30" width="84" height="140" rx="14" fill="#060E1F" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
      <Rect x="58" y="30" width="84" height="140" rx="14" fill="url(#obg1)" />
      <Rect x="86" y="38" width="28" height="5" rx="2.5" fill="rgba(255,255,255,0.15)" />
      <SvgText x="100" y="78" textAnchor="middle" fontSize="7" fill="#8396AD" fontFamily="DMSans_500Medium" letterSpacing="1.2">AMOUNT PAID</SvgText>
      <SvgText x="100" y="98" textAnchor="middle" fontSize="13" fontWeight="700" fill="#FFFFFF" fontFamily="JetBrainsMono_700Bold" letterSpacing="-0.3">KES 2,450</SvgText>
      <Rect x="72" y="112" width="56" height="22" rx="11" fill={EMERALD} />
      <Path d="M 83 123 L 88 128 L 96 119" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <SvgText x="115" y="127" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff" fontFamily="DMSans_700Bold" letterSpacing="1">DONE</SvgText>
      <Rect x="72" y="144" width="56" height="3" rx="1.5" fill="rgba(255,255,255,0.18)" />
      <Rect x="80" y="152" width="40" height="3" rx="1.5" fill="rgba(255,255,255,0.08)" />
    </Svg>
  );
}

export function OnboardingIcon2({ size = 160 }: { size?: number }) {
  const coins: { cx: number; cy: number; sym: string; bg: string }[] = [
    { cx: 40, cy: 50, sym: "T", bg: "#26A17B" },
    { cx: 160, cy: 50, sym: "B", bg: "#F7931A" },
    { cx: 40, cy: 150, sym: "E", bg: "#627EEA" },
    { cx: 160, cy: 150, sym: "S", bg: "#9945FF" },
  ];
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      {coins.map((c, i) => (
        <Line key={i} x1={c.cx} y1={c.cy} x2="100" y2="100" stroke="rgba(16,185,129,0.3)" strokeWidth="1" strokeDasharray="3 3" />
      ))}
      <Circle cx="100" cy="100" r="30" fill={EMERALD} />
      <Circle cx="100" cy="100" r="30" fill="none" stroke="rgba(16,185,129,0.3)" strokeWidth="8" opacity="0.5" />
      <SvgText x="100" y="106" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" fontFamily="DMSans_700Bold" letterSpacing="0.5">KES</SvgText>
      {coins.map((c, i) => (
        <G key={`c-${i}`}>
          <Circle cx={c.cx} cy={c.cy} r="18" fill={c.bg} />
          <SvgText x={c.cx} y={c.cy + 5} textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff" fontFamily="DMSans_700Bold">{c.sym}</SvgText>
        </G>
      ))}
    </Svg>
  );
}

export function OnboardingIcon3({ size = 160 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Circle cx="100" cy="100" r="72" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
      <Circle cx="100" cy="100" r="72" fill="none" stroke={EMERALD} strokeWidth="6" strokeLinecap="round" strokeDasharray="340 452" transform="rotate(-90 100 100)" />
      <Path d="M 100 48 L 138 60 L 138 106 Q 138 138 100 156 Q 62 138 62 106 L 62 60 Z" fill="rgba(16,185,129,0.12)" stroke={EMERALD} strokeWidth="1.5" />
      <Rect x="82" y="96" width="36" height="30" rx="4" fill={EMERALD} />
      <Path d="M 88 96 L 88 86 Q 88 76 100 76 Q 112 76 112 86 L 112 96" fill="none" stroke={EMERALD} strokeWidth="4" strokeLinecap="round" />
      <Circle cx="100" cy="108" r="3" fill="#060E1F" />
      <Rect x="98.5" y="108" width="3" height="8" fill="#060E1F" />
      <SvgText x="100" y="184" textAnchor="middle" fontSize="11" fontWeight="700" fill={EMERALD} fontFamily="JetBrainsMono_700Bold" letterSpacing="2">90s</SvgText>
    </Svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// PUSH NOTIF ICON — white Coin-C on ink circle. Used by notification
// subsystem + lock-screen icons.
// ═════════════════════════════════════════════════════════════════════════

export function PushNotifIcon({ size = 120 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Circle cx="100" cy="100" r="96" fill={INK} />
      <Circle cx="100" cy="100" r="72" fill="none" stroke="#fff" strokeWidth="22" strokeLinecap="round" strokeDasharray="380 500" transform="rotate(-135 100 100)" />
      <Rect x="100" y="92" width="46" height="16" rx="3" fill="#fff" />
    </Svg>
  );
}
