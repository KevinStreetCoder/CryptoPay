import { useEffect, useRef } from "react";
import { Text, Animated, Easing, Platform } from "react-native";
import { getThemeColors, colors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { SpinnerCoinC } from "./brand/SpinnerCoinC";

const useNative = Platform.OS !== "web";

/**
 * Clean, modern loading screen. One animation (indeterminate progress bar) and
 * one micro fade-in for the content block — nothing else. Inspired by how
 * Wise / Revolut / Cash App handle cold-load: the logo and wordmark are stable,
 * only the progress bar moves. This feels instant at ~200ms instead of the old
 * screen's perceived 4-6s due to six parallel loops.
 */
export function LoadingScreen({ status }: { status?: string }) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Quick fade-in so the screen doesn't pop in jarringly.
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: useNative,
    }).start();
  }, []);

  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: tc.dark.bg,
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeIn,
      }}
    >
      {/* Brand loader — Coin-C mark with an orbiting emerald arc. Replaces
          the previous Image + indeterminate bar combo. One motion element,
          on-brand, respects reduced-motion. */}
      <SpinnerCoinC size={72} />

      {/* Wordmark — matches the design brief (C in emerald, rest in text). */}
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 22,
          fontFamily: "DMSans_700Bold",
          letterSpacing: -0.4,
          marginTop: 22,
        }}
      >
        <Text style={{ color: colors.primary[500] }}>C</Text>pay
      </Text>

      {/* Status — only renders if caller provided one. No generic filler. */}
      {status ? (
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            marginTop: 16,
            opacity: 0.7,
          }}
        >
          {status}
        </Text>
      ) : null}
    </Animated.View>
  );
}
