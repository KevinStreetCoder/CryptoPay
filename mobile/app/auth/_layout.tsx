import { Stack } from "expo-router";
import { useThemeMode } from "../../src/stores/theme";
import { getThemeColors } from "../../src/constants/theme";

export default function AuthLayout() {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tc.dark.bg },
        animation: "slide_from_bottom",
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
