import { useEffect, useRef } from "react";
import { View, Text, Animated, Easing } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function LoadingScreen() {
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
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Subtle rotate animation for the glow ring
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
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
        backgroundColor: "#0F172A",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Rotating glow ring */}
      <Animated.View
        style={{
          position: "absolute",
          width: 120,
          height: 120,
          borderRadius: 60,
          borderWidth: 2,
          borderColor: "rgba(13, 159, 110, 0.15)",
          borderTopColor: "rgba(13, 159, 110, 0.5)",
          transform: [{ rotate: spin }],
        }}
      />

      {/* Logo container */}
      <Animated.View
        style={{
          width: 80,
          height: 80,
          borderRadius: 24,
          backgroundColor: "#0D9F6E",
          alignItems: "center",
          justifyContent: "center",
          opacity: pulseAnim,
          transform: [
            {
              scale: pulseAnim.interpolate({
                inputRange: [0.6, 1],
                outputRange: [0.95, 1.05],
              }),
            },
          ],
          shadowColor: "#0D9F6E",
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.4,
          shadowRadius: 20,
          elevation: 10,
        }}
      >
        <Ionicons name="wallet" size={40} color="#fff" />
      </Animated.View>

      {/* Brand name */}
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 28,
          fontFamily: "Inter_700Bold",
          marginTop: 24,
          letterSpacing: -0.5,
        }}
      >
        CryptoPay
      </Text>

      <Text
        style={{
          color: "#64748B",
          fontSize: 14,
          fontFamily: "Inter_400Regular",
          marginTop: 8,
        }}
      >
        Pay bills with crypto, instantly
      </Text>
    </View>
  );
}
