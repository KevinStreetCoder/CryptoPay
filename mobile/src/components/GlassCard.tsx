/**
 * GlassCard — reusable glassmorphism container with optional glow border.
 * Uses expo-blur on native, CSS backdrop-filter on web.
 */
import { View, Platform, ViewStyle, StyleProp } from "react-native";
import { BlurView } from "expo-blur";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Glow border color — defaults to emerald primary */
  glowColor?: string;
  /** Glow intensity 0–1 */
  glowOpacity?: number;
  /** Blur intensity (native only) */
  intensity?: number;
  /** No glow border */
  noGlow?: boolean;
}

const isWeb = Platform.OS === "web";

export function GlassCard({
  children,
  style,
  glowColor,
  glowOpacity = 0.25,
  intensity = 40,
  noGlow = false,
}: GlassCardProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const glow = glowColor || colors.primary[500];

  const containerStyle: ViewStyle = {
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: noGlow ? 1 : 1.5,
    borderColor: noGlow ? tc.glass.border : glow + "40",
  };

  const webGlassStyle: any = isWeb
    ? {
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        backgroundColor: isDark ? "rgba(12, 26, 46, 0.75)" : "rgba(255, 255, 255, 0.75)",
        boxShadow: noGlow
          ? "0 4px 24px rgba(0,0,0,0.2)"
          : `0 4px 24px rgba(0,0,0,0.2), 0 0 20px ${glow}${Math.round(glowOpacity * 255).toString(16).padStart(2, "0")}`,
      }
    : {};

  if (isWeb) {
    return (
      <View style={[containerStyle, webGlassStyle, style]}>
        {children}
      </View>
    );
  }

  return (
    <View style={[containerStyle, { backgroundColor: tc.dark.card }, style]}>
      <BlurView
        intensity={intensity}
        tint={isDark ? "dark" : "light"}
        style={{ flex: 1 }}
      >
        {children}
      </BlurView>
    </View>
  );
}
