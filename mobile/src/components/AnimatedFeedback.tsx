import React, { useEffect, useRef } from "react";
import { View, Text, Platform, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const useNative = Platform.OS !== "web";

const STATUS_CONFIG = {
  success: { icon: "checkmark", color: "#10B981" },
  error: { icon: "close", color: "#EF4444" },
  warning: { icon: "alert", color: "#F59E0B" },
  loading: { icon: "hourglass-outline", color: "#3B82F6" },
} as const;

interface StatusAnimationProps {
  status: "success" | "error" | "warning" | "loading";
  size?: number;
  message?: string;
}

export function StatusAnimation({ status, size = 80, message }: StatusAnimationProps) {
  const config = STATUS_CONFIG[status];
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scale.setValue(0);
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 80,
      useNativeDriver: useNative,
    }).start();
  }, [status]);

  return (
    <View style={{ alignItems: "center" }}>
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: config.color + "18",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: config.color + "35",
          transform: [{ scale }],
          marginBottom: message ? 16 : 0,
        }}
      >
        <Ionicons
          name={config.icon as any}
          size={size * 0.45}
          color={config.color}
        />
      </Animated.View>
      {message && (
        <Text
          style={{
            color: "#8899AA",
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
            textAlign: "center",
          }}
        >
          {message}
        </Text>
      )}
    </View>
  );
}
