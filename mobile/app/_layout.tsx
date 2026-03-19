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

// WalletConnect AppKit — DISABLED until WalletConnect integration is needed
// The AppKit module-level imports crash on Android with:
// "AppKit instance is not yet available in context"
// Re-enable when WalletConnect deposit flow is production-ready
// let AppKitModal: React.ComponentType | null = null;
// let initAppKit: (() => any) | null = null;

// Hide native splash quickly — our animated LoadingScreen takes over
SplashScreen.preventAutoHideAsync().catch(() => {});
setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 500);

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
  const [initStatus, setInitStatus] = useState("Starting...");
  const [showOnboarding, setShowOnboarding] = useState(false);

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { expoPushToken } = usePushNotifications();

  useEffect(() => {
    const init = async () => {
      try {
        setInitStatus("Connecting...");
        // Race bootstrap against a 8s timeout — don't hang forever
        await Promise.race([
          Promise.all([
            bootstrap().then(() => setInitStatus("Authenticated")),
            initTheme(),
            initPrivacy(),
          ]),
          new Promise((_, reject) => setTimeout(() => {
            setInitStatus("Taking longer than usual...");
            reject(new Error("Init timeout"));
          }, 8000)),
        ]);
      } catch (e: any) {
        // Timeout or error — proceed anyway (user will land on login screen)
        setInitStatus(e?.message === "Init timeout" ? "Ready" : `Error: ${e?.message?.slice(0, 50)}`);
        console.warn("App init failed or timed out:", e);
      }
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

    const isLanding = segments[0] === "landing" || (!segments[0] && !user); // Root = landing for unauth
    const isPitch = segments[0] === "pitch";
    const isPrivacy = segments[0] === "privacy";
    const isTerms = segments[0] === "terms";
    const isPublicPage = isLanding || isPitch || isPrivacy || isTerms;

    const webHost = Platform.OS === "web" && typeof window !== "undefined" ? window.location?.hostname : "";
    const isAppSubdomain = webHost === "app.cpay.co.ke";

    if (!user && !inAuthGroup && !isPublicPage) {
      if (Platform.OS === "web") {
        if (isAppSubdomain) {
          router.replace("/auth/login");
          return;
        }
        // Root index.tsx handles landing page rendering — no redirect needed
        // Only redirect if user navigated to a non-public route directly
        if (segments[0]) {
          router.replace("/");
        }
      } else {
        router.replace("/auth/login");
      }
    } else if (user && (inAuthGroup || isLanding)) {
      router.replace("/(tabs)");
    }
  }, [user, segments, appReady, router]);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    // Trigger the interactive tooltip tour after onboarding slides
    triggerAppTour();
  }, []);

  if (!appReady) {
    return <LoadingScreen status={initStatus} />;
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

// AppKit/WalletConnect disabled on mobile — users deposit via manual addresses
// Re-enable when WalletConnect native support is needed
// let appKitReady = false;

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  // Font timeout: don't block the app forever if fonts fail to load
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!fontsLoaded && !fontTimeout) {
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
              {/* AppKit disabled on mobile — WalletConnect uses manual deposit addresses instead */}
            </ToastProvider>
          </LanguageProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
