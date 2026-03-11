import { useEffect, useRef, useState } from "react";
import { View, Text, Animated, Easing, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shadows, getThemeColors, getThemeShadows } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const useNative = Platform.OS !== "web";

interface RateItem {
  symbol: string;
  rate: number;
  change24h?: number; // percentage change
}

interface RateTickerProps {
  rates: RateItem[];
  speed?: number; // ms per cycle
}

export function RateTicker({ rates, speed = 4000 }: RateTickerProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const [activeIndex, setActiveIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulsing green dot animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  // Rate cycling with crossfade
  useEffect(() => {
    if (rates.length <= 1) return;

    const interval = setInterval(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: useNative,
      }).start(() => {
        setActiveIndex((prev) => (prev + 1) % rates.length);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 350,
          easing: Easing.in(Easing.ease),
          useNativeDriver: useNative,
        }).start();
      });
    }, speed);

    return () => clearInterval(interval);
  }, [rates.length, speed, fadeAnim]);

  if (rates.length === 0) return null;

  const current = rates[activeIndex];
  const isPositive = (current.change24h ?? 0) >= 0;
  const changeColor = isPositive ? colors.success : colors.error;

  return (
    <View style={[styles.container, ts.sm, { backgroundColor: tc.dark.card, borderColor: tc.glass.border }]}>
      {/* Left: Live indicator */}
      <View style={styles.liveContainer}>
        <Animated.View
          style={[
            styles.liveDot,
            { opacity: pulseAnim },
          ]}
        />
        <Text style={[styles.liveText, { color: tc.textMuted }]}>LIVE</Text>
      </View>

      {/* Center: Rate */}
      <Animated.View style={[styles.rateContainer, { opacity: fadeAnim }]}>
        <Text style={[styles.symbolText, { color: tc.textSecondary }]}>{current.symbol}/KES</Text>
        <Text style={[styles.rateText, { color: tc.textPrimary }]}>
          {isNaN(current.rate)
            ? "--"
            : current.rate.toLocaleString("en-KE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
        </Text>
      </Animated.View>

      {/* Right: Change pill */}
      <Animated.View
        style={[
          styles.changePill,
          {
            backgroundColor: changeColor + "1F", // 12% opacity
            opacity: fadeAnim,
          },
        ]}
      >
        <Ionicons
          name={isPositive ? "trending-up" : "trending-down"}
          size={13}
          color={changeColor}
        />
        <Text style={[styles.changeText, { color: changeColor }]}>
          {current.change24h !== undefined
            ? `${isPositive ? "+" : ""}${current.change24h.toFixed(1)}%`
            : "--"}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
  },
  liveContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.success,
  },
  liveText: {
    fontSize: 11,
    fontFamily: "DMSans_600SemiBold",
    letterSpacing: 1,
  },
  rateContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  symbolText: {
    fontSize: 14,
    fontFamily: "DMSans_600SemiBold",
  },
  rateText: {
    fontSize: 15,
    fontFamily: "DMSans_700Bold",
  },
  changePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  changeText: {
    fontSize: 12,
    fontFamily: "DMSans_600SemiBold",
  },
});
