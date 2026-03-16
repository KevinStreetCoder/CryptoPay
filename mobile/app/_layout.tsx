import { useEffect, useState, useCallback } from "react";
import { View, Platform } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
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
import { initTheme, useThemeMode } from "../src/stores/theme";
import { getThemeColors } from "../src/constants/theme";
import { initPrivacy } from "../src/utils/privacy";
import { LanguageProvider } from "../src/contexts/LanguageContext";
import { OnboardingModal, ONBOARDING_COMPLETED_KEY } from "./onboarding";
import { AppTourProvider, triggerAppTour } from "../src/components/AppTour";

// WalletConnect AppKit — gracefully degrade if not available (Expo Go)
let AppKitModal: React.ComponentType | null = null;
let initAppKit: (() => any) | null = null;

try {
  const appkitConfig = require("../src/config/appkit");
  initAppKit = appkitConfig.initAppKit;

  // Only load the native AppKit modal on non-web platforms
  // On web, AppKit uses a web modal that doesn't need this component
  if (Platform.OS !== "web") {
    const appkitRN = require("@reown/appkit-react-native");
    AppKitModal = appkitRN.AppKit;
  }
} catch {
  // AppKit not available — Expo Go or missing dependencies
}

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry if session expired — user needs to re-login
        if (error && (error as any).name === "SessionExpiredError") return false;
        return failureCount < 2;
      },
      staleTime: 30000,
    },
  },
});

function RootNavigator() {
  const { user, loading, bootstrap } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { expoPushToken } = usePushNotifications();

  useEffect(() => {
    const init = async () => {
      await Promise.all([bootstrap(), initTheme(), initPrivacy()]);
      setAppReady(true);
      await SplashScreen.hideAsync().catch(() => {});
    };
    init();
  }, [bootstrap]);

  // Check onboarding status when user logs in
  useEffect(() => {
    if (!user) {
      setShowOnboarding(false);
      return;
    }
    (async () => {
      const flag = await storage.getItemAsync(ONBOARDING_COMPLETED_KEY);
      if (flag !== "true") {
        setShowOnboarding(true);
      }
    })();
  }, [user]);

  // Auth gate
  useEffect(() => {
    if (!appReady) return;

    const inAuthGroup = segments[0] === "auth";
    const inOnboarding = segments[0] === "onboarding";

    // Skip onboarding route — redirect to proper place
    if (inOnboarding) {
      if (user) router.replace("/(tabs)");
      else router.replace("/auth/login");
      return;
    }

    const isLanding = segments[0] === "landing";
    const isPitch = segments[0] === "pitch";

    if (!user && !inAuthGroup && !isLanding && !isPitch) {
      // Show landing page to unauthenticated visitors on web, login on native
      if (Platform.OS === "web") {
        router.replace("/landing");
      } else {
        router.replace("/auth/login");
      }
    } else if (user && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [user, segments, appReady, router]);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    // Trigger the interactive tooltip tour after onboarding slides
    triggerAppTour();
  }, []);

  if (!appReady) {
    return <LoadingScreen />;
  }

  const inAuthGroup = segments[0] === "auth";
  const isLandingPage = segments[0] === "landing";
  const isPitchPage = segments[0] === "pitch";
  const showDashboard = !!user && !inAuthGroup && !isLandingPage && !isPitchPage;

  const stackContent = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tc.dark.bg },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="landing" options={{ animation: "fade" }} />
      <Stack.Screen name="pitch" options={{ animation: "fade" }} />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
      <Stack.Screen name="auth" options={{ animation: "slide_from_bottom" }} />
      <Stack.Screen name="payment" />
      <Stack.Screen name="settings" options={{ animation: "slide_from_bottom" }} />
    </Stack>
  );

  return (
    <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <NetworkStatus />
      <StatusBar style={isDark ? "light" : "dark"} />
      {showDashboard ? (
        <DashboardLayout>{stackContent}</DashboardLayout>
      ) : (
        stackContent
      )}

      {/* Onboarding popup — shown once after first login */}
      <OnboardingModal
        visible={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
    </View>
  );
}

// Initialize AppKit once at module level
// initAppKit() returns null if PROJECT_ID is missing — guard <AppKit /> on success
let appKitReady = false;
if (initAppKit) {
  try {
    const result = initAppKit();
    appKitReady = result != null;
  } catch {
    // Silently fail — WalletConnect won't be available
  }
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <LanguageProvider>
            <ToastProvider>
              <AppTourProvider>
                <RootNavigator />
              </AppTourProvider>
              {appKitReady && AppKitModal && <AppKitModal />}
            </ToastProvider>
          </LanguageProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
