import { Stack } from "expo-router";

export default function PaymentLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#0F172A" },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="paybill" />
      <Stack.Screen name="till" />
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
