/**
 * SpinnerArc — emerald arc rotating on a muted track.
 * 1s linear rotation, respects prefers-reduced-motion (static 3/4 arc
 * on the axis so the user still reads "this is working").
 *
 * Use for: buttons, data fetches, inline loading — size 16–32.
 * For full-screen processing, use <SpinnerCoinC> instead.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../../constants/theme";

export interface SpinnerArcProps {
  /** Pixel diameter. Default 24. */
  size?: number;
  /** Override the arc color. Defaults to emerald 500. */
  color?: string;
  /** Override the track color. Defaults to a low-opacity neutral. */
  trackColor?: string;
  /** Stroke width. Scales with size by default. */
  strokeWidth?: number;
}

const isWeb = Platform.OS === "web";

export function SpinnerArc({
  size = 24,
  color = colors.primary[500],
  trackColor = "rgba(255,255,255,0.12)",
  strokeWidth,
}: SpinnerArcProps) {
  const sw = strokeWidth ?? Math.max(2, size / 10);
  const r = (size - sw) / 2;
  const circumference = 2 * Math.PI * r;
  // 25% visible arc — a pleasant fraction that reads as "progress," not
  // a full ring (which would look like a finished circle).
  const visible = circumference * 0.25;
  const gap = circumference - visible;

  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isWeb) return; // CSS handles web spin.
    const loop = Animated.loop(
      Animated.timing(rot, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const spin = rot.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const svg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={sw} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${visible} ${gap}`}
      />
    </Svg>
  );

  if (isWeb) {
    return (
      <View
        style={
          {
            width: size,
            height: size,
            animation: "cpay-spinner-arc-rot 0.9s linear infinite",
          } as any
        }
      >
        {/* Inject keyframe once per document. */}
        {typeof document !== "undefined" && !document.getElementById("cpay-spinner-arc-kf") && injectArcKeyframe()}
        {svg}
      </View>
    );
  }

  return <Animated.View style={{ width: size, height: size, transform: [{ rotate: spin }] }}>{svg}</Animated.View>;
}

function injectArcKeyframe() {
  if (typeof document === "undefined") return null;
  const style = document.createElement("style");
  style.id = "cpay-spinner-arc-kf";
  style.textContent = `
    @keyframes cpay-spinner-arc-rot {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      [style*="cpay-spinner-arc-rot"] { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
  return null;
}
