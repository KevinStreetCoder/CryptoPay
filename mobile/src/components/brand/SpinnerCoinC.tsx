/**
 * SpinnerCoinC · the brand-strong loader.
 *
 * Canonical version from the design handoff (logos.jsx · SpinnerCoinC).
 * Pure SVG: a rotating emerald arc wraps a central pulsing bar (the
 * Coin-C "slot"). No raster mark, so it stays sharp at any size and
 * doesn't pull in brand-mark.png.
 *
 * Timing: 1.1s arc rotation, 1.4s bar pulse · same as the designer's.
 * Both respect prefers-reduced-motion (static composition).
 *
 * Size 48–80 px. Use for full-screen overlays, payment processing,
 * KYC review. Pair with an ink-2 subtitle describing the operation.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, View } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";
import { colors } from "../../constants/theme";

const isWeb = Platform.OS === "web";

export interface SpinnerCoinCProps {
  /** Diameter. Default 56 (designer's default). */
  size?: number;
  /** Override the arc + bar color. Defaults to emerald 500. */
  color?: string;
}

// Inject the keyframes once per web document · the designer's
// `@keyframes cpaySpin` / `cpayPulse`. On native we drive the same
// motion via RN Animated.
function injectKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById("cpay-brand-spinner-kf")) return;
  const style = document.createElement("style");
  style.id = "cpay-brand-spinner-kf";
  style.textContent = `
    @keyframes cpaySpin { to { transform: rotate(360deg); } }
    @keyframes cpayPulse {
      0%, 100% { transform: scale(1); opacity: 0.9; }
      50%      { transform: scale(1.15); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-cpay-spin],
      [data-cpay-pulse] { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

export function SpinnerCoinC({ size = 56, color = colors.primary[500] }: SpinnerCoinCProps) {
  const s = size;
  const sw = s * 0.11;
  const r = (s - sw) / 2 - s * 0.02;
  const circumference = 2 * Math.PI * r;
  const visible = circumference * 0.22;
  const gap = circumference - visible;

  // Central slot bar geometry (matches designer's rect).
  const barX = s * 0.38;
  const barY = s * 0.455;
  const barW = s * 0.24;
  const barH = s * 0.09;
  const barRx = s * 0.015;

  const rot = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isWeb) {
      injectKeyframes();
      return;
    }
    const rotLoop = Animated.loop(
      Animated.timing(rot, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.15,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    rotLoop.start();
    pulseLoop.start();
    return () => {
      rotLoop.stop();
      pulseLoop.stop();
    };
  }, []);

  const spin = rot.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Web: render one SVG with inline CSS animations (matches designer's output).
  if (isWeb) {
    return (
      <View style={{ width: s, height: s }}>
        <svg
          viewBox={`0 0 ${s} ${s}`}
          width={s}
          height={s}
          style={{ display: "block", overflow: "visible" }}
        >
          <g
            {...({ "data-cpay-spin": true } as any)}
            style={{
              transformOrigin: `${s / 2}px ${s / 2}px`,
              animation: "cpaySpin 1.1s linear infinite",
            } as any}
          >
            <circle
              cx={s / 2}
              cy={s / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray={`${visible} ${gap}`}
            />
          </g>
          <rect
            {...({ "data-cpay-pulse": true } as any)}
            x={barX}
            y={barY}
            width={barW}
            height={barH}
            rx={barRx}
            fill={color}
            style={{
              transformOrigin: `${s / 2}px ${s / 2}px`,
              animation: "cpayPulse 1.4s ease-in-out infinite",
            } as any}
          />
        </svg>
      </View>
    );
  }

  // Native: RN Animated.View wrapping react-native-svg.
  return (
    <View style={{ width: s, height: s, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: s, height: s, transform: [{ rotate: spin }] }}>
        <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
          <Circle
            cx={s / 2}
            cy={s / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${visible} ${gap}`}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
          <Rect x={barX} y={barY} width={barW} height={barH} rx={barRx} fill={color} />
        </Svg>
      </Animated.View>
    </View>
  );
}
