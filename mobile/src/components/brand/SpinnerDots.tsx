/**
 * SpinnerDots · three emerald dots with a staggered opacity pulse.
 * Use inline in copy or chat-bubble "thinking" contexts. Size 24–36.
 *
 * Deliberately quieter than SpinnerArc · it fades rather than rotates,
 * so it won't compete with surrounding text for attention.
 */
import { useEffect, useRef } from "react";
import { Animated, Platform, View } from "react-native";
import { colors } from "../../constants/theme";

export interface SpinnerDotsProps {
  /** Pixel width of the full 3-dot row. Default 28. */
  size?: number;
  /** Override the dot color. */
  color?: string;
}

const isWeb = Platform.OS === "web";

export function SpinnerDots({ size = 28, color = colors.primary[500] }: SpinnerDotsProps) {
  const d = size / 4; // dot diameter
  const gap = d * 0.7;

  // Three Animated values for native · each staggered by 200ms.
  const a1 = useRef(new Animated.Value(0.35)).current;
  const a2 = useRef(new Animated.Value(0.35)).current;
  const a3 = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (isWeb) {
      if (typeof document !== "undefined" && !document.getElementById("cpay-spinner-dots-kf")) {
        const s = document.createElement("style");
        s.id = "cpay-spinner-dots-kf";
        s.textContent = `
          @keyframes cpay-spinner-dots-pulse {
            0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
            40% { opacity: 1; transform: translateY(-3px); }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-cpay-dot] { animation: none !important; opacity: 0.6 !important; }
          }
        `;
        document.head.appendChild(s);
      }
      return;
    }
    const mk = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.35, duration: 320, useNativeDriver: true }),
          Animated.delay(320 - delay),
        ]),
      );
    const loops = [mk(a1, 0), mk(a2, 200), mk(a3, 400)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);

  const dotStyle = (i: number, v: Animated.Value) =>
    isWeb
      ? ({
          width: d,
          height: d,
          borderRadius: d / 2,
          backgroundColor: color,
          animation: `cpay-spinner-dots-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        } as any)
      : {
          width: d,
          height: d,
          borderRadius: d / 2,
          backgroundColor: color,
          opacity: v,
        };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap, width: size }}>
      {isWeb ? (
        <>
          <View {...({ "data-cpay-dot": true } as any)} style={dotStyle(0, a1)} />
          <View {...({ "data-cpay-dot": true } as any)} style={dotStyle(1, a2)} />
          <View {...({ "data-cpay-dot": true } as any)} style={dotStyle(2, a3)} />
        </>
      ) : (
        <>
          <Animated.View style={dotStyle(0, a1)} />
          <Animated.View style={dotStyle(1, a2)} />
          <Animated.View style={dotStyle(2, a3)} />
        </>
      )}
    </View>
  );
}
