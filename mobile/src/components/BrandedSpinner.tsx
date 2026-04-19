import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";
import { colors } from "../constants/theme";

const isWeb = Platform.OS === "web";

type SpinnerSize = "small" | "medium" | "large";

interface BrandedSpinnerProps {
  size?: SpinnerSize;
  color?: string;
}

const SIZE_MAP: Record<SpinnerSize, number> = {
  small: 20,
  medium: 32,
  large: 48,
};

const BORDER_WIDTH_MAP: Record<SpinnerSize, number> = {
  small: 2.5,
  medium: 3,
  large: 4,
};

/**
 * Branded spinning ring loader for Cpay.
 *
 * On native it uses Animated.loop with useNativeDriver for smooth 60 fps rotation.
 * On web it injects a CSS @keyframes rule and applies it via inline style,
 * which is offloaded to the compositor and avoids JS-driven frame updates.
 */
export function BrandedSpinner({
  size = "medium",
  color = colors.primary[500],
}: BrandedSpinnerProps) {
  const dimension = SIZE_MAP[size];
  const borderW = BORDER_WIDTH_MAP[size];

  // --- Web path: pure CSS animation ---
  if (isWeb) {
    return (
      <WebSpinner dimension={dimension} borderW={borderW} color={color} />
    );
  }

  // --- Native path: Animated rotation ---
  return (
    <NativeSpinner dimension={dimension} borderW={borderW} color={color} />
  );
}

/* ------------------------------------------------------------------ */
/*  Native spinner                                                     */
/* ------------------------------------------------------------------ */

function NativeSpinner({
  dimension,
  borderW,
  color,
}: {
  dimension: number;
  borderW: number;
  color: string;
}) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 750,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View
      style={[
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          borderWidth: borderW,
          borderColor: color,
          borderTopColor: "transparent",
          transform: [{ rotate: spin }],
        },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Web spinner – uses injected CSS @keyframes for GPU-composited spin */
/* ------------------------------------------------------------------ */

const KEYFRAMES_ID = "cryptopay-spinner-keyframes";

function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `@keyframes cpSpinnerRotate{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
  document.head.appendChild(style);
}

function WebSpinner({
  dimension,
  borderW,
  color,
}: {
  dimension: number;
  borderW: number;
  color: string;
}) {
  useEffect(() => {
    ensureKeyframes();
  }, []);

  const webStyle = {
    width: dimension,
    height: dimension,
    borderRadius: dimension / 2,
    borderWidth: borderW,
    borderColor: color,
    borderTopColor: "transparent",
    borderStyle: "solid" as const,
    animationName: "cpSpinnerRotate",
    animationDuration: "0.75s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  };

  return (
    <View
      style={webStyle as any}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    />
  );
}
