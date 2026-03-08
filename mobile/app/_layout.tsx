import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAuth } from "../src/stores/auth";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { NetworkStatus } from "../src/components/NetworkStatus";
import { LoadingScreen } from "../src/components/LoadingScreen";
import { ToastProvider } from "../src/components/Toast";
import { DashboardLayout } from "../src/components/WebSidebar";
import { usePushNotifications } from "../src/hooks/usePushNotifications";
import { storage } from "../src/utils/storage";
import { ONBOARDING_COMPLETED_KEY } from "./onboarding";
// Keep splash screen visible until we decide what to show
SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 30000 },
  },
});

function RootNavigator() {
  const { user, loading, bootstrap } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState<
    boolean | null
  >(null);

  // Register for push notifications when the user is authenticated
  const { expoPushToken } = usePushNotifications();

  useEffect(() => {
    const init = async () => {
      const [, onboardingFlag] = await Promise.all([
        bootstrap(),
        storage.getItemAsync(ONBOARDING_COMPLETED_KEY),
      ]);
      setOnboardingCompleted(onboardingFlag === "true");
      setAppReady(true);
      await SplashScreen.hideAsync().catch(() => {});
    };
    init();
  }, [bootstrap]);

  // Auth gate: redirect based on onboarding + auth state
  useEffect(() => {
    if (!appReady || onboardingCompleted === null) return;

    const inAuthGroup = segments[0] === "auth";
    const inOnboarding = segments[0] === "onboarding";

    // If onboarding not completed, redirect there (unless already on it)
    if (!onboardingCompleted && !inOnboarding) {
      router.replace("/onboarding");
      return;
    }

    // If onboarding is done but user is still on the onboarding screen, move on
    if (onboardingCompleted && inOnboarding) {
      router.replace("/auth/login");
      return;
    }

    // Normal auth gating (only when onboarding is complete)
    if (onboardingCompleted && !user && !inAuthGroup && !inOnboarding) {
      router.replace("/auth/login");
    } else if (user && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [user, segments, appReady, onboardingCompleted, router]);

  if (!appReady) {
    return <LoadingScreen />;
  }

  const inAuthGroup = segments[0] === "auth";
  const showDashboard = !!user && !inAuthGroup;

  return (
    <View style={{ flex: 1, backgroundColor: "#060E1F" }}>
      <NetworkStatus />
      <StatusBar style="light" />
      {showDashboard ? (
        <DashboardLayout>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#060E1F" },
              animation: "slide_from_right",
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="onboarding"
              options={{ animation: "fade" }}
            />
            <Stack.Screen
              name="auth"
              options={{ animation: "slide_from_bottom" }}
            />
            <Stack.Screen name="payment" />
            <Stack.Screen
              name="settings"
              options={{ animation: "slide_from_bottom" }}
            />
          </Stack>
        </DashboardLayout>
      ) : (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#060E1F" },
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="onboarding"
            options={{ animation: "fade" }}
          />
          <Stack.Screen
            name="auth"
            options={{ animation: "slide_from_bottom" }}
          />
          <Stack.Screen name="payment" />
          <Stack.Screen
            name="settings"
            options={{ animation: "slide_from_bottom" }}
          />
        </Stack>
      )}
    </View>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
