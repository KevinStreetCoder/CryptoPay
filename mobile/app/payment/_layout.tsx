import { Stack } from "expo-router";
import { useThemeMode } from "../../src/stores/theme";
import { getThemeColors } from "../../src/constants/theme";

export default function PaymentLayout() {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tc.dark.bg },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="paybill" />
      <Stack.Screen name="till" />
      <Stack.Screen name="send" />
      <Stack.Screen name="send-to-bank" />
      <Stack.Screen name="detail" />
      <Stack.Screen name="buy-crypto" />
      <Stack.Screen name="deposit" />
      <Stack.Screen name="withdraw" />
      <Stack.Screen name="swap" />
      <Stack.Screen name="confirm" />
      <Stack.Screen
        name="success"
        options={{
          animation: "fade",
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
}
