// Router includes /r/[code] public referral landing + /settings/referrals
import { useEffect, useState, useCallback } from "react";
import { View, Platform } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { Ionicons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  useAuth,
  isBiometricEnabled,
  isGoogleUnlockPending,
  getGoogleUnlockPendingSync,
  subscribeGoogleUnlock,
} from "../src/stores/auth";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { NetworkStatus } from "../src/components/NetworkStatus";
import { LoadingScreen } from "../src/components/LoadingScreen";
import { ToastProvider } from "../src/components/Toast";
import { DashboardLayout } from "../src/components/WebSidebar";
import { AppLockScreen } from "../src/components/AppLockScreen";
import { useAppLock } from "../src/hooks/useAppLock";
import { usePushNotifications } from "../src/hooks/usePushNotifications";
import { storage } from "../src/utils/storage";
import { initTheme, useThemeMode } from "../src/stores/theme";
import { getThemeColors } from "../src/constants/theme";
import { initPrivacy } from "../src/utils/privacy";
import { LanguageProvider } from "../src/contexts/LanguageContext";
import { OnboardingModal, ONBOARDING_COMPLETED_KEY } from "./onboarding";
import { AppTourProvider, triggerAppTour } from "../src/components/AppTour";

// WalletConnect AppKit · initialized LAZILY inside deposit screen only
// DO NOT import appkit.ts or @reown/appkit-react-native here.
// Their module-level side effects register React context hooks that crash
// with "AppKit instance is not yet available in context" before the
// React tree is mounted. AppKit is initialized on-demand when the user
// navigates to the deposit screen via React.lazy() in deposit.tsx.

// Prevent native splash from hiding until we're ready
SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry if session expired · user needs to re-login
        if (error && (error as any).name === "SessionExpiredError") return false;
        return failureCount < 2;
      },
      staleTime: 30000,
    },
  },
});

function RootNavigator() {
  const { user, loading, bootstrap, logout } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);
  const [initStatus, setInitStatus] = useState("Starting...");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { expoPushToken } = usePushNotifications();

  // App lock: monitors background/foreground transitions
  const { locked, unlock } = useAppLock(biometricOn, !!user);

  // Check biometric setting when user changes
  useEffect(() => {
    if (user) {
      isBiometricEnabled().then(setBiometricOn);
    }
  }, [user]);

  // Hide native splash as soon as RootNavigator mounts (LoadingScreen takes over)
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        setInitStatus("Connecting...");
        // Race bootstrap against a 8s timeout · don't hang forever
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
        // Timeout or error · proceed anyway (user will land on login screen).
        // We intentionally don't log to console here: on flaky mobile networks
        // this path fires frequently and would spam the JS console; the status
        // message already surfaces the issue in the loading screen itself.
        setInitStatus(e?.message === "Init timeout" ? "Ready" : `Error: ${e?.message?.slice(0, 50)}`);
      }
      setAppReady(true);
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

  // Google-unlock sentinel · read synchronously from a module-level
  // mirror populated atomically by setGoogleUnlockPendingFlag() /
  // clearGoogleUnlockFlag() so the auth gate never sees a stale value
  // during Google sign-in or PIN-verify transitions.
  const [googleUnlockPending, setGoogleUnlockPending] = useState(
    getGoogleUnlockPendingSync(),
  );
  // Hydrate the mirror from SecureStore on mount (and whenever user
  // changes) · handles cold starts where the mirror hasn't been
  // initialised yet (e.g. user re-opens the tab after closing it).
  useEffect(() => {
    if (!user) {
      setGoogleUnlockPending(false);
      return;
    }
    let cancelled = false;
    isGoogleUnlockPending().then((pending) => {
      if (!cancelled) setGoogleUnlockPending(pending);
    });
    const unsub = subscribeGoogleUnlock(() => {
      setGoogleUnlockPending(getGoogleUnlockPendingSync());
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user]);

  // Auth gate
  useEffect(() => {
    if (!appReady) return;

    const inAuthGroup = segments[0] === "auth";
    const inOnboarding = segments[0] === "onboarding";

    // Force Google-authenticated users through PIN/biometric before they
    // can reach authenticated routes. `auth/google-unlock` itself and
    // `auth/set-initial-pin` are allowed; everything else is blocked.
    if (user && googleUnlockPending) {
      const isUnlockScreen = segments[0] === "auth" && (
        segments[1] === "google-unlock" || segments[1] === "set-initial-pin"
      );
      if (!isUnlockScreen) {
        router.replace("/auth/google-unlock" as any);
        return;
      }
    }

    // Skip onboarding route · redirect to proper place
    if (inOnboarding) {
      if (user) router.replace("/(tabs)");
      else router.replace("/auth/login");
      return;
    }

    const isLanding = segments[0] === "landing" || (!segments[0] && !user); // Root = landing for unauth
    const isPitch = segments[0] === "pitch";
    const isPrivacy = segments[0] === "privacy";
    const isTerms = segments[0] === "terms";
    const isReferralLanding = segments[0] === "r"; // /r/{code} public referral landing
    const isPublicPage = isLanding || isPitch || isPrivacy || isTerms || isReferralLanding;

    const webHost = Platform.OS === "web" && typeof window !== "undefined" ? window.location?.hostname : "";
    const isAppSubdomain = webHost === "app.cpay.co.ke";

    if (!user && !inAuthGroup && !isPublicPage) {
      if (Platform.OS === "web") {
        if (isAppSubdomain) {
          router.replace("/auth/login");
          return;
        }
        // Root index.tsx handles landing page rendering · no redirect needed
        // Only redirect if user navigated to a non-public route directly
        if (segments[0]) {
          router.replace("/");
        }
      } else {
        router.replace("/auth/login");
      }
    } else if (user && (inAuthGroup || isLanding)) {
      // Exempt the Google-unlock gate and the initial-PIN setup from the
      // default "authenticated user bounces back to tabs" rule. Without
      // this, a returning Google user is instantly redirected to (tabs)
      // the moment tokens are stored · before the async
      // `googleUnlockPending` state has caught up · and the unlock
      // screen is bypassed.
      const isUnlockScreen = segments[0] === "auth" && (
        segments[1] === "google-unlock" || segments[1] === "set-initial-pin"
      );
      if (!isUnlockScreen) {
        router.replace("/(tabs)");
      }
    }
  }, [user, segments, appReady, router, googleUnlockPending]);

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

  // Show lock screen overlay when app is locked
  if (locked && user) {
    return (
      <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <AppLockScreen
          onUnlock={unlock}
          userPhone={user?.phone}
          onForgotPin={() => {
            // Force logout and redirect to forgot-pin
            unlock(); // Remove lock screen
            logout(); // Clear tokens
            setTimeout(() => router.replace("/auth/forgot-pin" as any), 100);
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <NetworkStatus />
      <StatusBar style={isDark ? "light" : "dark"} />
      {showDashboard ? (
        <DashboardLayout>{stackContent}</DashboardLayout>
      ) : (
        stackContent
      )}

      {/* Onboarding popup · shown once after first login */}
      <OnboardingModal
        visible={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
    </View>
  );
}

// AppKit initialized lazily in deposit screen

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    ...Ionicons.font,
  });

  // Font timeout: don't block the app forever if fonts fail to load
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!fontsLoaded && !fontTimeout) {
    return (
      <View style={{ flex: 1, backgroundColor: '#060E1F' }}>
        <LoadingScreen status="Loading fonts..." />
      </View>
    );
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
              {/* AppKit modal renders lazily inside deposit screen */}
            </ToastProvider>
          </LanguageProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
