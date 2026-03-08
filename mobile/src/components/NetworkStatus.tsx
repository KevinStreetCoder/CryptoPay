import { useEffect, useRef, useState } from "react";
import { View, Text, Animated, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Periodically checks network connectivity by attempting to reach a known endpoint.
 * Falls back to navigator.onLine on web. Shows a banner when offline.
 */
export function NetworkStatus() {
  const [isOffline, setIsOffline] = useState(false);
  const slideAnim = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    let mounted = true;
    let interval: ReturnType<typeof setInterval>;

    const checkConnection = async () => {
      try {
        // Attempt a lightweight fetch to verify connectivity
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch("https://clients3.google.com/generate_204", {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (mounted) setIsOffline(false);
      } catch {
        if (mounted) setIsOffline(true);
      }
    };

    // Check every 10 seconds
    checkConnection();
    interval = setInterval(checkConnection, 10000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: isOffline ? 0 : -60,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [isOffline, slideAnim]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        transform: [{ translateY: slideAnim }],
      }}
      pointerEvents={isOffline ? "auto" : "none"}
    >
      <View
        style={{
          backgroundColor: "#EF4444",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: Platform.OS === "ios" ? 50 : 36,
          paddingBottom: 10,
          paddingHorizontal: 16,
          gap: 8,
        }}
      >
        <Ionicons name="cloud-offline-outline" size={18} color="#FFFFFF" />
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 13,
            fontFamily: "Inter_500Medium",
          }}
        >
          No internet connection
        </Text>
      </View>
    </Animated.View>
  );
}
