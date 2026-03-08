import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/theme";

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
  return (
    <Pressable
      onPress={onPress}
      className="items-center flex-1 active:opacity-70"
    >
      <View
        className="w-14 h-14 rounded-2xl items-center justify-center mb-2"
        style={{ backgroundColor: color + "15" }}
      >
        <Ionicons name={icon as any} size={26} color={color} />
      </View>
      <Text className="text-textSecondary text-xs font-inter-medium text-center">
        {label}
      </Text>
    </Pressable>
  );
}
