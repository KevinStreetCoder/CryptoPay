/**
 * Spinner · the single-entry component that picks the right variant
 * based on the context you're rendering in.
 *
 * Contract (from the design brief):
 *   - Arc spinner (rotating arc) for buttons + data fetches < 2s.
 *     Size 16–32.
 *   - Coin-C spinner (mark + orbiting arc) for full-screen overlays,
 *     payment processing, KYC review. Size 48–80.
 *   - Dots spinner (three pulsing dots) for inline "thinking" in copy
 *     or chat bubbles. Size 24–36.
 *
 * Pick via `variant` explicitly. Default `variant="arc"` (the safest,
 * most generic option) so dropping <Spinner /> into any ActivityIndicator
 * slot gives sensible output.
 *
 * Never mix two spinners on one screen. Never exceed 1.2s cycle.
 */
import type { ReactElement } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SpinnerArc, SpinnerArcProps } from "./SpinnerArc";
import { SpinnerDots, SpinnerDotsProps } from "./SpinnerDots";
import { SpinnerCoinC, SpinnerCoinCProps } from "./SpinnerCoinC";

export type SpinnerVariant = "arc" | "dots" | "coinc";

export interface SpinnerProps {
  variant?: SpinnerVariant;
  size?: number;
  color?: string;
  /** Outer-View style · forwarded as a wrapper around the variant so
   * call-sites can apply `marginLeft`, `marginVertical`, etc. without
   * having to wrap every Spinner usage in their own `<View>`. */
  style?: StyleProp<ViewStyle>;
}

export function Spinner({ variant = "arc", size, color, style }: SpinnerProps) {
  let inner: ReactElement;
  if (variant === "dots") {
    inner = <SpinnerDots size={size} color={color} />;
  } else if (variant === "coinc") {
    inner = <SpinnerCoinC size={size} color={color} />;
  } else {
    inner = <SpinnerArc size={size} color={color} />;
  }
  return style ? <View style={style}>{inner}</View> : inner;
}

export { SpinnerArc, SpinnerDots, SpinnerCoinC };
export type { SpinnerArcProps, SpinnerDotsProps, SpinnerCoinCProps };
