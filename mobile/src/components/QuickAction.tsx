import React from "react";
import { View, Text, Pressable, Animated, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/theme";

const useNative = Platform.OS !== "web";

interface QuickActionProps {
  icon: string;
  label: string;
  color?: string;
  onPress: () => void;
}

export function QuickAction({
  icon,
  label,
  color = colors.primary[400],
  onPress,
}: QuickActionProps) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.92,
      useNativeDriver: useNative,
      tension: 300,
      friction: 20,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: useNative,
      tension: 300,
      friction: 20,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.pressable}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <View
          style={[
            styles.iconContainer,
            {
              backgroundColor: color + "1F", // ~12% opacity
              borderColor: color + "33", // ~20% opacity
            },
          ]}
        >
          <Ionicons name={icon as any} size={24} color={color} />
        </View>
        <Text style={styles.label} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    alignItems: "center",
  },
  pressable: {
    alignItems: "center",
    minWidth: 44,
    minHeight: 44,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    borderWidth: 1,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: colors.textMuted,
    textAlign: "center",
  },
});
