import { useEffect, useRef } from "react";
import { View, Text, Animated, Easing, Platform, Image, useWindowDimensions } from "react-native";
import { getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const useNative = Platform.OS !== "web";
const APP_LOGO = require("../../assets/icon.png");

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
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const fadeIn = useRef(new Animated.Value(0)).current;
  const barTrack = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Quick fade-in so the screen doesn't pop in jarringly
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: useNative,
    }).start();

    // Single indeterminate bar loop — a 40% wide shimmer that slides L->R->L.
    Animated.loop(
      Animated.sequence([
        Animated.timing(barTrack, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: useNative,
        }),
        Animated.timing(barTrack, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: useNative,
        }),
      ]),
    ).start();
  }, []);

  const barWidth = isMobile ? 180 : 220;
  const shimmerWidth = Math.round(barWidth * 0.4);
  const slide = barTrack.interpolate({
    inputRange: [0, 1],
    outputRange: [-shimmerWidth, barWidth],
  });

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
      {/* Logo — stable, no pulse. Lets the eye settle. */}
      <Image
        source={APP_LOGO}
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          ...((Platform.OS === "web"
            ? { boxShadow: "0 8px 24px rgba(16, 185, 129, 0.18)" }
            : {
                shadowColor: "#10B981",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.18,
                shadowRadius: 12,
                elevation: 6,
              }) as any),
        }}
        resizeMode="cover"
      />

      {/* Wordmark */}
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 20,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: -0.3,
          marginTop: 18,
        }}
      >
        CryptoPay
      </Text>

      {/* Indeterminate progress bar */}
      <View
        style={{
          width: barWidth,
          height: 2,
          borderRadius: 2,
          backgroundColor: "rgba(255, 255, 255, 0.06)",
          overflow: "hidden",
          marginTop: 28,
        }}
      >
        <Animated.View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: shimmerWidth,
            borderRadius: 2,
            backgroundColor: tc.primary[500],
            transform: [{ translateX: slide }],
          }}
        />
      </View>

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
