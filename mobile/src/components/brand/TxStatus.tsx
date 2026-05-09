/**
 * TxStatus · four 24×24 glyphs for transaction states.
 *
 * 2026-05-09 · re-aligned to the Cpay Landing Assets canvas spec:
 *   pending     · dashed muted circle (3-3 dasharray)
 *   processing  · ink track + rotating emerald 1/4 arc
 *   confirmed   · FILLED emerald circle + white checkmark
 *   failed      · ink-2 outlined circle + ink-2 X
 *
 * Single emerald accent on confirmed/processing. Ink-2 elsewhere.
 * Per the brand brief: failed is NOT red · palette is emerald ∪ ink only.
 *
 * `processing` rotates the arc; others are static. Respects
 * prefers-reduced-motion via media query injected once on web.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, View } from "react-native";
import Svg, { Circle, Path, Line } from "react-native-svg";

const INK2 = "#1F2937";
const EMERALD = "#10B981";
const LINE = "#E5E7EB";
const MUTED = "#64748B";

const isWeb = Platform.OS === "web";

export type TxStatusValue = "pending" | "processing" | "confirmed" | "failed";

export interface TxStatusProps {
  status: TxStatusValue;
  size?: number;
}

export function TxStatus({ status, size = 24 }: TxStatusProps) {
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status !== "processing") return;
    if (isWeb) {
      if (typeof document !== "undefined" && !document.getElementById("cpay-txstatus-kf")) {
        const s = document.createElement("style");
        s.id = "cpay-txstatus-kf";
        s.textContent = `
          @keyframes cpay-txstatus-rot { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) {
            [data-cpay-txstatus-rot] { animation: none !important; }
          }
        `;
        document.head.appendChild(s);
      }
      return;
    }
    const loop = Animated.loop(
      Animated.timing(rot, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [status]);

  const s = size;
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  if (status === "confirmed") {
    // Filled emerald disc with white checkmark · matches the canvas
    // confirmed glyph (a lift in visual hierarchy compared to the
    // outlined pending/failed states; reads as "done · go").
    return (
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="9" fill={EMERALD} />
        <Path d="M 8 12 L 11 15 L 16 9" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }

  if (status === "failed") {
    return (
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="9" fill="none" stroke={INK2} strokeWidth="2" />
        <Line x1="9" y1="9" x2="15" y2="15" stroke={INK2} strokeWidth="2" strokeLinecap="round" />
        <Line x1="15" y1="9" x2="9" y2="15" stroke={INK2} strokeWidth="2" strokeLinecap="round" />
      </Svg>
    );
  }

  if (status === "pending") {
    // Dashed muted circle · "queued · not yet acted on" · the
    // canvas spec uses a 3-3 dasharray (12 dashes · "ticking" feel).
    return (
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke={MUTED}
          strokeWidth="2"
          strokeDasharray="3 3"
        />
      </Svg>
    );
  }

  // processing · still ring + rotating 1/4 emerald arc
  // Track is a subtle line-200 ring (not the 0.2-opacity ink we had
  // before · the canvas wants paper-on-line, not ghosted ink).
  const arc = (
    <Svg width={s} height={s} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" fill="none" stroke={LINE} strokeWidth="2" />
      <Path
        d="M 12 3 A 9 9 0 0 1 21 12"
        fill="none"
        stroke={EMERALD}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </Svg>
  );

  if (isWeb) {
    return (
      <View
        {...({ "data-cpay-txstatus-rot": true } as any)}
        style={{ width: s, height: s, animation: "cpay-txstatus-rot 1.4s linear infinite" } as any}
      >
        {arc}
      </View>
    );
  }
  return (
    <Animated.View style={{ width: s, height: s, transform: [{ rotate: spin }] }}>{arc}</Animated.View>
  );
}
