import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors, getThemeShadows } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const isWeb = Platform.OS === "web";

interface QuickActionProps {
  icon: string;
  label: string;
  color?: string;
  onPress: () => void;
  badge?: string;
}

export function QuickAction({
  icon,
  label,
  color = colors.primary[400],
  onPress,
  badge,
}: QuickActionProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed, hovered }: any) => ({
          alignItems: "center",
          minWidth: 44,
          minHeight: 44,
          opacity: pressed ? 0.7 : 1,
          transform: [{ scale: pressed ? 0.95 : 1 }],
          ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
        })}
      >
        <View style={{ position: "relative", marginBottom: 10 }}>
          <View
            style={{
              width: 54,
              height: 54,
              borderRadius: 17,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: color + "15",
              borderWidth: 1,
              borderColor: color + "25",
            }}
          >
            <Ionicons name={icon as any} size={24} color={color} />
          </View>
          {badge && (
            <View
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                backgroundColor: colors.error,
                borderRadius: 7,
                paddingHorizontal: 5,
                paddingVertical: 1,
                minWidth: 16,
                alignItems: "center",
                borderWidth: 2,
                borderColor: tc.dark.bg,
              }}
            >
              <Text style={{ color: "#FFF", fontSize: 9, fontFamily: "DMSans_700Bold" }}>
                {badge}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={{
            fontSize: 12,
            fontFamily: "DMSans_600SemiBold",
            color: tc.textSecondary,
            textAlign: "center",
            letterSpacing: 0.1,
          }}
          maxFontSizeMultiplier={1.3}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

/* ─── Desktop Quick Action Card ─── */
interface DesktopQuickActionCardProps {
  icon: string;
  label: string;
  description: string;
  color: string;
  onPress: () => void;
  badge?: string;
}

export function DesktopQuickActionCard({
  icon,
  label,
  description,
  color,
  onPress,
  badge,
}: DesktopQuickActionCardProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: any) => ({
        flex: 1,
        backgroundColor: hovered ? tc.dark.elevated : tc.dark.card,
        borderRadius: 18,
        padding: 20,
        borderWidth: 1,
        borderColor: pressed ? color + "40" : hovered ? tc.glass.borderStrong : tc.glass.border,
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        ...(isWeb
          ? { cursor: "pointer", transition: "all 0.2s ease" } as any
          : {}),
        ...ts.sm,
      })}
    >
      <View style={{ position: "relative", marginBottom: 14 }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 15,
            backgroundColor: color + "15",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: color + "20",
          }}
        >
          <Ionicons name={icon as any} size={22} color={color} />
        </View>
        {badge && (
          <View
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              backgroundColor: colors.error,
              borderRadius: 7,
              paddingHorizontal: 5,
              paddingVertical: 1,
              minWidth: 16,
              alignItems: "center",
              borderWidth: 2,
              borderColor: tc.dark.card,
            }}
          >
            <Text style={{ color: "#FFF", fontSize: 9, fontFamily: "DMSans_700Bold" }}>{badge}</Text>
          </View>
        )}
      </View>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 14,
          fontFamily: "DMSans_600SemiBold",
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 12,
          fontFamily: "DMSans_400Regular",
          lineHeight: 17,
        }}
      >
        {description}
      </Text>
    </Pressable>
  );
}
