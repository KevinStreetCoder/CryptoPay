/**
 * Empty / Error / Success / KYC state illustrations.
 *
 * Contract from the design brief:
 *   - 200×200 viewBox, 1.5px ink-2 stroke, single emerald accent
 *   - prefers-reduced-motion safe (static or 1 subtle animation)
 *   - No emoji, no stock art
 *
 * Each component renders a mark + label/CTA. Callers layout text
 * + buttons around them.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, View } from "react-native";
import Svg, { Circle, Rect, Path, Line } from "react-native-svg";

const INK = "#0B1220";
const INK2 = "#1F2937";
const EMERALD = "#10B981";
const LINE = "#E5E7EB";

const isWeb = Platform.OS === "web";

// ─────────────────────────────────────────────────────────────────────────
// EmptyTransactions — a Coin-C mark with a faint dashed ledger row.
// ─────────────────────────────────────────────────────────────────────────
export function EmptyTransactions({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Circle cx="100" cy="100" r="56" fill="none" stroke={EMERALD} strokeWidth="6" strokeLinecap="round" strokeDasharray="230 400" transform="rotate(-135 100 100)" />
      <Rect x="100" y="94" width="36" height="12" rx="2" fill={EMERALD} />
      <Line x1="56" y1="168" x2="144" y2="168" stroke={LINE} strokeWidth="1" strokeDasharray="3 4" />
      <Line x1="70" y1="180" x2="130" y2="180" stroke={LINE} strokeWidth="1" strokeDasharray="3 4" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EmptyWallet — open wallet outline with the slot hollow.
// ─────────────────────────────────────────────────────────────────────────
export function EmptyWallet({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Rect x="40" y="72" width="120" height="82" rx="10" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Path d="M 55 72 Q 55 58 70 58 L 130 58 Q 145 58 145 72" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Rect x="108" y="106" width="40" height="16" rx="3" fill="none" stroke={EMERALD} strokeWidth="1.5" strokeDasharray="4 3" />
      <Line x1="56" y1="90" x2="90" y2="90" stroke={INK2} strokeWidth="1" opacity="0.3" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EmptyNotifications — quiet bell, single emerald dot (cleared).
// ─────────────────────────────────────────────────────────────────────────
export function EmptyNotifications({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Path d="M 100 60 Q 130 60 130 95 L 130 120 L 140 135 L 60 135 L 70 120 L 70 95 Q 70 60 100 60 Z" fill="none" stroke={INK2} strokeWidth="1.5" strokeLinejoin="round" />
      <Path d="M 92 145 Q 92 155 100 155 Q 108 155 108 145" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Circle cx="100" cy="52" r="3.5" fill={EMERALD} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ErrorState — ink circle-x. Deliberately NOT red — brand stays calm.
// The CTA under it is the emerald one.
// ─────────────────────────────────────────────────────────────────────────
export function ErrorState({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Circle cx="100" cy="100" r="64" fill="none" stroke={INK2} strokeWidth="2" />
      <Line x1="78" y1="78" x2="122" y2="122" stroke={INK2} strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="122" y1="78" x2="78" y2="122" stroke={INK2} strokeWidth="2.5" strokeLinecap="round" />
      <Circle cx="100" cy="162" r="4" fill={EMERALD} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SuccessCheck — animated draw-on emerald checkmark.
// One-shot on mount (doesn't loop). Reduced-motion: static final frame.
// ─────────────────────────────────────────────────────────────────────────
export function SuccessCheck({ size = 120 }: { size?: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isWeb && typeof window !== "undefined") {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (reduced) {
        progress.setValue(1);
        return;
      }
      if (!document.getElementById("cpay-success-kf")) {
        const s = document.createElement("style");
        s.id = "cpay-success-kf";
        s.textContent = `
          @keyframes cpay-success-draw {
            from { stroke-dashoffset: 60; }
            to   { stroke-dashoffset: 0; }
          }
          @keyframes cpay-success-ring {
            from { stroke-dashoffset: 360; }
            to   { stroke-dashoffset: 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-cpay-success] { animation: none !important; stroke-dashoffset: 0 !important; }
          }
        `;
        document.head.appendChild(s);
      }
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, []);

  const s = size;
  return (
    <Svg width={s} height={s} viewBox="0 0 120 120">
      <Circle
        {...({ "data-cpay-success": "ring" } as any)}
        cx="60" cy="60" r="54"
        fill="none" stroke={EMERALD} strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="360"
        style={isWeb ? ({ animation: "cpay-success-ring 600ms cubic-bezier(.2,.8,.2,1) both" } as any) : undefined}
      />
      <Path
        {...({ "data-cpay-success": "check" } as any)}
        d="M 40 62 L 54 76 L 82 48"
        fill="none" stroke={EMERALD} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray="60"
        style={isWeb ? ({ animation: "cpay-success-draw 400ms cubic-bezier(.2,.8,.2,1) 300ms both" } as any) : undefined}
      />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// KycIdFront — outline ID card + photo box + emerald chip accent.
// ─────────────────────────────────────────────────────────────────────────
export function KycIdFront({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Rect x="30" y="58" width="140" height="92" rx="10" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Rect x="44" y="74" width="40" height="50" rx="4" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Circle cx="64" cy="90" r="7" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Path d="M 50 122 Q 52 108 64 108 Q 76 108 78 122" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Line x1="96" y1="82" x2="158" y2="82" stroke={INK2} strokeWidth="1.2" />
      <Line x1="96" y1="96" x2="158" y2="96" stroke={INK2} strokeWidth="1.2" />
      <Line x1="96" y1="110" x2="140" y2="110" stroke={INK2} strokeWidth="1.2" />
      <Rect x="96" y="122" width="30" height="10" rx="2" fill={EMERALD} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// KycSelfie — head outline + phone frame + emerald shutter dot.
// ─────────────────────────────────────────────────────────────────────────
export function KycSelfie({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Rect x="64" y="36" width="72" height="128" rx="12" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Circle cx="100" cy="94" r="22" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Path d="M 72 140 Q 76 118 100 118 Q 124 118 128 140" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Circle cx="100" cy="152" r="5" fill={EMERALD} />
      <Rect x="90" y="40" width="20" height="4" rx="2" fill={INK2} opacity="0.4" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// KycReview — clipboard with emerald check-in-progress dot.
// ─────────────────────────────────────────────────────────────────────────
export function KycReview({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Rect x="50" y="48" width="100" height="124" rx="8" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Rect x="78" y="38" width="44" height="18" rx="4" fill={INK2} />
      <Line x1="62" y1="78" x2="138" y2="78" stroke={INK2} strokeWidth="1.2" />
      <Line x1="62" y1="94" x2="138" y2="94" stroke={INK2} strokeWidth="1.2" />
      <Line x1="62" y1="110" x2="120" y2="110" stroke={INK2} strokeWidth="1.2" />
      <Circle cx="100" cy="140" r="12" fill="none" stroke={EMERALD} strokeWidth="2" />
      <Path d="M 94 140 L 98 144 L 106 136" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
