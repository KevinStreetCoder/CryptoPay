/**
 * Brand illustrations · ported 1:1 from the Cpay design handoff
 * (`Cpay-handoff-resources/cpay/project/assets.jsx`).
 *
 * Replaces the unDraw stock art with the design's in-brand SVGs.
 * Each viewport is 320×320 to match the handoff's IllFrame.
 *
 * Shared defs:
 *   - `ill-em` linear gradient (emerald → emerald-dark)
 *   - `ill-bg` soft emerald mint gradient
 *
 * Animations use requestAnimationFrame on web (bound to window to
 * avoid "Illegal invocation" on Chromium) and a setTimeout fallback
 * on native.
 */
import { useEffect, useState, useMemo } from "react";
import { Platform } from "react-native";
import Svg, {
  Circle,
  Rect,
  Ellipse,
  Path,
  Line,
  Text as SvgText,
  G,
  Defs,
  LinearGradient,
  Stop,
} from "react-native-svg";

const isWeb = Platform.OS === "web";

// ─── Shared anim hook: 0..1 loop over `duration` ms ─────────────────────
function useLoop(duration = 2800) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf: any;
    let start: number | null = null;
    const raw = isWeb
      ? (cb: (n: number) => void) => window.requestAnimationFrame(cb)
      : (cb: (n: number) => void) => setTimeout(() => cb(Date.now()), 16) as any;
    const tick = (now: number) => {
      if (start == null) start = now;
      setT(((now - start) % duration) / duration);
      raf = raw(tick);
    };
    raf = raw(tick);
    return () => {
      if (isWeb) window.cancelAnimationFrame(raf);
      else clearTimeout(raf);
    };
  }, [duration]);
  return t;
}

// ─── IllFrame: the handoff's reusable wrapper ───────────────────────────
function IllFrame({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <Svg viewBox="0 0 320 320" width={size} height={size} style={{ display: "block" } as any}>
      <Defs>
        <LinearGradient id="ill-em" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#10B981" />
          <Stop offset="1" stopColor="#059669" />
        </LinearGradient>
        <LinearGradient id="ill-bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ECFDF5" />
          <Stop offset="1" stopColor="#D1FAE5" />
        </LinearGradient>
      </Defs>
      {children}
    </Svg>
  );
}

// ═════════════════════════════════════════════════════════════════════
// WalletIcon · replaces wallet_aym5
// Stack of cards + wallet body with clasp + coin + sparkle
// ═════════════════════════════════════════════════════════════════════
export function WalletIcon({ size = 200 }: { size?: number }) {
  return (
    <IllFrame size={size}>
      {/* Pedestal blob */}
      <Ellipse cx="160" cy="260" rx="120" ry="14" fill="#10B981" opacity="0.1" />
      {/* Back card peeking */}
      <G transform="rotate(-8 160 115)">
        <Rect x="90" y="70" width="140" height="90" rx="8" fill="#CBD5E1" />
        <Rect x="100" y="82" width="50" height="6" rx="3" fill="#94A3B8" />
      </G>
      {/* Cash note */}
      <G transform="rotate(6 170 120)">
        <Rect x="100" y="90" width="130" height="70" rx="4" fill="#D1FAE5" stroke="#10B981" strokeWidth="1.5" />
        <Circle cx="165" cy="125" r="16" fill="none" stroke="#10B981" strokeWidth="1.5" />
        <SvgText x="165" y="131" textAnchor="middle" fontSize="16" fontWeight="700" fill="#10B981" fontFamily="DMSans_700Bold">K</SvgText>
        <Rect x="108" y="98" width="14" height="14" rx="2" fill="none" stroke="#10B981" strokeWidth="1.2" />
        <Rect x="208" y="146" width="14" height="14" rx="2" fill="none" stroke="#10B981" strokeWidth="1.2" />
      </G>
      {/* Wallet body */}
      <Path
        d="M 60 140 L 260 140 Q 278 140 278 158 L 278 240 Q 278 258 260 258 L 60 258 Q 42 258 42 240 L 42 158 Q 42 140 60 140 Z"
        fill="#0B1220"
      />
      <Path
        d="M 60 140 L 260 140 Q 278 140 278 158 L 278 170 L 42 170 L 42 158 Q 42 140 60 140 Z"
        fill="#1F2937"
      />
      {/* Wallet clasp */}
      <Rect x="210" y="190" width="50" height="26" rx="4" fill="url(#ill-em)" />
      <Circle cx="235" cy="203" r="4" fill="#ECFDF5" />
      {/* Card slots */}
      <Line x1="60" y1="200" x2="150" y2="200" stroke="#374151" strokeWidth="1.5" />
      <Line x1="60" y1="218" x2="130" y2="218" stroke="#374151" strokeWidth="1.5" />
      {/* Coin */}
      <G transform="translate(80 90)">
        <Circle cx="0" cy="0" r="22" fill="url(#ill-em)" />
        <Circle cx="0" cy="0" r="22" fill="none" stroke="#064E3B" strokeWidth="1.5" />
        <SvgText x="0" y="6" textAnchor="middle" fontSize="20" fontWeight="700" fill="#ECFDF5" fontFamily="DMSans_700Bold">C</SvgText>
      </G>
      {/* Sparkle */}
      <Path
        d="M 245 90 L 250 80 L 255 90 L 265 95 L 255 100 L 250 110 L 245 100 L 235 95 Z"
        fill="#F59E0B"
        opacity="0.9"
      />
    </IllFrame>
  );
}

// ═════════════════════════════════════════════════════════════════════
// SecurityLock · replaces secure_data + safe
// Shield with layered padlock + amber checkmark badge
// ═════════════════════════════════════════════════════════════════════
export function SecurityLock({ size = 200 }: { size?: number }) {
  return (
    <IllFrame size={size}>
      {/* Orbital dashed rings */}
      <Circle cx="160" cy="160" r="140" fill="none" stroke="#10B981" strokeWidth="1" strokeDasharray="3 6" opacity="0.4" />
      <Circle cx="160" cy="160" r="115" fill="none" stroke="#10B981" strokeWidth="1" strokeDasharray="2 4" opacity="0.3" />
      {/* Shield backdrop */}
      <Path
        d="M 160 40 L 260 78 L 260 170 Q 260 240 160 286 Q 60 240 60 170 L 60 78 Z"
        fill="url(#ill-em)"
      />
      <Path
        d="M 160 40 L 260 78 L 260 170 Q 260 240 160 286 Q 60 240 60 170 L 60 78 Z"
        fill="none"
        stroke="#064E3B"
        strokeWidth="2"
      />
      {/* Inner shield facet */}
      <Path
        d="M 160 60 L 240 90 L 240 168 Q 240 224 160 264 Q 80 224 80 168 L 80 90 Z"
        fill="#064E3B"
        opacity="0.35"
      />
      {/* Padlock body */}
      <Rect x="118" y="148" width="84" height="80" rx="8" fill="#0B1220" />
      <Rect x="118" y="148" width="84" height="80" rx="8" fill="none" stroke="#064E3B" strokeWidth="1.5" />
      {/* Shackle */}
      <Path
        d="M 132 148 L 132 128 Q 132 100 160 100 Q 188 100 188 128 L 188 148"
        fill="none"
        stroke="#ECFDF5"
        strokeWidth="8"
        strokeLinecap="round"
      />
      {/* Keyhole */}
      <Circle cx="160" cy="178" r="9" fill="#10B981" />
      <Rect x="156" y="178" width="8" height="20" rx="2" fill="#10B981" />
      {/* Checkmark badge */}
      <Circle cx="220" cy="110" r="18" fill="#F59E0B" />
      <Path
        d="M 212 110 L 218 116 L 228 104"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Data bits */}
      <Rect x="40" y="230" width="30" height="4" rx="1" fill="#10B981" opacity="0.6" />
      <Rect x="40" y="240" width="20" height="4" rx="1" fill="#10B981" opacity="0.4" />
      <Rect x="250" y="240" width="28" height="4" rx="1" fill="#10B981" opacity="0.5" />
    </IllFrame>
  );
}

// ═════════════════════════════════════════════════════════════════════
// SpeedRing · replaces fast_loading
// Big countdown ring (30 → 0 SECONDS) + flying coin + lightning badge
// Animated.
// ═════════════════════════════════════════════════════════════════════
export function SpeedRing({ size = 200, seconds = 30 }: { size?: number; seconds?: number }) {
  const t = useLoop(2800);
  const CIRCUMFERENCE = 490; // 2πr where r=78
  return (
    <IllFrame size={size}>
      {/* Speed lines row 1 */}
      {[0, 1, 2, 3, 4].map((i) => {
        const y = 60 + i * 16;
        const w = 40 + (i % 3) * 40;
        const offset = (t * 300 + i * 50) % 300;
        return (
          <Rect
            key={`s1-${i}`}
            x={-w + offset}
            y={y}
            width={w}
            height="3"
            rx="1.5"
            fill="#10B981"
            opacity={0.2 + (i % 3) * 0.15}
          />
        );
      })}
      {/* Speed lines row 2 */}
      {[0, 1, 2, 3].map((i) => {
        const y = 212 + i * 16;
        const w = 30 + (i % 2) * 40;
        const offset = (t * 300 + i * 70 + 100) % 300;
        return (
          <Rect
            key={`s2-${i}`}
            x={-w + offset}
            y={y}
            width={w}
            height="3"
            rx="1.5"
            fill="#10B981"
            opacity={0.25}
          />
        );
      })}
      {/* Ring glow (opacity substitute for the design's filter blur) */}
      <Circle cx="160" cy="160" r="78" fill="url(#ill-em)" opacity="0.15" />
      <Circle cx="160" cy="160" r="78" fill="#fff" stroke="#10B981" strokeWidth="3" />
      {/* Progress arc */}
      <Circle
        cx="160"
        cy="160"
        r="78"
        fill="none"
        stroke="#10B981"
        strokeWidth="6"
        strokeDasharray={`${(1 - t) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        strokeLinecap="round"
        transform="rotate(-90 160 160)"
      />
      <SvgText
        x="160"
        y="156"
        textAnchor="middle"
        fontSize="48"
        fontWeight="700"
        fill="#0B1220"
        fontFamily="DMSans_700Bold"
        letterSpacing="-1.5"
      >
        {Math.ceil(seconds * (1 - t))}
      </SvgText>
      <SvgText
        x="160"
        y="180"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill="#059669"
        fontFamily="DMSans_600SemiBold"
        letterSpacing="3"
      >
        SECONDS
      </SvgText>
      {/* Flying coin */}
      <G transform={`translate(${60 + t * 140} ${100 - Math.sin(t * Math.PI * 2) * 6})`}>
        <Circle r="14" fill="url(#ill-em)" />
        <SvgText y="5" textAnchor="middle" fontSize="14" fontWeight="700" fill="#ECFDF5" fontFamily="DMSans_700Bold">
          C
        </SvgText>
      </G>
      {/* Lightning bolt badge */}
      <G transform="translate(240 90)">
        <Circle r="20" fill="#F59E0B" />
        <Path d="M -3 -10 L -8 2 L 0 2 L -3 12 L 8 -2 L 0 -2 L 4 -10 Z" fill="#fff" />
      </G>
    </IllFrame>
  );
}

// ═════════════════════════════════════════════════════════════════════
// FaqMark · replaces questions_re1f
// Big emerald speech bubble with "?" + dark chat bubble + chip
// ═════════════════════════════════════════════════════════════════════
export function FaqMark({ size = 200 }: { size?: number }) {
  return (
    <IllFrame size={size}>
      {/* Main bubble */}
      <Path
        d="M 50 80 Q 50 40 90 40 L 220 40 Q 260 40 260 80 L 260 130 Q 260 170 220 170 L 130 170 L 100 200 L 105 170 L 90 170 Q 50 170 50 130 Z"
        fill="url(#ill-em)"
      />
      <Path
        d="M 50 80 Q 50 40 90 40 L 220 40 Q 260 40 260 80 L 260 130 Q 260 170 220 170 L 130 170 L 100 200 L 105 170 L 90 170 Q 50 170 50 130 Z"
        fill="none"
        stroke="#064E3B"
        strokeWidth="1.5"
      />
      {/* Big question mark */}
      <Path
        d="M 125 80 Q 125 58 155 58 Q 185 58 185 78 Q 185 95 165 105 L 165 122"
        fill="none"
        stroke="#ECFDF5"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <Circle cx="165" cy="142" r="6" fill="#ECFDF5" />
      {/* Secondary chat bubble */}
      <Path
        d="M 180 190 Q 180 170 200 170 L 270 170 Q 290 170 290 190 L 290 220 Q 290 240 270 240 L 250 240 L 240 255 L 242 240 L 200 240 Q 180 240 180 220 Z"
        fill="#0B1220"
      />
      <Circle cx="210" cy="205" r="3" fill="#10B981" />
      <Circle cx="225" cy="205" r="3" fill="#10B981" opacity="0.6" />
      <Circle cx="240" cy="205" r="3" fill="#10B981" opacity="0.3" />
      <Rect x="200" y="218" width="70" height="4" rx="2" fill="#374151" />
      <Rect x="200" y="228" width="50" height="4" rx="2" fill="#374151" />
      {/* Corner chip */}
      <Rect x="40" y="220" width="70" height="26" rx="13" fill="#fff" stroke="#10B981" strokeWidth="1.5" />
      <Circle cx="55" cy="233" r="5" fill="#F59E0B" />
      <Rect x="65" y="229" width="36" height="3" rx="1.5" fill="#64748B" />
      <Rect x="65" y="235" width="24" height="3" rx="1.5" fill="#94A3B8" />
    </IllFrame>
  );
}

// ═════════════════════════════════════════════════════════════════════
// TargetMark · replaces target_kriv
// Bullseye on stand + flying arrow + motion dashes + "+100%" score chip
// ═════════════════════════════════════════════════════════════════════
export function TargetMark({ size = 200 }: { size?: number }) {
  return (
    <IllFrame size={size}>
      {/* Ground shadow */}
      <Ellipse cx="160" cy="275" rx="110" ry="10" fill="#10B981" opacity="0.12" />
      {/* Stand */}
      <Path d="M 150 260 L 170 260 L 175 280 L 145 280 Z" fill="#0B1220" />
      <Rect x="130" y="275" width="60" height="5" rx="2" fill="#0B1220" />
      {/* Target body (concentric) */}
      <Circle cx="160" cy="155" r="100" fill="#fff" stroke="#0B1220" strokeWidth="2" />
      <Circle cx="160" cy="155" r="100" fill="url(#ill-em)" opacity="0.08" />
      <Circle cx="160" cy="155" r="82" fill="#fff" stroke="#0B1220" strokeWidth="1.5" />
      <Circle cx="160" cy="155" r="82" fill="#10B981" opacity="0.15" />
      <Circle cx="160" cy="155" r="62" fill="#D1FAE5" stroke="#0B1220" strokeWidth="1.5" />
      <Circle cx="160" cy="155" r="42" fill="#10B981" stroke="#064E3B" strokeWidth="1.5" />
      <Circle cx="160" cy="155" r="22" fill="#ECFDF5" stroke="#064E3B" strokeWidth="1.5" />
      <Circle cx="160" cy="155" r="8" fill="#F59E0B" />
      {/* Crosshair */}
      <Line x1="50" y1="155" x2="270" y2="155" stroke="#064E3B" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.6" />
      <Line x1="160" y1="50" x2="160" y2="260" stroke="#064E3B" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.6" />
      {/* Arrow in flight */}
      <G transform="rotate(-28 180 130)">
        <Line x1="180" y1="130" x2="280" y2="130" stroke="#0B1220" strokeWidth="2.5" />
        <Path d="M 180 130 L 190 124 L 190 136 Z" fill="#10B981" stroke="#064E3B" strokeWidth="1" />
        <Path d="M 278 130 L 290 124 L 296 130 L 290 136 Z" fill="#F59E0B" stroke="#0B1220" strokeWidth="0.8" />
        <Path d="M 270 130 L 282 124 L 288 130 L 282 136 Z" fill="#ECFDF5" stroke="#0B1220" strokeWidth="0.8" />
      </G>
      {/* Motion dashes */}
      <G opacity="0.5">
        <Line x1="235" y1="90" x2="250" y2="82" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
        <Line x1="255" y1="100" x2="275" y2="88" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
      </G>
      {/* Score chip */}
      <Rect x="40" y="50" width="72" height="28" rx="14" fill="#0B1220" />
      <SvgText x="76" y="69" textAnchor="middle" fontSize="13" fontWeight="700" fill="#10B981" fontFamily="DMSans_700Bold">
        +100%
      </SvgText>
    </IllFrame>
  );
}

// ═════════════════════════════════════════════════════════════════════
// KenyaCorridor · replaces online_world
// East-Africa map with Kenya emerald + Nairobi pin + corridor dashes
// Animated Nairobi pulse.
// ═════════════════════════════════════════════════════════════════════
export function KenyaCorridor({ size = 200 }: { size?: number }) {
  const t = useLoop(2400);
  const pulseR = 8 + (24 * (t % 1));
  const pulseO = 0.7 * (1 - (t % 1));
  const kenyaPath =
    "M 120 90 L 150 85 L 175 95 L 200 92 L 215 110 L 220 135 L 235 145 L 240 170 L 220 200 L 195 215 L 165 210 L 135 200 L 115 175 L 105 150 L 110 120 Z";
  return (
    <IllFrame size={size}>
      {/* Faint grid */}
      {[80, 120, 160, 200, 240].map((y) => (
        <Line key={`h-${y}`} x1="20" y1={y} x2="300" y2={y} stroke="#10B981" strokeWidth="0.5" opacity="0.15" />
      ))}
      {[60, 100, 140, 180, 220, 260].map((x) => (
        <Line key={`v-${x}`} x1={x} y1="40" x2={x} y2="280" stroke="#10B981" strokeWidth="0.5" opacity="0.15" />
      ))}
      {/* Africa suggestion */}
      <Path
        d="M 80 70 Q 70 90 75 130 Q 70 170 90 210 Q 110 260 160 270 Q 210 265 240 230 Q 270 200 265 160 Q 270 120 250 90 Q 220 60 170 60 Q 120 58 80 70 Z"
        fill="#fff"
        stroke="#0B1220"
        strokeWidth="1.5"
        opacity="0.9"
      />
      {/* Kenya highlighted */}
      <Path d={kenyaPath} fill="url(#ill-em)" opacity="0.95" />
      <Path d={kenyaPath} fill="none" stroke="#064E3B" strokeWidth="2" />
      {/* Nairobi pin + pulse */}
      <G transform="translate(175 155)">
        <Circle r={pulseR} fill="none" stroke="#F59E0B" strokeWidth="2" opacity={pulseO} />
        <Circle r="8" fill="#F59E0B" stroke="#0B1220" strokeWidth="1.5" />
      </G>
      {/* Mombasa & Kisumu dots */}
      <Circle cx="210" cy="205" r="4" fill="#10B981" stroke="#064E3B" strokeWidth="1" />
      <Circle cx="140" cy="140" r="4" fill="#10B981" stroke="#064E3B" strokeWidth="1" />
      {/* Corridor lines */}
      <Path d="M 175 155 Q 260 100 290 70" fill="none" stroke="#10B981" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
      <Path d="M 175 155 Q 100 100 40 70" fill="none" stroke="#10B981" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
      <Path d="M 175 155 Q 250 250 300 270" fill="none" stroke="#10B981" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
      {/* Origin tokens */}
      <G transform="translate(40 60)">
        <Circle r="14" fill="#0B1220" />
        <SvgText y="4" textAnchor="middle" fontSize="9" fontWeight="700" fill="#10B981" fontFamily="DMSans_700Bold">
          USDT
        </SvgText>
      </G>
      <G transform="translate(290 60)">
        <Circle r="14" fill="#0B1220" />
        <SvgText y="4" textAnchor="middle" fontSize="9" fontWeight="700" fill="#F59E0B" fontFamily="DMSans_700Bold">
          BTC
        </SvgText>
      </G>
      <G transform="translate(290 275)">
        <Circle r="14" fill="#0B1220" />
        <SvgText y="4" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="DMSans_700Bold">
          ETH
        </SvgText>
      </G>
      {/* Label */}
      <SvgText
        x="160"
        y="295"
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fill="#064E3B"
        fontFamily="DMSans_700Bold"
        letterSpacing="3"
      >
        NAIROBI · LIVE
      </SvgText>
    </IllFrame>
  );
}

// ═════════════════════════════════════════════════════════════════════
// FeeBreakdown · replaces finance_0dk + bitcoin2
// Transparent pricing panel · spread, flat fee, waiver, footnote
// ═════════════════════════════════════════════════════════════════════
export function FeeBreakdown({ width = 320, height = 220 }: { width?: number; height?: number }) {
  return (
    <Svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="xMidYMid meet" style={{ display: "block" } as any}>
      <Rect x="0" y="0" width={width} height={height} fill="#FFFFFF" />
      <SvgText x="24" y="32" fontSize="10" fontWeight="700" letterSpacing="2" fill="#64748B" fontFamily="DMSans_700Bold">
        PRICING · TRANSPARENT
      </SvgText>
      {/* Row 1: Spread */}
      <SvgText x="24" y="70" fontSize="12" fill="#1F2937" fontFamily="DMSans_400Regular">
        Platform spread
      </SvgText>
      <SvgText x={width - 24} y="70" textAnchor="end" fontSize="22" fontWeight="700" fill="#10B981" fontFamily="JetBrainsMono_700Bold" letterSpacing="-0.5">
        1.5%
      </SvgText>
      <Line x1="24" y1="86" x2={width - 24} y2="86" stroke="#E5E7EB" />
      {/* Row 2: Flat fee */}
      <SvgText x="24" y="114" fontSize="12" fill="#1F2937" fontFamily="DMSans_400Regular">
        Flat fee
      </SvgText>
      <SvgText x={width - 24} y="114" textAnchor="end" fontSize="22" fontWeight="700" fill="#0B1220" fontFamily="JetBrainsMono_700Bold" letterSpacing="-0.5">
        KES 10
      </SvgText>
      <Line x1="24" y1="130" x2={width - 24} y2="130" stroke="#E5E7EB" />
      {/* Row 3: First 5K */}
      <SvgText x="24" y="158" fontSize="12" fill="#1F2937" fontFamily="DMSans_400Regular">
        First KES 5,000
      </SvgText>
      <SvgText x={width - 24} y="158" textAnchor="end" fontSize="13" fontWeight="700" fill="#059669" fontFamily="DMSans_700Bold">
        FLAT FEE WAIVED
      </SvgText>
      {/* Footnote */}
      <SvgText x="24" y={height - 14} fontSize="10" fill="#64748B" fontFamily="DMSans_400Regular" letterSpacing="0.5">
        No hidden FX markup · No card fees
      </SvgText>
    </Svg>
  );
}
