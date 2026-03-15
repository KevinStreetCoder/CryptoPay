import { useEffect, useRef } from "react";
import { View, Text, Animated, Easing, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const useNative = Platform.OS !== "web";

export function LoadingScreen() {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const pulseAnim = useRef(new Animated.Value(0.6)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
      ])
    ).start();

    // Subtle rotate animation for the glow ring
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: useNative,
      })
    ).start();
  }, [pulseAnim, rotateAnim]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tc.dark.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Rotating glow ring */}
      <Animated.View
        style={{
          position: "absolute",
          width: 100,
          height: 100,
          borderRadius: 50,
          borderWidth: 2,
          borderColor: "rgba(16, 185, 129, 0.1)",
          borderTopColor: "rgba(16, 185, 129, 0.5)",
          transform: [{ rotate: spin }],
        }}
      />

      {/* Logo — matches sidebar/login flash icon */}
      <Animated.View
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          backgroundColor: tc.primary[500],
          alignItems: "center",
          justifyContent: "center",
          opacity: pulseAnim,
          transform: [
            {
              scale: pulseAnim.interpolate({
                inputRange: [0.6, 1],
                outputRange: [0.96, 1.04],
              }),
            },
          ],
          ...(Platform.OS === "web"
            ? { boxShadow: "0 8px 24px rgba(16, 185, 129, 0.35)" }
            : {
                shadowColor: "#10B981",
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.35,
                shadowRadius: 16,
                elevation: 8,
              }) as any,
        }}
      >
        <Ionicons name="flash" size={28} color="#fff" />
      </Animated.View>

      {/* Brand name */}
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 24,
          fontFamily: "DMSans_700Bold",
          marginTop: 20,
          letterSpacing: -0.5,
        }}
      >
        CryptoPay
      </Text>

      <Text
        style={{
          color: tc.textMuted,
          fontSize: 13,
          fontFamily: "DMSans_400Regular",
          marginTop: 6,
        }}
      >
        Secure. Fast. Seamless.
      </Text>
    </View>
  );
}
