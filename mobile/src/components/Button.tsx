import React from "react";
import {
  Pressable,
  Text,
  View,
  Animated,
  StyleSheet,
  ViewStyle,
  Platform,
} from "react-native";
import { colors, shadows } from "../constants/theme";
import { BrandedSpinner } from "./BrandedSpinner";

const isWeb = Platform.OS === "web";
const useNative = !isWeb;

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  testID?: string;
  style?: ViewStyle;
}

const SIZE_CONFIG = {
  sm: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    fontSize: 14,
    minHeight: 40,
    spinnerSize: "small" as const,
  },
  md: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    fontSize: 15,
    minHeight: 48,
    spinnerSize: "small" as const,
  },
  lg: {
    paddingHorizontal: 32,
    paddingVertical: 18,
    borderRadius: 20,
    fontSize: 17,
    minHeight: 56,
    spinnerSize: "medium" as const,
  },
} as const;

const VARIANT_STYLES = {
  primary: {
    bg: colors.primary[500],
    bgPressed: colors.primary[600],
    bgHover: colors.primary[400],
    text: "#FFFFFF",
    border: "transparent",
    borderWidth: 0,
  },
  secondary: {
    bg: "rgba(22, 39, 66, 0.7)",
    bgPressed: "rgba(22, 39, 66, 0.9)",
    bgHover: "rgba(22, 39, 66, 0.85)",
    text: "#FFFFFF",
    border: colors.glass.border,
    borderWidth: 1,
  },
  outline: {
    bg: "transparent",
    bgPressed: "rgba(16, 185, 129, 0.08)",
    bgHover: "rgba(16, 185, 129, 0.05)",
    text: colors.primary[400],
    border: colors.primary[500],
    borderWidth: 1.5,
  },
  ghost: {
    bg: "transparent",
    bgPressed: colors.dark.elevated,
    bgHover: "rgba(22, 39, 66, 0.4)",
    text: colors.primary[400],
    border: "transparent",
    borderWidth: 0,
  },
} as const;

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  testID,
  style: containerStyle,
}: ButtonProps) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const flashAnim = React.useRef(new Animated.Value(0)).current;
  const sizeConfig = SIZE_CONFIG[size];
  const variantStyle = VARIANT_STYLES[variant];

  const handlePressIn = () => {
    // Spring scale down
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: useNative,
      tension: 300,
      friction: 20,
    }).start();

    // Ripple-like opacity flash
    flashAnim.setValue(1);
    Animated.timing(flashAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: useNative,
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

  const glowShadow =
    variant === "primary" && !disabled
      ? shadows.glow(colors.primary[500], 0.35)
      : shadows.sm;

  // Opacity flash overlay interpolation (0 -> transparent, 1 -> white flash)
  const flashOpacity = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.12],
  });

  // Web-specific inline styles for smooth CSS transitions and cursor
  const webOuterStyle: any = isWeb
    ? {
        transition:
          "transform 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease",
      }
    : undefined;

  return (
    <Animated.View
      style={[
        {
          transform: [{ scale: scaleAnim }],
          opacity: disabled ? 0.5 : 1,
        },
        variant === "primary" && !disabled ? glowShadow : null,
        webOuterStyle,
        containerStyle,
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        style={({ pressed, hovered }: any) => {
          const isHovered = isWeb && hovered && !pressed;
          return [
            {
              flexDirection: "row" as const,
              alignItems: "center" as const,
              justifyContent: "center" as const,
              backgroundColor: pressed
                ? variantStyle.bgPressed
                : isHovered
                  ? variantStyle.bgHover
                  : variantStyle.bg,
              borderColor: variantStyle.border,
              borderWidth: variantStyle.borderWidth,
              paddingHorizontal: sizeConfig.paddingHorizontal,
              paddingVertical: sizeConfig.paddingVertical,
              borderRadius: sizeConfig.borderRadius,
              minHeight: sizeConfig.minHeight,
              opacity: pressed ? 0.9 : 1,
              overflow: "hidden" as const,
              position: "relative" as const,
              ...(isWeb
                ? ({
                    cursor: disabled || loading ? "default" : "pointer",
                    transition: "background-color 0.15s ease",
                  } as any)
                : {}),
            },
          ];
        }}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        testID={testID}
      >
        {/* Ripple flash overlay */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: "#FFFFFF",
              opacity: flashOpacity,
              borderRadius: sizeConfig.borderRadius,
            },
          ]}
        />

        {loading ? (
          <BrandedSpinner
            size={sizeConfig.spinnerSize}
            color={variantStyle.text}
          />
        ) : (
          <View style={styles.content}>
            {icon}
            <Text
              style={[
                styles.text,
                {
                  color: variantStyle.text,
                  fontSize: sizeConfig.fontSize,
                  marginLeft: icon ? 8 : 0,
                },
              ]}
              maxFontSizeMultiplier={1.3}
            >
              {title}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
});
