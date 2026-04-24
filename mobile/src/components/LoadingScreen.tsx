import { useEffect, useRef } from "react";
import { Text, Animated, Easing, Image, Platform, View } from "react-native";
import { getThemeColors, colors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { SpinnerCoinC } from "./brand/SpinnerCoinC";

const useNative = Platform.OS !== "web";
// Raster brand mark — same as Wordmark uses. We embed it directly in the
// splash rather than going through <Wordmark> because the splash renders
// BEFORE DM Sans finishes loading, and Wordmark's Text uses DM Sans metrics
// (negative letterSpacing + lineHeight≈fontSize) that clip the "y" of "Cpay"
// to "Cpa" on the Android system fallback font. By hand-rolling the text
// with font-safe metrics below we keep the brand lockup readable regardless
// of which font is active at paint time.
const LOGO_MARK = require("../../assets/brand-mark.png");

/**
 * Clean, modern loading screen. One animation (indeterminate progress bar) and
 * one micro fade-in for the content block · nothing else. Inspired by how
 * Wise / Revolut / Cash App handle cold-load: the logo and wordmark are stable,
 * only the progress bar moves. This feels instant at ~200ms instead of the old
 * screen's perceived 4-6s due to six parallel loops.
 *
 * Historical bug (APK 2026-04-22): the wordmark was a bare <Text> with
 * `letterSpacing: -0.4` and no includeFontPadding, which Android rendered
 * as "Cpa" because the y-descender got clipped by the tight text box.
 * Fixed by switching to the <Wordmark/> component (Coin-C image + proper
 * DM Sans text with lineHeight that accommodates descenders).
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
      {/* Brand loader · Coin-C mark with an orbiting emerald arc. Replaces
          the previous Image + indeterminate bar combo. One motion element,
          on-brand, respects reduced-motion. */}
      <SpinnerCoinC size={72} />

      {/* Brand lockup · Coin-C mark + "Cpay" with the C in emerald.
          Hand-rolled instead of the Wordmark component because this screen
          paints BEFORE DM Sans finishes loading — Wordmark's tight metrics
          (negative letterSpacing, lineHeight ≈ fontSize) let Android clip
          the "y" descender when rendered in the system fallback font. We
          use a generous lineHeight (1.4×), explicit bottom padding, and
          includeFontPadding=true on Android so descenders always survive. */}
      <View
        style={{
          marginTop: 24,
          flexDirection: "row",
          alignItems: "center",
          paddingBottom: 8,
        }}
      >
        <Image
          source={LOGO_MARK}
          style={{ width: 32, height: 32, marginRight: 10 }}
          resizeMode="contain"
          accessibilityLabel="Cpay"
        />
        <Text
          allowFontScaling={false}
          style={{
            fontSize: 28,
            lineHeight: 40,          // 1.4× — plenty of room for descenders
            fontFamily: "DMSans_700Bold",
            color: isDark ? "#FFFFFF" : "#0B1220",
            includeFontPadding: true, // Android: keep default padding so "y" isn't clipped
            paddingBottom: 4,
          }}
        >
          <Text style={{ color: colors.primary[500] }}>C</Text>
          <Text>pay</Text>
        </Text>
      </View>

      {/* Status · only renders if caller provided one. No generic filler. */}
      {status ? (
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            marginTop: 16,
            opacity: 0.7,
            // Android: `includeFontPadding: false` trims the default top/
            // bottom padding; we add explicit `paddingBottom` so descenders
            // in a status like "Verifying..." stay visible.
            includeFontPadding: false,
            paddingBottom: 2,
          }}
        >
          {status}
        </Text>
      ) : null}
    </Animated.View>
  );
}
