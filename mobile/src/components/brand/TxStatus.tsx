/**
 * TxStatus · four monochrome 24×24 glyphs for transaction states.
 * Single emerald on `confirmed`. Ink-2 outlines for pending/processing/failed.
 *
 * Replaces the emoji / unicode indicators currently used in tx lists and
 * detail screens. Per the brand brief: failed is NOT red · the status
 * colour palette is emerald ∪ ink, nothing else.
 *
 * `processing` has a subtle rotating arc; others are static.
 * Respects prefers-reduced-motion.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, View } from "react-native";
import Svg, { Circle, Path, Line } from "react-native-svg";

const INK2 = "#1F2937";
const EMERALD = "#10B981";

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
    return (
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="10" fill="none" stroke={EMERALD} strokeWidth="1.6" />
        <Path d="M 7 12 L 10.5 15.5 L 17 9" fill="none" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }

  if (status === "failed") {
    return (
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="10" fill="none" stroke={INK2} strokeWidth="1.6" />
        <Line x1="8.5" y1="8.5" x2="15.5" y2="15.5" stroke={INK2} strokeWidth="1.8" strokeLinecap="round" />
        <Line x1="15.5" y1="8.5" x2="8.5" y2="15.5" stroke={INK2} strokeWidth="1.8" strokeLinecap="round" />
      </Svg>
    );
  }

  if (status === "pending") {
    // Clock face · ink-2, no emerald.
    return (
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="10" fill="none" stroke={INK2} strokeWidth="1.6" />
        <Line x1="12" y1="12" x2="12" y2="7.5" stroke={INK2} strokeWidth="1.8" strokeLinecap="round" />
        <Line x1="12" y1="12" x2="15" y2="14" stroke={INK2} strokeWidth="1.8" strokeLinecap="round" />
      </Svg>
    );
  }

  // processing · rotating emerald arc
  const arc = (
    <Svg width={s} height={s} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" fill="none" stroke={INK2} strokeWidth="1.6" opacity="0.2" />
      <Circle cx="12" cy="12" r="10" fill="none" stroke={EMERALD} strokeWidth="1.8" strokeLinecap="round" strokeDasharray="18 80" />
    </Svg>
  );

  if (isWeb) {
    return (
      <View
        {...({ "data-cpay-txstatus-rot": true } as any)}
        style={{ width: s, height: s, animation: "cpay-txstatus-rot 1.1s linear infinite" } as any}
      >
        {arc}
      </View>
    );
  }
  return (
    <Animated.View style={{ width: s, height: s, transform: [{ rotate: spin }] }}>{arc}</Animated.View>
  );
}
