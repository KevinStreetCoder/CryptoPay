import { Stack } from "expo-router";

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#060E1F" },
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
    </Stack>
  );
}
