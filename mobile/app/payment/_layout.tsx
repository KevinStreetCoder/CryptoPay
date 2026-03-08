import { Stack } from "expo-router";

export default function PaymentLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#060E1F" },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="paybill" />
      <Stack.Screen name="till" />
      <Stack.Screen name="send" />
      <Stack.Screen name="detail" />
      <Stack.Screen name="buy-crypto" />
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
