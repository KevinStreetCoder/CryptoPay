import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const isWeb = Platform.OS === "web";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionIcon?: string;
  onAction?: () => void;
  icon?: string;
  iconColor?: string;
  count?: number;
  uppercase?: boolean;
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  actionIcon = "chevron-forward",
  onAction,
  icon,
  iconColor,
  count,
  uppercase = true,
}: SectionHeaderProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
        paddingHorizontal: 4,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
        {icon ? (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: (iconColor || colors.primary[400]) + "15",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name={icon as any}
              size={14}
              color={iconColor || colors.primary[400]}
            />
          </View>
        ) : null}
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={
                uppercase
                  ? {
                      color: tc.textMuted,
                      fontSize: 11,
                      fontFamily: "DMSans_600SemiBold",
                      letterSpacing: 1.2,
                      textTransform: "uppercase",
                    }
                  : {
                      color: tc.textPrimary,
                      fontSize: 17,
                      fontFamily: "DMSans_600SemiBold",
                      letterSpacing: -0.2,
                    }
              }
            >
              {title}
            </Text>
            {count !== undefined && count > 0 && (
              <View
                style={{
                  backgroundColor: colors.primary[500] + "20",
                  borderRadius: 10,
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  minWidth: 22,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: colors.primary[400],
                    fontSize: 11,
                    fontFamily: "DMSans_700Bold",
                  }}
                >
                  {count}
                </Text>
              </View>
            )}
          </View>
          {subtitle ? (
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
                marginTop: 2,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingVertical: 4,
            paddingHorizontal: 8,
            borderRadius: 8,
            backgroundColor: isWeb && hovered ? colors.primary[400] + "10" : "transparent",
            opacity: pressed ? 0.7 : 1,
            ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
          })}
        >
          <Text
            style={{
              color: colors.primary[400],
              fontSize: 13,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            {actionLabel}
          </Text>
          <Ionicons name={actionIcon as any} size={14} color={colors.primary[400]} />
        </Pressable>
      )}
    </View>
  );
}
