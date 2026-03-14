import { Stack } from "expo-router";
import { useThemeMode } from "../../src/stores/theme";
import { getThemeColors } from "../../src/constants/theme";

export default function SettingsLayout() {
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
      <Stack.Screen name="index" />
      <Stack.Screen name="change-pin" />
      <Stack.Screen name="kyc" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="language" />
      <Stack.Screen name="help" />
      <Stack.Screen name="notifications-inbox" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="security" />
      <Stack.Screen name="devices" />
      <Stack.Screen name="totp-setup" />
      <Stack.Screen name="admin-rebalance" />
      <Stack.Screen name="admin-users" />
      <Stack.Screen name="admin-user-detail" />
      <Stack.Screen name="currency" />
    </Stack>
  );
}
