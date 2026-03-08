import { View, Text, Pressable, ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/theme";

interface HeaderProps {
  title: string;
  showBack?: boolean;
  onBackPress?: () => void;
  rightAction?: {
    icon: string;
    onPress: () => void;
  };
  transparent?: boolean;
}

export function Header({
  title,
  showBack = true,
  onBackPress,
  rightAction,
  transparent = false,
}: HeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (onBackPress) {
      onBackPress();
    } else {
      router.back();
    }
  };

  const containerStyle: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
    minHeight: 56,
    backgroundColor: transparent ? "transparent" : colors.dark.bg,
  };

  return (
    <View style={containerStyle}>
      {/* Left: back button or spacer */}
      {showBack ? (
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: transparent
              ? "rgba(30, 41, 59, 0.6)"
              : colors.dark.card,
          }}
        >
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
      ) : (
        <View style={{ width: 48 }} />
      )}

      {/* Center: title */}
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 17,
          fontFamily: "Inter_600SemiBold",
          flex: 1,
          textAlign: "center",
        }}
        numberOfLines={1}
      >
        {title}
      </Text>

      {/* Right: action or spacer */}
      {rightAction ? (
        <Pressable
          onPress={rightAction.onPress}
          hitSlop={12}
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: transparent
              ? "rgba(30, 41, 59, 0.6)"
              : colors.dark.card,
          }}
        >
          <Ionicons
            name={rightAction.icon as any}
            size={22}
            color="#FFFFFF"
          />
        </Pressable>
      ) : (
        <View style={{ width: 48 }} />
      )}
    </View>
  );
}
