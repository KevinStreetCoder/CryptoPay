import { Pressable, Text, ActivityIndicator, View } from "react-native";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  testID?: string;
}

const variantStyles = {
  primary: "bg-primary-500 active:bg-primary-600",
  secondary: "bg-dark-elevated active:bg-dark-border",
  outline: "border-2 border-primary-500 active:bg-primary-500/10",
  ghost: "active:bg-dark-elevated",
};

const variantTextStyles = {
  primary: "text-white",
  secondary: "text-white",
  outline: "text-primary-400",
  ghost: "text-primary-400",
};

const sizeStyles = {
  sm: "px-4 py-2 rounded-lg",
  md: "px-6 py-3.5 rounded-xl",
  lg: "px-8 py-4 rounded-2xl",
};

const sizeTextStyles = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
};

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  testID,
}: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      className={`flex-row items-center justify-center ${variantStyles[variant]} ${sizeStyles[size]} ${
        disabled ? "opacity-50" : ""
      }`}
      style={{ minHeight: 48 }}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <View className="flex-row items-center gap-2">
          {icon}
          <Text
            className={`font-inter-semibold ${variantTextStyles[variant]} ${sizeTextStyles[size]}`}
            maxFontSizeMultiplier={1.3}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
