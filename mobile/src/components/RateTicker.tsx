import { useEffect, useRef, useState } from "react";
import { View, Text, Animated, Easing } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/theme";

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
  const [activeIndex, setActiveIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (rates.length <= 1) return;

    const interval = setInterval(() => {
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        setActiveIndex((prev) => (prev + 1) % rates.length);
        // Fade in
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start();
      });
    }, speed);

    return () => clearInterval(interval);
  }, [rates.length, speed, fadeAnim]);

  if (rates.length === 0) return null;

  const current = rates[activeIndex];
  const isPositive = (current.change24h ?? 0) >= 0;

  return (
    <View
      style={{
        backgroundColor: colors.dark.card,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {/* Left: Live indicator */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.success,
          }}
        />
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 11,
            fontFamily: "Inter_500Medium",
          }}
        >
          LIVE
        </Text>
      </View>

      {/* Center: Rate */}
      <Animated.View
        style={{
          opacity: fadeAnim,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 14,
            fontFamily: "Inter_600SemiBold",
          }}
        >
          {current.symbol}/KES
        </Text>
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 14,
            fontFamily: "Inter_700Bold",
          }}
        >
          {current.rate.toLocaleString("en-KE", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </Text>
      </Animated.View>

      {/* Right: Change */}
      <Animated.View
        style={{
          opacity: fadeAnim,
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
        }}
      >
        <Ionicons
          name={isPositive ? "trending-up" : "trending-down"}
          size={14}
          color={isPositive ? colors.success : colors.error}
        />
        <Text
          style={{
            color: isPositive ? colors.success : colors.error,
            fontSize: 12,
            fontFamily: "Inter_500Medium",
          }}
        >
          {current.change24h !== undefined
            ? `${isPositive ? "+" : ""}${current.change24h.toFixed(1)}%`
            : "--"}
        </Text>
      </Animated.View>
    </View>
  );
}
